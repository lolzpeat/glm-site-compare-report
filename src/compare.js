// Main comparison pipeline. For each prod↔AEM URL pair:
//   1. load both pages (concurrent workers)
//   2. extract DOM metrics from each
//   3. screenshot each (1 full-page png)
//   4. compute parity score + per-metric diffs
//   5. accumulate → data/results.json (or custom via --output=)
//
// Usage:
//   node src/compare.js                              # main: data/results.json
//   node src/compare.js --news                       # news mode scoring
//   node src/compare.js --output=data/results-news.json  # custom output file
//   node src/compare.js --source=data/results-news.json  # custom resume source
//
// Usage: node src/compare.js [--limit=N] [--concurrency=N]

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { glob } from 'node:fs/promises';
import puppeteer from 'puppeteer-core';
import {
  DIR, VIEWPORT, NAV_TIMEOUT, NAV_WAIT_UNTIL, SETTLE_AFTER_LOAD, LAZY_WAIT_TIMEOUT, LAYOUT_WAIT_TIMEOUT, CONCURRENCY,
  SCREENSHOT_FULLPAGE, SCREENSHOT_MAX_WIDTH, MIN_TEXT_LEN, SCROLL_STIMULATE_STEPS, SCROLL_STIMULATE_DELAY,
  WEIGHTS, WEIGHTS_NEWS, TEXT_MATCH_TOLERANCE, CHROME_EXECUTABLE_PATH,
  THAI_RATIO_DELTA, IMAGE_RATIO_TOLERANCE, MAX_LINK_CHECKS, LINK_CHECK_BATCH, LINK_CHECK_DELAY,
} from '../config.js';
import sharp from 'sharp';
import { EXTRACT_FN } from './extract.js';

// ─── Text/image helpers (ported from site-compare-report) ──────────────────
const THAI_MONTHS =
  /(ม\.?ค\.?|ก\.?พ\.?|มี\.?ค\.?|เม\.?ย\.?|พ\.?ค\.?|มิ\.?ย\.?|ก\.?ค\.?|ส\.?ค\.?|ก\.?ย\.?|ต\.?ค\.?|พ\.?ย\.?|ธ\.?ค\.?|มกราคม|กุมภาพันธ์|มีนาคม|เมษายน|พฤษภาคม|มิถุนายน|กรกฎาคม|สิงหาคม|กันยายน|ตุลาคม|พฤศจิกายน|ธันวาคม)\s*\d{2,4}/;

// Filter out text blocks that are mostly digits or Thai month+year — these are
// dynamic content (dates, rates, counters) that change between captures and
// would generate false "missing text" issues.
function isDynamicBlock(s) {
  const t = String(s ?? '').replace(/\s+/g, ' ').trim();
  const digits = (t.match(/\d/g) || []).length;
  const nonSpace = t.replace(/\s/g, '').length || 1;
  if (digits / nonSpace > 0.4) return true;
  return THAI_MONTHS.test(t);
}

// Lowercased basename of a URL — used to match images across sites where the
// full src differs but the asset filename is the same.
function filenameOf(url) {
  try {
    const name = new URL(url).pathname.split('/').pop() || '';
    return decodeURIComponent(name).toLowerCase();
  } catch {
    return String(url || '').toLowerCase();
  }
}

// Output file — defaults to data/results.json, override with --output=
const OUTPUT_PATH = process.argv.find(a => a.startsWith('--output='))?.split('=')[1] || `${DIR.data}/results.json`;
// Resume source — defaults to same as output, override with --source=
const RESULTS_PATH = process.argv.find(a => a.startsWith('--source='))?.split('=')[1] || OUTPUT_PATH;
const SS_DIR = DIR.screenshots;

// Split a block of text into sentence-like chunks for missing-text comparison.
function splitSentences(text) {
  return String(text || '')
    .split(/[.\n\r!?।]+/)
    .map(s => s.trim())
    .filter(s => s.length >= 8);
}

// ─── CSV reader ───────────────────────────────────────────────────────────
async function readPairs() {
  const csvPath = process.argv.find(a => a.startsWith('--urls='))?.split('=')[1] || `${DIR.data}/urls.csv`;
  if (!existsSync(csvPath)) throw new Error(`Missing ${csvPath}. Run 'npm run fetch' first.`);
  const text = await readFile(csvPath, 'utf8');
  const lines = text.trim().split('\n');
  const header = parseCsvLine(lines[0]);
  const idx = {
    prod: header.indexOf('prodUrl'),
    aem: header.indexOf('aemUrl'),
    cat: header.indexOf('category'),
    sub: header.indexOf('subCategory'),
  };
  const pairs = [];
  for (let i = 1; i < lines.length; i++) {
    if (!lines[i].trim()) continue;
    const c = parseCsvLine(lines[i]);
    pairs.push({
      prodUrl: c[idx.prod],
      aemUrl: c[idx.aem],
      category: c[idx.cat] || '',
      subCategory: c[idx.sub] || '',
    });
  }
  return pairs;
}

// Handles quoted CSV fields.
function parseCsvLine(line) {
  const out = [];
  let field = '', inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQ) {
      if (ch === '"' && line[i + 1] === '"') { field += '"'; i++; }
      else if (ch === '"') inQ = false;
      else field += ch;
    } else {
      if (ch === '"') inQ = true;
      else if (ch === ',') { out.push(field); field = ''; }
      else field += ch;
    }
  }
  out.push(field);
  return out;
}

