# WAF Block-Check Trigger Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One probe module (`src/waf-probe.js`) that answers "are we WAF-blocked right now?" three ways: an on-demand CLI (`npm run probe`), a `--watch` daemon with macOS notifications on state change, and a wait-until-clear pre-flight inside compare.js.

**Architecture:** All probing and classification lives in `src/waf-probe.js`; the CLI, watcher and pre-flight are thin consumers of it. Every probe result is appended to a shared `data/waf-status.json` so consumers can trust each other's recent results instead of re-probing. `resolveChrome()` is extracted from compare.js into `src/chrome.js` because waf-probe must not import compare.js (compare.js starts a capture run on import).

**Tech Stack:** Node 18+ ESM (`.js` extensions on relative imports, no build step), puppeteer-core, node:test.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-08-06-waf-block-trigger-design.md` (user-approved).
- **Never probe with curl** — Akamai rejects curl's TLS fingerprint outright and the result is indistinguishable from an IP ban (AGENTS.md gotcha, 2026-08-05). Probing must use puppeteer with the pipeline's own `CAPTURE_USER_AGENT` and `VIEWPORT`.
- All tunables go in `config.js` — never hardcode a threshold in a script (AGENTS.md).
- `src/extract.js` rules do NOT apply here (waf-probe runs in Node, not in-page).
- Logging style: emoji-prefixed `console.log` (🚀 ✅ 📥 ❌ ⏳) to match the repo.
- Tests: `node --test 'test/*.test.js'` via `npm test`; style follows `test/checks-assets.test.js` (node:test + `assert/strict`).
- A capture loop may be running in the background (`.capture-loop-tmp.sh`, a tmp file). Do NOT modify or restart it; it is out of scope.

## File Structure

- Create `src/chrome.js` — `resolveChrome()` moved verbatim from compare.js (single responsibility: find the Chrome binary).
- Create `src/waf-probe.js` — `classify()`, status-file helpers, `probeOnce()`, `waitUntilClear()`, CLI (`once` + `--watch`).
- Create `test/waf-probe.test.js` — tests for the pure parts: `classify()` and the status-file helpers.
- Modify `config.js` — `WAF_*` constants block.
- Modify `src/compare.js` — import `resolveChrome` from `./chrome.js` (delete local copy); add pre-flight + `--no-wait`.
- Modify `package.json` — `"probe"` script.
- Modify `README.md` — document `npm run probe` and `--no-wait`.

---

### Task 1: Extract `resolveChrome()` into `src/chrome.js`

**Files:**
- Create: `src/chrome.js`
- Modify: `src/compare.js` (imports at ~line 17-29; delete `resolveChrome` at ~line 999-1015)

**Interfaces:**
- Produces: `resolveChrome(): Promise<string>` exported from `src/chrome.js` — returns an absolute path to a Chrome binary or throws. Tasks 4-6 import it.

- [ ] **Step 1: Create `src/chrome.js` with the function moved verbatim**

```js
// Chrome binary resolution, shared by compare.js and waf-probe.js.
// Lives in its own module because waf-probe must not import compare.js —
// compare.js starts a capture run on import.
import { existsSync } from 'node:fs';
import { glob } from 'node:fs/promises';
import { CHROME_EXECUTABLE_PATH } from '../config.js';

