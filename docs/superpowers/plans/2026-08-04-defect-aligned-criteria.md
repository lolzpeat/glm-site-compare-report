# Defect-Aligned Review Criteria Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restructure the main-pipeline parity scoring into 5 groups matching QA's real defect categories, adding broken-image, content-order, visual-layout, and PDF-download checks computed entirely from already-cached data.

**Architecture:** Scoring is extracted from `compare.js` into pure modules under `src/scoring/` (testable with Node's built-in test runner). Two standalone cache-building passes (`layout-profile.js` over screenshots via sharp, `check-downloads.js` via HEAD requests) feed a `rescore.js` script that re-scores `data/results.json` into `data/results-v2.json` without any page re-capture. `compare.js` is only switched to the new scoring in the final, user-gated promotion task.

**Tech Stack:** Node.js 18+ ESM, `sharp` (already a dep), `node:test` built-in runner (new to this repo, zero new dependencies), global `fetch`.

**Spec:** `docs/superpowers/specs/2026-08-04-defect-aligned-criteria-design.md`

## Global Constraints

- ESM only, `"type": "module"` — every relative import needs the `.js` extension.
- No new npm dependencies. Runtime deps stay exactly `puppeteer-core` + `sharp`.
- **`config.js` is the only place for tunables** — never hardcode a threshold in a script.
- New weights sum to exactly **1.00**: contentLength .10, missingText .12, missingKeywords .08, missingImage .10, brokenImage .11, imageAlt .04, contentOrder .10, visualLayout .10, missingDownloadLink .09, deadDownloadLink .06, headings .04, links .02, meta .02, template .02.
- Until the final promotion task, the new weights/groups live as `WEIGHTS_MAIN_V2` / `CRITERIA_GROUPS_V2` exports — **`compare.js`, the existing `WEIGHTS_MAIN`, and `data/results.json` must keep working unchanged mid-plan** (the user runs WAF-recovery compare runs between sessions).
- News pipeline (`WEIGHTS_NEWS`, `scoreNews`) and `src/extract.js` are untouched.
- Never write to `data/results.json` in any task before promotion; promotion backs it up first (`cp data/results.json data/results.json.backup-<label>`).
- `check-downloads.js` hits BBL hosts: HEAD only (GET fallback on 405/501 with body cancelled), dedupe by URL, bounded concurrency + pacing from config, abort when blocked ratio ≥ `SAFE_BLOCK_ABORT_RATIO`.
- Check-object shape everywhere: `{ id, weight, label, passed, detail, partial, diff, insufficient? }` — `partial` must never exceed 1 while `passed` is false.
- `insufficient` checks are excluded from the weight denominator, never scored 0.
- Logging: emoji-prefixed `console.log` (🚀 ✅ 📥 ❌ 📸). Code/comments English; dashboard/sheet copy Thai.
- Commit after every task; conventional commit format (`feat:`, `fix:`, `refactor:`, `docs:`, `test:`); **do not push** (user pushes manually).
- Tests run with `npm test` → `node --test test/`. Every pure module gets tests; I/O scripts get manual verification commands with expected output.

## File Map

| File | Role |
|---|---|
| `config.js` (modify) | `WEIGHTS_MAIN_V2`, `CRITERIA_GROUPS_V2`, download/order/layout/HEAD constants |
| `src/scoring/weights.js` (create) | single indirection `W`/`GROUPS` + load-time invariants (promotion edits only this file) |
| `src/scoring/util.js` (create) | shared pure helpers: `makeCheck`, `isDynamicBlock`, `filenameOf`, `normCompare`, `isDownloadHref`, `downloadBasename`, `lis`, `profileMatch` |
| `src/scoring/checks-content.js` (create) | contentLength, missingText, missingKeywords |
| `src/scoring/checks-assets.js` (create) | missingImage, brokenImage, imageAlt |
| `src/scoring/checks-alignment.js` (create) | contentOrder, visualLayout |
| `src/scoring/checks-downloads.js` (create) | missingDownloadLink, deadDownloadLink |
| `src/scoring/checks-structure.js` (create) | headings, links, meta, template |
| `src/scoring/advisory.js` (create) | aemIssues / brokenLinks / imageIssues / thaiIssues / formatting (unscored) |
| `src/scoring/score-main.js` (create) | assembles checks, weighted parity, gaps, advisory demotion |
| `src/layout-profile.js` (create) | screenshots → `data/layout-profiles.json` |
| `src/check-downloads.js` (create) | AEM download URLs → `data/link-status.json` |
| `src/rescore.js` (create) | results.json → results-v2.json + distribution report |
| `src/build-dashboard.js` (modify) | `--criteria=v2` flag, 5 new diff renderers, group CSS |
| `src/sync-sheet.js` (modify) | 7 new `CHECK_LABELS_TH` entries |
| `src/build-docs.js` (modify) | labels for new checks |
| `src/review-new-criteria.js` (delete) | superseded pilot |
| `src/compare.js` (modify, promotion only) | main branch → `scoreMain`, helpers imported from util |
| `test/*.test.js` (create) | node:test suites |

---

### Task 1: Test harness + config v2 weights/groups + weights indirection

**Files:**
- Modify: `config.js` (append after the `WEIGHTS_NEWS` block)
- Modify: `package.json` (scripts)
- Create: `src/scoring/weights.js`
- Test: `test/weights.test.js`

**Interfaces:**
- Produces: `WEIGHTS_MAIN_V2: Record<string, number>`, `CRITERIA_GROUPS_V2: {id, label, checks[]}[]`, constants `DOWNLOAD_EXTENSIONS`, `CONTENT_ORDER_PASS`, `CONTENT_ORDER_MIN_BLOCKS`, `LAYOUT_PROFILE_BINS`, `LAYOUT_PROFILE_PASS`, `LINK_HEAD_CONCURRENCY`, `LINK_HEAD_PACING_MS`, `LINK_HEAD_TIMEOUT`, `LAYOUT_PROFILE_PATH`, `LINK_STATUS_PATH` (all from `config.js`); `W`, `GROUPS` re-exported from `src/scoring/weights.js`. Every later scoring task imports `W`/`GROUPS` from `./weights.js`, never from config directly.

- [ ] **Step 1: Write the failing test**

`test/weights.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { W, GROUPS } from '../src/scoring/weights.js';

test('weights sum to exactly 1.0', () => {
  const sum = Object.values(W).reduce((a, b) => a + b, 0);
  assert.ok(Math.abs(sum - 1) < 1e-9, `sum is ${sum}`);
});

test('groups and weights list the same check ids exactly once', () => {
  const groupIds = GROUPS.flatMap(g => g.checks);
  assert.equal(new Set(groupIds).size, groupIds.length, 'duplicate id across groups');
  assert.deepEqual([...groupIds].sort(), Object.keys(W).sort());
});

test('group weights are the sum of their check weights', () => {
  for (const g of GROUPS) {
    const sum = g.checks.reduce((a, id) => a + W[id], 0);
    assert.ok(Math.abs(sum - g.weight) < 1e-9, `${g.id}: ${sum} != ${g.weight}`);
  }
});
```

- [ ] **Step 2: Add the npm test script, run test to verify it fails**

In `package.json` scripts add (keep existing entries):

```json
"test": "node --test test/",
"layout-profile": "node src/layout-profile.js",
"check-downloads": "node src/check-downloads.js",
"rescore": "node src/rescore.js"
```

Run: `npm test`
Expected: FAIL — `Cannot find module .../src/scoring/weights.js`

- [ ] **Step 3: Append the v2 config block to `config.js`**

Insert after the existing `CRITERIA_GROUPS` export (do NOT touch `WEIGHTS_MAIN`/`CRITERIA_GROUPS`):

```js
// ─── v2 criteria (defect-aligned) ──────────────────────────────────────────
// 5 groups named after QA's recurring defect categories. Lives beside the
// old WEIGHTS_MAIN until rescore output is reviewed; the promotion step
// replaces WEIGHTS_MAIN/CRITERIA_GROUPS with these values and deletes the
// _V2 names. See docs/superpowers/specs/2026-08-04-defect-aligned-criteria-design.md
export const WEIGHTS_MAIN_V2 = {
  // Missing content (30%)
  contentLength:       0.10,
  missingText:         0.12,
  missingKeywords:     0.08,
  // Missing assets (25%)
  missingImage:        0.10,  // count only (alt split out)
  brokenImage:         0.11,  // tag renders but file never loads
  imageAlt:            0.04,
  // Content alignment (20%)
  contentOrder:        0.10,  // LIS over shared text blocks
  visualLayout:        0.10,  // screenshot column-profile match
  // Download links (15%)
  missingDownloadLink: 0.09,
  deadDownloadLink:    0.06,
  // Structure & template (10%)
  headings:            0.04,
  links:               0.02,
  meta:                0.02,
  template:            0.02,  // header+footer+components merged
};

export const CRITERIA_GROUPS_V2 = [
  { id: 'missing-content', label: 'Missing content',      weight: 0.30, checks: ['contentLength', 'missingText', 'missingKeywords'] },
  { id: 'missing-assets',  label: 'Missing assets',       weight: 0.25, checks: ['missingImage', 'brokenImage', 'imageAlt'] },
  { id: 'alignment',       label: 'Content alignment',    weight: 0.20, checks: ['contentOrder', 'visualLayout'] },
  { id: 'downloads',       label: 'Download links',       weight: 0.15, checks: ['missingDownloadLink', 'deadDownloadLink'] },
  { id: 'structure',       label: 'Structure & template', weight: 0.10, checks: ['headings', 'links', 'meta', 'template'] },
];

// Download-link checks: an href whose URL *path* ends in one of these.
export const DOWNLOAD_EXTENSIONS = ['.pdf', '.doc', '.docx', '.xls', '.xlsx', '.zip'];

// contentOrder: pass threshold on LIS/shared ratio; below MIN_BLOCKS shared
// blocks the check is `insufficient` (LIS over a tiny sample is noise).
export const CONTENT_ORDER_PASS = 0.90;
export const CONTENT_ORDER_MIN_BLOCKS = 5;

// visualLayout: column-ink profiles binned to this many buckets; pass when
// histogram intersection ≥ LAYOUT_PROFILE_PASS. Thresholds get tuned during
// the hand-check calibration step.
export const LAYOUT_PROFILE_BINS = 64;
export const LAYOUT_PROFILE_PASS = 0.85;
export const LAYOUT_PROFILE_PATH = join(DIR.data, 'layout-profiles.json');

// check-downloads.js — HEAD requests against BBL hosts (WAF applies).
export const LINK_HEAD_CONCURRENCY = 4;
export const LINK_HEAD_PACING_MS = 250;
export const LINK_HEAD_TIMEOUT = 10000;
export const LINK_STATUS_PATH = join(DIR.data, 'link-status.json');
```

- [ ] **Step 4: Create `src/scoring/weights.js`**

```js
// Single indirection between the scoring modules and config so the
// v2 → canonical promotion touches only this file. Also enforces the
// weight invariants at module load — with 14 entries the 1.00 sum is
// easy to break by hand.
import { WEIGHTS_MAIN_V2, CRITERIA_GROUPS_V2 } from '../../config.js';

export const W = WEIGHTS_MAIN_V2;
export const GROUPS = CRITERIA_GROUPS_V2;

const sum = Object.values(W).reduce((a, b) => a + b, 0);
if (Math.abs(sum - 1) > 1e-9) throw new Error(`WEIGHTS sum to ${sum}, expected 1.0`);
const groupIds = GROUPS.flatMap(g => g.checks);
const wIds = Object.keys(W);
if (new Set(groupIds).size !== groupIds.length) throw new Error('duplicate check id across CRITERIA_GROUPS');
if (groupIds.length !== wIds.length || !groupIds.every(id => id in W)) {
  throw new Error('CRITERIA_GROUPS checks and WEIGHTS keys do not match');
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test`
Expected: PASS (3 tests)

- [ ] **Step 6: Sanity-check nothing existing broke**

Run: `node -e "import('./config.js').then(c => console.log('old sum', Object.values(c.WEIGHTS_MAIN).reduce((a,b)=>a+b,0), '| v2 sum', Object.values(c.WEIGHTS_MAIN_V2).reduce((a,b)=>a+b,0)))"`
Expected: `old sum 1.0000000000000002 | v2 sum 1` (old float noise is pre-existing; v2 within 1e-9 of 1)

- [ ] **Step 7: Commit**

```bash
git add config.js package.json src/scoring/weights.js test/weights.test.js
git commit -m "feat(criteria): add v2 defect-aligned weights/groups + test harness"
```

---

### Task 2: Shared scoring utilities

**Files:**
- Create: `src/scoring/util.js`
- Test: `test/util.test.js`

**Interfaces:**
- Produces (all pure, all exported):
  - `makeCheck(id, label, passed, detail, partial, diff) → Check` (weight looked up from `W`; may be `undefined` — score-main demotes those to advisory)
  - `isDynamicBlock(s: string) → boolean` (ported verbatim from `compare.js:39-46`)
  - `filenameOf(url: string) → string` (ported verbatim from `compare.js:49-56`)
  - `normCompare(a, b) → boolean` (ported verbatim from `compare.js:756-759`)
  - `isDownloadHref(href: string) → boolean`
  - `downloadBasename(href: string) → string` (lowercased, decoded, `-<hash>` suffix stripped)
  - `lis(indices: number[]) → { length: number, keep: boolean[] }` (strictly increasing)
  - `profileMatch(a: number[]|null|undefined, b) → number|null` (histogram intersection; `null` when either side unavailable/mismatched)

- [ ] **Step 1: Write the failing test**

`test/util.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  makeCheck, isDynamicBlock, isDownloadHref, downloadBasename, lis, profileMatch,
} from '../src/scoring/util.js';

test('makeCheck fills the standard shape and looks up weight', () => {
  const c = makeCheck('headings', 'Headings', false, 'detail', 0.4, { x: 1 });
  assert.equal(c.id, 'headings');
  assert.equal(c.weight, 0.04);
  assert.equal(c.passed, false);
  assert.equal(c.partial, 0.4);
  assert.deepEqual(c.diff, { x: 1 });
  const unknown = makeCheck('notAScoredId', 'X', true, 'd');
  assert.equal(unknown.weight, undefined);
  assert.equal(unknown.partial, 0);
  assert.equal(unknown.diff, null);
});

test('isDynamicBlock flags digit-heavy and Thai-month blocks', () => {
  assert.equal(isDynamicBlock('123,456.78 900'), true);
  assert.equal(isDynamicBlock('อัตราดอกเบี้ยเงินฝากประจำ'), false);
  assert.equal(isDynamicBlock('ณ วันที่ 12 มกราคม 2569'), true);
});

test('isDownloadHref matches by URL path extension only', () => {
  assert.equal(isDownloadHref('https://x.com/a/report.pdf'), true);
  assert.equal(isDownloadHref('https://x.com/a/report.PDF?v=2'), true);
  assert.equal(isDownloadHref('https://x.com/page?file=report.pdf'), false);
  assert.equal(isDownloadHref('https://x.com/a/page.html'), false);
  assert.equal(isDownloadHref('not a url'), false);
});

test('downloadBasename lowercases, decodes and strips trailing hash', () => {
  assert.equal(downloadBasename('https://x.com/dam/Annual-Report.pdf'), 'annual-report.pdf');
  assert.equal(downloadBasename('https://x.com/dam/annual-report-1a2b3c4d5e.pdf'), 'annual-report.pdf');
  assert.equal(downloadBasename('https://x.com/dam/fee%20table.xlsx'), 'fee table.xlsx');
});

test('lis finds the longest strictly-increasing subsequence with membership', () => {
  const r = lis([0, 4, 1, 2, 3]);
  assert.equal(r.length, 4);
  assert.deepEqual(r.keep, [true, false, true, true, true]);
  assert.deepEqual(lis([]), { length: 0, keep: [] });
  assert.equal(lis([5, 5, 5]).length, 1);
});

test('profileMatch is 1 for identical, null when unavailable, 0 for zero-mass', () => {
  assert.equal(profileMatch([0.5, 0.5], [0.5, 0.5]), 1);
  assert.equal(profileMatch(null, [1]), null);
  assert.equal(profileMatch([1, 0], [1, 0, 0]), null);
  assert.equal(profileMatch([0, 0], [1, 0]), 0);
  const m = profileMatch([1, 0], [0, 1]);
  assert.equal(m, 0);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — `Cannot find module .../src/scoring/util.js`

- [ ] **Step 3: Create `src/scoring/util.js`**

`isDynamicBlock`, `filenameOf`, `normCompare` are byte-for-byte ports from `src/compare.js` (which keeps its own copies until promotion — the duplication is temporary and removed there):

```js
// Shared pure helpers for the scoring modules. isDynamicBlock/filenameOf/
// normCompare are ported from compare.js (whose copies are removed at
// promotion) so the check modules can be tested without loading puppeteer.
import { DOWNLOAD_EXTENSIONS } from '../../config.js';
import { W } from './weights.js';

const THAI_MONTHS =
  /(ม\.?ค\.?|ก\.?พ\.?|มี\.?ค\.?|เม\.?ย\.?|พ\.?ค\.?|มิ\.?ย\.?|ก\.?ค\.?|ส\.?ค\.?|ก\.?ย\.?|ต\.?ค\.?|พ\.?ย\.?|ธ\.?ค\.?|มกราคม|กุมภาพันธ์|มีนาคม|เมษายน|พฤษภาคม|มิถุนายน|กรกฎาคม|สิงหาคม|กันยายน|ตุลาคม|พฤศจิกายน|ธันวาคม)\s*\d{2,4}/;

// Filter out text blocks that are mostly digits or Thai month+year — these are
// dynamic content (dates, rates, counters) that change between captures and
// would generate false "missing text" issues.
export function isDynamicBlock(s) {
  const t = String(s ?? '').replace(/\s+/g, ' ').trim();
  const digits = (t.match(/\d/g) || []).length;
  const nonSpace = t.replace(/\s/g, '').length || 1;
  if (digits / nonSpace > 0.4) return true;
  return THAI_MONTHS.test(t);
}

// Lowercased basename of a URL — used to match assets across sites where the
// full src differs but the filename is the same.
export function filenameOf(url) {
  try {
    const name = new URL(url).pathname.split('/').pop() || '';
    return decodeURIComponent(name).toLowerCase();
  } catch {
    return String(url || '').toLowerCase();
  }
}

export function normCompare(a, b) {
  const n = (s) => (s || '').toLowerCase().replace(/[^a-z0-9\u0E00-\u0E7F]/gi, '').slice(0, 200);
  return n(a) === n(b);
}

// Standard check object. `weight` may come back undefined for ids not in W —
// score-main demotes those to advisory instead of scoring them.
export function makeCheck(id, label, passed, detail, partial, diff) {
  return { id, weight: W[id], label, passed: !!passed, detail, partial: partial ?? 0, diff: diff || null };
}

// A download link is an href whose URL *path* (query/fragment excluded)
// ends in one of DOWNLOAD_EXTENSIONS.
export function isDownloadHref(href) {
  let path;
  try { path = new URL(href).pathname.toLowerCase(); } catch { return false; }
  return DOWNLOAD_EXTENSIONS.some(ext => path.endsWith(ext));
}

// Normalised basename for cross-site download matching. AEM re-hosts assets
// under /content/dam/ with different paths and sometimes a -<hash> suffix,
// so full-URL comparison would report every file as missing.
export function downloadBasename(href) {
  return filenameOf(href).replace(/-[0-9a-f]{6,}(\.[a-z0-9]+)$/i, '$1');
}

// Longest strictly-increasing subsequence with membership flags. O(n²) DP —
// textBlocks are capped at 200 in extract.js, so n is small.
export function lis(indices) {
  const n = indices.length;
  if (!n) return { length: 0, keep: [] };
  const len = new Array(n).fill(1);
  const prev = new Array(n).fill(-1);
  let best = 0;
  for (let i = 1; i < n; i++) {
    for (let j = 0; j < i; j++) {
      if (indices[j] < indices[i] && len[j] + 1 > len[i]) { len[i] = len[j] + 1; prev[i] = j; }
    }
    if (len[i] > len[best]) best = i;
  }
  const keep = new Array(n).fill(false);
  for (let i = best; i !== -1; i = prev[i]) keep[i] = true;
  return { length: len[best], keep };
}

// Histogram intersection of two column profiles (re-normalised defensively).
// Returns null when either profile is missing or the shapes differ — the
// caller marks the check `insufficient` in that case, never failed.
export function profileMatch(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length || a.length === 0) return null;
  const sum = (v) => v.reduce((s, x) => s + x, 0);
  const sa = sum(a), sb = sum(b);
  if (sa <= 0 || sb <= 0) return 0;
  let m = 0;
  for (let i = 0; i < a.length; i++) m += Math.min(a[i] / sa, b[i] / sb);
  return m;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: PASS (all suites)

- [ ] **Step 5: Commit**

```bash
git add src/scoring/util.js test/util.test.js
git commit -m "feat(scoring): shared pure helpers (lis, profileMatch, download matching)"
```

---

### Task 3: Test fixtures + content checks module

**Files:**
- Create: `test/fixtures.js`
- Create: `src/scoring/checks-content.js`
- Test: `test/checks-content.test.js`

**Interfaces:**
- Consumes: `makeCheck`, `isDynamicBlock` from `./util.js`; `TEXT_MATCH_TOLERANCE` from config.
- Produces: `contentChecks(prod, aem) → Check[]` — ids `contentLength`, `missingText`, `missingKeywords`. `prod`/`aem` are the metric objects stored at `page.prod.metrics` in results.json. `test/fixtures.js` exports `metrics(overrides) → object` used by every later test.

- [ ] **Step 1: Create `test/fixtures.js`**

```js
// Minimal-but-valid metric objects matching what extract.js produces
// (the shape stored at page.prod.metrics / page.aem.metrics in results.json).
export function metrics(over = {}) {
  return {
    headingCount: 0, headings: [],
    linkCount: 0, links: [],
    imageCount: 0, images: [],
    meta: {},
    accordionCount: 0, emptyAccordions: 0, accordions: [],
    headerLinkCount: 0, footerLinkCount: 0,
    componentCounts: { accordion: 0, table: 0, tableRows: 0, form: 0, formInputs: 0, video: 0, carousel: 0, tabs: 0 },
    headerMenus: [], footerMenus: [], otherComponents: [],
    social: {}, features: {}, leakedContentPaths: [],
    textLength: 1000, bodyTextSample: 'sample', thaiRatio: 0.5,
    textBlocks: [], topWords: [],
    ...over,
  };
}
```

- [ ] **Step 2: Write the failing test**

`test/checks-content.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { contentChecks } from '../src/scoring/checks-content.js';
import { metrics } from './fixtures.js';

const byId = (arr, id) => arr.find(c => c.id === id);

test('identical content passes all three checks', () => {
  const blocks = ['หัวข้อหลักของหน้า', 'รายละเอียดผลิตภัณฑ์เงินฝาก', 'เงื่อนไขการให้บริการ'];
  const words = [{ w: 'เงินฝาก', c: 5 }, { w: 'บัญชี', c: 3 }];
  const m = metrics({ textLength: 1000, textBlocks: blocks, topWords: words });
  const checks = contentChecks(m, metrics({ textLength: 1000, textBlocks: blocks, topWords: words }));
  assert.equal(checks.length, 3);
  for (const c of checks) assert.equal(c.passed, true, c.id);
});

test('contentLength partial degrades on BOTH too-short and too-long', () => {
  const prod = metrics({ textLength: 1000 });
  const short = byId(contentChecks(prod, metrics({ textLength: 500 })), 'contentLength');
  assert.equal(short.passed, false);
  assert.ok(Math.abs(short.partial - 0.5) < 1e-9);
  const long = byId(contentChecks(prod, metrics({ textLength: 1600 })), 'contentLength');
  assert.equal(long.passed, false);
  assert.ok(long.partial <= 1, 'partial must never exceed 1');   // old code awarded 1.6 here
  assert.ok(Math.abs(long.partial - 0.4) < 1e-9);                // 1 - |1 - 1.6|
});

test('missingText reports prod blocks absent from AEM, dynamic blocks filtered', () => {
  const prod = metrics({ textBlocks: ['บริการบัญชีเงินเดือน', 'สิทธิประโยชน์พิเศษ', '12 มกราคม 2569'] });
  const aem = metrics({ textBlocks: ['บริการบัญชีเงินเดือน'] });
  const c = byId(contentChecks(prod, aem), 'missingText');
  assert.equal(c.passed, false);
  assert.deepEqual(c.diff.missingTextBlocks, ['สิทธิประโยชน์พิเศษ']);  // date block filtered as dynamic
  assert.ok(Math.abs(c.partial - 0.5) < 1e-9);
});

test('missingKeywords scores hit rate over prod top-30', () => {
  const prod = metrics({ topWords: [{ w: 'สินเชื่อ', c: 9 }, { w: 'ดอกเบี้ย', c: 5 }] });
  const aem = metrics({ topWords: [{ w: 'สินเชื่อ', c: 7 }] });
  const c = byId(contentChecks(prod, aem), 'missingKeywords');
  assert.equal(c.passed, false);
  assert.deepEqual(c.diff.missingKeywords, ['ดอกเบี้ย']);
  assert.ok(Math.abs(c.partial - 0.5) < 1e-9);
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — `Cannot find module .../checks-content.js`

- [ ] **Step 4: Create `src/scoring/checks-content.js`**

Port of `compare.js:548-576`, with one deliberate fix: the old contentLength partial was `Math.max(0, ratio)`, which awarded >1.0 partial to a failed check when AEM was longer than prod; the new form `max(0, 1 - |1 - ratio|)` degrades symmetrically:

```js
// Missing-content group: contentLength, missingText, missingKeywords.
import { TEXT_MATCH_TOLERANCE } from '../../config.js';
import { makeCheck, isDynamicBlock } from './util.js';

export function contentChecks(prod, aem) {
  const checks = [];

  // contentLength: text within ±TEXT_MATCH_TOLERANCE. Partial degrades on
  // both sides of 1.0 (the pre-v2 code let ratio>1 exceed full credit).
  const ratio = prod.textLength > 0 ? aem.textLength / prod.textLength : 0;
  const lenPass = Math.abs(1 - ratio) <= TEXT_MATCH_TOLERANCE;
  checks.push(makeCheck('contentLength',
    `Content length (±${Math.round(TEXT_MATCH_TOLERANCE * 100)}%)`, lenPass,
    `${aem.textLength}/${prod.textLength} chars (${Math.round(ratio * 100)}%)`,
    lenPass ? 1 : Math.max(0, 1 - Math.abs(1 - ratio)),
    { ratio: Math.round(ratio * 100), prodSample: (prod.bodyTextSample || '').slice(0, 600), aemSample: (aem.bodyTextSample || '').slice(0, 600) }));

  // missingText: prod text blocks not present in AEM.
  const aemBlockSet = new Set((aem.textBlocks || []).map(t => String(t).toLowerCase()));
  const prodBlocks = (prod.textBlocks || []).map(t => String(t).trim()).filter(t => t.length >= 8 && !isDynamicBlock(t));
  const prodBlocksSet = new Set(prodBlocks);
  const missingTextBlocks = [...new Set(prodBlocks.filter(t => !aemBlockSet.has(t.toLowerCase())))].slice(0, 15);
  const textHit = prodBlocksSet.size > 0 ? 1 - (missingTextBlocks.length / prodBlocksSet.size) : 1;
  checks.push(makeCheck('missingText', 'Missing text blocks', missingTextBlocks.length === 0,
    `${missingTextBlocks.length} prod block(s) missing`, textHit,
    { missingTextBlocks, prodBlockCount: prodBlocksSet.size }));

  // missingKeywords: prod top keywords absent from AEM.
  const prodWordMap = new Map((prod.topWords || []).map(w => [w.w, w.c]));
  const aemWordMap = new Map((aem.topWords || []).map(w => [w.w, w.c]));
  const prodKey = [...prodWordMap.keys()].slice(0, 30);
  const missingKeywords = prodKey.filter(w => !aemWordMap.has(w)).slice(0, 20);
  const kwHit = prodKey.length > 0 ? 1 - (missingKeywords.length / prodKey.length) : 1;
  checks.push(makeCheck('missingKeywords', 'Missing keywords', missingKeywords.length === 0,
    `${missingKeywords.length}/${prodKey.length} prod keywords missing`, kwHit,
    { missingKeywords, sharedCount: prodKey.length - missingKeywords.length }));

  return checks;
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add test/fixtures.js src/scoring/checks-content.js test/checks-content.test.js
git commit -m "feat(scoring): content checks module (ported, contentLength partial fixed)"
```

---

### Task 4: Assets checks module (missingImage / brokenImage / imageAlt)

**Files:**
- Create: `src/scoring/checks-assets.js`
- Test: `test/checks-assets.test.js`

**Interfaces:**
- Consumes: `makeCheck` from `./util.js`; fixture `metrics()`.
- Produces: `assetChecks(prod, aem) → Check[]` — ids `missingImage`, `brokenImage`, `imageAlt`. Image objects have `{ alt, src, naturalWidth, naturalHeight, renderedWidth, renderedHeight }` (extract.js shape).

- [ ] **Step 1: Write the failing test**

`test/checks-assets.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assetChecks } from '../src/scoring/checks-assets.js';
import { metrics } from './fixtures.js';

const img = (over = {}) => ({ alt: '', src: 'https://x.com/a.jpg', naturalWidth: 100, naturalHeight: 50, renderedWidth: 100, renderedHeight: 50, ...over });
const byId = (arr, id) => arr.find(c => c.id === id);

test('missingImage: count-only, 80% floor', () => {
  const prod = metrics({ images: [img(), img(), img(), img(), img()] });   // 5 → ceil(4) needed
  const pass = byId(assetChecks(prod, metrics({ images: [img(), img(), img(), img()] })), 'missingImage');
  assert.equal(pass.passed, true);
  const fail = byId(assetChecks(prod, metrics({ images: [img(), img()] })), 'missingImage');
  assert.equal(fail.passed, false);
  assert.ok(Math.abs(fail.partial - 0.5) < 1e-9);   // 2/4
});

test('missingImage: prod zero images — AEM adding some fails with 0 partial', () => {
  const c = byId(assetChecks(metrics(), metrics({ images: [img()] })), 'missingImage');
  assert.equal(c.passed, false);
  assert.equal(c.partial, 0);
});

test('brokenImage flags rendered-but-unloaded, excluding svg and data URIs', () => {
  const aem = metrics({ images: [
    img(),                                                                      // fine
    img({ src: 'https://x.com/broken.jpg', naturalWidth: 0, naturalHeight: 0 }), // broken
    img({ src: 'https://x.com/icon.svg', naturalWidth: 0, naturalHeight: 0 }),   // excluded
    img({ src: 'data:image/png;base64,xx', naturalWidth: 0, naturalHeight: 0 }), // excluded
  ] });
  const c = byId(assetChecks(metrics({ images: [img()] }), aem), 'brokenImage');
  assert.equal(c.passed, false);
  assert.equal(c.diff.broken.length, 1);
  assert.equal(c.diff.broken[0].src, 'https://x.com/broken.jpg');
  assert.ok(Math.abs(c.partial - 0.5) < 1e-9);   // 1 broken of 2 candidates
});

test('brokenImage is insufficient (not failed) when AEM has no images', () => {
  const c = byId(assetChecks(metrics({ images: [img()] }), metrics()), 'brokenImage');
  assert.equal(c.insufficient, true);
});

test('imageAlt: hit rate over prod alts; insufficient when prod has none', () => {
  const prod = metrics({ images: [img({ alt: 'บัตรเดบิต' }), img({ alt: 'สาขา' })] });
  const aem = metrics({ images: [img({ alt: 'บัตรเดบิต' })] });
  const c = byId(assetChecks(prod, aem), 'imageAlt');
  assert.equal(c.passed, false);
  assert.ok(Math.abs(c.partial - 0.5) < 1e-9);
  const ins = byId(assetChecks(metrics({ images: [img()] }), aem), 'imageAlt');
  assert.equal(ins.insufficient, true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — module not found

- [ ] **Step 3: Create `src/scoring/checks-assets.js`**

```js
// Missing-assets group. The pre-v2 `missingImage` averaged count and alt
// parity into one score, letting a good alt rate mask missing images —
// they are split into independent checks here. `brokenImage` is new: a tag
// that renders (>0 rendered width) whose file never loaded (0×0 natural).
import { makeCheck } from './util.js';

// svg and data: URIs legitimately report zero natural dimensions.
const brokenExcluded = (src = '') => /^data:/i.test(src) || /\.svg([?#]|$)/i.test(src);

export function assetChecks(prod, aem) {
  const checks = [];
  const prodImgs = prod.images || [];
  const aemImgs = aem.images || [];

  // missingImage: count ≥80% of prod. When prod has none, AEM adding images
  // is a template mismatch — partial must be 0, not 1 (pre-v2 invariant kept).
  const target = Math.ceil(prodImgs.length * 0.8);
  const countPass = prodImgs.length === 0 ? aemImgs.length === 0 : aemImgs.length >= target;
  const countPartial = prodImgs.length === 0 ? (aemImgs.length === 0 ? 1 : 0) : Math.min(1, aemImgs.length / target);
  checks.push(makeCheck('missingImage', 'Missing image (count ≥80%)', countPass,
    `${aemImgs.length}/${prodImgs.length} images`, countPartial,
    { prodCount: prodImgs.length, aemCount: aemImgs.length }));

  // brokenImage: AEM-side only — an image AEM added and failed to load is a
  // defect regardless of what prod had. Insufficient when AEM has no images.
  const candidates = aemImgs.filter(i => !brokenExcluded(i.src));
  const broken = candidates.filter(i => i.renderedWidth > 0 && i.naturalWidth === 0 && i.naturalHeight === 0);
  const bCheck = makeCheck('brokenImage', 'Broken image (fails to load on AEM)', broken.length === 0,
    `${broken.length}/${candidates.length} AEM image(s) fail to load`,
    candidates.length > 0 ? 1 - broken.length / candidates.length : 1,
    { broken: broken.slice(0, 20).map(i => ({ src: i.src, alt: i.alt })), candidateCount: candidates.length });
  if (aemImgs.length === 0) { bCheck.insufficient = true; bCheck.passed = false; bCheck.partial = 0; bCheck.detail = 'AEM has no images — nothing to check'; }
  checks.push(bCheck);

  // imageAlt: fraction of prod alt texts present on AEM.
  const prodAlts = new Set(prodImgs.map(i => (i.alt || '').toLowerCase()).filter(Boolean));
  const aemAlts = new Set(aemImgs.map(i => (i.alt || '').toLowerCase()).filter(Boolean));
  const altHit = prodAlts.size > 0 ? [...prodAlts].filter(a => aemAlts.has(a)).length / prodAlts.size : 0;
  const aCheck = makeCheck('imageAlt', 'Image alt text (>50% match)', altHit > 0.5,
    `alt match ${Math.round(altHit * 100)}%`, altHit,
    { altMatchPct: Math.round(altHit * 100), missingAlts: [...prodAlts].filter(a => !aemAlts.has(a)).slice(0, 20), prodAltCount: prodAlts.size });
  if (prodAlts.size === 0) { aCheck.insufficient = true; aCheck.passed = false; aCheck.partial = 0; aCheck.detail = 'prod has no image alt texts'; }
  checks.push(aCheck);

  return checks;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/scoring/checks-assets.js test/checks-assets.test.js
git commit -m "feat(scoring): assets checks — split missingImage/imageAlt, add brokenImage"
```

---

### Task 5: Alignment checks module (contentOrder / visualLayout)

**Files:**
- Create: `src/scoring/checks-alignment.js`
- Test: `test/checks-alignment.test.js`

**Interfaces:**
- Consumes: `makeCheck`, `isDynamicBlock`, `lis`, `profileMatch` from `./util.js`; `CONTENT_ORDER_PASS`, `CONTENT_ORDER_MIN_BLOCKS`, `LAYOUT_PROFILE_PASS` from config.
- Produces: `alignmentChecks(prod, aem, context) → Check[]` — ids `contentOrder`, `visualLayout`. `context.layout` is `{ prod: number[]|null, aem: number[]|null } | undefined` — normalised bin arrays from `data/layout-profiles.json` (Task 8 produces them; `rescore.js` wires them in Task 10).

- [ ] **Step 1: Write the failing test**

`test/checks-alignment.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { alignmentChecks } from '../src/scoring/checks-alignment.js';
import { metrics } from './fixtures.js';

const byId = (arr, id) => arr.find(c => c.id === id);
const blocks = ['หัวข้อที่หนึ่ง', 'หัวข้อที่สอง', 'หัวข้อที่สาม', 'หัวข้อที่สี่', 'หัวข้อที่ห้า', 'หัวข้อที่หก'];

test('contentOrder passes when shared blocks keep prod order', () => {
  const c = byId(alignmentChecks(metrics({ textBlocks: blocks }), metrics({ textBlocks: blocks }), {}), 'contentOrder');
  assert.equal(c.passed, true);
  assert.equal(c.partial, 1);
});

test('contentOrder fails when sections are reordered, and names the moved blocks', () => {
  const shuffled = [blocks[5], blocks[0], blocks[1], blocks[2], blocks[3], blocks[4]];
  const c = byId(alignmentChecks(metrics({ textBlocks: blocks }), metrics({ textBlocks: shuffled }), {}), 'contentOrder');
  assert.equal(c.passed, false);
  assert.ok(Math.abs(c.partial - 5 / 6) < 1e-9);
  assert.deepEqual(c.diff.outOfOrder, ['หัวข้อที่หก']);
});

test('contentOrder is insufficient below CONTENT_ORDER_MIN_BLOCKS shared blocks', () => {
  const c = byId(alignmentChecks(metrics({ textBlocks: blocks.slice(0, 3) }), metrics({ textBlocks: blocks.slice(0, 3) }), {}), 'contentOrder');
  assert.equal(c.insufficient, true);
});

test('visualLayout scores from context profiles, insufficient without them', () => {
  const ins = byId(alignmentChecks(metrics(), metrics(), {}), 'visualLayout');
  assert.equal(ins.insufficient, true);
  const same = { layout: { prod: [0.25, 0.5, 0.25], aem: [0.25, 0.5, 0.25] } };
  const ok = byId(alignmentChecks(metrics(), metrics(), same), 'visualLayout');
  assert.equal(ok.passed, true);
  const shifted = { layout: { prod: [1, 0, 0], aem: [0, 0, 1] } };
  const bad = byId(alignmentChecks(metrics(), metrics(), shifted), 'visualLayout');
  assert.equal(bad.passed, false);
  assert.equal(bad.partial, 0);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — module not found

- [ ] **Step 3: Create `src/scoring/checks-alignment.js`**

```js
// Content-alignment group. contentOrder isolates *sequence* from *presence*
// (missingText already scores absent blocks): shared blocks are mapped to
// their FIRST index in AEM's sequence — repeated boilerplate must not create
// ambiguous mappings — and scored by longest-increasing-subsequence coverage.
// visualLayout compares cached screenshot column profiles (height-invariant;
// a merely-longer page must not be flagged).
import { CONTENT_ORDER_PASS, CONTENT_ORDER_MIN_BLOCKS, LAYOUT_PROFILE_PASS } from '../../config.js';
import { makeCheck, isDynamicBlock, lis, profileMatch } from './util.js';

export function alignmentChecks(prod, aem, context = {}) {
  const checks = [];

  // ── contentOrder ──
  const prodSeq = (prod.textBlocks || []).map(t => String(t).trim()).filter(t => t.length >= 8 && !isDynamicBlock(t));
  const aemFirst = new Map();
  (aem.textBlocks || []).forEach((t, i) => {
    const k = String(t).trim().toLowerCase();
    if (!aemFirst.has(k)) aemFirst.set(k, i);
  });
  const seen = new Set();
  const shared = [];   // prod block text, in prod order, deduped
  const indices = [];  // matching first-index in AEM
  for (const b of prodSeq) {
    const k = b.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    if (aemFirst.has(k)) { shared.push(b); indices.push(aemFirst.get(k)); }
  }
  const { length: inOrder, keep } = lis(indices);
  const orderScore = indices.length > 0 ? inOrder / indices.length : 0;
  const oCheck = makeCheck('contentOrder', 'Content order (sequence)', orderScore >= CONTENT_ORDER_PASS,
    `${inOrder}/${indices.length} shared block(s) in prod order (${Math.round(orderScore * 100)}%)`,
    orderScore,
    { sharedCount: indices.length, inOrder, outOfOrder: shared.filter((_, i) => !keep[i]).slice(0, 15) });
  if (indices.length < CONTENT_ORDER_MIN_BLOCKS) {
    oCheck.insufficient = true; oCheck.passed = false; oCheck.partial = 0;
    oCheck.detail = `only ${indices.length} shared block(s) — too few to judge order`;
  }
  checks.push(oCheck);

  // ── visualLayout ──
  const match = profileMatch(context.layout?.prod, context.layout?.aem);
  const vCheck = makeCheck('visualLayout', 'Visual layout (column profile)', (match ?? 0) >= LAYOUT_PROFILE_PASS,
    match == null ? 'no layout profile cached — run: npm run layout-profile' : `profile match ${Math.round(match * 100)}%`,
    match ?? 0,
    match == null ? null : { match: Math.round(match * 100), prodBins: context.layout.prod, aemBins: context.layout.aem });
  if (match == null) { vCheck.insufficient = true; vCheck.passed = false; }
  checks.push(vCheck);

  return checks;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/scoring/checks-alignment.js test/checks-alignment.test.js
git commit -m "feat(scoring): alignment checks — LIS content order + screenshot column profile"
```

---

### Task 6: Download-link checks module

**Files:**
- Create: `src/scoring/checks-downloads.js`
- Test: `test/checks-downloads.test.js`

**Interfaces:**
- Consumes: `makeCheck`, `isDownloadHref`, `downloadBasename` from `./util.js`.
- Produces: `downloadChecks(prod, aem, context) → Check[]` — ids `missingDownloadLink`, `deadDownloadLink`. `context.linkStatus` is `Record<url, { status: number, checkedAt: string }> | null` (the parsed `data/link-status.json`; Task 9 produces it). Link objects have `{ text, href }` (extract.js shape).

- [ ] **Step 1: Write the failing test**

`test/checks-downloads.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { downloadChecks } from '../src/scoring/checks-downloads.js';
import { metrics } from './fixtures.js';

const byId = (arr, id) => arr.find(c => c.id === id);
const link = (href, text = 'ดาวน์โหลด') => ({ text, href });

test('missingDownloadLink matches by normalised basename, not URL', () => {
  const prod = metrics({ links: [link('https://bbl.co.th/files/Annual-Report.pdf'), link('https://bbl.co.th/files/fees.xlsx')] });
  const aem = metrics({ links: [link('https://aem.bbl.co.th/content/dam/x/annual-report-9f8e7d6c5b.pdf')] });
  const c = byId(downloadChecks(prod, aem, {}), 'missingDownloadLink');
  assert.equal(c.passed, false);
  assert.deepEqual(c.diff.missing, ['fees.xlsx']);
  assert.ok(Math.abs(c.partial - 0.5) < 1e-9);
});

test('missingDownloadLink is insufficient when prod has no download links', () => {
  const c = byId(downloadChecks(metrics({ links: [link('https://x.com/page.html')] }), metrics(), {}), 'missingDownloadLink');
  assert.equal(c.insufficient, true);
});

test('deadDownloadLink reads cached statuses; 0 and >=400 are dead', () => {
  const aem = metrics({ links: [link('https://a.com/ok.pdf'), link('https://a.com/gone.pdf'), link('https://a.com/timeout.pdf')] });
  const linkStatus = {
    'https://a.com/ok.pdf': { status: 200, checkedAt: 'x' },
    'https://a.com/gone.pdf': { status: 404, checkedAt: 'x' },
    'https://a.com/timeout.pdf': { status: 0, checkedAt: 'x' },
  };
  const c = byId(downloadChecks(metrics(), aem, { linkStatus }), 'deadDownloadLink');
  assert.equal(c.passed, false);
  assert.equal(c.diff.dead.length, 2);
  assert.ok(Math.abs(c.partial - 1 / 3) < 1e-9);
});

test('deadDownloadLink is insufficient without cache or without AEM downloads', () => {
  const aem = metrics({ links: [link('https://a.com/a.pdf')] });
  assert.equal(byId(downloadChecks(metrics(), aem, {}), 'deadDownloadLink').insufficient, true);
  assert.equal(byId(downloadChecks(metrics(), metrics(), { linkStatus: {} }), 'deadDownloadLink').insufficient, true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — module not found

- [ ] **Step 3: Create `src/scoring/checks-downloads.js`**

```js
// Download-links group. Presence is matched by normalised basename because
// AEM re-hosts assets under /content/dam/ with different paths (full-URL
// comparison would report every file missing). Liveness comes from the
// data/link-status.json cache built by src/check-downloads.js — this module
// itself never touches the network.
import { makeCheck, isDownloadHref, downloadBasename } from './util.js';

export function downloadChecks(prod, aem, context = {}) {
  const checks = [];
  const downloads = (m) => (m.links || []).filter(l => isDownloadHref(l.href));
  const prodDl = downloads(prod);
  const aemDl = downloads(aem);

  // missingDownloadLink
  const prodNames = new Set(prodDl.map(l => downloadBasename(l.href)));
  const aemNames = new Set(aemDl.map(l => downloadBasename(l.href)));
  const missing = [...prodNames].filter(n => !aemNames.has(n));
  const mCheck = makeCheck('missingDownloadLink', 'Download links present',
    missing.length === 0,
    `${prodNames.size - missing.length}/${prodNames.size} prod download file(s) found on AEM`,
    prodNames.size > 0 ? 1 - missing.length / prodNames.size : 0,
    { missing: missing.slice(0, 20), prodCount: prodNames.size, aemCount: aemNames.size,
      prodLinks: prodDl.slice(0, 20).map(l => ({ text: l.text, href: l.href })) });
  if (prodNames.size === 0) { mCheck.insufficient = true; mCheck.passed = false; mCheck.partial = 0; mCheck.detail = 'prod has no download links'; }
  checks.push(mCheck);

  // deadDownloadLink — AEM side only.
  const status = context.linkStatus || null;
  const aemUrls = [...new Set(aemDl.map(l => l.href))];
  const checked = status ? aemUrls.filter(u => status[u] !== undefined) : [];
  const dead = checked.filter(u => status[u].status >= 400 || status[u].status === 0);
  const dCheck = makeCheck('deadDownloadLink', 'Download links alive',
    dead.length === 0,
    `${dead.length}/${checked.length} AEM download link(s) dead`,
    checked.length > 0 ? 1 - dead.length / checked.length : 0,
    { dead: dead.slice(0, 20).map(u => ({ url: u, status: status?.[u]?.status })), checkedCount: checked.length, totalCount: aemUrls.length });
  if (aemUrls.length === 0) { dCheck.insufficient = true; dCheck.passed = false; dCheck.partial = 0; dCheck.detail = 'AEM has no download links'; }
  else if (checked.length === 0) { dCheck.insufficient = true; dCheck.passed = false; dCheck.partial = 0; dCheck.detail = 'no cached link status — run: npm run check-downloads'; }
  checks.push(dCheck);

  return checks;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/scoring/checks-downloads.js test/checks-downloads.test.js
git commit -m "feat(scoring): download-link checks — basename presence + cached liveness"
```

---

### Task 7: Structure checks module (headings / links / meta / template)

**Files:**
- Create: `src/scoring/checks-structure.js`
- Test: `test/checks-structure.test.js`

**Interfaces:**
- Consumes: `makeCheck`, `normCompare` from `./util.js`.
- Produces: `structureChecks(prod, aem) → Check[]` — ids `headings`, `links`, `meta`, `template`. `template` merges the pre-v2 `headerMenu`/`footerMenu`/`components` logic; its `diff` is `{ header, footer, components }` with the original per-part diff shapes preserved for the dashboard drill-down.

- [ ] **Step 1: Write the failing test**

`test/checks-structure.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { structureChecks } from '../src/scoring/checks-structure.js';
import { metrics } from './fixtures.js';

const byId = (arr, id) => arr.find(c => c.id === id);

test('headings: Jaccard over normalised text sets', () => {
  const prod = metrics({ headings: [{ level: 2, text: 'บัญชีเงินฝาก', tag: 'H2' }, { level: 2, text: 'สินเชื่อ', tag: 'H2' }], headingCount: 2 });
  const aem = metrics({ headings: [{ level: 2, text: 'บัญชีเงินฝาก', tag: 'H2' }], headingCount: 1 });
  const c = byId(structureChecks(prod, aem), 'headings');
  assert.equal(c.passed, false);            // Jaccard 0.5 ≤ 0.6
  assert.ok(Math.abs(c.partial - 0.5) < 1e-9);
});

test('meta gives partial credit per matched key', () => {
  const prod = metrics({ meta: { title: 'A', description: 'B', canonical: '', ogTitle: '', ogImage: '', keywords: '' } });
  const aem = metrics({ meta: { title: 'A', description: 'X', canonical: '', ogTitle: '', ogImage: '', keywords: '' } });
  const c = byId(structureChecks(prod, aem), 'meta');
  assert.equal(c.passed, false);
  assert.ok(Math.abs(c.partial - 5 / 6) < 1e-9);   // 5 of 6 keys match ('' === '')
  assert.deepEqual(c.diff.missing, ['description']);
});

test('template merges header/footer/components; insufficient on old captures', () => {
  const menus = [{ label: 'หน้าแรก' }, { label: 'ผลิตภัณฑ์' }];
  const prod = metrics({ headerMenus: menus, footerMenus: menus });
  const aem = metrics({ headerMenus: menus, footerMenus: [{ label: 'หน้าแรก' }] });
  const c = byId(structureChecks(prod, aem), 'template');
  assert.equal(c.passed, false);           // footer label missing
  assert.ok(c.partial > 0 && c.partial < 1);
  assert.equal(c.diff.footer.missing.length, 1);
  // old capture (no headerMenus/componentCounts) → insufficient
  const old = { ...metrics() };
  delete old.headerMenus; delete old.footerMenus; delete old.componentCounts;
  assert.equal(byId(structureChecks(old, aem), 'template').insufficient, true);
});

test('template fails when accordions match count but are empty shells', () => {
  const prod = metrics({ componentCounts: { ...metrics().componentCounts, accordion: 2 }, accordionCount: 2 });
  const aem = metrics({ componentCounts: { ...metrics().componentCounts, accordion: 2 }, accordionCount: 2, emptyAccordions: 2 });
  const c = byId(structureChecks(prod, aem), 'template');
  assert.equal(c.passed, false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — module not found

- [ ] **Step 3: Create `src/scoring/checks-structure.js`**

Ports of `compare.js:484-545` (menus/components → merged `template`) and `compare.js:598-637` (headings/links/meta), logic unchanged:

```js
// Structure & template group. headings/links/meta are straight ports of the
// pre-v2 checks. `template` merges the pre-v2 headerMenu/footerMenu/components
// checks into one 2% check — their logic is unchanged and their per-part diffs
// survive under diff.{header,footer,components} for the drill-down view.
import { makeCheck, normCompare } from './util.js';

// True when a metrics object has the newer extract fields; older captures
// (300 of the 358 scored pages) mark `template` insufficient instead of failing.
const hasNewMetrics = (m) => !!(m && m.componentCounts && m.headerMenus && m.footerMenus);

// count equal + 100% label match; partial = matched / union so EXTRA labels
// on AEM reduce the score too (partial must never be 1.0 while failing).
function scoreMenu(prodMenus, aemMenus) {
  const pSet = new Set((prodMenus || []).map(m => (m.label || '').toLowerCase()).filter(Boolean));
  const aSet = new Set((aemMenus || []).map(m => (m.label || '').toLowerCase()).filter(Boolean));
  const missing = [...pSet].filter(l => !aSet.has(l));
  const extra = [...aSet].filter(l => !pSet.has(l));
  const matched = pSet.size - missing.length;
  const union = pSet.size + extra.length;
  const hit = union > 0 ? matched / union : 1;
  const pass = pSet.size === aSet.size && missing.length === 0;
  return {
    pass, hit,
    detail: `${aSet.size}/${pSet.size} labels${missing.length ? ` · ${missing.length} missing` : ''}${extra.length ? ` · ${extra.length} extra` : ''}`,
    diff: { prodCount: pSet.size, aemCount: aSet.size, missing: missing.slice(0, 20), extra: extra.slice(0, 20) },
  };
}

// each prod-present component type must be ≥80% in AEM; prod-absent types
// must stay absent (ratio 0 otherwise); accordions must also be FILLED.
function scoreComponents(prod, aem) {
  const pC = prod.componentCounts || {};
  const aC = aem.componentCounts || {};
  const types = ['accordion', 'table', 'form', 'video'];
  const emptyAcc = aem.emptyAccordions || 0;
  const perType = types.map(t => {
    const p = pC[t] || 0, a = aC[t] || 0;
    let ratio = p > 0 ? Math.min(1, a / (p * 0.8)) : (a === 0 ? 1 : 0);
    let ok = p === 0 ? a === 0 : a >= Math.ceil(p * 0.8);
    if (t === 'accordion' && a > 0 && emptyAcc > 0) {
      ok = false;
      ratio *= (a - emptyAcc) / a;
    }
    return { type: t, prod: p, aem: a, ratio, ok };
  });
  return {
    pass: perType.every(t => t.ok),
    hit: perType.reduce((s, t) => s + t.ratio, 0) / perType.length,
    detail: perType.map(t => `${t.type} ${t.aem}/${t.prod}${t.ok ? '' : '✗'}`).join(' · '),
    diff: { perType, emptyAccordions: emptyAcc },
  };
}

export function structureChecks(prod, aem) {
  const checks = [];

  // headings: Jaccard over normalised heading-text sets, with matched outlines.
  const headingText = (h) => (typeof h === 'string' ? h : h.text);
  const pH = new Set((prod.headings || []).map(headingText).map(s => s.toLowerCase()));
  const aH = new Set((aem.headings || []).map(headingText).map(s => s.toLowerCase()));
  const hInter = [...pH].filter(x => aH.has(x)).length;
  const hUnion = new Set([...pH, ...aH]).size || 1;
  const jac = hInter / hUnion;
  const outline = (hs, other) => (hs || []).map(h => ({
    level: typeof h === 'string' ? 0 : h.level,
    text: headingText(h),
    tag: typeof h === 'string' ? '' : h.tag,
    matched: other.has(headingText(h).toLowerCase()),
  }));
  checks.push(makeCheck('headings', 'Headings (Jaccard)', jac > 0.6,
    `${aem.headingCount}/${prod.headingCount} headings (Jaccard ${Math.round(jac * 100)}%)`,
    jac, { prodOutline: outline(prod.headings, aH), aemOutline: outline(aem.headings, pH) }));

  // links: fraction of prod link-texts found in AEM.
  const pLinks = new Set((prod.links || []).map(l => l.text.toLowerCase()).filter(Boolean));
  const aLinks = new Set((aem.links || []).map(l => l.text.toLowerCase()).filter(Boolean));
  const linkHit = pLinks.size > 0 ? [...pLinks].filter(t => aLinks.has(t)).length / pLinks.size : 0;
  checks.push(makeCheck('links', 'Links match', linkHit > 0.5,
    `${aem.linkCount}/${prod.linkCount} links (${Math.round(linkHit * 100)}% of prod link-texts found)`,
    linkHit, { matchedCount: [...pLinks].filter(t => aLinks.has(t)).length }));

  // meta: partial credit per matched key.
  const metaKeys = ['title', 'description', 'canonical', 'ogTitle', 'ogImage', 'keywords'];
  const metaChecks = metaKeys.map(k => ({ key: k, prod: prod.meta?.[k] || '', aem: aem.meta?.[k] || '', match: normCompare(prod.meta?.[k], aem.meta?.[k]) }));
  const metaHits = metaChecks.filter(m => m.match).length;
  const metaMissing = metaChecks.filter(m => m.prod && !m.match).map(m => m.key);
  checks.push(makeCheck('meta', 'Meta tags', metaHits === metaKeys.length,
    `${metaHits}/${metaKeys.length} matched` + (metaMissing.length ? ` — missing: ${metaMissing.join(', ')}` : ''),
    metaHits / metaKeys.length, { missing: metaMissing, details: metaChecks }));

  // template: header + footer + components merged.
  const tCheck = (() => {
    if (!hasNewMetrics(prod) || !hasNewMetrics(aem)) {
      const c = makeCheck('template', 'Template (header/footer/components)', false,
        'insufficient data (page captured before criteria update)', 0, null);
      c.insufficient = true;
      return c;
    }
    const hm = scoreMenu(prod.headerMenus, aem.headerMenus);
    const fm = scoreMenu(prod.footerMenus, aem.footerMenus);
    const comp = scoreComponents(prod, aem);
    return makeCheck('template', 'Template (header/footer/components)',
      hm.pass && fm.pass && comp.pass,
      `header ${hm.detail} · footer ${fm.detail} · ${comp.detail}`,
      (hm.hit + fm.hit + comp.hit) / 3,
      { header: hm.diff, footer: fm.diff, components: comp.diff });
  })();
  checks.push(tCheck);

  return checks;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/scoring/checks-structure.js test/checks-structure.test.js
git commit -m "feat(scoring): structure checks — headings/links/meta ports + merged template"
```

---

### Task 8: Advisory module + score-main assembler

**Files:**
- Create: `src/scoring/advisory.js`
- Create: `src/scoring/score-main.js`
- Test: `test/score-main.test.js`

**Interfaces:**
- Consumes: every `checks-*.js` module; `filenameOf` from `./util.js`; `THAI_RATIO_DELTA`, `IMAGE_RATIO_TOLERANCE` from config.
- Produces:
  - `advisoryIssues(prod, aem) → { aemIssues, brokenLinks, imageIssues, thaiIssues }` (same field shapes as pre-v2 `scoreParity` output)
  - `scoreMain(prod, aem, context = {}) → { parity, checks, gaps, aemIssues, brokenLinks, imageIssues, thaiIssues }` — the exact return shape `compare.js`'s main branch has today, so `rescore.js` and (at promotion) `compare.js` can drop it in. Checks whose id is missing from `W` (weight `undefined`) are demoted to `aemIssues` advisories instead of scored — this is the mechanism the brokenImage calibration gate uses.

- [ ] **Step 1: Write the failing test**

`test/score-main.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scoreMain } from '../src/scoring/score-main.js';
import { metrics } from './fixtures.js';

test('perfect parity scores 100 with insufficient checks excluded from denominator', () => {
  const blocks = ['หัวข้อที่หนึ่ง', 'หัวข้อที่สอง', 'หัวข้อที่สาม', 'หัวข้อที่สี่', 'หัวข้อที่ห้า'];
  const m = () => metrics({
    textLength: 1000, textBlocks: blocks,
    topWords: [{ w: 'เงินฝาก', c: 5 }],
    headings: [{ level: 2, text: 'บัญชี', tag: 'H2' }], headingCount: 1,
    links: [{ text: 'หน้าแรก', href: 'https://x.com/' }], linkCount: 1,
    images: [{ alt: 'รูป', src: 'https://x.com/a.jpg', naturalWidth: 10, naturalHeight: 10, renderedWidth: 10, renderedHeight: 10 }], imageCount: 1,
    headerMenus: [{ label: 'หน้าแรก' }], footerMenus: [{ label: 'ติดต่อ' }],
  });
  const r = scoreMain(m(), m(), {});
  // visualLayout + download checks are insufficient here (no context/no PDFs) —
  // they must be excluded, not counted as failures.
  assert.equal(r.parity, 100);
  const ins = r.checks.filter(c => c.insufficient).map(c => c.id).sort();
  assert.deepEqual(ins, ['deadDownloadLink', 'missingDownloadLink', 'visualLayout']);
  assert.equal(r.gaps.length, 0);
});

test('thaiBalance is advisory now — affects aemIssues/thaiIssues, never parity', () => {
  const a = metrics({ thaiRatio: 0.9 });
  const b = metrics({ thaiRatio: 0.1 });
  const r = scoreMain(a, b, {});
  assert.equal(r.checks.find(c => c.id === 'thaiBalance'), undefined);
  assert.equal(r.thaiIssues.length, 1);
  assert.ok(r.aemIssues.some(i => /Thai\/English/.test(i.label)));
});

test('formatting advisory fires on table drop', () => {
  const prod = metrics({ componentCounts: { ...metrics().componentCounts, table: 2 } });
  const r = scoreMain(prod, metrics(), {});
  assert.ok(r.aemIssues.some(i => /Formatting/.test(i.label)));
});

test('all 14 scored check ids are present exactly once', () => {
  const r = scoreMain(metrics(), metrics(), {});
  const ids = r.checks.map(c => c.id).sort();
  assert.deepEqual(ids, ['brokenImage', 'contentLength', 'contentOrder', 'deadDownloadLink',
    'headings', 'imageAlt', 'links', 'meta', 'missingDownloadLink', 'missingImage',
    'missingKeywords', 'missingText', 'template', 'visualLayout'].sort());
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — module not found

- [ ] **Step 3: Create `src/scoring/advisory.js`**

Ports of `compare.js:658-751` (aemIssues, thaiIssues, brokenLinks, image distortion) plus the new formatting advisory and thaiBalance moved here from the scored set:

```js
// Advisory findings — surfaced in the dashboard and synced to the sheet's
// Open Issues, but never part of the weighted parity score. Ports the pre-v2
// aemIssues/brokenLinks/imageIssues logic, absorbs thaiBalance (demoted from
// the scored set), and adds the low-priority formatting heuristics.
import { THAI_RATIO_DELTA, IMAGE_RATIO_TOLERANCE } from '../../config.js';
import { filenameOf } from './util.js';

export function advisoryIssues(prod, aem) {
  const aemIssues = [];

  if (aem.leakedContentPaths?.length) aemIssues.push({ severity: 'high', label: 'Leaked /content/ paths', detail: `${aem.leakedContentPaths.length} found` });
  if (!aem.features?.login && prod.features?.login) aemIssues.push({ severity: 'high', label: 'Missing login', detail: 'prod has login, AEM does not' });
  if (!aem.features?.languageSwitch && prod.features?.languageSwitch) aemIssues.push({ severity: 'high', label: 'Missing language switcher' });
  const socialMissing = Object.entries(prod.social || {}).filter(([k, v]) => v && !aem.social?.[k]).map(([k]) => k);
  if (socialMissing.length) aemIssues.push({ severity: 'medium', label: 'Missing social icons', detail: socialMissing.join(', ') });

  // Thai/English balance — advisory in v2 (no longer a scored check, so the
  // pre-v2 double-count concern with gaps no longer applies).
  const pThai = prod.thaiRatio ?? 0;
  const aThai = aem.thaiRatio ?? 0;
  const tDelta = Math.abs(pThai - aThai);
  const thaiIssues = tDelta > THAI_RATIO_DELTA
    ? [{ severity: 'high', label: 'Thai/English balance differs', detail: `prod ${Math.round(pThai * 100)}% Thai vs AEM ${Math.round(aThai * 100)}% Thai` }]
    : [];
  if (thaiIssues.length) aemIssues.push({ severity: 'medium', label: 'Thai/English balance differs', detail: thaiIssues[0].detail });

  // Formatting (advisory, low priority per QA): heading text present on both
  // sides at a different level, or table count dropped.
  const prodLevels = new Map((prod.headings || []).filter(h => typeof h === 'object').map(h => [h.text.toLowerCase(), h.level]));
  let levelMismatch = 0;
  for (const h of (aem.headings || [])) {
    if (typeof h !== 'object') continue;
    const pl = prodLevels.get(h.text.toLowerCase());
    if (pl && pl !== h.level) levelMismatch++;
  }
  const tableDrop = (prod.componentCounts?.table || 0) - (aem.componentCounts?.table || 0);
  if (levelMismatch > 0 || tableDrop > 0) {
    aemIssues.push({
      severity: 'low', label: 'Formatting (advisory)',
      detail: [levelMismatch ? `${levelMismatch} heading(s) at wrong level` : '', tableDrop > 0 ? `${tableDrop} table(s) dropped` : ''].filter(Boolean).join(' · '),
    });
  }

  // Broken in-page links (HTTP status from the in-browser AEM link check).
  const brokenLinks = [];
  if (aem.linkStatuses) {
    for (const [url, status] of Object.entries(aem.linkStatuses)) {
      if (status >= 400) brokenLinks.push({ url: url.slice(0, 80), status });
      else if (status === 0) brokenLinks.push({ url: url.slice(0, 80), status: 'unreachable' });
    }
  }
  if (brokenLinks.length) aemIssues.push({ severity: 'high', label: 'Broken links on AEM', detail: `${brokenLinks.length} links return error` });

  // Image distortion/ratio — filename match first, order-based fill after.
  const prodImgs = prod.images || [];
  const aemImgs = aem.images || [];
  const imageIssues = [];
  const imgRatio = (w, h) => h > 0 ? w / h : 0;
  const imgDiffers = (a, b) => a > 0 && b > 0 && Math.abs(a - b) / a > IMAGE_RATIO_TOLERANCE;
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
      label, kind: '', detail: '', prodSrc: o.src, aemSrc: m.src, prodAlt: o.alt || '', aemAlt: m.alt || '',
      prodRendered: `${o.renderedWidth}×${o.renderedHeight}`, aemRendered: `${m.renderedWidth}×${m.renderedHeight}`,
    };
    if (imgDiffers(ro, rm)) {
      imageIssues.push({ ...imgData, kind: 'ratio', detail: `rendered ratio prod ${ro.toFixed(2)} vs aem ${rm.toFixed(2)}` });
      continue;
    }
    const natM = imgRatio(m.naturalWidth, m.naturalHeight);
    const natO = imgRatio(o.naturalWidth, o.naturalHeight);
    if (imgDiffers(natM, rm) && !imgDiffers(natO, ro)) {
      imageIssues.push({ ...imgData, kind: 'distortion', detail: `distorted: natural ${natM.toFixed(2)} vs rendered ${rm.toFixed(2)}` });
    }
  }
  if (aemImgs.length < prodImgs.length - 2) {
    imageIssues.push({ label: '(page-wide)', detail: `AEM renders ${aemImgs.length} images vs ${prodImgs.length} on prod`, kind: 'missing' });
  }
  if (imageIssues.length) aemIssues.push({ severity: 'medium', label: 'Image distortion/ratio', detail: `${imageIssues.length} image issue(s)` });

  return { aemIssues, brokenLinks, imageIssues, thaiIssues };
}
```

- [ ] **Step 4: Create `src/scoring/score-main.js`**

```js
// v2 main-mode scorer. Assembles the five check groups, computes the weighted
// parity with `insufficient` checks excluded from the denominator, and demotes
// any check whose id is absent from W (weight undefined) to an advisory —
// that mechanism is how the brokenImage calibration gate can turn the check
// advisory-only by removing its weight from config, with no code change here.
import { W } from './weights.js';
import { contentChecks } from './checks-content.js';
import { assetChecks } from './checks-assets.js';
import { alignmentChecks } from './checks-alignment.js';
import { downloadChecks } from './checks-downloads.js';
import { structureChecks } from './checks-structure.js';
import { advisoryIssues } from './advisory.js';

export function scoreMain(prod, aem, context = {}) {
  const all = [
    ...contentChecks(prod, aem),
    ...assetChecks(prod, aem),
    ...alignmentChecks(prod, aem, context),
    ...downloadChecks(prod, aem, context),
    ...structureChecks(prod, aem),
  ];
  const checks = all.filter(c => c.weight !== undefined);
  const demoted = all.filter(c => c.weight === undefined);

  let score = 0, possible = 0;
  for (const c of checks) {
    if (c.insufficient) continue;             // excluded — weight not counted
    score += c.weight * (c.passed ? 1 : c.partial);
    possible += c.weight;
  }
  const parity = Math.min(100, Math.round((possible > 0 ? score / possible : 0) * 100));
  const gaps = checks.filter(c => !c.passed && !c.insufficient).map(c => ({ label: c.label, detail: c.detail, weight: c.weight }));

  const adv = advisoryIssues(prod, aem);
  for (const c of demoted) {
    if (!c.passed && !c.insufficient) adv.aemIssues.push({ severity: 'medium', label: `${c.label} (advisory)`, detail: c.detail });
  }

  return { parity, checks, gaps, ...adv };
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test`
Expected: PASS (all suites)

- [ ] **Step 6: Commit**

```bash
git add src/scoring/advisory.js src/scoring/score-main.js test/score-main.test.js
git commit -m "feat(scoring): advisory module + score-main assembler with demotion mechanism"
```

---

### Task 9: layout-profile.js (screenshots → column profiles)

**Files:**
- Create: `src/layout-profile.js`

**Interfaces:**
- Consumes: `data/results.json` page shape (`{ pages: [{ id, prod: { screenshot }, aem: { screenshot } }] }`; screenshot paths are ROOT-relative like `data/screenshots/1/prod.jpg`, legacy absolute tolerated); `LAYOUT_PROFILE_BINS`, `LAYOUT_PROFILE_PATH` from config.
- Produces: `data/layout-profiles.json` shaped `{ [pageId]: { prod: { mtimeMs, bins: number[] } | null, aem: {...} | null } }` — `null` means "cannot be computed" (missing/unreadable file), distinct from an absent id ("not yet computed"). Task 10's rescore reads this file.

- [ ] **Step 1: Create `src/layout-profile.js`**

```js
// Build per-screenshot horizontal "ink mass" profiles for the visualLayout
// check. For each column: sum of |pixel − row median| down the column (flat
// background contributes ~0), binned to LAYOUT_PROFILE_BINS buckets and
// normalised to sum 1. Height-invariant by construction — a page that is
// merely longer produces the same profile shape.
//
// Cached in data/layout-profiles.json keyed by page id with the source file
// mtime, so re-runs only recompute changed screenshots.
//
// Usage:
//   node src/layout-profile.js                      # all pages in results.json
//   node src/layout-profile.js --source=data/results.json --force
import { readFile, writeFile } from 'node:fs/promises';
import { existsSync, statSync } from 'node:fs';
import { join, isAbsolute } from 'node:path';
import sharp from 'sharp';
import { ROOT, DIR, LAYOUT_PROFILE_BINS, LAYOUT_PROFILE_PATH } from '../config.js';

const arg = (name, dflt) => process.argv.find(a => a.startsWith(`--${name}=`))?.split('=')[1] || dflt;
const SOURCE = arg('source', join(DIR.data, 'results.json'));
const FORCE = process.argv.includes('--force');

// Mirror of build-dashboard's resolveShot: relative paths resolve via ROOT,
// legacy absolute paths pass through.
const resolveShot = (stored) => !stored ? null : (isAbsolute(stored) ? stored : join(ROOT, stored));

async function columnProfile(absPath) {
  const { data, info } = await sharp(absPath).greyscale().raw().toBuffer({ resolveWithObject: true });
  const { width, height } = info;
  const colMass = new Float64Array(width);
  for (let y = 0; y < height; y++) {
    const off = y * width;
    const sorted = Uint8Array.prototype.slice.call(data, off, off + width).sort();
    const median = sorted[width >> 1];
    for (let x = 0; x < width; x++) colMass[x] += Math.abs(data[off + x] - median);
  }
  const bins = new Array(LAYOUT_PROFILE_BINS).fill(0);
  for (let x = 0; x < width; x++) {
    bins[Math.min(LAYOUT_PROFILE_BINS - 1, Math.floor(x / width * LAYOUT_PROFILE_BINS))] += colMass[x];
  }
  const total = bins.reduce((a, b) => a + b, 0);
  return total > 0 ? bins.map(v => v / total) : bins;   // all-zero = blank page
}

async function main() {
  console.log(`🚀 layout profiles from ${SOURCE} (${LAYOUT_PROFILE_BINS} bins)`);
  const data = JSON.parse(await readFile(SOURCE, 'utf8'));
  const cache = !FORCE && existsSync(LAYOUT_PROFILE_PATH)
    ? JSON.parse(await readFile(LAYOUT_PROFILE_PATH, 'utf8'))
    : {};
  let done = 0, computed = 0, cached = 0, failed = 0;
  for (const p of data.pages) {
    const entry = cache[p.id] || (cache[p.id] = {});
    for (const side of ['prod', 'aem']) {
      const abs = resolveShot(p[side]?.screenshot);
      if (!abs || !existsSync(abs)) { entry[side] = null; continue; }
      const mtimeMs = statSync(abs).mtimeMs;
      if (entry[side] && entry[side].mtimeMs === mtimeMs) { cached++; continue; }
      try {
        entry[side] = { mtimeMs, bins: await columnProfile(abs) };
        computed++;
      } catch (e) {
        console.log(`❌ page ${p.id} ${side}: ${e.message}`);
        entry[side] = null;
        failed++;
      }
    }
    done++;
    if (done % 25 === 0) {
      await writeFile(LAYOUT_PROFILE_PATH, JSON.stringify(cache));
      console.log(`📸 ${done}/${data.pages.length} pages (${computed} computed · ${cached} cached · ${failed} failed)`);
    }
  }
  await writeFile(LAYOUT_PROFILE_PATH, JSON.stringify(cache));
  console.log(`✅ ${done} pages → ${LAYOUT_PROFILE_PATH} (${computed} computed · ${cached} cached · ${failed} failed)`);
}

main().catch(e => { console.error('❌', e); process.exit(1); });
```

- [ ] **Step 2: Verify on real data — full run**

Run: `npm run layout-profile`
Expected: progress lines every 25 pages, final `✅ 632 pages → .../data/layout-profiles.json`. First run takes minutes (1264 full-page images); interrupt+rerun resumes from cache. Error-page/blocked pages without screenshots record `null` — that's correct, not a failure.

- [ ] **Step 3: Spot-check the output makes sense**

Run:

```bash
node -e "
import('node:fs').then(async ({ readFileSync }) => {
  const c = JSON.parse(readFileSync('data/layout-profiles.json', 'utf8'));
  const { profileMatch } = await import('./src/scoring/util.js');
  const ids = Object.keys(c).filter(id => c[id].prod?.bins && c[id].aem?.bins).slice(0, 10);
  for (const id of ids) console.log('page', id, 'match', profileMatch(c[id].prod.bins, c[id].aem.bins)?.toFixed(3));
});"
```

Expected: 10 lines with match values in (0, 1]; visually-similar pages should score high (>0.85). A second `npm run layout-profile` run finishes in seconds with `computed 0`.

- [ ] **Step 4: Commit**

```bash
git add src/layout-profile.js
git commit -m "feat: layout-profile pass — screenshot column profiles for visualLayout"
```

---

### Task 10: check-downloads.js (HEAD liveness cache) + rescore.js

**Files:**
- Create: `src/check-downloads.js`
- Create: `src/rescore.js`

**Interfaces:**
- Consumes: `isDownloadHref` from `src/scoring/util.js`; `scoreMain` from `src/scoring/score-main.js`; `data/layout-profiles.json` (Task 9); config constants from Task 1.
- Produces: `data/link-status.json` shaped `{ [url]: { status: number, checkedAt: string } }` (status 0 = network error/timeout); `data/results-v2.json` in the exact results.json shape (`{ generatedAt, totalDurationMs, pages }`) with re-scored `parity/checks/gaps/aemIssues/brokenLinks/imageIssues/thaiIssues` per page. Everything else on each page — and every error/news/metricless page in its entirety — is preserved verbatim.

- [ ] **Step 1: Create `src/check-downloads.js`**

```js
// HEAD-check every AEM download URL found in the results file and cache the
// HTTP status in data/link-status.json for the deadDownloadLink check.
//
// ⚠️ This hits BBL hosts — the same Akamai WAF that bans compare.js runs.
// Discipline (see AGENTS.md gotchas): dedupe by URL first, HEAD not GET
// (GET fallback only on 405/501, body cancelled), bounded concurrency,
// per-request pacing, and abort when the blocked ratio crosses
// SAFE_BLOCK_ABORT_RATIO — a mostly-blocked run means the IP is banned and
// continuing would only cache garbage.
//
// Usage:
//   node src/check-downloads.js                # all uncached AEM download URLs
//   node src/check-downloads.js --limit=10     # first N (connectivity test)
//   node src/check-downloads.js --force        # re-check cached URLs too
import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import {
  DIR, LINK_STATUS_PATH, LINK_HEAD_CONCURRENCY, LINK_HEAD_PACING_MS,
  LINK_HEAD_TIMEOUT, SAFE_BLOCK_ABORT_RATIO, CAPTURE_USER_AGENT,
} from '../config.js';
import { isDownloadHref } from './scoring/util.js';

const arg = (name, dflt) => process.argv.find(a => a.startsWith(`--${name}=`))?.split('=')[1] || dflt;
const SOURCE = arg('source', join(DIR.data, 'results.json'));
const LIMIT = parseInt(arg('limit', '0'), 10) || Infinity;
const FORCE = process.argv.includes('--force');

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function headStatus(url) {
  const opts = { redirect: 'follow', headers: { 'user-agent': CAPTURE_USER_AGENT }, signal: AbortSignal.timeout(LINK_HEAD_TIMEOUT) };
  try {
    let res = await fetch(url, { ...opts, method: 'HEAD' });
    if (res.status === 405 || res.status === 501) {
      res = await fetch(url, { ...opts, method: 'GET' });
      try { await res.body?.cancel(); } catch { /* body already consumed */ }
    }
    return res.status;
  } catch {
    return 0;   // timeout / DNS / connection drop
  }
}

async function main() {
  const data = JSON.parse(await readFile(SOURCE, 'utf8'));
  const urls = new Set();
  for (const p of data.pages) {
    for (const l of (p.aem?.metrics?.links || [])) {
      if (isDownloadHref(l.href)) urls.add(l.href);
    }
  }
  const cache = existsSync(LINK_STATUS_PATH) ? JSON.parse(await readFile(LINK_STATUS_PATH, 'utf8')) : {};
  const queue = [...urls].filter(u => FORCE || cache[u] === undefined).slice(0, LIMIT);
  console.log(`🚀 ${urls.size} distinct AEM download URL(s), ${queue.length} to check (concurrency ${LINK_HEAD_CONCURRENCY}, pacing ${LINK_HEAD_PACING_MS}ms)`);

  let idx = 0, processed = 0, blocked = 0, aborted = false;
  const save = () => writeFile(LINK_STATUS_PATH, JSON.stringify(cache, null, 1));

  async function worker() {
    while (!aborted && idx < queue.length) {
      const url = queue[idx++];
      const status = await headStatus(url);
      cache[url] = { status, checkedAt: new Date().toISOString() };
      processed++;
      if (status === 403 || status === 0) blocked++;
      if (processed % 25 === 0) {
        await save();
        console.log(`📥 ${processed}/${queue.length} (${blocked} blocked/unreachable)`);
      }
      if (processed >= 20 && blocked / processed >= SAFE_BLOCK_ABORT_RATIO) {
        aborted = true;
        console.log(`❌ ABORT: ${blocked}/${processed} blocked — the WAF is refusing this IP. Wait/switch IP and re-run (cached URLs are kept).`);
      }
      await sleep(LINK_HEAD_PACING_MS);
    }
  }

  await Promise.all(Array.from({ length: LINK_HEAD_CONCURRENCY }, worker));
  await save();
  console.log(`${aborted ? '❌ aborted at' : '✅'} ${processed} checked → ${LINK_STATUS_PATH}`);
  if (aborted) process.exit(1);
}

main().catch(e => { console.error('❌', e); process.exit(1); });
```

- [ ] **Step 2: Connectivity test, then full run**

Run: `npm run check-downloads -- --limit=10`
Expected: `🚀 ... 10 to check`, then `✅ 10 checked` with statuses landing in `data/link-status.json` (inspect: `node -e "console.log(JSON.parse(require('fs').readFileSync('data/link-status.json')))"` — mostly 200s expected). If mostly 403/0 → the WAF is refusing; stop and tell the user rather than continuing.

Then: `npm run check-downloads`
Expected: completes over the remaining URLs (deduped set is far smaller than 172 pages × links). Re-run finishes instantly (`0 to check`).

- [ ] **Step 3: Create `src/rescore.js`**

```js
// Re-score a results file with the v2 criteria from CACHED metrics — no
// page re-capture, no network. Pages with an errorType, news-mode pages,
// and pages without both metric objects are preserved byte-identical.
//
// Usage:
//   node src/rescore.js                                  # results.json → results-v2.json
//   node src/rescore.js --source=X.json --out=Y.json
//   node src/rescore.js --ids=1-50                       # re-score subset, preserve rest
// Writing --out onto an existing file makes a timestamped backup first.
import { readFile, writeFile, copyFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { DIR, LAYOUT_PROFILE_PATH, LINK_STATUS_PATH, PASS_THRESHOLD } from '../config.js';
import { scoreMain } from './scoring/score-main.js';

const arg = (name, dflt) => process.argv.find(a => a.startsWith(`--${name}=`))?.split('=')[1] || dflt;
const SOURCE = arg('source', join(DIR.data, 'results.json'));
const OUT = arg('out', join(DIR.data, 'results-v2.json'));
const IDS = (() => {
  const spec = arg('ids', '');
  if (!spec) return null;
  const set = new Set();
  for (const part of spec.split(',')) {
    const [a, b] = part.split('-').map(Number);
    if (b) { for (let i = a; i <= b; i++) set.add(String(i)); } else set.add(String(a));
  }
  return set;
})();

const histogram = (pages) => {
  const h = {};
  for (const p of pages) {
    const k = p.errorType ? p.errorType : `${Math.floor((p.parity ?? 0) / 10) * 10}s`;
    h[k] = (h[k] || 0) + 1;
  }
  return h;
};

async function main() {
  console.log(`🚀 rescore ${SOURCE} → ${OUT}`);
  const data = JSON.parse(await readFile(SOURCE, 'utf8'));
  const layout = existsSync(LAYOUT_PROFILE_PATH) ? JSON.parse(await readFile(LAYOUT_PROFILE_PATH, 'utf8')) : {};
  const linkStatus = existsSync(LINK_STATUS_PATH) ? JSON.parse(await readFile(LINK_STATUS_PATH, 'utf8')) : null;
  if (!Object.keys(layout).length) console.log('⚠️ no layout profiles — visualLayout will be insufficient (run: npm run layout-profile)');
  if (!linkStatus) console.log('⚠️ no link statuses — deadDownloadLink will be insufficient (run: npm run check-downloads)');

  let rescored = 0, preserved = 0;
  const failCounts = {};
  const pages = data.pages.map(p => {
    const skip = (IDS && !IDS.has(String(p.id))) || p.errorType || p.newsMode || !p.prod?.metrics || !p.aem?.metrics;
    if (skip) { preserved++; return p; }
    const lp = layout[p.id] || {};
    const sc = scoreMain(p.prod.metrics, p.aem.metrics, {
      layout: { prod: lp.prod?.bins ?? null, aem: lp.aem?.bins ?? null },
      linkStatus,
    });
    for (const c of sc.checks) if (!c.passed && !c.insufficient) failCounts[c.id] = (failCounts[c.id] || 0) + 1;
    rescored++;
    return { ...p, ...sc };
  });

  const out = { ...data, pages };
  if (existsSync(OUT)) {
    const backup = `${OUT}.backup-${new Date().toISOString().replace(/[:.]/g, '-')}`;
    await copyFile(OUT, backup);
    console.log(`📦 backed up existing ${OUT} → ${backup}`);
  }
  await writeFile(OUT, JSON.stringify(out, null, 1));

  const oldScored = data.pages.filter(p => !p.errorType);
  const newScored = pages.filter(p => !p.errorType);
  console.log(`✅ ${rescored} rescored · ${preserved} preserved verbatim → ${OUT}`);
  console.log('📊 old histogram:', histogram(oldScored));
  console.log('📊 new histogram:', histogram(newScored));
  console.log(`📊 PASS (≥${PASS_THRESHOLD}): old ${oldScored.filter(p => p.parity >= PASS_THRESHOLD).length} → new ${newScored.filter(p => p.parity >= PASS_THRESHOLD).length}`);
  console.log('📊 fail counts by check:', Object.fromEntries(Object.entries(failCounts).sort((a, b) => b[1] - a[1])));
}

main().catch(e => { console.error('❌', e); process.exit(1); });
```

- [ ] **Step 4: Run rescore and verify the three invariants**

Run: `npm run rescore`
Expected: `✅ 358 rescored · 274 preserved verbatim`, both histograms printed, fail counts led by content/asset checks. A collapse of the new histogram to all-`0s` or all-`90s` is a bug — investigate before continuing.

Verify error pages are byte-identical:

```bash
node -e "
const f = require('fs');
const a = JSON.parse(f.readFileSync('data/results.json')).pages;
const b = JSON.parse(f.readFileSync('data/results-v2.json')).pages;
const bad = a.filter((p, i) => p.errorType && JSON.stringify(p) !== JSON.stringify(b[i]));
console.log(bad.length === 0 ? '✅ all error pages preserved verbatim' : '❌ ' + bad.length + ' error pages mutated');"
```

Expected: `✅ all error pages preserved verbatim`

Verify every rescored page has 14 checks:

```bash
node -e "
const b = JSON.parse(require('fs').readFileSync('data/results-v2.json')).pages;
const scored = b.filter(p => !p.errorType && p.prod?.metrics && p.aem?.metrics && !p.newsMode);
const bad = scored.filter(p => p.checks.length !== 14);
console.log(bad.length === 0 ? '✅ all ' + scored.length + ' rescored pages have 14 checks' : '❌ ' + bad.length + ' pages wrong check count');"
```

Expected: `✅ all 358 rescored pages have 14 checks`

- [ ] **Step 5: Commit**

```bash
git add src/check-downloads.js src/rescore.js
git commit -m "feat: check-downloads liveness cache + rescore.js (results-v2 side file)"
```

---

### Task 11: Dashboard v2 — flag, diff renderers, group CSS

**Files:**
- Modify: `src/build-dashboard.js`

**Interfaces:**
- Consumes: `CRITERIA_GROUPS_V2` from config; the diff shapes produced by Tasks 4–7 (`brokenImage: {broken[], candidateCount}`, `imageAlt: {altMatchPct, missingAlts[], prodAltCount}`, `contentOrder: {sharedCount, inOrder, outOfOrder[]}`, `visualLayout: {match, prodBins[], aemBins[]}`, `missingDownloadLink: {missing[], prodCount, aemCount, prodLinks[]}`, `deadDownloadLink: {dead[], checkedCount, totalCount}`, `template: {header, footer, components}`, `missingImage: {prodCount, aemCount}`).
- Produces: `--criteria=v2` CLI flag; running with `--source=data/results-v2.json --prefix=v2 --criteria=v2` renders `output/v2-dashboard.html` + `output/v2-pages/` without touching the live dashboard.

- [ ] **Step 1: Add the `--criteria=v2` flag**

In `src/build-dashboard.js`, change the config import (line 13) to also import `CRITERIA_GROUPS_V2`:

```js
import { ROOT, DIR, CRITERIA_GROUPS, CRITERIA_GROUPS_V2 } from '../config.js';

// --criteria=v2 renders with the defect-aligned v2 groups (results-v2.json);
// default stays the live groups until promotion.
const GROUPS = process.argv.includes('--criteria=v2') ? CRITERIA_GROUPS_V2 : CRITERIA_GROUPS;
```

Then replace every other `CRITERIA_GROUPS` reference in the file with `GROUPS` (lines ~112, ~420, ~432 — `grep -n CRITERIA_GROUPS src/build-dashboard.js` and rename all except the import).

- [ ] **Step 2: Add the new diff renderer cases**

In `renderDiffDetails` (the `switch (id)` starting ~line 590), insert after the `'missingKeywords'` case. Also **replace** the existing `'missingImage'` case body with the count-only version below (its old diff shape carried alt fields that now live in `imageAlt`):

```js
    case 'missingImage':
      // v2 diff = { prodCount, aemCount } (count only; alt split into imageAlt)
      return `<div class="diff-body"><div class="diff-section">
        <div class="diff-title">AEM ${diff.aemCount ?? '?'} / Production ${diff.prodCount ?? '?'} รูป</div>
        ${diff.altMatchPct !== undefined ? `<div class="diff-title">alt match ${diff.altMatchPct}% (legacy)</div>` : ''}
      </div></div>`;

    case 'imageAlt':
      // diff = { altMatchPct, missingAlts, prodAltCount }
      return `<div class="diff-body"><div class="diff-section">
        <div class="diff-title">alt ตรงกัน ${diff.altMatchPct ?? 0}% (จาก ${diff.prodAltCount ?? 0} alt บน prod)</div>
        ${diff.missingAlts?.length ? `<div class="chip-list">${diff.missingAlts.map(a => `<span class="chip chip-missing">${esc(a)}</span>`).join('')}</div>` : ''}
      </div></div>`;

    case 'brokenImage':
      // diff = { broken: [{src, alt}], candidateCount }
      if (!diff.broken?.length) return `<div class="diff-body"><div class="diff-section"><div class="diff-title ok">รูปทั้งหมดโหลดได้ ✓ (${diff.candidateCount ?? 0} รูป)</div></div></div>`;
      return `<div class="diff-body"><div class="diff-section">
        <div class="diff-title bad">รูปบน AEM ที่โหลดไม่ขึ้น (${diff.broken.length}/${diff.candidateCount ?? 0})</div>
        <div class="chip-list">${diff.broken.map(b => `<span class="chip chip-missing" title="${esc(b.alt || '')}">${esc(b.src.split('/').pop() || b.src)}</span>`).join('')}</div>
      </div></div>`;

    case 'contentOrder':
      // diff = { sharedCount, inOrder, outOfOrder }
      return `<div class="diff-body"><div class="diff-section">
        <div class="diff-title">${diff.inOrder ?? 0}/${diff.sharedCount ?? 0} block ตามลำดับ prod</div>
        ${diff.outOfOrder?.length ? `<div class="diff-title bad">Block ที่ย้ายตำแหน่ง (${diff.outOfOrder.length})</div>
        <div class="chip-list">${diff.outOfOrder.map(t => `<span class="chip chip-missing">${esc(String(t).slice(0, 80))}</span>`).join('')}</div>` : ''}
      </div></div>`;

    case 'visualLayout': {
      // diff = { match, prodBins, aemBins } — sparkline of the two column profiles
      const spark = (bins, color) => {
        if (!bins?.length) return '';
        const w = 280, h = 44, max = Math.max(...bins, 1e-9);
        const pts = bins.map((v, i) => `${(i / (bins.length - 1) * w).toFixed(1)},${(h - v / max * h).toFixed(1)}`).join(' ');
        return `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" style="display:block"><polyline points="${pts}" fill="none" stroke="${color}" stroke-width="1.5"/></svg>`;
      };
      return `<div class="diff-body"><div class="diff-section">
        <div class="diff-title">การกระจายเนื้อหาแนวนอน — ตรงกัน ${diff.match ?? 0}%</div>
        <div class="outline-grid">
          <div class="outline-col"><div class="outline-head src">PRODUCTION</div>${spark(diff.prodBins, '#2563eb')}</div>
          <div class="outline-col"><div class="outline-head tgt">AEM</div>${spark(diff.aemBins, '#d97706')}</div>
        </div>
      </div></div>`;
    }

    case 'missingDownloadLink':
      // diff = { missing, prodCount, aemCount, prodLinks }
      if (!diff.missing?.length) return `<div class="diff-body"><div class="diff-section"><div class="diff-title ok">ไฟล์ดาวน์โหลดครบ ✓ (${diff.prodCount ?? 0} ไฟล์)</div></div></div>`;
      return `<div class="diff-body"><div class="diff-section">
        <div class="diff-title bad">ไฟล์ดาวน์โหลดที่หายจาก AEM (${diff.missing.length}/${diff.prodCount ?? 0})</div>
        <div class="chip-list">${diff.missing.map(n => `<span class="chip chip-missing">${esc(n)}</span>`).join('')}</div>
        ${diff.prodLinks?.length ? `<div class="diff-title">ลิงก์บน prod:</div><ul>${diff.prodLinks.map(l => `<li>${esc(l.text)} — <code>${esc(l.href)}</code></li>`).join('')}</ul>` : ''}
      </div></div>`;

    case 'deadDownloadLink':
      // diff = { dead: [{url, status}], checkedCount, totalCount }
      if (!diff.dead?.length) return `<div class="diff-body"><div class="diff-section"><div class="diff-title ok">ลิงก์ดาวน์โหลดทำงานทั้งหมด ✓ (${diff.checkedCount ?? 0} ลิงก์)</div></div></div>`;
      return `<div class="diff-body"><div class="diff-section">
        <div class="diff-title bad">ลิงก์ดาวน์โหลดที่ตาย (${diff.dead.length}/${diff.checkedCount ?? 0})</div>
        <ul>${diff.dead.map(d => `<li><code>${esc(d.url)}</code> → HTTP ${esc(d.status)}</li>`).join('')}</ul>
      </div></div>`;

    case 'template': {
      // diff = { header, footer, components } — the pre-v2 per-part diff shapes
      const menuPart = (name, m) => !m ? '' : `<div class="diff-section">
        <div class="diff-title">${name}: ${m.aemCount}/${m.prodCount} labels</div>
        ${m.missing?.length ? `<div class="chip-list">${m.missing.map(l => `<span class="chip chip-missing">${esc(l)}</span>`).join('')}</div>` : ''}
        ${m.extra?.length ? `<div class="chip-list">${m.extra.map(l => `<span class="chip">${esc(l)} (extra)</span>`).join('')}</div>` : ''}
      </div>`;
      const comp = diff.components?.perType
        ? `<div class="diff-section"><div class="diff-title">Components</div>
           <table class="mini">${diff.components.perType.map(t => `<tr><td>${esc(t.type)}</td><td>${t.aem}/${t.prod}</td><td class="${t.ok ? 'ok' : 'bad'}">${t.ok ? '✓' : '✗'}</td></tr>`).join('')}</table></div>`
        : '';
      return `<div class="diff-body">${menuPart('Header', diff.header)}${menuPart('Footer', diff.footer)}${comp}</div>`;
    }
```

- [ ] **Step 3: Add CSS for the five v2 group ids**

Next to the existing `.group-head.template/.content/.structure/.other` rules (~line 1025), add (keep the old rules — the live dashboard still uses them until promotion):

```css
.group-head.missing-content { background:#eef2ff; color:#1a2b5c; }
.group-head.missing-assets { background:#f0f7e6; color:#1a6b3c; }
.group-head.alignment { background:#fff7e0; color:#7a5200; }
.group-head.downloads { background:#fdf0e6; color:#8a5a00; }
.group-head.structure { background:#f0f1f3; color:#555; }
table.mini td { padding:2px 8px; font-size:12px; }
```

- [ ] **Step 4: Build both dashboards and verify**

Run:

```bash
node src/build-dashboard.js --source=data/results-v2.json --prefix=v2 --criteria=v2
npm run dashboard   # live dashboards must still build unchanged
```

Expected: `output/v2-dashboard.html` + `output/v2-pages/*.html` created; `npm run dashboard` completes with no errors. Open `output/v2-dashboard.html` in a browser: 5 group filters present; open one failing page's drill-down and confirm the brokenImage/contentOrder/visualLayout/download sections render (sparkline visible for visualLayout).

- [ ] **Step 5: Commit**

```bash
git add src/build-dashboard.js output/v2-dashboard.html output/v2-pages
git commit -m "feat(dashboard): v2 criteria flag, new-check diff renderers, 5-group CSS"
```

---

### Task 12: Thai sheet labels, criteria docs, delete superseded pilot

**Files:**
- Modify: `src/sync-sheet.js` (~line 42, `CHECK_LABELS_TH`)
- Modify: `src/build-docs.js` (~line 19, `labels`)
- Delete: `src/review-new-criteria.js`

**Interfaces:**
- Consumes: the 7 new check ids from Tasks 4–7.
- Produces: every new check id resolves to a Thai label in both the sheet sync and `output/criteria.html` (per AGENTS.md, a missing `CHECK_LABELS_TH` entry silently falls back to raw English in the QA sheet).

- [ ] **Step 1: Add the Thai labels to `src/sync-sheet.js`**

Inside `CHECK_LABELS_TH`, after the `missingImage` entry, add:

```js
  brokenImage: 'รูปโหลดไม่ขึ้น',
  imageAlt: 'Alt text รูปไม่ตรง',
  contentOrder: 'ลำดับเนื้อหาไม่ตรง',
  visualLayout: 'การจัดวาง layout ไม่ตรง',
  missingDownloadLink: 'ไฟล์ดาวน์โหลดหาย',
  deadDownloadLink: 'ลิงก์ดาวน์โหลดตาย',
  template: 'เทมเพลตไม่ครบ',
```

- [ ] **Step 2: Verify labels resolve (no sheet writes)**

Run: `node src/sync-sheet.js --source=data/results-v2.json --dry-run`
Expected: dry-run listing where Open Issues show the Thai labels above — **no raw English ids** like `brokenImage` in the output. (`--dry-run` is mandatory before any real sync per project rules; do NOT run a real sync in this plan.)

- [ ] **Step 3: Update `src/build-docs.js` labels**

In the `labels` object inside `renderDoc()` (~line 19), add entries for the new ids (keep existing ones — extra entries are harmless while both group sets exist):

```js
      brokenImage:         ['Broken image', 'ไม่มีรูปที่โหลดไม่ขึ้น', 'รูปบน AEM ที่แท็ก render แต่ไฟล์ไม่โหลด (naturalWidth 0) — ยกเว้น .svg และ data: URI'],
      imageAlt:            ['Image alt text', 'alt match > 50%', 'alt text ของ prod ต้องพบใน AEM เกินครึ่ง'],
      contentOrder:        ['Content order', 'ลำดับตรง ≥ 90%', 'บล็อกข้อความที่มีทั้งสองฝั่งต้องเรียงลำดับเดียวกับ prod (LIS)'],
      visualLayout:        ['Visual layout', 'โปรไฟล์ตรง ≥ 85%', 'เทียบการกระจายเนื้อหาแนวนอนจาก screenshot (ไม่ขึ้นกับความสูงหน้า)'],
      missingDownloadLink: ['Download links present', 'ครบทุกไฟล์', 'ไฟล์ .pdf/.doc/.xls/.zip ของ prod ต้องมีบน AEM (เทียบชื่อไฟล์)'],
      deadDownloadLink:    ['Download links alive', 'ไม่มีลิงก์ตอบ ≥400', 'HEAD check ลิงก์ดาวน์โหลดบน AEM จาก cache'],
      template:            ['Template (header/footer/components)', 'ผ่านทั้ง 3 ส่วน', 'รวม header menu + footer menu + component parity เป็นเช็คเดียว'],
```

Note: `build-docs.js` imports `CRITERIA_GROUPS`/`WEIGHTS_MAIN` — it keeps rendering the live (old) criteria until promotion switches those exports; these label entries just make it promotion-ready.

- [ ] **Step 4: Delete the superseded pilot and verify docs still build**

```bash
git rm src/review-new-criteria.js
npm run docs
```

Expected: `✅ Criteria page → .../output/criteria.html` (unchanged content — still old groups, correct until promotion).

- [ ] **Step 5: Commit**

```bash
git add src/sync-sheet.js src/build-docs.js output/criteria.html
git commit -m "feat: Thai labels + docs entries for v2 checks; drop superseded criteria pilot"
```

---

### Task 13: Calibration — brokenImage gate + hand-check + threshold tuning

This task is analysis with the user in the loop, not code. Its output is recorded threshold/weight decisions.

**Files:**
- Modify (possibly): `config.js` (`CONTENT_ORDER_PASS`, `LAYOUT_PROFILE_PASS`, and the brokenImage weight if the gate fails)
- Modify: `docs/superpowers/specs/2026-08-04-defect-aligned-criteria-design.md` (record observed precision + final thresholds)

- [ ] **Step 1: Generate the brokenImage calibration sample (20 random flagged pages)**

```bash
node -e "
const f = require('fs');
const pages = JSON.parse(f.readFileSync('data/results-v2.json')).pages;
const flagged = pages.filter(p => (p.checks || []).some(c => c.id === 'brokenImage' && !c.passed && !c.insufficient));
console.log('flagged total:', flagged.length);
const pick = flagged.map(p => [Math.random(), p]).sort((a, b) => a[0] - b[0]).slice(0, 20).map(([, p]) => p);
for (const p of pick) {
  const c = p.checks.find(c => c.id === 'brokenImage');
  console.log('id', p.id, '| data/screenshots/' + p.id + '/aem.jpg |', c.diff.broken.map(b => b.src.split('/').pop()).join(', '));
}"
```

- [ ] **Step 2: Review each sampled page's `aem.jpg` with the user**

For each of the 20: `open data/screenshots/<id>/aem.jpg` and confirm a visibly broken/blank image region matching the flagged srcs. Tally true/false positives. **This step requires the user's judgment — present the tally and stop for their call.**

- [ ] **Step 3: Apply the gate decision**

- Precision ≥ 80% → keep `brokenImage: 0.11`. No change.
- Precision < 80% → in `config.js` `WEIGHTS_MAIN_V2`: delete the `brokenImage` line, change `missingImage` to `0.21`, and remove `'brokenImage'` from the `missing-assets` group's `checks` array. The demotion mechanism in score-main then reports it as an advisory automatically. Run `npm test` (weights invariants must still pass), then `npm run rescore`.

Record the observed precision and decision in the spec's "Calibration gate" section.

- [ ] **Step 4: Hand-check 15 pages across the other new checks**

For each of `contentOrder`, `visualLayout`, `missingDownloadLink`, `deadDownloadLink` (+ `brokenImage` if it survived), list the top-3 failing pages:

```bash
node -e "
const f = require('fs');
const pages = JSON.parse(f.readFileSync('data/results-v2.json')).pages;
for (const id of ['contentOrder', 'visualLayout', 'missingDownloadLink', 'deadDownloadLink', 'brokenImage']) {
  const fails = pages.filter(p => (p.checks || []).some(c => c.id === id && !c.passed && !c.insufficient))
    .sort((a, b) => a.parity - b.parity).slice(0, 3);
  console.log('\n──', id);
  for (const p of fails) console.log('  id', p.id, 'parity', p.parity, '\n   prod:', p.prodUrl, '\n   aem: ', p.aemUrl);
}"
```

Confirm each against its cached screenshots (`data/screenshots/<id>/`) and, where reachable, the live AEM URL. If `visualLayout` or `contentOrder` flags pages that look fine, lower `LAYOUT_PROFILE_PASS` / `CONTENT_ORDER_PASS` in `config.js` in 0.05 steps and re-run `npm run rescore` (seconds — no image/network work) until the failures are genuine. Record final threshold values in the spec.

- [ ] **Step 5: Rebuild the v2 dashboard with final thresholds and commit**

```bash
npm run rescore
node src/build-dashboard.js --source=data/results-v2.json --prefix=v2 --criteria=v2
git add config.js docs/ output/v2-dashboard.html output/v2-pages
git commit -m "chore(criteria): calibrate brokenImage gate + alignment thresholds from hand-check"
```

---

### Task 14: Promotion — switch compare.js + live data to v2 (USER-GATED)

**⚠️ STOP: do not start this task until the user has reviewed `output/v2-dashboard.html` and explicitly approved promotion.** This task overwrites `data/results.json` (the one un-backed-up mutable cache) and changes what every future capture scores with.

**Files:**
- Modify: `config.js` (v2 becomes canonical)
- Modify: `src/scoring/weights.js`
- Modify: `src/compare.js`
- Modify: `src/build-dashboard.js` (drop the flag)
- Data: `data/results.json` (backup + replace)

**Interfaces:**
- Consumes: everything above.
- Produces: `scoreParity(prod, aem, newsMode, context)` in compare.js delegating main mode to `scoreMain`; `WEIGHTS_MAIN`/`CRITERIA_GROUPS` in config carry the v2 values; `_V2` names deleted.

- [ ] **Step 1: Make v2 canonical in `config.js`**

Replace the old `WEIGHTS_MAIN` object's value with the (calibrated) v2 weights and `CRITERIA_GROUPS`'s value with the v2 groups; delete the `WEIGHTS_MAIN_V2` and `CRITERIA_GROUPS_V2` exports (keep all the other Task-1 constants). The old 11-check weights are gone — git history preserves them.

- [ ] **Step 2: Point `src/scoring/weights.js` at the canonical names**

```js
import { WEIGHTS_MAIN, CRITERIA_GROUPS } from '../../config.js';

export const W = WEIGHTS_MAIN;
export const GROUPS = CRITERIA_GROUPS;
```

(keep the invariant assertions below unchanged)

- [ ] **Step 3: Drop the dashboard flag**

In `src/build-dashboard.js`: remove the `CRITERIA_GROUPS_V2` import and the `--criteria=v2` line; `const GROUPS = CRITERIA_GROUPS;` (or rename `GROUPS` back). Delete the now-redundant old `.group-head.template/.content` CSS rules if desired (the `structure` rule is shared — keep it).

- [ ] **Step 4: Switch `src/compare.js` to the v2 scorer**

1. Add imports: `import { scoreMain } from './scoring/score-main.js';` and `import { LINK_STATUS_PATH } from '../config.js';` (merge into the existing config import). Remove `WEIGHTS_MAIN` and `CRITERIA_GROUPS` from compare.js's config import if now unused.
2. Add a module-level cache holder + load it in `main()` before the pool starts:

```js
// Cached download-link statuses (data/link-status.json) — feeds the
// deadDownloadLink check. Loaded once per run; absent file → the check is
// `insufficient`, never failed. visualLayout is NOT fed here: a fresh capture
// just rewrote the screenshots, so any cached profile is stale — refresh with
// `npm run layout-profile && npm run rescore -- --out=data/results.json` after
// a capture run.
let LINK_STATUS = null;
```

and in `main()`:

```js
  LINK_STATUS = existsSync(LINK_STATUS_PATH) ? JSON.parse(await readFile(LINK_STATUS_PATH, 'utf8')) : null;
```

3. In `scoreParity`, keep the error-page guard and news dispatch exactly as-is, and replace the entire main-mode body (from `const W = WEIGHTS_MAIN;` down to the final `return { parity, checks, gaps, aemIssues, brokenLinks, imageIssues, thaiIssues };`) with:

```js
  // ─── MAIN MODE: v2 defect-aligned scoring (src/scoring/score-main.js) ────
  return scoreMain(prod, aem, { linkStatus: LINK_STATUS });
```

4. Delete the now-dead code from compare.js: `hasNewMetrics`, `isDynamicBlock`, `filenameOf`, `normCompare` local definitions — and import what `scoreNews` still needs from the scoring utils: `import { normCompare, isDynamicBlock, filenameOf } from './scoring/util.js';` (check `scoreNews`'s actual references before deleting: `grep -nE "isDynamicBlock|filenameOf|normCompare|splitSentences" src/compare.js` — keep `splitSentences` and anything else scoreNews uses).
5. Both `scoreParity` call sites (previously lines ~775 and ~853) need no signature change — `newsMode` still passes through, context is read from the module-level `LINK_STATUS`.

- [ ] **Step 5: Verify everything still works**

```bash
npm test                                       # all suites green
node --check src/compare.js                    # parses
node src/rescore.js --source=data/results.json --out=/tmp/promotion-check.json
```

Expected: rescore output identical fail-count numbers to the last Task-13 run (same scorer, same data). Then a 2-page live smoke test of compare.js **with the user's go-ahead** (it hits BBL hosts):

```bash
node src/compare.js --ids=1-2 --force --concurrency=1 --output=/tmp/compare-smoke.json --source=data/results.json
node -e "const p=JSON.parse(require('fs').readFileSync('/tmp/compare-smoke.json')).pages.filter(x=>['1','2'].includes(String(x.id))); for(const x of p) console.log(x.id, x.parity, x.checks.length, 'checks')"
```

Expected: pages 1–2 score with 14 checks (visualLayout `insufficient` — expected for fresh captures).

- [ ] **Step 6: Promote the data + rebuild everything**

```bash
cp data/results.json data/results.json.backup-pre-v2-promotion
cp data/results-v2.json data/results.json
npm run dashboard && npm run docs
rm -rf output/v2-dashboard.html output/v2-pages   # superseded by the live dashboard
node src/sync-sheet.js --dry-run                  # verify Thai labels on real flow; DO NOT run a real sync without the user
```

Expected: `output/dashboard.html` now shows 5 groups; `output/criteria.html` shows the v2 table; dry-run sync prints Thai labels.

- [ ] **Step 7: Commit (do not push — user pushes)**

```bash
git add config.js src/scoring/weights.js src/compare.js src/build-dashboard.js output/
git commit -m "feat(criteria)!: promote defect-aligned v2 scoring to main pipeline"
```

Remind the user: `data/results.json.backup-pre-v2-promotion` is the rollback; after their next capture run, the refresh flow is `npm run layout-profile && npm run rescore -- --out=data/results.json && npm run dashboard`.

---

## Self-Review Notes

- **Spec coverage:** 5 groups/14 checks (Tasks 1, 3–7), brokenImage calibration gate (13), contentOrder LIS + first-occurrence mapping (5), visualLayout column profile (5, 9), basename download matching + HEAD cache with WAF discipline (6, 10), insufficient-denominator rule (8, tested), side-file rollout (10, 11, 14), rescore backups (10, 14), CHECK_LABELS_TH (12), build-docs (12), review-new-criteria deletion (12), verification items 1–6 of the spec map to Task 1 tests / Task 10 step 4 / Task 10 step 4 / Task 13 / Task 13 / Task 12+14 respectively. Phase 2 is out of scope by design.
- **Deliberate deviations from spec text:** contentLength partial formula fixed (old one exceeded 1.0 when AEM was longer — noted in Task 3); `brokenImage` keys off AEM images alone rather than prod count (spec was amended to say exactly this).
- Type/name consistency verified: `W`/`GROUPS` (weights.js), `makeCheck`, `scoreMain`, context `{ layout: {prod, aem}, linkStatus }`, diff field names match between check modules (Tasks 4–7) and dashboard renderers (Task 11).
