// Meta inventory scraper for the "BBL Thai Manual Pages" tab.
//
// This is NOT a parity comparison. It scrapes 5 meta fields (title, description,
// ogTitle, ogImage, keywords) — plus canonical/publishDate/section that come for
// free from the same query — from each PRODUCTION URL listed in the manual
// tracking sheet, so the team can audit SEO meta coverage in one place.
//
// Source of URLs: the private "BBL Thai Manual Pages" tab of the QA master
// sheet (SYNC_SPREADSHEET_ID), read via the service-account key — NOT the public
// CSV export the main pipeline uses (that's a different, public sheet).
//
// Rate-limit safety: prod (www.bangkokbank.com) sits behind the same Akamai WAF
// that bans the IP after ~120-200 heavy loads in a sliding window (see AGENTS.md
// 2026-07-08/09 incidents). Meta is light (we block images/fonts/css via request
// interception and never wait for layout), but VOLUME is the ban trigger, so we
// reuse the same guards as safe-run.js: small chunks + 20-min pause between them,
// isolated browser context per page, concurrency 1, and abort a chunk if it comes
// back mostly BLOCKED. See the META_* tunables in config.js.
//
// Usage:
//   npm run scrape:meta                          # full run (chunked, ~3.5h for 500 pages)
//   npm run scrape:meta -- --limit=20            # first 20 only (smoke test)
//   npm run scrape:meta -- --ids=1-50            # specific id range
//   npm run scrape:meta -- --chunk=30 --pause=15 # custom chunk size / pause minutes
//   npm run scrape:meta -- --dry-run             # print the plan, run nothing
//   npm run scrape:meta -- --force               # re-scrape already-done pages too

import { readFile, writeFile } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { glob } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import puppeteer from 'puppeteer-core';
import {
  ROOT, DIR, SYNC_SPREADSHEET_ID, SYNC_KEY_PATH, MANUAL_SHEET_GID, META_SHEET_TAB_NAME,
  META_CHUNK_SIZE, META_CHUNK_PAUSE_MS, META_CONCURRENCY, META_PACING_MS, META_NAV_TIMEOUT,
  META_BLOCKED_RESOURCE_TYPES, SAFE_BLOCK_ABORT_RATIO,
  VIEWPORT, NAV_WAIT_UNTIL, CAPTURE_USER_AGENT, CAPTURE_ACCEPT_LANGUAGE, CHROME_EXECUTABLE_PATH,
} from '../config.js';
import { getAccessToken } from './google-auth.js';

const OUTPUT_PATH = `${DIR.data}/meta-manual.json`;

// ─── CLI ───────────────────────────────────────────────────────────────────
const arg = (name) => process.argv.find(a => a.startsWith(`--${name}=`))?.split('=')[1];
const flag = (name) => process.argv.includes(`--${name}`);
const limit = parseInt(arg('limit') || '0', 10);
const idsArg = arg('ids');
const force = flag('force');
const dryRun = flag('dry-run');
const chunkSize = parseInt(arg('chunk') || String(META_CHUNK_SIZE), 10);
const pauseMin = parseInt(arg('pause') || String(META_CHUNK_PAUSE_MS / 60000), 10);
const concurrency = parseInt(arg('concurrency') || String(META_CONCURRENCY), 10);
const pacingMs = parseInt(arg('pacing') || String(META_PACING_MS), 10);

// ─── Meta extractor (browser-side, self-contained) ─────────────────────────
// Lifted from extract.js lines 37-51 — same queries the parity pipeline uses,
// so the dashboard's notion of "meta" matches exactly. No imports, only DOM
// APIs (runs via page.evaluate). Returns the full meta object; the 5 requested
// fields are title/description/ogTitle/ogImage/keywords; canonical/publishDate/
// section come free from the same selectors.
const EXTRACT_META = () => {
  const norm = (s) => (s || '').trim().replace(/\s+/g, ' ');
  const meta = (name) => {
    const el = document.querySelector(`meta[name="${name}"], meta[property="${name}"]`);
    return el ? norm(el.content) : '';
  };
  return {
    title: norm(document.title),
    description: meta('description'),
    canonical: (document.querySelector('link[rel="canonical"]') || {}).href || '',
    ogTitle: meta('og:title'),
    ogImage: meta('og:image'),
    keywords: meta('keywords'),
    publishDate: meta('article:published_time') || meta('publish_date') || meta('date'),
    section: meta('article:section'),
  };
};

// The 5 fields the user asked for (used for coverage stats + dashboard badges).
const META_FIELDS = ['title', 'description', 'ogTitle', 'ogImage', 'keywords'];