// ─── Per-page capture ─────────────────────────────────────────────────────
async function capturePage(page, url) {
  const result = { url, ok: false, error: null, metrics: null, screenshot: null };
  if (!url) { result.error = 'no URL'; return result; }
  try {
    await page.goto(url, { waitUntil: NAV_WAIT_UNTIL, timeout: NAV_TIMEOUT });

    // AEM is client-side rendered: the DOM populates quickly but layout
    // (offsetHeight/scrollHeight) stays 0 for many seconds while JS/CSS
    // finishes. A screenshot taken before layout settles is blank.
    // Wait until the page has real visual height, or give up after timeout.
    try {
      await page.waitForFunction(
        (minH) => document.body.scrollHeight >= minH,
        { timeout: LAYOUT_WAIT_TIMEOUT, polling: 500 },
        VIEWPORT.height
      );
    } catch {
      // Layout never settled — capture whatever we have (may be sparse/blank).
    }
    await new Promise(r => setTimeout(r, SETTLE_AFTER_LOAD));

    result.metrics = await page.evaluate(EXTRACT_FN);
    result.ok = true;
    result.metrics.lowContent = result.metrics.textLength < MIN_TEXT_LEN;

    // Broken-link check: fetch AEM same-origin links in-browser to get HTTP
    // status. Only checks links on the AEM host (cross-origin → CORS error → 0).
    const linkUrls = (result.metrics.links || [])
      .map(l => l.href)
      .filter(h => h && h.startsWith('http'))
      .slice(0, MAX_LINK_CHECKS);
    if (linkUrls.length) {
      result.metrics.linkStatuses = await page.evaluate(
        async ({ list, batchSize, delay }) => {
          const out = {};
          for (let i = 0; i < list.length; i += batchSize) {
            if (i > 0) await new Promise(r => setTimeout(r, delay));
            await Promise.all(list.slice(i, i + batchSize).map(async (u) => {
              try {
                let res = await fetch(u, { method: 'HEAD', redirect: 'follow' });
                if (res.status === 405 || res.status === 501) {
                  res = await fetch(u, { method: 'GET', redirect: 'follow' });
                }
                out[u] = res.status;
              } catch { out[u] = 0; }
            }));
          }
          return out;
        },
        { list: linkUrls, batchSize: LINK_CHECK_BATCH, delay: LINK_CHECK_DELAY }
      ).catch(() => ({}));
    }
  } catch (e) {
    result.error = e.message.split('\n')[0];
  }
  return result;
}

async function stimulateLazy(page) {
  for (let i = 0; i < SCROLL_STIMULATE_STEPS; i++) {
    await page.evaluate((step) => window.scrollTo(0, document.body.scrollHeight * (step + 1) / (SCROLL_STIMULATE_STEPS + 1)), i).catch(() => {});
    await new Promise(r => setTimeout(r, SCROLL_STIMULATE_DELAY));
  }
  await page.evaluate(() => window.scrollTo(0, 0)).catch(() => {});
  await new Promise(r => setTimeout(r, 400));
}

