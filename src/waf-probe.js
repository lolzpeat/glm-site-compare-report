// WAF block-check trigger — the ONE home of "are we blocked?" logic.
// Three consumers: the CLI (npm run probe), --watch, and compare.js's
// pre-flight. Never probe with curl: Akamai rejects curl's TLS fingerprint
// outright, indistinguishable from an IP ban (AGENTS.md, 2026-08-05).
// Spec: docs/superpowers/specs/2026-08-06-waf-block-trigger-design.md
import { readFileSync, writeFileSync, renameSync, existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { execFile } from 'node:child_process';
import puppeteer from 'puppeteer-core';
import { pathToFileURL } from 'node:url';
import { resolveChrome } from './chrome.js';
import {
  RETRYABLE_HTTP_STATUS, WAF_PROBE_URLS, WAF_STATUS_PATH, WAF_HISTORY_MAX,
  WAF_STATUS_FRESH_MS, WAF_WATCH_INTERVAL_MS, WAF_PREFLIGHT_RETRY_MS,
  WAF_PREFLIGHT_MAX_WAIT_MS, VIEWPORT, CAPTURE_USER_AGENT, NAV_WAIT_UNTIL, NAV_TIMEOUT,
} from '../config.js';

// Same denial signals scoreParity uses on captured pages (compare.js
// isBlocked): Akamai serves the denial as a real HTTP 200 page, so the
// title/body text is the signal, not the status code.
const DENIED_TITLE = /access denied|forbidden|blocked|you have been blocked/i;
const DENIED_BODY = /access denied|you have been blocked/i;

// 'ok' only for a clean 200. A navigation error is the ban's connection-drop
// signature → 'drop'. Everything else — retryable statuses, denial pages,
// unexpected non-200s — is 'denied': not clearly ok means do not capture.
export function classify({ status, title, bodySample, navError } = {}) {
  if (navError) return 'drop';
  if (DENIED_TITLE.test(title || '') || DENIED_BODY.test(bodySample || '')) return 'denied';
  if (RETRYABLE_HTTP_STATUS.includes(status)) return 'denied';
  if (status !== 200) return 'denied';
  return 'ok';
}

// Plain synchronous writes: the file is tiny and advisory. Concurrent
// writers (watcher + a pre-flight) are last-writer-wins by design.
export function readStatus(path) {
  if (!existsSync(path)) return { current: null, history: [] };
  try {
    const d = JSON.parse(readFileSync(path, 'utf8'));
    return { current: d.current ?? null, history: Array.isArray(d.history) ? d.history : [] };
  } catch {
    return { current: null, history: [] };
  }
}

export function appendStatus(path, entry, max) {
  const { history } = readStatus(path);
  const next = { current: entry, history: [...history, entry].slice(-max) };
  mkdirSync(dirname(path), { recursive: true });
  // Atomic write: write to a temp file then rename over the target. A torn
  // read during a concurrent write (watcher + a pre-flight probe both firing)
  // must not wipe the history — rename is atomic on the same filesystem.
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, JSON.stringify(next, null, 1));
  renameSync(tmp, path);
}

async function probeHost(browser, url) {
  // Isolated context per probe page — matches the pipeline's
  // SHARE_BROWSER_CONTEXT=false behaviour (shared cookies let the WAF
  // correlate requests into one bot session; see config.js).
  const ctx = await browser.createBrowserContext();
  try {
    const page = await ctx.newPage();
    await page.setViewport(VIEWPORT);
    await page.setUserAgent(CAPTURE_USER_AGENT);
    const resp = await page.goto(url, { waitUntil: NAV_WAIT_UNTIL, timeout: NAV_TIMEOUT });
    const title = await page.title().catch(() => '');
    const bodySample = await page.evaluate(() => document.body?.innerText?.slice(0, 300) ?? '').catch(() => '');
    return classify({ status: resp ? resp.status() : 0, title, bodySample });
  } catch (e) {
    return classify({ navError: e.message || String(e) });
  } finally {
    await ctx.close().catch(() => {});
  }
}

export async function probeOnce({ source = 'cli' } = {}) {
  const t0 = Date.now();
  const exe = await resolveChrome();
  const browser = await puppeteer.launch({ executablePath: exe, headless: true, args: ['--no-sandbox'] });
  let prod, aem;
  try {
    prod = await probeHost(browser, WAF_PROBE_URLS.prod);
    aem = await probeHost(browser, WAF_PROBE_URLS.aem);
  } finally {
    await browser.close().catch(() => {});
  }
  const entry = {
    state: prod === 'ok' && aem === 'ok' ? 'ok' : 'blocked',
    prod, aem,
    at: new Date().toISOString(),
    durationMs: Date.now() - t0,
    source,
  };
  appendStatus(WAF_STATUS_PATH, entry, WAF_HISTORY_MAX);
  return entry;
}