export async function resolveChrome() {
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
```

- [ ] **Step 2: Switch compare.js to the shared copy**

In `src/compare.js`:
1. Delete the whole `resolveChrome` function (the block under `// ─── Chrome binary resolution ───`, ~lines 999-1015).
2. Add to the imports: `import { resolveChrome } from './chrome.js';`
3. `CHROME_EXECUTABLE_PATH` and `glob` may now be unused in compare.js — check with `grep -n "CHROME_EXECUTABLE_PATH\|glob(" src/compare.js` and remove them from the import lists **only if** nothing else uses them.

- [ ] **Step 3: Verify nothing broke**

Run: `node --check src/compare.js && node --check src/chrome.js && npm test`
Expected: syntax ok, 59/59 tests pass.
Also run: `node -e "import('./src/chrome.js').then(async m => console.log(await m.resolveChrome()))"`
Expected: prints an existing Chrome path.

- [ ] **Step 4: Commit**

```bash
git add src/chrome.js src/compare.js
git commit -m "refactor: extract resolveChrome into src/chrome.js"
```

---

### Task 2: `WAF_*` config + `classify()` (TDD)

**Files:**
- Modify: `config.js` (append a new section near `RETRYABLE_HTTP_STATUS`)
- Create: `src/waf-probe.js` (classify only, for now)
- Create: `test/waf-probe.test.js`

**Interfaces:**
- Consumes: `RETRYABLE_HTTP_STATUS` from `config.js` (already exists: `[408, 429, 500, 502, 503, 504]`).
- Produces: `classify({ status, title, bodySample, navError }): 'ok' | 'denied' | 'drop'` exported from `src/waf-probe.js`; the `WAF_*` constants below.

- [ ] **Step 1: Add the config block**

Append to `config.js`:

```js
// ─── WAF block-check trigger (src/waf-probe.js) ─────────────────────────────
// One probe module, three consumers: `npm run probe` (on-demand), `--watch`
// (periodic + macOS notify on state change), and compare.js's pre-flight.
// All write data/waf-status.json so they can trust each other's recent
// results instead of re-probing. Spec:
// docs/superpowers/specs/2026-08-06-waf-block-trigger-design.md
export const WAF_PROBE_URLS = {
  prod: 'https://www.bangkokbank.com/th-TH/About-Us',
  aem: 'https://main--site-prod--bangkok-bank.aem.live/th/about-us',
};
export const WAF_STATUS_PATH = join(DIR.data, 'waf-status.json');
export const WAF_HISTORY_MAX = 200;      // history entries kept in the status file
export const WAF_STATUS_FRESH_MS = 2 * 60 * 1000;   // trust a result this recent, skip probing
export const WAF_WATCH_INTERVAL_MS = [10 * 60 * 1000, 20 * 60 * 1000];  // watcher jitter range
export const WAF_PREFLIGHT_RETRY_MS = [5 * 60 * 1000, 20 * 60 * 1000];  // pre-flight wait jitter range
export const WAF_PREFLIGHT_MAX_WAIT_MS = 6 * 60 * 60 * 1000; // give up: a nohup'd run must not hang forever
```

(`join` and `DIR` are already imported/defined at the top of config.js.)

- [ ] **Step 2: Write the failing tests**

Create `test/waf-probe.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classify } from '../src/waf-probe.js';

test('classify: clean 200 page is ok', () => {
  assert.equal(classify({ status: 200, title: 'เกี่ยวกับธนาคารกรุงเทพ', bodySample: 'ธนาคารกรุงเทพ...' }), 'ok');
});

test('classify: Access Denied page is denied even with HTTP 200', () => {
  // Akamai serves the denial as a real 200 page — the title is the signal.
  assert.equal(classify({ status: 200, title: 'Access Denied', bodySample: "You don't have permission to access..." }), 'denied');
});

test('classify: denial text in the body is denied even with a clean title', () => {
  assert.equal(classify({ status: 200, title: '', bodySample: 'Access Denied You don\'t have permission' }), 'denied');
});

test('classify: retryable statuses are denied — a 429 body still LOADS (priority ids 11/13 incident)', () => {
  for (const s of [408, 429, 500, 502, 503, 504]) assert.equal(classify({ status: s, title: '', bodySample: '' }), 'denied');
});

test('classify: navigation error is drop — the WAF ban connection-drop signature', () => {
  assert.equal(classify({ navError: 'net::ERR_HTTP2_PROTOCOL_ERROR' }), 'drop');
});

test('classify: unexpected non-200 without denial text is denied (not clearly ok = do not capture)', () => {
  assert.equal(classify({ status: 404, title: 'Not Found', bodySample: '' }), 'denied');
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL — `Cannot find module .../src/waf-probe.js`.

- [ ] **Step 4: Implement `classify()` in a new `src/waf-probe.js`**

```js
// WAF block-check trigger — the ONE home of "are we blocked?" logic.
// Three consumers: the CLI (npm run probe), --watch, and compare.js's
// pre-flight. Never probe with curl: Akamai rejects curl's TLS fingerprint
// outright, indistinguishable from an IP ban (AGENTS.md, 2026-08-05).
// Spec: docs/superpowers/specs/2026-08-06-waf-block-trigger-design.md
import { RETRYABLE_HTTP_STATUS } from '../config.js';

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
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test`
Expected: PASS (59 old + 6 new = 65).

- [ ] **Step 6: Commit**

```bash
git add config.js src/waf-probe.js test/waf-probe.test.js
git commit -m "feat(waf-probe): classify() + WAF_* config"
```

---

### Task 3: Status-file helpers (TDD)

**Files:**
- Modify: `src/waf-probe.js`
- Modify: `test/waf-probe.test.js`

**Interfaces:**
- Produces (exported from `src/waf-probe.js`):
  - `readStatus(path): { current: object|null, history: object[] }` — `{ current: null, history: [] }` when missing or corrupt.
  - `appendStatus(path, entry, max): void` — writes `{ current: entry, history: [...old, entry] }` with history capped to the last `max`.

- [ ] **Step 1: Write the failing tests**

Append to `test/waf-probe.test.js`:

```js
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readStatus, appendStatus } from '../src/waf-probe.js';