// ─── Parity scoring ────────────────────────────────────────────────────────
// Compare prod (source of truth) vs AEM metrics → 0..100 + breakdown + gaps.
// ─── News-specific scoring ────────────────────────────────────────────────
// Checks only 5 elements that matter for news articles:
// title, publishDate, content, images, breadcrumb + share buttons.
function scoreNews(prod, aem, W, add, checks) {
  // 1. Title — use the specific title containers first:
  //    prod: .text-large.text-light.pad-bot | AEM: first <p> in .news-media-details
  //    Falls back to og:title / heading candidates if containers not found.
  const prodTitleData = prod.newsTitle?.found
    ? { text: prod.newsTitle.text, source: prod.newsTitle.source }
    : null;
  const aemTitleData = aem.newsTitle?.found
    ? { text: aem.newsTitle.text, source: aem.newsTitle.source }
    : null;

  let prodTitle = prodTitleData?.text || '';
  let aemTitle = aemTitleData?.text || '';
  let prodSource = prodTitleData?.source || '?';
  let aemSource = aemTitleData?.source || '?';
  let titleMatch = prodTitle && aemTitle && normCompare(prodTitle, aemTitle);

  // Fallback: if container title not found, try og:title / heading candidates.
  if (!prodTitle || !aemTitle) {
    const GENERIC = /ข่าวธนาคาร|^news|^home|^บัวหลวง/i;
    const candidates = (m) => {
      const list = [];
      const h1 = (m.headings || []).find(h => (h.level || 4) === 1)?.text;
      if (h1) list.push({ source: 'H1', text: h1 });
      if (m.meta?.ogTitle) list.push({ source: 'og:title', text: m.meta.ogTitle });
      return list.filter(c => c.text && c.text.trim().length > 5 && !GENERIC.test(c.text.trim()));
    };
    if (!prodTitle) {
      const c = candidates(prod).sort((a, b) => b.text.length - a.text.length)[0];
      if (c) { prodTitle = c.text; prodSource = c.source; }
    }
    if (!aemTitle) {
      const c = candidates(aem).sort((a, b) => b.text.length - a.text.length)[0];
      if (c) { aemTitle = c.text; aemSource = c.source; }
    }
    titleMatch = prodTitle && aemTitle && normCompare(prodTitle, aemTitle);
  }

  add('title', W.title, 'หัวข้อข่าว (Title)', !!titleMatch,
    `prod (${prodSource}): "${prodTitle.slice(0, 60)}" / aem (${aemSource}): "${aemTitle.slice(0, 60)}"`,
    { prodTitle, aemTitle, prodSource, aemSource, matched: !!titleMatch });

  // 2. Publish date — must match (meta tag or extracted from content).
  const pDate = prod.meta?.publishDate || prod.publishDateFromContent || '';
  const aDate = aem.meta?.publishDate || aem.publishDateFromContent || '';
  const dateMatch = pDate && aDate && normCompare(pDate, aDate);
  add('publishDate', W.publishDate, 'วันที่เผยแพร่ (Publish Date)', !!dateMatch,
    `prod: "${pDate || '(none)'}" / aem: "${aDate || '(none)'}"`,
    { prodDate: pDate, aemDate: aDate, matched: !!dateMatch });

  // 3. Content — compare ONLY the article body containers (not the whole page).
  // prod: .modal-body.pad-bot | AEM: .news-media-details-container
  const prodNews = prod.newsContent || { found: false, textLength: 0, sample: '' };
  const aemNews = aem.newsContent || { found: false, textLength: 0, sample: '' };
  const prodContentLen = prodNews.found ? prodNews.textLength : prod.textLength;
  const aemContentLen = aemNews.found ? aemNews.textLength : aem.textLength;
  const ratio = prodContentLen > 0 ? aemContentLen / prodContentLen : 0;
  const contentPass = Math.abs(1 - ratio) <= 0.30;
  // Missing text blocks — compare from article containers if available.
  const prodTextBlocks = prodNews.found ? splitSentences(prodNews.text) : (prod.textBlocks || []);
  const aemTextBlocksRaw = aemNews.found ? splitSentences(aemNews.text) : (aem.textBlocks || []);
  const aemBlockSet = new Set(aemTextBlocksRaw.map(t => t.toLowerCase()));
  const missingTextBlocks = [...new Set(
    prodTextBlocks
      .map(t => t.trim())
      .filter(t => t.length >= 8 && !isDynamicBlock(t) && !aemBlockSet.has(t.toLowerCase()))
  )].slice(0, 15);
  const containerNote = prodNews.found && aemNews.found
    ? 'modal-body.pad-bot vs news-media-details-container'
    : (!prodNews.found && !aemNews.found ? 'containers not found — using page text' : `${prodNews.found ? 'prod container' : 'prod page'} vs ${aemNews.found ? 'aem container' : 'aem page'}`);
  add('content', W.content, 'เนื้อหาข่าว (Content)', contentPass,
    `${aemContentLen}/${prodContentLen} chars (ratio ${(ratio * 100 | 0)}%)${missingTextBlocks.length ? ` · ${missingTextBlocks.length} missing` : ''} · ${containerNote}`,
    {
      prodSample: (prodNews.sample || prod.bodyTextSample || '').slice(0, 600),
      aemSample: (aemNews.sample || aem.bodyTextSample || '').slice(0, 600),
      ratio: Math.round(ratio * 100),
      missingTextBlocks,
    });

  // 4. Images — count + alt text from news content containers ONLY
  //    (excludes nav icons, logos, share buttons from the page chrome).
  const prodImgs = prod.newsImages?.found ? prod.newsImages.images : (prod.images || []);
  const aemImgs = aem.newsImages?.found ? aem.newsImages.images : (aem.images || []);
  const prodImgSrc = prodImgs.found ? prodImgs.count : prodImgs.length;
  const aemImgSrc = aemImgs.found ? aemImgs.count : aemImgs.length;
  // Normalize: newsImages returns {found,count,images[]} vs images is array.
  const prodImgsArr = Array.isArray(prodImgs) ? prodImgs : (prodImgs.images || []);
  const aemImgsArr = Array.isArray(aemImgs) ? aemImgs : (aemImgs.images || []);
  // Images must be present on both sides. If prod has images, AEM must have
  // at least ~70% of them. When prod has very few (1-2), exact match required.
  const prodImgCount = prodImgsArr.length;
  const aemImgCount = aemImgsArr.length;
  const imgCountOk = prodImgCount === 0
    ? aemImgCount === 0  // both empty = ok
    : aemImgCount >= Math.ceil(prodImgCount * 0.7);  // prod has images → aem must have ≥70%
  const prodAlts = new Set(prodImgsArr.map(i => i.alt?.toLowerCase()).filter(Boolean));
  const aemAlts = new Set(aemImgsArr.map(i => i.alt?.toLowerCase()).filter(Boolean));
  const altHit = prodAlts.size ? [...prodAlts].filter(a => aemAlts.has(a)).length / prodAlts.size : 1;
  const imgPass = imgCountOk && altHit > 0.5;
  const imgContainerNote = (prod.newsImages?.found || aem.newsImages?.found) ? 'news content only' : 'page-wide';
  add('images', W.images, 'รูปประกอบ (Images)', imgPass,
    `prod ${prodImgsArr.length} / aem ${aemImgsArr.length} images · alt match ${(altHit * 100 | 0)}% · ${imgContainerNote}`,
    {
      prodCount: prodImgsArr.length, aemCount: aemImgsArr.length,
      altMatchPct: Math.round(altHit * 100),
      prodImageSrcs: prodImgsArr.map(i => ({ src: i.src?.slice(0, 60), alt: i.alt?.slice(0, 40) })),
      aemImageSrcs: aemImgsArr.map(i => ({ src: i.src?.slice(0, 60), alt: i.alt?.slice(0, 40) })),
    });

  // 5. Breadcrumb + share buttons — must be present on both sides.
  const prodBc = prod.breadcrumb || { hasBreadcrumb: false, items: [] };
  const aemBc = aem.breadcrumb || { hasBreadcrumb: false, items: [] };
  const bcPass = (prodBc.hasBreadcrumb === aemBc.hasBreadcrumb) || (!prodBc.hasBreadcrumb && !aemBc.hasBreadcrumb);
  const prodShare = prod.shareBtns || {};
  const aemShare = aem.shareBtns || {};
  const shareTypes = ['hasFacebook', 'hasLine', 'hasTwitter', 'hasEmail', 'hasPrint'];
  const prodShareCount = shareTypes.filter(k => prodShare[k]).length;
  const aemShareCount = shareTypes.filter(k => aemShare[k]).length;
  const sharePass = prodShareCount === aemShareCount || (prodShareCount === 0 && aemShareCount === 0);
  const missingShare = shareTypes.filter(k => prodShare[k] && !aemShare[k]);
  add('breadcrumbShare', W.breadcrumbShare, 'Breadcrumb + ปุ่มแชร์', bcPass && sharePass,
    `breadcrumb: ${prodBc.hasBreadcrumb ? '✓' : '✗'}→${aemBc.hasBreadcrumb ? '✓' : '✗'} · share: ${prodShareCount}→${aemShareCount}${missingShare.length ? ` (missing: ${missingShare.join(',')})` : ''}`,
    {
      prodBreadcrumb: prodBc,
      aemBreadcrumb: aemBc,
      prodShare: { count: prodShareCount, ...prodShare },
      aemShare: { count: aemShareCount, ...aemShare },
      missingShare,
    });

  // Score: weighted sum, partial credit for content only (not images).
  const partial = { content: contentPass ? 1 : Math.max(0, ratio) };
  let score = 0;
  for (const c of checks) {
    score += c.weight * (c.passed ? 1 : (partial[c.id] ?? 0));
  }
  const parity = Math.min(100, Math.round(score * 100));
  const gaps = checks.filter(c => !c.passed).map(c => ({ label: c.label, detail: c.detail, weight: c.weight }));

  // Re-use the existing issue detectors (broken links, image distortion, Thai ratio).
  const aemIssues = [];
  if (aem.leakedContentPaths?.length) aemIssues.push({ severity: 'high', label: 'Leaked /content/ paths', detail: `${aem.leakedContentPaths.length} found` });

  // Broken links.
  const brokenLinks = [];
  if (aem.linkStatuses) {
    for (const [url, status] of Object.entries(aem.linkStatuses)) {
      if (status >= 400) brokenLinks.push({ url: url.slice(0, 80), status });
      else if (status === 0) brokenLinks.push({ url: url.slice(0, 80), status: 'unreachable' });
    }
  }
  if (brokenLinks.length) aemIssues.push({ severity: 'high', label: 'Broken links', detail: `${brokenLinks.length} found` });

  return { parity, checks, gaps, aemIssues, brokenLinks, imageIssues: [], thaiIssues: [] };
}