const jitter = ([lo, hi]) => lo + Math.floor(Math.random() * (hi - lo));
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// Pre-flight gate. Trusts a fresh result from ANY source (watcher, another
// pre-flight) before spending WAF budget on a new probe. Waits with jitter —
// fixed retry intervals are a bot fingerprint. Hard cap so a nohup'd run
// fails loudly instead of hanging invisibly forever.
export async function waitUntilClear({ source = 'preflight' } = {}) {
  const t0 = Date.now();
  for (;;) {
    const { current } = readStatus(WAF_STATUS_PATH);
    // Guard against a future-dated file from clock skew: a negative age would
    // otherwise satisfy `age < WAF_STATUS_FRESH_MS` and be trusted as fresh.
    // NaN (unparseable `at`) must also stay not-fresh — `NaN >= 0` is false.
    const age = current ? Date.now() - Date.parse(current.at) : Infinity;
    const fresh = current && age >= 0 && age < WAF_STATUS_FRESH_MS;
    const cur = fresh ? current : await probeOnce({ source });
    if (cur.state === 'ok') return cur;
    if (Date.now() - t0 > WAF_PREFLIGHT_MAX_WAIT_MS) {
      throw new Error(`WAF still blocking after ${Math.round(WAF_PREFLIGHT_MAX_WAIT_MS / 3600000)}h (prod:${cur.prod} aem:${cur.aem}) — giving up`);
    }
    const nap = jitter(WAF_PREFLIGHT_RETRY_MS);
    console.log(`⏳ WAF blocked (prod:${cur.prod} aem:${cur.aem}) — retrying in ${Math.round(nap / 60000)}m`);
    await sleep(nap);
  }
}

// macOS notification; best-effort (headless/SSH sessions just log).
function notifyMac(message) {
  execFile('osascript', ['-e',
    `display notification ${JSON.stringify(message)} with title "BBL WAF"`,
  ], () => {});
}

async function cliWatch() {
  console.log(`🚀 watching WAF status (probe every ${WAF_WATCH_INTERVAL_MS.map(m => Math.round(m / 60000)).join('-')}m, jittered) — Ctrl-C to stop`);
  // Only trust a stored status as the seed for change-detection if it's
  // recent (within one watch-interval upper bound and not future-dated). A
  // days-old 'blocked' entry left over from a previous session must not fire
  // a phantom "ปลดบล็อกแล้ว" (unblocked) notification on the very first probe.
  const stored = readStatus(WAF_STATUS_PATH).current;
  const recent = stored && (Date.now() - Date.parse(stored.at)) < WAF_WATCH_INTERVAL_MS[1] && (Date.now() - Date.parse(stored.at)) >= 0;
  let prev = recent ? stored.state : null;
  for (;;) {
    let e;
    try {
      e = await probeOnce({ source: 'watch' });
    } catch (err) {
      // A probe crash (Chrome missing, disk full) must not kill the watcher.
      console.log(`❌ probe failed: ${err.message}`);
      await sleep(jitter(WAF_WATCH_INTERVAL_MS));
      continue;
    }
    console.log(`${mark(e.state)} ${e.at} ${e.state} · prod:${e.prod} aem:${e.aem}`);
    if (prev !== null && e.state !== prev) {
      notifyMac(e.state === 'ok' ? 'WAF ปลดบล็อกแล้ว — capture ได้' : `โดน WAF บล็อก (prod:${e.prod} aem:${e.aem})`);
    }
    prev = e.state;
    await sleep(jitter(WAF_WATCH_INTERVAL_MS));
  }
}

const mark = (s) => s === 'ok' ? '✅' : '🚫';

async function cliOnce() {
  console.log('🚀 probing prod + AEM with the pipeline browser (never curl — see AGENTS.md)');
  const e = await probeOnce({ source: 'cli' });
  console.log(`${mark(e.state)} state: ${e.state} · prod: ${e.prod} · aem: ${e.aem} · ${e.durationMs}ms`);
  const { history } = readStatus(WAF_STATUS_PATH);
  for (const h of history.slice(-5)) {
    console.log(`   ${h.at}  ${h.state.padEnd(7)} prod:${h.prod} aem:${h.aem} (${h.source})`);
  }
  // process.exitCode (not process.exit()) lets stdout/stderr flush fully
  // before the process ends — process.exit() can truncate piped output.
  process.exitCode = e.state === 'ok' ? 0 : 1;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  if (process.argv.includes('--watch')) {
    cliWatch().catch(e => { console.error('❌', e.message); process.exitCode = 2; });
  } else {
    cliOnce().catch(e => { console.error('❌', e.message); process.exitCode = 2; });
  }
}