const entry = (n) => ({ state: 'ok', prod: 'ok', aem: 'ok', at: `2026-08-06T00:00:${String(n).padStart(2, '0')}Z`, source: 'cli' });

test('status file: missing file reads as empty', () => {
  const p = join(mkdtempSync(join(tmpdir(), 'waf-')), 'waf-status.json');
  assert.deepEqual(readStatus(p), { current: null, history: [] });
});

test('status file: append sets current and grows history, capped at max', () => {
  const p = join(mkdtempSync(join(tmpdir(), 'waf-')), 'waf-status.json');
  for (let i = 0; i < 5; i++) appendStatus(p, entry(i), 3);
  const st = readStatus(p);
  assert.equal(st.current.at, entry(4).at);
  assert.equal(st.history.length, 3, 'history capped');
  assert.equal(st.history[0].at, entry(2).at, 'oldest dropped');
});

test('status file: corrupt file reads as empty instead of throwing', async () => {
  const p = join(mkdtempSync(join(tmpdir(), 'waf-')), 'waf-status.json');
  appendStatus(p, entry(0), 3);
  const fs = await import('node:fs');
  fs.writeFileSync(p, '{not json');   // simulate corruption
  assert.deepEqual(readStatus(p), { current: null, history: [] });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL — `readStatus is not exported`.

- [ ] **Step 3: Implement the helpers**

Add to `src/waf-probe.js`:

```js
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

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
  writeFileSync(path, JSON.stringify(next, null, 1));
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: PASS (65 + 3 = 68).

- [ ] **Step 5: Commit**

```bash
git add src/waf-probe.js test/waf-probe.test.js
git commit -m "feat(waf-probe): status-file read/append with capped history"
```

---

### Task 4: `probeOnce()` + CLI once-mode + `npm run probe`

**Files:**
- Modify: `src/waf-probe.js`
- Modify: `package.json` (scripts)

**Interfaces:**
- Consumes: `resolveChrome()` from `./chrome.js` (Task 1); `classify`, `readStatus`, `appendStatus` (Tasks 2-3); from config: `WAF_PROBE_URLS, WAF_STATUS_PATH, WAF_HISTORY_MAX, VIEWPORT, CAPTURE_USER_AGENT, NAV_WAIT_UNTIL, NAV_TIMEOUT`.
- Produces: `probeOnce({ source }): Promise<{ state, prod, aem, at, durationMs, source }>` where `state` is `'ok' | 'blocked'`; CLI exit code 0 = ok, 1 = blocked (scripts gate on this — it replaces the session-tmp probe files).

- [ ] **Step 1: Implement `probeOnce()` and the CLI**

Add to `src/waf-probe.js`:

```js
import puppeteer from 'puppeteer-core';
import { pathToFileURL } from 'node:url';
import { resolveChrome } from './chrome.js';
import {
  RETRYABLE_HTTP_STATUS, WAF_PROBE_URLS, WAF_STATUS_PATH, WAF_HISTORY_MAX,
  WAF_STATUS_FRESH_MS, WAF_WATCH_INTERVAL_MS, WAF_PREFLIGHT_RETRY_MS,
  WAF_PREFLIGHT_MAX_WAIT_MS, VIEWPORT, CAPTURE_USER_AGENT, NAV_WAIT_UNTIL, NAV_TIMEOUT,
} from '../config.js';
```

(Merge with the existing `RETRYABLE_HTTP_STATUS` import from Task 2 — one import statement for config.)

```js
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
```

CLI at the bottom of the file (guarded so importing never runs it):

```js
const mark = (s) => s === 'ok' ? '✅' : '🚫';

async function cliOnce() {
  console.log('🚀 probing prod + AEM with the pipeline browser (never curl — see AGENTS.md)');
  const e = await probeOnce({ source: 'cli' });
  console.log(`${mark(e.state)} state: ${e.state} · prod: ${e.prod} · aem: ${e.aem} · ${e.durationMs}ms`);
  const { history } = readStatus(WAF_STATUS_PATH);
  for (const h of history.slice(-5)) {
    console.log(`   ${h.at}  ${h.state.padEnd(7)} prod:${h.prod} aem:${h.aem} (${h.source})`);
  }
  process.exit(e.state === 'ok' ? 0 : 1);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  if (process.argv.includes('--watch')) {
    console.log('❌ --watch arrives in a later task');
    process.exit(2);
  } else {
    cliOnce().catch(e => { console.error('❌', e.message); process.exit(2); });
  }
}
```

- [ ] **Step 2: Add the npm script**

In `package.json` scripts, after `"fetch:priority"`:

```json
"probe": "node src/waf-probe.js",
```

- [ ] **Step 3: Verify — unit tests still pass, and one real probe**

Run: `npm test` — expected: 68/68 pass (importing waf-probe.js must NOT launch a browser).
Run: `npm run probe` — expected: two page loads, a state line, and `echo $?` matching (0 if ok). `data/waf-status.json` now exists with `current` + history.
⚠️ This spends 2 WAF page loads — run it ONCE. If a capture chunk is mid-flight (check `pgrep -f "compare.js --urls"`), wait for its cooldown first.

- [ ] **Step 4: Commit**

```bash
git add src/waf-probe.js package.json
git commit -m "feat(waf-probe): probeOnce + npm run probe (exit 0 ok / 1 blocked)"
```

---

### Task 5: `waitUntilClear()` + compare.js pre-flight + `--no-wait`

**Files:**
- Modify: `src/waf-probe.js`
- Modify: `src/compare.js` (main(), just before `const exe = await resolveChrome();` ~line 1088)
- Modify: `README.md` (CLI Flags section)

**Interfaces:**
- Consumes: `probeOnce`, `readStatus` (Tasks 3-4); config `WAF_STATUS_FRESH_MS, WAF_PREFLIGHT_RETRY_MS, WAF_PREFLIGHT_MAX_WAIT_MS, WAF_STATUS_PATH`.
- Produces: `waitUntilClear({ source }): Promise<entry>` — resolves when state is ok; throws after `WAF_PREFLIGHT_MAX_WAIT_MS`.

- [ ] **Step 1: Implement `waitUntilClear()`**

Add to `src/waf-probe.js`:

```js
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
    const fresh = current && (Date.now() - Date.parse(current.at)) < WAF_STATUS_FRESH_MS;
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
```

- [ ] **Step 2: Wire the pre-flight into compare.js**

In `src/compare.js` `main()`, immediately BEFORE `const exe = await resolveChrome();`:

```js
  // Pre-flight: don't start a capture into a WAF ban — it writes garbage 0%
  // rows and deepens the ban. Waits (jittered) until a probe comes back
  // clean; --no-wait skips the gate. See src/waf-probe.js.
  if (!process.argv.includes('--no-wait')) {
    await waitUntilClear({ source: 'preflight' });
  }
```

And add the import at the top: `import { waitUntilClear } from './waf-probe.js';`

- [ ] **Step 3: Document the flag**

In README.md's CLI Flags section (keep the Thai copy style), add rows:

```markdown
| `--no-wait` | ข้าม pre-flight ที่รอให้ WAF ปลดบล็อกก่อนเริ่ม capture |
| `npm run probe` | เช็คทันทีว่าโดน WAF บล็อกอยู่ไหม (exit 0 = ปกติ, 1 = โดนบล็อก) |
```

- [ ] **Step 4: Verify**

Run: `node --check src/compare.js && node --check src/waf-probe.js && npm test`
Expected: syntax ok, 68/68 pass.
Then verify the gate reads a fresh file instead of probing: `data/waf-status.json` was just written by Task 4's probe — if still within 2 minutes, `node -e "import('./src/waf-probe.js').then(m => m.waitUntilClear().then(e => console.log('clear', e.source)))"` should return instantly WITHOUT launching a browser (source shows the file's original source, not 'preflight'). If more than 2 minutes have passed it will probe once — also fine.

- [ ] **Step 5: Commit**

```bash
git add src/waf-probe.js src/compare.js README.md
git commit -m "feat(compare): WAF pre-flight — wait until clear, --no-wait to skip"
```

---

### Task 6: `--watch` mode + macOS notification on state change

**Files:**
- Modify: `src/waf-probe.js` (replace the `--watch` stub from Task 4)

**Interfaces:**
- Consumes: `probeOnce`, `readStatus`; config `WAF_WATCH_INTERVAL_MS, WAF_STATUS_PATH`.
- Produces: `node src/waf-probe.js --watch` — runs until killed; notifies via osascript ONLY when state changes.

- [ ] **Step 1: Implement watch mode**

Add to `src/waf-probe.js`:

```js
import { execFile } from 'node:child_process';

// macOS notification; best-effort (headless/SSH sessions just log).
function notifyMac(message) {
  execFile('osascript', ['-e',
    `display notification ${JSON.stringify(message)} with title "BBL WAF"`,
  ], () => {});
}

async function cliWatch() {
  console.log(`🚀 watching WAF status (probe every ${WAF_WATCH_INTERVAL_MS.map(m => Math.round(m / 60000)).join('-')}m, jittered) — Ctrl-C to stop`);
  let prev = readStatus(WAF_STATUS_PATH).current?.state ?? null;
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
```

Replace the Task 4 stub in the CLI guard:

```js
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  if (process.argv.includes('--watch')) {
    cliWatch().catch(e => { console.error('❌', e.message); process.exit(2); });
  } else {
    cliOnce().catch(e => { console.error('❌', e.message); process.exit(2); });
  }
}
```

- [ ] **Step 2: Verify**

Run: `npm test` — expected 68/68 (still no browser launch on import).
Smoke test the notification path WITHOUT probing: `osascript -e 'display notification "test" with title "BBL WAF"'` — a notification appears.
Optional live smoke (2 loads): `node src/waf-probe.js --watch`, let it print the first status line, Ctrl-C.

- [ ] **Step 3: Commit**

```bash
git add src/waf-probe.js
git commit -m "feat(waf-probe): --watch mode with macOS notify on state change"
```

---

### Task 7: AGENTS.md note

**Files:**
- Modify: `AGENTS.md` (the "NEVER use curl" gotcha bullet)

- [ ] **Step 1: Point the gotcha at the new tool**

At the end of the existing "NEVER use curl to test whether prod is blocked" bullet in AGENTS.md, append:

```markdown
The proper probe is now `npm run probe` (src/waf-probe.js — exit 0 ok / 1 blocked, writes data/waf-status.json); `--watch` for continuous monitoring; compare.js pre-flights automatically unless `--no-wait`.
```

- [ ] **Step 2: Verify + commit**

Run: `npm test` (unchanged, 68/68).

```bash
git add AGENTS.md
git commit -m "docs: point the never-curl gotcha at npm run probe"
```

---

## Self-Review (performed)

- **Spec coverage:** classify/probeOnce/waitUntilClear/CLI/watch/status-file/config/pre-flight/README — Tasks 1-7 cover every spec section, including the chrome.js extraction and the curl constraint (Task 7).
- **Placeholders:** none — every step carries real code.
- **Type consistency:** `entry` shape `{ state, prod, aem, at, durationMs, source }` is identical in Tasks 4-6; `readStatus`/`appendStatus` signatures match between Tasks 3-6; `jitter`/`sleep`/`mark` defined (Task 5/4) before first use order-wise — Task 6 uses `jitter`/`sleep` defined in Task 5 and `mark` from Task 4; noted in Interfaces.
- **Fixed during review:** the corrupt-file test is written as an async test callback (needs `await import('node:fs')`).