function scoreParity(prod, aem, newsMode = false) {
  const W = newsMode ? WEIGHTS_NEWS : WEIGHTS;
  const checks = [];
  const add = (id, weight, label, passed, detail, diff) =>
    checks.push({ id, weight, label, passed: !!passed, detail, diff: diff || null });

  // ─── Error-page guard ────────────────────────────────────────────────────
  // Detect 404/error/blocked pages on either side.
  // - 404: title has "404" / "not found", or Thai body "ไม่พบหน้าที่คุณต้องการ"
  // - Blocked: title "Access Denied" or body has access-denied text (WAF/anti-bot)
  const isErrorPage = (m) => {
    const title = (m.meta?.title || '').toLowerCase();
    const sample = m.bodyTextSample || '';
    return /404|not found/.test(title) || /ไม่พบหน้าที่คุณต้องการ/.test(sample);
  };
  const isBlocked = (m) => {
    const title = (m.meta?.title || '').toLowerCase();
    const sample = (m.bodyTextSample || '').toLowerCase();
    return /access denied|forbidden|blocked|you have been blocked/.test(title) ||
           /access denied|you have been blocked/.test(sample);
  };
  const pageErrorType = (m) => {
    if (isErrorPage(m)) return '404';
    if (isBlocked(m)) return 'blocked';
    return null;
  };

  const prodErr = pageErrorType(prod);
  const aemErr = pageErrorType(aem);

  // Build early-return for any error condition.
  if (prodErr || aemErr) {
    const label = (side, t) => t === 'blocked'
      ? `${side} page is BLOCKED (Access Denied / WAF)`
      : `${side} page is 404`;
    const type = (p, a) => {
      if (p && a) return 'both404';
      if (p === 'blocked' || a === 'blocked') return 'blocked';
      if (p) return 'prod404';
      return 'aem404';
    };
    const detail = (side, m, t) => t === 'blocked'
      ? `${side} was blocked by WAF — title: "${m.meta?.title}" ลอง re-run หรือเช็ค rate limit`
      : `${side} title: "${m.meta?.title}"`;
    const sideErr = prodErr ? 'Production' : 'AEM';
    const m = prodErr ? prod : aem;
    return {
      parity: 0,
      errorType: type(prodErr, aemErr),
      checks: [{ id: 'error', weight: 1, label: label(sideErr, prodErr || aemErr), passed: false, detail: detail(sideErr, m, prodErr || aemErr), diff: null }],
      gaps: [{ label: label(sideErr, prodErr || aemErr), detail: detail(sideErr, m, prodErr || aemErr), weight: 1 }],
      aemIssues: [],
      brokenLinks: [], imageIssues: [], thaiIssues: [],
    };
  }

  // ─── NEWS MODE: skip generic checks, use focused news scoring ────────────
  if (newsMode) {
    return scoreNews(prod, aem, W, add, checks);
  }

  // Headings — Jaccard similarity over normalized heading text sets.
  const prodHeadings = (prod.headings || []).map(h => typeof h === 'string' ? h : h.text);
  const aemHeadings = (aem.headings || []).map(h => typeof h === 'string' ? h : h.text);
  const pH = new Set(prodHeadings.map(h => h.toLowerCase()));
  const aH = new Set(aemHeadings.map(h => h.toLowerCase()));
  const hInter = [...pH].filter(x => aH.has(x)).length;
  const hUnion = new Set([...pH, ...aH]).size || 1;
  const headingScore = hInter / hUnion;
  // Build full heading outline with match status for side-by-side display.
  const prodOutline = (prod.headings || []).map(h => {
    const text = typeof h === 'string' ? h : h.text;
    const level = typeof h === 'string' ? 0 : h.level;
    return { level, text, tag: typeof h === 'string' ? '' : h.tag, matched: aH.has(text.toLowerCase()) };
  });
  const aemOutline = (aem.headings || []).map(h => {
    const text = typeof h === 'string' ? h : h.text;
    const level = typeof h === 'string' ? 0 : h.level;
    return { level, text, tag: typeof h === 'string' ? '' : h.tag, matched: pH.has(text.toLowerCase()) };
  });
  add('headings', W.headings, 'Headings match', headingScore > 0.6,
    `${aem.headingCount}/${prod.headingCount} headings (Jaccard ${(headingScore * 100 | 0)}%)`,
    {
      matchedCount: hInter,
      prodOutline,
      aemOutline,
    });

  // Links — fraction of prod link-texts present in AEM.
  const pLinks = new Set(prod.links.map(l => l.text.toLowerCase()).filter(Boolean));
  const aLinks = new Set(aem.links.map(l => l.text.toLowerCase()).filter(Boolean));
  const linkHit = pLinks.size ? [...pLinks].filter(t => aLinks.has(t)).length / pLinks.size : 0;
  // Side-by-side link lists with match status (deduplicated by text).
  const prodLinksUnique = [];
  const seenP = new Set();
  for (const l of prod.links) {
    const key = l.text.toLowerCase();
    if (key && !seenP.has(key)) { seenP.add(key); prodLinksUnique.push({ text: l.text, href: l.href, matched: aLinks.has(key) }); }
  }
  const aemLinksUnique = [];
  const seenA = new Set();
  for (const l of aem.links) {
    const key = l.text.toLowerCase();
    if (key && !seenA.has(key)) { seenA.add(key); aemLinksUnique.push({ text: l.text, href: l.href, matched: pLinks.has(key) }); }
  }
  add('links', W.links, 'Links match', linkHit > 0.5,
    `${aem.linkCount}/${prod.linkCount} links (${(linkHit * 100 | 0)}% of prod link-texts found)`,
    {
      matchedCount: [...pLinks].filter(t => aLinks.has(t)).length,
      prodLinks: prodLinksUnique.slice(0, 50),
      aemLinks: aemLinksUnique.slice(0, 50),
    });

  // Content — text length within tolerance, plus keyword comparison.
  const ratio = prod.textLength > 0 ? aem.textLength / prod.textLength : 0;
  const textPass = Math.abs(1 - ratio) <= TEXT_MATCH_TOLERANCE;
  // Keyword diff: words in prod's top-words that are rare/absent in AEM.
  const prodWordMap = new Map((prod.topWords || []).map(w => [w.w, w.c]));
  const aemWordMap = new Map((aem.topWords || []).map(w => [w.w, w.c]));
  const prodKey = [...prodWordMap.entries()].sort((a, b) => b[1] - a[1]).slice(0, 30);
  const aemKey = [...aemWordMap.entries()].sort((a, b) => b[1] - a[1]).slice(0, 30);
  const keywordsMissing = prodKey.filter(([w]) => !aemWordMap.has(w)).slice(0, 20);
  const keywordsShared = prodKey.filter(([w]) => aemWordMap.has(w));
  // Missing text blocks (dynamic content filtered out to avoid false positives).
  const aemBlockSet = new Set((aem.textBlocks || []).map(t => t.toLowerCase()));
  const missingTextBlocks = [...new Set(
    (prod.textBlocks || [])
      .map(t => t.trim())
      .filter(t => t.length >= 8 && !isDynamicBlock(t) && !aemBlockSet.has(t.toLowerCase()))
  )].slice(0, 15);
  add('text', W.text, 'Content length', textPass,
    `${aem.textLength}/${prod.textLength} chars (ratio ${(ratio * 100 | 0)}%)`,
    {
      prodSample: (prod.bodyTextSample || '').slice(0, 600),
      aemSample: (aem.bodyTextSample || '').slice(0, 600),
      prodKeywords: prodKey.map(([w, c]) => ({ w, c, aemCount: aemWordMap.get(w) || 0 })),
      aemKeywords: aemKey.map(([w, c]) => ({ w, c, prodCount: prodWordMap.get(w) || 0 })),
      keywordsMissingCount: keywordsMissing.length,
      keywordsSharedCount: keywordsShared.length,
      missingTextBlocks,
      thaiRatio: { prod: prod.thaiRatio ?? 0, aem: aem.thaiRatio ?? 0, delta: Math.abs((prod.thaiRatio ?? 0) - (aem.thaiRatio ?? 0)) },
    });

  // Meta tags — title/description should match.
  const metaKeys = ['title', 'description', 'canonical', 'ogTitle', 'ogImage', 'keywords'];
  const metaChecks = metaKeys.map(k => ({ key: k, prod: prod.meta[k] || '', aem: aem.meta[k] || '', match: normCompare(prod.meta[k], aem.meta[k]) }));
  const metaHits = metaChecks.filter(m => m.match).length;
  const metaScore = metaKeys.length ? metaHits / metaKeys.length : 0;
  const metaMissing = metaChecks.filter(m => m.prod && !m.match).map(m => m.key);
  add('meta', W.meta, 'Meta tags', metaScore === 1,
    `${metaHits}/${metaKeys.length} matched` + (metaMissing.length ? ` — missing: ${metaMissing.join(', ')}` : ''),
    { missing: metaMissing, details: metaChecks });

  // Accordions — AEM should have same count and none empty.
  const accCountMatch = aem.accordionCount >= prod.accordionCount * 0.8;
  const accFilled = aem.accordionCount > 0 ? (aem.accordionCount - aem.emptyAccordions) / aem.accordionCount : 1;
  const accPass = accCountMatch && aem.emptyAccordions === 0;
  const emptyAccTitles = aem.accordions.filter(a => !a.isFilled).map(a => a.title || '(untitled)').slice(0, 10);
  add('accordions', W.accordions, 'Accordions filled', accPass,
    `prod ${prod.accordionCount} / aem ${aem.accordionCount} (${aem.emptyAccordions} empty)`,
    { emptyAccordions: emptyAccTitles, prodCount: prod.accordionCount, aemCount: aem.accordionCount });

  // Header/footer — AEM should have header & footer links like prod.
  const headerOk = aem.headerLinkCount > 0 || prod.headerLinkCount === 0;
  const footerOk = aem.footerLinkCount > 0 || prod.footerLinkCount === 0;
  add('headerFooter', W.headerFooter, 'Header & Footer', headerOk && footerOk,
    `header ${aem.headerLinkCount}/${prod.headerLinkCount} links, footer ${aem.footerLinkCount}/${prod.footerLinkCount} links`,
    { header: { prod: prod.headerLinkCount, aem: aem.headerLinkCount }, footer: { prod: prod.footerLinkCount, aem: aem.footerLinkCount } });

  // ─── News-specific: publish date check ────────────────────────────────────
  if (newsMode && W.publishDate) {
    const pDate = prod.meta?.publishDate || prod.publishDateFromContent || '';
    const aDate = aem.meta?.publishDate || aem.publishDateFromContent || '';
    const dateMatch = pDate && aDate && normCompare(pDate, aDate);
    const datePass = !pDate || !aDate ? false : !!dateMatch;
    add('publishDate', W.publishDate, 'Publish date', datePass,
      `prod: "${pDate || '(none)'}" / aem: "${aDate || '(none)'}"`,
      { prodDate: pDate, aemDate: aDate });
  }

  // Weighted score: sum(weight * 1) for passed, partial credit for ratio-based checks.
  const partial = { headings: headingScore, links: linkHit, text: textPass ? 1 : Math.max(0, ratio), meta: metaScore };
  let score = 0;
  for (const c of checks) {
    score += c.weight * (c.passed ? 1 : (partial[c.id] ?? 0));
  }
  const parity = Math.min(100, Math.round(score * 100));
  const gaps = checks.filter(c => !c.passed).map(c => ({ label: c.label, detail: c.detail, weight: c.weight }));

  // AEM-specific issues (counted but not in the weighted score).
  const aemIssues = [];
  if (aem.leakedContentPaths.length) aemIssues.push({ severity: 'high', label: 'Leaked /content/ paths', detail: `${aem.leakedContentPaths.length} found` });
  if (!aem.features.login && prod.features.login) aemIssues.push({ severity: 'high', label: 'Missing login', detail: 'prod has login, AEM does not' });
  if (!aem.features.languageSwitch && prod.features.languageSwitch) aemIssues.push({ severity: 'high', label: 'Missing language switcher' });
  const socialMissing = Object.entries(prod.social).filter(([k, v]) => v && !aem.social[k]).map(([k]) => k);
  if (socialMissing.length) aemIssues.push({ severity: 'medium', label: 'Missing social icons', detail: socialMissing.join(', ') });

  // ─── Thai/Latin script ratio (language-regression signal) ────────────────
  const pThai = prod.thaiRatio ?? 0;
  const aThai = aem.thaiRatio ?? 0;
  const thaiDelta = Math.abs(pThai - aThai);
  const thaiIssues = [];
  if (thaiDelta > THAI_RATIO_DELTA) {
    const issue = {
      severity: 'high',
      label: 'Thai/English balance differs',
      detail: `prod ${(pThai * 100).toFixed(0)}% Thai vs AEM ${(aThai * 100).toFixed(0)}% Thai`,
    };
    thaiIssues.push(issue);
    aemIssues.push(issue);
  }

  // ─── Broken links (HTTP status from AEM link check) ──────────────────────
  const brokenLinks = [];
  if (aem.linkStatuses) {
    for (const [url, status] of Object.entries(aem.linkStatuses)) {
      if (status >= 400) brokenLinks.push({ url: url.slice(0, 80), status });
      else if (status === 0) brokenLinks.push({ url: url.slice(0, 80), status: 'unreachable' });
    }
  }
  if (brokenLinks.length) {
    aemIssues.push({
      severity: 'high',
      label: 'Broken links on AEM',
      detail: `${brokenLinks.length} links return error`,
    });
  }

  // ─── Image distortion (rendered ratio + newly-introduced distortion) ─────
  // AEM stores images with hash names (media_abc123...) so filename matching
  // fails. Fall back to order-based pairing, then compare rendered aspect
  // ratios. Also flag newly-introduced distortion (natural ≠ rendered on AEM
  // where prod rendered correctly).
  const imageIssues = [];
  const prodImgs = (prod.images || []);
  const aemImgs = (aem.images || []);
  const imgRatio = (w, h) => h > 0 ? w / h : 0;
  const imgDiffers = (a, b) => a > 0 && b > 0 && Math.abs(a - b) / a > IMAGE_RATIO_TOLERANCE;

  // Try filename match first; fill unmatched by order.
  const usedAem = new Set();
  const pairs = [];
  for (const o of prodImgs) {
    const key = filenameOf(o.src);
    const idx = key ? aemImgs.findIndex((m, i) => !usedAem.has(i) && filenameOf(m.src) === key) : -1;
    if (idx !== -1) { usedAem.add(idx); pairs.push([o, aemImgs[idx]]); }
  }
  const restProd = prodImgs.filter(o => !pairs.some(([po]) => po === o));
  const restAem = aemImgs.filter((_, i) => !usedAem.has(i));
  restProd.forEach((o, i) => { if (restAem[i]) pairs.push([o, restAem[i]]); });

  for (const [o, m] of pairs) {
    const label = filenameOf(m.src) || m.src.slice(0, 40);
    const ro = imgRatio(o.renderedWidth, o.renderedHeight);
    const rm = imgRatio(m.renderedWidth, m.renderedHeight);
    const imgData = {
      label,
      kind: '',
      detail: '',
      prodSrc: o.src,
      aemSrc: m.src,
      prodAlt: o.alt || '',
      aemAlt: m.alt || '',
      prodRendered: `${o.renderedWidth}×${o.renderedHeight}`,
      aemRendered: `${m.renderedWidth}×${m.renderedHeight}`,
    };
    if (imgDiffers(ro, rm)) {
      imageIssues.push({
        ...imgData,
        kind: 'ratio',
        detail: `rendered ratio prod ${ro.toFixed(2)} vs aem ${rm.toFixed(2)}`,
      });
      continue;
    }
    const natM = imgRatio(m.naturalWidth, m.naturalHeight);
    const natO = imgRatio(o.naturalWidth, o.naturalHeight);
    if (imgDiffers(natM, rm) && !imgDiffers(natO, ro)) {
      imageIssues.push({
        ...imgData,
        kind: 'distortion',
        detail: `distorted: natural ${natM.toFixed(2)} vs rendered ${rm.toFixed(2)}`,
      });
    }
  }
  // Count check — flag if AEM has significantly fewer images than prod.
  if (aemImgs.length < prodImgs.length - 2) {
    imageIssues.push({
      label: '(page-wide)',
      detail: `AEM renders ${aemImgs.length} images vs ${prodImgs.length} on prod`,
      kind: 'missing',
    });
  }
  if (imageIssues.length) {
    aemIssues.push({
      severity: 'medium',
      label: 'Image distortion/ratio',
      detail: `${imageIssues.length} image issue(s)`,
    });
  }

  return { parity, checks, gaps, aemIssues, brokenLinks, imageIssues, thaiIssues };
}

