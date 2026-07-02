// Main comparison pipeline. For each prod↔AEM URL pair:
//   1. load both pages (concurrent workers)
//   2. extract DOM metrics from each
//   3. screenshot each (1 full-page png)
//   4. compute parity score + per-metric diffs
//   5. accumulate → data/results.json
//
// Usage: node src/compare.js [--limit=N] [--concurrency=N]

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { glob } from 'node:fs/promises';
import puppeteer from 'puppeteer-core';
import {
  DIR, VIEWPORT, NAV_TIMEOUT, NAV_WAIT_UNTIL, SETTLE_AFTER_LOAD, LAZY_WAIT_TIMEOUT, LAYOUT_WAIT_TIMEOUT, CONCURRENCY,
  SCREENSHOT_FULLPAGE, SCREENSHOT_MAX_WIDTH, MIN_TEXT_LEN, SCROLL_STIMULATE_STEPS, SCROLL_STIMULATE_DELAY,
  WEIGHTS, TEXT_MATCH_TOLERANCE, CHROME_EXECUTABLE_PATH,
} from '../config.js';
import sharp from 'sharp';
import { EXTRACT_FN } from './extract.js';

const RESULTS_PATH = `${DIR.data}/results.json`;
const SS_DIR = DIR.screenshots;

// ─── CSV reader ───────────────────────────────────────────────────────────
async function readPairs() {
  const csvPath = `${DIR.data}/urls.csv`;
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
function scoreParity(prod, aem) {
  const checks = [];
  const add = (id, weight, label, passed, detail, diff) =>
    checks.push({ id, weight, label, passed: !!passed, detail, diff: diff || null });

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
  add('headings', WEIGHTS.headings, 'Headings match', headingScore > 0.6,
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
  add('links', WEIGHTS.links, 'Links match', linkHit > 0.5,
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
  add('text', WEIGHTS.text, 'Content length', textPass,
    `${aem.textLength}/${prod.textLength} chars (ratio ${(ratio * 100 | 0)}%)`,
    {
      prodSample: (prod.bodyTextSample || '').slice(0, 600),
      aemSample: (aem.bodyTextSample || '').slice(0, 600),
      prodKeywords: prodKey.map(([w, c]) => ({ w, c, aemCount: aemWordMap.get(w) || 0 })),
      aemKeywords: aemKey.map(([w, c]) => ({ w, c, prodCount: prodWordMap.get(w) || 0 })),
      keywordsMissingCount: keywordsMissing.length,
      keywordsSharedCount: keywordsShared.length,
    });

  // Meta tags — title/description should match.
  const metaKeys = ['title', 'description', 'canonical', 'ogTitle', 'ogImage', 'keywords'];
  const metaChecks = metaKeys.map(k => ({ key: k, prod: prod.meta[k] || '', aem: aem.meta[k] || '', match: normCompare(prod.meta[k], aem.meta[k]) }));
  const metaHits = metaChecks.filter(m => m.match).length;
  const metaScore = metaKeys.length ? metaHits / metaKeys.length : 0;
  const metaMissing = metaChecks.filter(m => m.prod && !m.match).map(m => m.key);
  add('meta', WEIGHTS.meta, 'Meta tags', metaScore === 1,
    `${metaHits}/${metaKeys.length} matched` + (metaMissing.length ? ` — missing: ${metaMissing.join(', ')}` : ''),
    { missing: metaMissing, details: metaChecks });

  // Accordions — AEM should have same count and none empty.
  const accCountMatch = aem.accordionCount >= prod.accordionCount * 0.8;
  const accFilled = aem.accordionCount > 0 ? (aem.accordionCount - aem.emptyAccordions) / aem.accordionCount : 1;
  const accPass = accCountMatch && aem.emptyAccordions === 0;
  const emptyAccTitles = aem.accordions.filter(a => !a.isFilled).map(a => a.title || '(untitled)').slice(0, 10);
  add('accordions', WEIGHTS.accordions, 'Accordions filled', accPass,
    `prod ${prod.accordionCount} / aem ${aem.accordionCount} (${aem.emptyAccordions} empty)`,
    { emptyAccordions: emptyAccTitles, prodCount: prod.accordionCount, aemCount: aem.accordionCount });

  // Header/footer — AEM should have header & footer links like prod.
  const headerOk = aem.headerLinkCount > 0 || prod.headerLinkCount === 0;
  const footerOk = aem.footerLinkCount > 0 || prod.footerLinkCount === 0;
  add('headerFooter', WEIGHTS.headerFooter, 'Header & Footer', headerOk && footerOk,
    `header ${aem.headerLinkCount}/${prod.headerLinkCount} links, footer ${aem.footerLinkCount}/${prod.footerLinkCount} links`,
    { header: { prod: prod.headerLinkCount, aem: aem.headerLinkCount }, footer: { prod: prod.footerLinkCount, aem: aem.footerLinkCount } });

  // Weighted score: sum(weight * 1) for passed, partial credit for ratio-based checks.
  const partial = { headings: headingScore, links: linkHit, text: textPass ? 1 : Math.max(0, ratio), meta: metaScore };
  let score = 0;
  for (const c of checks) {
    score += c.weight * (c.passed ? 1 : (partial[c.id] ?? 0));
  }
  const parity = Math.round(score * 100);
  const gaps = checks.filter(c => !c.passed).map(c => ({ label: c.label, detail: c.detail, weight: c.weight }));

  // AEM-specific issues (counted but not in the weighted score).
  const aemIssues = [];
  if (aem.leakedContentPaths.length) aemIssues.push({ severity: 'high', label: 'Leaked /content/ paths', detail: `${aem.leakedContentPaths.length} found` });
  if (!aem.features.login && prod.features.login) aemIssues.push({ severity: 'high', label: 'Missing login', detail: 'prod has login, AEM does not' });
  if (!aem.features.languageSwitch && prod.features.languageSwitch) aemIssues.push({ severity: 'high', label: 'Missing language switcher' });
  const socialMissing = Object.entries(prod.social).filter(([k, v]) => v && !aem.social[k]).map(([k]) => k);
  if (socialMissing.length) aemIssues.push({ severity: 'medium', label: 'Missing social icons', detail: socialMissing.join(', ') });

  return { parity, checks, gaps, aemIssues };
}

function normCompare(a, b) {
  const n = (s) => (s || '').toLowerCase().replace(/[^a-z0-9\u0E00-\u0E7F]/gi, '').slice(0, 200);
  return n(a) === n(b);
}

// ─── Worker ────────────────────────────────────────────────────────────────
async function processPair(browser, pair, index, total) {
  const tag = `[${index + 1}/${total}]`;
  const prodPath = pair.prodUrl.split('/').slice(3).join('/') || 'home';
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
      const sc = scoreParity(prodRes.metrics, aemRes.metrics);
      result.parity = sc.parity;
      result.checks = sc.checks;
      result.gaps = sc.gaps;
      result.aemIssues = sc.aemIssues;
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
async function runPool(browser, pairs, concurrency) {
  const results = new Array(pairs.length);
  let cursor = 0;
  let done = 0;
  const start = Date.now();

  async function worker() {
    while (cursor < pairs.length) {
      const i = cursor++;
      results[i] = await processPair(browser, pairs[i], i, pairs.length);
      done++;
      if (done % 5 === 0 || done === pairs.length) {
        const elapsed = ((Date.now() - start) / 1000).toFixed(0);
        const rate = (done / ((Date.now() - start) / 1000)).toFixed(2);
        const eta = ((pairs.length - done) / parseFloat(rate)).toFixed(0);
        process.stdout.write(`   ─ progress ${done}/${pairs.length} · ${rate}/s · ETA ${eta}s · ${elapsed}s elapsed\r`);
      }
      // Incremental save every 10 pages so a crash doesn't lose everything.
      if (done % 10 === 0) await saveResults(results.filter(Boolean), start);
    }
  }

  await Promise.all(Array.from({ length: concurrency }, worker));
  await saveResults(results, start);
  return results;
}

async function saveResults(results, start) {
  const payload = {
    generatedAt: new Date().toISOString(),
    totalDurationMs: start ? Date.now() - start : 0,
    pages: results,
  };
  await writeFile(RESULTS_PATH, JSON.stringify(payload, null, 1), 'utf8');
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

  await mkdir(SS_DIR, { recursive: true });
  const pairs = await readPairs();
  const subset = limit > 0 ? pairs.slice(0, limit) : pairs;
  console.log(`🚀 Comparing ${subset.length} page pair(s) · concurrency ${concurrency}`);

  const exe = await resolveChrome();
  console.log(`   Chrome: ${exe}`);
  const browser = await puppeteer.launch({
    executablePath: exe,
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu', `--window-size=${VIEWPORT.width},${VIEWPORT.height}`],
  });

  try {
    const t0 = Date.now();
    const results = await runPool(browser, subset, concurrency);
    const dur = ((Date.now() - t0) / 1000).toFixed(1);
    const avg = results.filter(r => r.parity != null).reduce((s, r) => s + r.parity, 0) / (results.length || 1);
    const passed = results.filter(r => r.parity >= 85).length;
    console.log(`\n✅ Done in ${dur}s · avg parity ${avg.toFixed(0)} · ${passed}/${results.length} passed (≥85)`);
    console.log(`   Results → ${RESULTS_PATH}`);
    console.log(`   Next: npm run dashboard`);
  } finally {
    await browser.close();
  }
}

main().catch(e => { console.error('❌', e); process.exit(1); });