// ─── Read URLs from the private sheet via the service account ──────────────
// Sheet layout (tab "BBL Thai Manual Pages"): row 1 = title, row 2 = headers,
// data starts row 3. Col A=prod URL, D=category, E=sub-category, F=Status.
async function readManualPages() {
  if (!existsSync(SYNC_KEY_PATH)) throw new Error(`Missing service-account key at ${SYNC_KEY_PATH}. See README "Sheet sync".`);
  const token = await getAccessToken(SYNC_KEY_PATH, 'https://www.googleapis.com/auth/spreadsheets.readonly');
  const range = `${META_SHEET_TAB_NAME}!A3:H1002`;
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${SYNC_SPREADSHEET_ID}/values/${encodeURIComponent(range)}?valueRenderOption=UNFORMATTED_VALUE`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  const json = await res.json();
  if (!res.ok) throw new Error(`Sheets API failed: ${res.status} ${JSON.stringify(json)}`);
  const rows = (json.values || []).filter(r => r[0]); // must have a prod URL
  return rows.map((r, i) => ({
    id: String(i + 1), // stable id, independent of any later filtering/slicing
    prodUrl: r[0],
    category: r[3] || '',
    subCategory: r[4] || '',
    sheetStatus: r[5] || '',
  }));
}

// ─── Scrape one page ────────────────────────────────────────────────────────
// Isolated context per page (same rationale as compare.js:815 — Akamai flags a
// shared session as a bot after a request or two). Request interception drops
// images/fonts/css/media because meta tags live in <head> from the first byte
// and we never render the page.
async function scrapeOne(browser, prodUrl) {
  const result = { ok: false, error: null, errorType: null, meta: null };
  if (!prodUrl) { result.error = 'no URL'; return result; }
  const context = await browser.createBrowserContext();
  const page = await context.newPage();
  try {
    await page.setUserAgent(CAPTURE_USER_AGENT).catch(() => {});
    await page.setExtraHTTPHeaders({ 'Accept-Language': CAPTURE_ACCEPT_LANGUAGE }).catch(() => {});
    await page.setViewport(VIEWPORT);

    await page.setRequestInterception(true);
    page.on('request', (req) => {
      if (META_BLOCKED_RESOURCE_TYPES.includes(req.resourceType())) req.abort();
      else req.continue();
    });

    await page.goto(prodUrl, { waitUntil: NAV_WAIT_UNTIL, timeout: META_NAV_TIMEOUT });
    // No layout/scroll wait — meta is in the initial HTML. One tiny settle lets
    // any client-injected <meta> (rare on prod, common on AEM) land.
    await new Promise(r => setTimeout(r, 300));
    result.meta = await page.evaluate(EXTRACT_META);
    result.ok = true;
  } catch (e) {
    const msg = (e.message || '').split('\n')[0];
    result.error = msg;
    // Connection-drop is the confirmed WAF-ban signature (compare.js:868) —
    // classify as blocked so the abort guard + dashboard can tell "retry later"
    // apart from a genuine empty-meta page.
    result.errorType = /ERR_HTTP2_PROTOCOL_ERROR|ERR_SOCKET|net::ERR_NETWORK|ERR_CONNECTION/.test(msg) ? 'blocked' : null;
  } finally {
    await context.close().catch(() => {});
  }
  return result;
}

// ─── Resume + merge helpers (mirror compare.js's mergePreserved) ────────────
// A page is "done" if it has a non-null `meta` object OR a real error captured
// (not a WAF block — those should retry). Blocked pages are re-attempted.
function isDone(p) {
  if (!p) return false;
  if (p.meta) return true;
  // Non-blocked error (e.g. genuine 404) counts as done — retrying won't help.
  if (p.error && p.errorType !== 'blocked') return true;
  return false;
}

function loadExisting() {
  if (!existsSync(OUTPUT_PATH)) return null;
  try {
    const raw = JSON.parse(readFileSync(OUTPUT_PATH, 'utf8'));
    const map = {};
    for (const p of (raw.pages || [])) if (p && p.id) map[String(p.id)] = p;
    return map;
  } catch { return null; }
}

// Merge this run's results (priority) over all previously-known pages.
function mergePreserved(results, preserveMap) {
  const runIds = new Set(results.filter(Boolean).map(r => r.id));
  const preserved = preserveMap
    ? Object.values(preserveMap).filter(p => p && p.id && !runIds.has(p.id))
    : [];
  const all = [...results.filter(Boolean), ...preserved];
  all.sort((a, b) => (parseInt(a.id, 10) || 0) - (parseInt(b.id, 10) || 0));
  return all;
}

async function saveResults(results, start, preserveMap) {
  const allPages = mergePreserved(results, preserveMap);
  const payload = { generatedAt: new Date().toISOString(), totalDurationMs: start ? Date.now() - start : 0, pages: allPages };
  await writeFile(OUTPUT_PATH, JSON.stringify(payload, null, 1), 'utf8');
  return { total: allPages.length, refreshed: results.filter(Boolean).length };
}

// Parse "3,7,19-25" into a Set of string ids.
function parseIdRanges(spec) {
  const ids = new Set();
  for (const part of spec.split(',').map(s => s.trim()).filter(Boolean)) {
    const range = part.match(/^(\d+)-(\d+)$/);
    if (range) {
      for (let n = parseInt(range[1], 10); n <= parseInt(range[2], 10); n++) ids.add(String(n));
    } else {
      ids.add(part);
    }
  }
  return ids;
}

// ─── Chunked worker pool (concurrency 1 by default) ────────────────────────
// Each worker pulls the next id-sorted page, scrapes it, paces, and saves
// incrementally every 10 pages. `subset` is the whole in-scope list (already
// chunk-filtered by the caller); preserveMap keeps out-of-scope + unreached
// pages verbatim across chunks.
async function runPool(browser, subset, existing, preserveMap, force, pacing) {
  const results = new Array(subset.length);
  let cursor = 0;
  let done = 0;
  const start = Date.now();

  async function worker() {
    while (cursor < subset.length) {
      const i = cursor++;
      const p = subset[i];
      const tag = `[${done + 1}/${subset.length}]`;
      const shortPath = p.prodUrl.replace('https://www.bangkokbank.com', '') || '(no url)';

      // Resume: skip already-scraped pages (unless --force).
      if (!force && existing && existing[p.id] && isDone(existing[p.id])) {
        results[i] = existing[p.id];
        if (done % 10 === 0 || done === subset.length - 1) console.log(`${tag} 📦 cached ${shortPath}`);
        done++;
        continue;
      }

      const res = await scrapeOne(browser, p.prodUrl);
      results[i] = {
        id: p.id,
        prodUrl: p.prodUrl,
        category: p.category,
        subCategory: p.subCategory,
        sheetStatus: p.sheetStatus,
        meta: res.meta,
        ok: res.ok,
        error: res.error,
        errorType: res.errorType,
      };
      done++;
      const cov = res.meta ? META_FIELDS.filter(f => res.meta[f]).length : 0;
      const mark = res.errorType === 'blocked' ? '🛑 BLOCKED' : res.ok ? `✓ ${cov}/5` : '✗ err';
      console.log(`${tag} ${mark} ${shortPath}${res.error ? ` — ${res.error}` : ''}`);

      if (done % 10 === 0) await saveResults(results, start, preserveMap);
      if (pacing > 0 && cursor < subset.length) await new Promise(r => setTimeout(r, pacing));
    }
  }

  await Promise.all(Array.from({ length: concurrency }, worker));
  return results;
}

// ─── Chrome binary resolution (same as compare.js) ──────────────────────────
async function resolveChrome() {
  if (process.env.PUPPETEER_EXECUTABLE_PATH && existsSync(process.env.PUPPETEER_EXECUTABLE_PATH)) {
    return process.env.PUPPETEER_EXECUTABLE_PATH;
  }
  for await (const p of glob(CHROME_EXECUTABLE_PATH)) {
    if (existsSync(p)) return p;
  }
  const ab = '/Users/prapon.t/.agent-browser/browsers/chrome-148.0.7778.97/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing';
  if (existsSync(ab)) return ab;
  throw new Error('No Chrome binary found. Set PUPPETEER_EXECUTABLE_PATH or install Chrome.');
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// ─── Main ───────────────────────────────────────────────────────────────────
async function main() {
  const allPages = await readManualPages();
  console.log(`📥 Read ${allPages.length} pages from sheet "BBL Thai Manual Pages" (gid ${MANUAL_SHEET_GID})`);

  // Scope selection (same precedence as compare.js): --ids > --limit > all.
  let subset = allPages;
  let scopeDesc = `all ${allPages.length}`;
  if (idsArg) {
    const wanted = parseIdRanges(idsArg);
    subset = allPages.filter(p => wanted.has(p.id));
    scopeDesc = `--ids=${idsArg} (${subset.length} matched)`;
  } else if (limit > 0) {
    subset = allPages.slice(0, limit);
    scopeDesc = `--limit=${limit}`;
  }

  const preserveMap = loadExisting(); // ALL previously-known pages = save fallback
  const existing = force ? null : preserveMap; // resume lookup (skip done pages)
  if (preserveMap) {
    console.log(`   Loaded ${Object.keys(preserveMap).length} existing result(s)${force ? ' · --force will re-scrape in-scope pages' : ' for resume'}`);
  }

  // Build chunks over the in-scope subset. Each chunk = one scrape burst; the
  // pause between them lets the WAF rate window lapse (same as safe-run.js).
  const chunks = [];
  for (let s = 0; s < subset.length; s += chunkSize) {
    chunks.push(subset.slice(s, s + chunkSize));
  }

  console.log(`🚀 Scraping meta · ${subset.length} page(s) · ${chunks.length} chunk(s) of ~${chunkSize} · concurrency ${concurrency}${pacingMs ? ` · pacing ${pacingMs}ms` : ''} · pause ${pauseMin}min${force ? ' · --force' : ''}`);
  console.log(`   scope: ${scopeDesc} · abort if a chunk is ≥${Math.round(SAFE_BLOCK_ABORT_RATIO * 100)}% BLOCKED`);
  console.log(`   output → ${OUTPUT_PATH}`);
  if (dryRun) {
    console.log(`\n⏩ --dry-run: plan only, nothing will run`);
    chunks.forEach((c, i) => {
      const first = c[0]?.id, last = c[c.length - 1]?.id;
      console.log(`   chunk ${String(i + 1).padStart(2)}/${chunks.length}: ids ${first}-${last} (${c.length} pages) → pause ${i < chunks.length - 1 ? pauseMin + 'min' : '(last, no pause)'}`);
    });
    return;
  }

  const exe = await resolveChrome();
  console.log(`   Chrome: ${exe}`);
  const browser = await puppeteer.launch({
    executablePath: exe,
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu', `--window-size=${VIEWPORT.width},${VIEWPORT.height}`],
  });

  const t0 = Date.now();
  let aborted = false;
  let completed = 0;
  try {
    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      console.log(`\n── chunk ${i + 1}/${chunks.length} · ids ${chunk[0]?.id}-${chunk[chunk.length - 1]?.id} ────────────────────`);
      const results = await runPool(browser, chunk, existing, preserveMap, force, pacingMs);
      await saveResults(results, t0, preserveMap);

      // Ban detection (safe-run.js pattern): a mostly-blocked chunk means the IP
      // is banned — continuing only writes garbage. Stop for a human decision.
      const blocked = results.filter(r => r && r.errorType === 'blocked').length;
      const blockRate = results.length > 0 ? blocked / results.length : 0;
      if (blocked > 0 && blockRate >= SAFE_BLOCK_ABORT_RATIO) {
        console.error(`\n🛑 ABORTED: chunk ${i + 1} was ${Math.round(blockRate * 100)}% BLOCKED (${blocked}/${results.length}).`);
        console.error(`   The IP looks banned — continuing would fill the file with garbage.`);
        console.error(`   Options: wait ~20-30 min and re-run (resume skips done pages), switch network/IP, or retry later.`);
        console.error(`   Progress is saved. Next: npm run scrape:meta (resumes here).`);
        aborted = true;
        break;
      }

      completed++;
      if (i < chunks.length - 1) {
        console.log(`\n😴 Pausing ${pauseMin} min to let the WAF rate window clear before chunk ${i + 2}...`);
        console.log(`   (Ctrl-C now is safe — re-run resumes from the next incomplete chunk)`);
        await sleep(pauseMin * 60000);
      }
    }
  } finally {
    await browser.close();
  }

  const dur = ((Date.now() - t0) / 1000).toFixed(1);
  const final = JSON.parse(readFileSync(OUTPUT_PATH, 'utf8'));
  const withMeta = final.pages.filter(p => p.meta).length;
  console.log(`\n${'═'.repeat(60)}`);
  console.log(aborted ? `🛑 Stopped early after ${completed} chunk(s) — possible IP ban.` : `✅ Finished ${completed}/${chunks.length} chunk(s) in ${dur}s.`);
  console.log(`   pages with meta: ${withMeta}/${final.pages.length}`);
  console.log(`   blocked:         ${final.pages.filter(p => p.errorType === 'blocked').length}`);
  console.log(`   Results → ${OUTPUT_PATH}`);
  console.log(`   Next: npm run dashboard:meta`);
  console.log(`${'═'.repeat(60)}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(e => { console.error('❌', e); process.exit(1); });
}