function normCompare(a, b) {
  const n = (s) => (s || '').toLowerCase().replace(/[^a-z0-9\u0E00-\u0E7F]/gi, '').slice(0, 200);
  return n(a) === n(b);
}

// ─── Worker ────────────────────────────────────────────────────────────────
async function processPair(browser, pair, index, total, existing, force, newsMode) {
  const tag = `[${index + 1}/${total}]`;
  const prodPath = pair.prodUrl.split('/').slice(3).join('/') || 'home';

  // Resumable: skip pages already captured successfully (unless --force).
  // If the existing result has cached metrics, re-score from those (no browser
  // needed) — this picks up logic changes (e.g. new error detection) cheaply.
  const id = String(index + 1);
  if (!force && existing && existing[id] && existing[id].prod?.metrics && existing[id].aem?.metrics) {
    const sc = scoreParity(existing[id].prod.metrics, existing[id].aem.metrics, newsMode);
    // Sync metadata from the current CSV (source of truth) — the sheet may have
    // filled in/updated category, subCategory, or corrected a URL since capture.
    existing[id].prodUrl = pair.prodUrl;
    existing[id].aemUrl = pair.aemUrl;
    existing[id].category = pair.category;
    existing[id].subCategory = pair.subCategory;
    existing[id].parity = sc.parity;
    existing[id].checks = sc.checks;
    existing[id].gaps = sc.gaps;
    existing[id].aemIssues = sc.aemIssues;
    existing[id].errorType = sc.errorType || null;
    existing[id].brokenLinks = sc.brokenLinks;
    existing[id].imageIssues = sc.imageIssues;
    existing[id].thaiIssues = sc.thaiIssues;
    existing[id].newsMode = newsMode || false;
    console.log(`${tag} ${prodPath} → re-scored (cached metrics)`);
    return existing[id];
  }

  console.log(`${tag} ${prodPath}`);

  const result = {
    id: String(index + 1),
    ...pair,
    prod: null,
    aem: null,
    parity: null,
    gaps: [],
    aemIssues: [],
    durationMs: 0,
    newsMode: newsMode || false,
  };
  const t0 = Date.now();

  const [prodPage, aemPage] = await Promise.all([
    browser.newPage().then(async p => { await p.setViewport(VIEWPORT); return p; }),
    browser.newPage().then(async p => { await p.setViewport(VIEWPORT); return p; }),
  ]);

  try {
    // Capture both in parallel.
    const [prodRes, aemRes] = await Promise.all([
      capturePage(prodPage, pair.prodUrl),
      capturePage(aemPage, pair.aemUrl),
    ]);

    // Screenshots (only if loaded ok) — capture to buffer, resize, then write.
    // Each page gets its own subfolder so files don't pile up in one directory.
    const pageDir = `${SS_DIR}/${result.id}`;
    await mkdir(pageDir, { recursive: true }).catch(() => {});
    if (prodRes.ok) {
      const buf = await prodPage.screenshot({ fullPage: SCREENSHOT_FULLPAGE, type: 'jpeg', quality: 80 }).catch(() => null);
      if (buf) {
        const f = `${pageDir}/prod.jpg`;
        await sharp(buf).resize({ width: SCREENSHOT_MAX_WIDTH, withoutEnlargement: true }).toFile(f);
        prodRes.screenshot = f;
      }
    }
    if (aemRes.ok) {
      const buf = await aemPage.screenshot({ fullPage: SCREENSHOT_FULLPAGE, type: 'jpeg', quality: 80 }).catch(() => null);
      if (buf) {
        const f = `${pageDir}/aem.jpg`;
        await sharp(buf).resize({ width: SCREENSHOT_MAX_WIDTH, withoutEnlargement: true }).toFile(f);
        aemRes.screenshot = f;
      }
    }

    result.prod = { url: prodRes.url, ok: prodRes.ok, error: prodRes.error, screenshot: prodRes.screenshot, metrics: prodRes.metrics };
    result.aem = { url: aemRes.url, ok: aemRes.ok, error: aemRes.error, screenshot: aemRes.screenshot, metrics: aemRes.metrics };

    if (prodRes.ok && aemRes.ok) {
      const sc = scoreParity(prodRes.metrics, aemRes.metrics, newsMode);
      result.parity = sc.parity;
      result.checks = sc.checks;
      result.gaps = sc.gaps;
      result.aemIssues = sc.aemIssues;
      result.brokenLinks = sc.brokenLinks;
      result.imageIssues = sc.imageIssues;
      result.thaiIssues = sc.thaiIssues;
      result.errorType = sc.errorType || null;
    } else {
      result.parity = 0;
      result.gaps = [];
      result.aemIssues = [{ severity: 'critical', label: 'Page load failed', detail: `prod:${prodRes.error || 'ok'} aem:${aemRes.error || 'ok'}` }];
    }
  } finally {
    await prodPage.close().catch(() => {});
    await aemPage.close().catch(() => {});
  }

  result.durationMs = Date.now() - t0;
  const status = result.parity >= 85 ? '✓' : result.parity >= 50 ? '⚠' : '✗';
  console.log(`${tag} ${status} parity ${result.parity} (${result.durationMs}ms)${result.gaps.length ? ` — ${result.gaps.length} gaps` : ''}`);
  return result;
}

// ─── Concurrency pool ──────────────────────────────────────────────────────
// `preserveMap` = the existing results that are OUTSIDE this run's scope
// (kept as-is so a partial re-run never drops them). It is the full `existing`
// map minus the ids in this run. `existing` (resumeMap) is still used by
// processPair to decide whether to skip re-capture of in-scope pages.
async function runPool(browser, pairs, concurrency, existing, force, newsMode, preserveMap) {
  const results = new Array(pairs.length);
  let cursor = 0;
  let done = 0;
  const start = Date.now();

  async function worker() {
    while (cursor < pairs.length) {
      const i = cursor++;
      results[i] = await processPair(browser, pairs[i], i, pairs.length, existing, force, newsMode);
      done++;
      if (done % 5 === 0 || done === pairs.length) {
        const elapsed = ((Date.now() - start) / 1000).toFixed(0);
        const rate = (done / ((Date.now() - start) / 1000)).toFixed(2);
        const eta = ((pairs.length - done) / parseFloat(rate)).toFixed(0);
        process.stdout.write(`   ─ progress ${done}/${pairs.length} · ${rate}/s · ETA ${eta}s · ${elapsed}s elapsed\r`);
      }
      // Incremental save every 10 pages so a crash doesn't lose everything.
      if (done % 10 === 0) await saveResults(results.filter(Boolean), start, preserveMap);
    }
  }

  await Promise.all(Array.from({ length: concurrency }, worker));
  const final = await saveResults(results, start, preserveMap);
  return { results, ...final };
}

// Merge this run's results with pages captured previously but outside this run
// (e.g. refreshing a --limit subset). Keeps results.json cumulative so a partial
// re-run never drops everything else. `preserveMap` is null only when the file
// didn't exist; --force still preserves out-of-scope pages — it only forces
// re-capture of the pages within this run's scope.
function mergePreserved(results, preserveMap) {
  const runIds = new Set(results.filter(Boolean).map(r => r.id));
  const preserved = preserveMap
    ? Object.values(preserveMap).filter(p => p && p.id && !runIds.has(p.id))
    : [];
  const allPages = [...results.filter(Boolean), ...preserved];
  allPages.sort((a, b) => (parseInt(a.id, 10) || 0) - (parseInt(b.id, 10) || 0));
  return { allPages, preservedCount: preserved.length };
}

async function saveResults(results, start, preserveMap = null) {
  const { allPages, preservedCount } = mergePreserved(results, preserveMap);
  const payload = {
    generatedAt: new Date().toISOString(),
    totalDurationMs: start ? Date.now() - start : 0,
    pages: allPages,
  };
  await writeFile(OUTPUT_PATH, JSON.stringify(payload, null, 1), 'utf8');
  return { total: allPages.length, refreshed: results.filter(Boolean).length, preservedCount };
}

// ─── Chrome binary resolution ──────────────────────────────────────────────
async function resolveChrome() {
  if (process.env.PUPPETEER_EXECUTABLE_PATH && existsSync(process.env.PUPPETEER_EXECUTABLE_PATH)) {
    return process.env.PUPPETEER_EXECUTABLE_PATH;
  }
  // Glob the puppeteer cache for the Chrome for Testing binary.
  const pattern = CHROME_EXECUTABLE_PATH;
  for await (const p of glob(pattern)) {
    if (existsSync(p)) return p;
  }
  // Fallback: try agent-browser's Chrome.
  const ab = '/Users/prapon.t/.agent-browser/browsers/chrome-148.0.7778.97/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing';
  if (existsSync(ab)) return ab;
  throw new Error('No Chrome binary found. Set PUPPETEER_EXECUTABLE_PATH or install Chrome.');
}

// ─── Main ──────────────────────────────────────────────────────────────────
async function main() {
  const limit = parseInt(process.argv.find(a => a.startsWith('--limit='))?.split('=')[1] || '0', 10);
  const concurrency = parseInt(process.argv.find(a => a.startsWith('--concurrency='))?.split('=')[1] || String(CONCURRENCY), 10);
  const force = process.argv.includes('--force');
  const newsMode = process.argv.includes('--news');

  await mkdir(SS_DIR, { recursive: true });
  const pairs = await readPairs();
  const subset = limit > 0 ? pairs.slice(0, limit) : pairs;

  // Load the existing results file once. We use it two ways:
  //   - existing (resumeMap): tells processPair to SKIP re-capture of in-scope
  //     pages that were already captured. Ignored under --force.
  //   - preserveMap: pages OUTSIDE this run's scope, kept verbatim on save so a
  //     partial re-run (--limit / subset) never drops the rest of the dataset.
  //     Loaded regardless of --force — forcing re-capture of the in-scope pages
  //     should not wipe out the others.
  let existing = null;
  let allPrevMap = null;
  if (existsSync(RESULTS_PATH)) {
    try {
      const prev = JSON.parse(await readFile(RESULTS_PATH, 'utf8'));
      allPrevMap = {};
      for (const p of (prev.pages || [])) allPrevMap[String(p.id)] = p;
      if (!force) existing = allPrevMap;
      const cached = Object.keys(allPrevMap).length;
      console.log(`📥 Loaded ${cached} existing result(s)${force ? ' · --force will re-capture in-scope pages' : ' for resume (use --force to re-capture all)'}`);
    } catch { /* ignore corrupt results */ }
  }

  console.log(`🚀 Comparing ${subset.length} page pair(s) · concurrency ${concurrency}${force ? ' · --force' : ''}`);

  // Pages outside this run's scope (e.g. only --limit=N of the full list) are
  // preserved on save so results.json stays cumulative across partial re-runs.
  // Built from ALL previously-known pages (not just the resume map), so --force
  // on a subset still keeps the rest of the dataset intact.
  const scopeIds = new Set(subset.map((_, i) => String(i + 1)));
  const preserveMap = allPrevMap
    ? Object.fromEntries(Object.entries(allPrevMap).filter(([id]) => !scopeIds.has(id)))
    : null;
  if (preserveMap && Object.keys(preserveMap).length) {
    console.log(`   Preserving ${Object.keys(preserveMap).length} page(s) outside this run's scope`);
  }

  const exe = await resolveChrome();
  console.log(`   Chrome: ${exe}`);
  const browser = await puppeteer.launch({
    executablePath: exe,
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu', `--window-size=${VIEWPORT.width},${VIEWPORT.height}`],
  });

  try {
    const t0 = Date.now();
    const { results, total, preservedCount } = await runPool(browser, subset, concurrency, existing, force, newsMode, preserveMap);
    const dur = ((Date.now() - t0) / 1000).toFixed(1);
    const avg = results.filter(r => r.parity != null).reduce((s, r) => s + r.parity, 0) / (results.length || 1);
    const passed = results.filter(r => r.parity >= 85).length;
    console.log(`\n✅ Done in ${dur}s · avg parity ${avg.toFixed(0)} · ${passed}/${results.length} passed (≥85)`);
    console.log(`   Results → ${OUTPUT_PATH} · ${results.length} refreshed${preservedCount ? ` · ${preservedCount} preserved` : ''} · ${total} total`);
    console.log(`   Next: npm run dashboard`);
  } finally {
    await browser.close();
  }
}

main().catch(e => { console.error('❌', e); process.exit(1); });
