# New Criteria for Main Dashboard (Pilot) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the 6-check main-dashboard scoring with 11 checks in 3 groups (Template / Content / Structure), then re-capture 20 pilot pages to validate.

**Architecture:** Add `WEIGHTS_MAIN` + `CRITERIA_GROUPS` to `config.js`; add component counts + header/footer menu labels to the self-contained `extract.js`; rewrite the main-mode branch of `scoreParity()` in `compare.js`; render grouped checks in `build-dashboard.js`; regenerate `criteria.html` from `build-docs.js`. News mode (`scoreNews`) is untouched.

**Tech Stack:** Node.js 18+ ESM, puppeteer-core, sharp. No test suite — verification is run-the-pipeline + eyeball the dashboard (per `AGENTS.md`).

**Spec:** `docs/superpowers/specs/2026-07-07-new-criteria-main-dashboard-design.md`

---

## File map

| File | Change |
|---|---|
| `config.js` | Add `WEIGHTS_MAIN`, `CRITERIA_GROUPS`. Keep `WEIGHTS` (still imported elsewhere — used as fallback / legacy). |
| `src/extract.js` | Add `tables/tableRows/forms/formInputs/videos/carousels/tabs` counts + `headerMenus`/`footerMenus` arrays + `otherComponents` heuristic. All browser-only, appended before the `return`. |
| `src/compare.js` | Rewrite main-mode `scoreParity()` (11 checks via `add()`). `newsMode` still calls `scoreNews()`. Early-return 404/blocked guard unchanged. |
| `src/build-dashboard.js` | `renderPage()` groups checks into 3 blocks with sub-scores; add "หมวดที่ fail" filter to overview. |
| `src/build-docs.js` | Regenerate `criteria.html` from `WEIGHTS_MAIN` + `CRITERIA_GROUPS`. |

**Order rationale:** config first (no dependencies) → extract (needed before re-capture) → compare (the core) → dashboard render → docs. Each task is independently committable.

---

## Task 1: Add `WEIGHTS_MAIN` and `CRITERIA_GROUPS` to `config.js`

**Files:**
- Modify: `config.js` (after the existing `WEIGHTS` export, ~line 45)

- [ ] **Step 1: Add the new weights + groups**

Insert after the existing `WEIGHTS` block (after line 45, before `WEIGHTS_NEWS`):

```js
// Main-dashboard criteria (pilot): 11 checks in 3 groups, sums to 1.00.
// Replaces WEIGHTS for main-mode scoring. Weights/thresholds here can be tuned
// later without re-capturing pages (re-score from cached metrics is enough).
export const WEIGHTS_MAIN = {
  // Template parity (25%)
  headerMenu:      0.08,  // header label + count match
  footerMenu:      0.07,  // footer label + count match
  components:      0.10,  // accordion/table/form/video parity

  // Content parity (50%)
  contentLength:   0.14,  // text length within ±30%
  missingText:     0.14,  // prod text blocks present in AEM
  missingKeywords: 0.12,  // prod keywords present in AEM
  missingImage:    0.10,  // image count ≥80% + alt match >50%

  // Structure / SEO (25%)
  headings:        0.10,  // Jaccard > 0.6
  links:           0.08,  // link-text hit > 50%
  meta:            0.05,  // meta tags match (partial credit)
  thaiBalance:     0.02,  // Thai/Latin ratio delta
};

// Group definitions — used by both compare (sub-score calc) and dashboard
// (grouped rendering). `checks` lists the WEIGHTS_MAIN keys in display order.
export const CRITERIA_GROUPS = [
  { id: 'template',  label: 'Template',         weight: 0.25, checks: ['headerMenu', 'footerMenu', 'components'] },
  { id: 'content',   label: 'Content',          weight: 0.50, checks: ['contentLength', 'missingText', 'missingKeywords', 'missingImage'] },
  { id: 'structure', label: 'Structure / SEO',  weight: 0.25, checks: ['headings', 'links', 'meta', 'thaiBalance'] },
];
```

- [ ] **Step 2: Verify the weights sum to 1.00**

Run:
```bash
node -e "import('./config.js').then(m => { const s = Object.values(m.WEIGHTS_MAIN).reduce((a,b)=>a+b,0); console.log('sum:', s.toFixed(4)); const g = m.CRITERIA_GROUPS.reduce((a,g)=>a+g.weight,0); console.log('groups sum:', g.toFixed(4)); })"
```
Expected: `sum: 1.0000` and `groups sum: 1.0000`

- [ ] **Step 3: Commit**

```bash
git add config.js
git commit -m "feat(config): add WEIGHTS_MAIN + CRITERIA_GROUPS for pilot criteria"
```

---

## Task 2: Add component + menu metrics to `extract.js`

**Files:**
- Modify: `src/extract.js` (add fields before the final `return` at line 118)

The function must stay self-contained (browser-only). We append new fields; existing fields are unchanged for backward compatibility.

- [ ] **Step 1: Add component counts**

Find the accordion section (lines 54-60). After the `emptyAccordions` line (line 60), add a block of component counters. Insert right before the `// --- Header / nav ---` comment (line 62):

```js
  // --- Component counts (for the new `components` parity check) ---
  const componentCounts = {
    accordion: accordions.length,
    table:     document.querySelectorAll('table').length,
    tableRows: document.querySelectorAll('table tr').length,
    form:      document.querySelectorAll('form').length,
    formInputs:document.querySelectorAll('input, select, textarea').length,
    video:     document.querySelectorAll(
                 'video, iframe[src*="youtube"], iframe[src*="youtu.be"], iframe[allow*="autoplay"]'
               ).length,
    carousel:  document.querySelectorAll('[class*="carousel" i], [class*="slider" i], [data-carousel]').length,
    tabs:      document.querySelectorAll('[role="tablist"], [class*="tabs" i], [class*="cmp-tabs"]').length,
  };
```

- [ ] **Step 2: Replace the header/footer section with one that also captures labels**

Replace lines 62-68 (the `// --- Header / nav ---` through `footerLinkCount`):

```js
  // --- Header / nav (labels for the new headerMenu check) ---
  const header = document.querySelector('header, [class*="header" i], nav');
  const headerMenus = header
    ? Array.from(new Set(Array.from(header.querySelectorAll('a[href]'))
        .map(a => norm(a.textContent).slice(0, 80))
        .filter(Boolean)))
        .map(label => ({ label, href: (header.querySelector(`a[href]`) || {}).href }))
        .slice(0, 80)
    : [];
  const headerLinkCount = header ? header.querySelectorAll('a[href]').length : 0;

  // --- Footer (labels for the new footerMenu check) ---
  const footer = document.querySelector('footer, [class*="footer" i]');
  const footerMenus = footer
    ? Array.from(new Set(Array.from(footer.querySelectorAll('a[href]'))
        .map(a => norm(a.textContent).slice(0, 80))
        .filter(Boolean)))
        .map(label => ({ label }))
        .slice(0, 80)
    : [];
  const footerLinkCount = footer ? footer.querySelectorAll('a[href]').length : 0;
```

- [ ] **Step 3: Add an "other components" heuristic**

After the `leakedPaths` line (line 101) inside the existing function, add:

```js
  // --- Heuristic "other components" (advisory only — not scored) ---
  // Detects components we don't formally score, surfaced in drill-down for QA.
  const otherComponents = [];
  if (document.querySelector('[role="dialog"], [class*="modal" i]')) otherComponents.push('dialog/modal');
  if (document.querySelector('canvas')) otherComponents.push('canvas');
  if (document.querySelector('[role="alert"], [class*="notification" i], [class*="toast" i]')) otherComponents.push('notification');
  if (document.querySelector('[class*="map" i], iframe[src*="google.com/maps"], iframe[src*="map"]')) otherComponents.push('map');
  if (document.querySelector('audio')) otherComponents.push('audio');
```

- [ ] **Step 4: Export the new fields in the returned object**

In the `return { ... }` object (starts at line 118), add these fields alongside the existing ones (place them after `footerLinkCount,` at line 130):

```js
    componentCounts,
    headerMenus,
    footerMenus,
    otherComponents,
```

- [ ] **Step 5: Verify the file is still valid ESM and self-contained**

Run:
```bash
node -e "import('./src/extract.js').then(m => { console.log('EXTRACT_FN type:', typeof m.EXTRACT_FN); })"
```
Expected: `EXTRACT_FN type: function` (no syntax error)

- [ ] **Step 6: Commit**

```bash
git add src/extract.js
git commit -m "feat(extract): add component counts + header/footer menu labels"
```

---

## Task 3: Rewrite main-mode `scoreParity()` in `compare.js`

**Files:**
- Modify: `src/compare.js`
  - Update import (line 21-25): add `WEIGHTS_MAIN`, `CRITERIA_GROUPS`
  - Rewrite the main-mode branch of `scoreParity()` (lines ~406-646)
  - Keep `scoreNews()` (lines 189-343) untouched
  - Keep the 404/blocked early-return guard (lines 351-399) untouched

- [ ] **Step 1: Update the import to include WEIGHTS_MAIN and CRITERIA_GROUPS**

In `src/compare.js`, find the import block (lines 20-25):

```js
import {
  DIR, VIEWPORT, NAV_TIMEOUT, NAV_WAIT_UNTIL, SETTLE_AFTER_LOAD, LAZY_WAIT_TIMEOUT, LAYOUT_WAIT_TIMEOUT, CONCURRENCY,
  SCREENSHOT_FULLPAGE, SCREENSHOT_MAX_WIDTH, MIN_TEXT_LEN, SCROLL_STIMULATE_STEPS, SCROLL_STIMULATE_DELAY,
  WEIGHTS, WEIGHTS_NEWS, TEXT_MATCH_TOLERANCE, CHROME_EXECUTABLE_PATH,
  THAI_RATIO_DELTA, IMAGE_RATIO_TOLERANCE, MAX_LINK_CHECKS, LINK_CHECK_BATCH, LINK_CHECK_DELAY,
} from '../config.js';
```

Replace the third line to add the new imports:

```js
  WEIGHTS, WEIGHTS_NEWS, WEIGHTS_MAIN, CRITERIA_GROUPS, TEXT_MATCH_TOLERANCE, CHROME_EXECUTABLE_PATH,
```

- [ ] **Step 2: Add a helper to detect "insufficient data" for new metrics**

Before the `scoreParity` function (around line 345), add:

```js
// Returns true when a metrics object lacks the new extract fields (captured
// before the extract.js change). Used to mark new checks as `insufficient`
// rather than fail them on old captures (pilot: 612 of 632 pages).
function hasNewMetrics(m) {
  return !!(m && m.componentCounts && m.headerMenus && m.footerMenus);
}
```

- [ ] **Step 3: Replace the main-mode body of `scoreParity()`**

The function `scoreParity(prod, aem, newsMode)` currently:
- lines 351-399: error-page early-return guard — **keep unchanged**
- line 401-404: `if (newsMode) return scoreNews(...)` — **keep unchanged**
- lines 406-646: main-mode checks — **replace entirely**

Find the start of the main-mode body. It begins right after the news-mode early return (currently around line 405, the comment `// Headings — Jaccard similarity...`). Replace everything from that comment down to the end of the function (the final `return { parity, checks, gaps, aemIssues, brokenLinks, imageIssues, thaiIssues };` at line 645).

Replace with:

```js
  // ─── MAIN MODE: 11 checks via WEIGHTS_MAIN (3 groups) ─────────────────────
  const W = WEIGHTS_MAIN;
  const checks = [];
  const insufficient = [];   // check ids skipped due to missing new metrics
  const add = (id, label, passed, detail, partial, diff) =>
    checks.push({ id, weight: W[id], label, passed: !!passed, detail, partial: partial ?? 0, diff: diff || null });
  const markInsufficient = (id, label) => {
    insufficient.push(id);
    checks.push({ id, weight: W[id], label, passed: false, detail: 'insufficient data (page captured before criteria update)', partial: 0, diff: null, insufficient: true });
  };
  const newDataOk = hasNewMetrics(prod) && hasNewMetrics(aem);

  // ── Template group ──
  if (newDataOk) {
    // headerMenu: count equal + 100% label match (strict).
    const pHL = new Set((prod.headerMenus || []).map(m => (m.label || '').toLowerCase()).filter(Boolean));
    const aHL = new Set((aem.headerMenus || []).map(m => (m.label || '').toLowerCase()).filter(Boolean));
    const hMissing = [...pHL].filter(l => !aHL.has(l));
    const hExtra = [...aHL].filter(l => !pHL.has(l));
    const hLabelHit = pHL.size > 0 ? (pHL.size - hMissing.length) / pHL.size : 1;
    const hPass = pHL.size === aHL.size && hMissing.length === 0;
    add('headerMenu', 'Header menu (label + count)', hPass,
      `${aHL.size}/${pHL.size} labels${hMissing.length ? ` · ${hMissing.length} missing` : ''}${hExtra.length ? ` · ${hExtra.length} extra` : ''}`,
      hLabelHit,
      { prodCount: pHL.size, aemCount: aHL.size, missing: hMissing.slice(0, 20), extra: hExtra.slice(0, 20) });

    // footerMenu: same logic as header.
    const pFL = new Set((prod.footerMenus || []).map(m => (m.label || '').toLowerCase()).filter(Boolean));
    const aFL = new Set((aem.footerMenus || []).map(m => (m.label || '').toLowerCase()).filter(Boolean));
    const fMissing = [...pFL].filter(l => !aFL.has(l));
    const fExtra = [...aFL].filter(l => !pFL.has(l));
    const fLabelHit = pFL.size > 0 ? (pFL.size - fMissing.length) / pFL.size : 1;
    const fPass = pFL.size === aFL.size && fMissing.length === 0;
    add('footerMenu', 'Footer menu (label + count)', fPass,
      `${aFL.size}/${pFL.size} labels${fMissing.length ? ` · ${fMissing.length} missing` : ''}${fExtra.length ? ` · ${fExtra.length} extra` : ''}`,
      fLabelHit,
      { prodCount: pFL.size, aemCount: aFL.size, missing: fMissing.slice(0, 20), extra: fExtra.slice(0, 20) });

    // components: each prod-present component type must be ≥80% in AEM.
    const pC = prod.componentCounts || {};
    const aC = aem.componentCounts || {};
    const types = ['accordion', 'table', 'form', 'video'];
    const perType = types.map(t => {
      const p = pC[t] || 0, a = aC[t] || 0;
      const ratio = p > 0 ? Math.min(1, a / (p * 0.8)) : 1;
      return { type: t, prod: p, aem: a, ratio, ok: p === 0 ? a === 0 : a >= Math.ceil(p * 0.8) };
    });
    const compPass = perType.every(t => t.ok);
    const compPartial = perType.reduce((s, t) => s + t.ratio, 0) / perType.length;
    const advisory = ['carousel', 'tabs'].map(t => ({ type: t, prod: pC[t] || 0, aem: aC[t] || 0 })).filter(t => t.prod || t.aem);
    add('components', 'Components (accordion/table/form/video)', compPass,
      perType.map(t => `${t.type} ${t.aem}/${t.prod}${t.ok ? '' : '✗'}`).join(' · ') + (advisory.length ? ` · advisory: ${advisory.map(t => `${t.type} ${t.aem}/${t.prod}`).join(', ')}` : ''),
      compPartial,
      { perType, advisory, otherComponents: [...new Set([...(prod.otherComponents || []), ...(aem.otherComponents || [])])] });
  } else {
    markInsufficient('headerMenu', 'Header menu (label + count)');
    markInsufficient('footerMenu', 'Footer menu (label + count)');
    markInsufficient('components', 'Components (accordion/table/form/video)');
  }

  // ── Content group ──
  // contentLength: text within ±TEXT_MATCH_TOLERANCE.
  const ratio = prod.textLength > 0 ? aem.textLength / prod.textLength : 0;
  const lenPass = Math.abs(1 - ratio) <= TEXT_MATCH_TOLERANCE;
  add('contentLength', 'Content length (±' + Math.round(TEXT_MATCH_TOLERANCE * 100) + '%)', lenPass,
    `${aem.textLength}/${prod.textLength} chars (${Math.round(ratio * 100)}%)`,
    lenPass ? 1 : Math.max(0, ratio),
    { ratio: Math.round(ratio * 100), prodSample: (prod.bodyTextSample || '').slice(0, 600), aemSample: (aem.bodyTextSample || '').slice(0, 600) });

  // missingText: prod text blocks not present in AEM.
  const aemBlockSet = new Set((aem.textBlocks || []).map(t => t.toLowerCase()));
  const prodBlocks = (prod.textBlocks || []).map(t => t.trim()).filter(t => t.length >= 8 && !isDynamicBlock(t));
  const missingTextBlocks = [...new Set(prodBlocks.filter(t => !aemBlockSet.has(t.toLowerCase())))].slice(0, 15);
  const textHit = prodBlocks.length > 0 ? 1 - (new Set(missingTextBlocks).size / new Set(prodBlocks).size) : 1;
  add('missingText', 'Missing text blocks', missingTextBlocks.length === 0,
    `${missingTextBlocks.length} prod block(s) missing`,
    textHit,
    { missingTextBlocks, prodBlockCount: new Set(prodBlocks).size });

  // missingKeywords: prod top keywords absent from AEM.
  const prodWordMap = new Map((prod.topWords || []).map(w => [w.w, w.c]));
  const aemWordMap = new Map((aem.topWords || []).map(w => [w.w, w.c]));
  const prodKey = [...prodWordMap.keys()].slice(0, 30);
  const missingKeywords = prodKey.filter(w => !aemWordMap.has(w)).slice(0, 20);
  const kwHit = prodKey.length > 0 ? 1 - (missingKeywords.length / prodKey.length) : 1;
  add('missingKeywords', 'Missing keywords', missingKeywords.length === 0,
    `${missingKeywords.length}/${prodKey.length} prod keywords missing`,
    kwHit,
    { missingKeywords, sharedCount: prodKey.length - missingKeywords.length });

  // missingImage: count ≥80% + alt match >50%.
  const prodImgs = prod.images || [];
  const aemImgs = aem.images || [];
  const imgCountOk = prodImgs.length === 0 ? aemImgs.length === 0 : aemImgs.length >= Math.ceil(prodImgs.length * 0.8);
  const prodAlts = new Set(prodImgs.map(i => i.alt?.toLowerCase()).filter(Boolean));
  const aemAlts = new Set(aemImgs.map(i => i.alt?.toLowerCase()).filter(Boolean));
  const altHit = prodAlts.size > 0 ? [...prodAlts].filter(a => aemAlts.has(a)).length / prodAlts.size : 1;
  const imgPass = imgCountOk && altHit > 0.5;
  const imgPartial = (imgCountOk ? 1 : Math.min(1, aemImgs.length / (prodImgs.length * 0.8 || 1))) * 0.5 + altHit * 0.5;
  add('missingImage', 'Missing image (≥80% + alt)', imgPass,
    `${aemImgs.length}/${prodImgs.length} images · alt match ${Math.round(altHit * 100)}%`,
    imgPartial,
    { prodCount: prodImgs.length, aemCount: aemImgs.length, altMatchPct: Math.round(altHit * 100), prodAlts: [...prodAlts].slice(0, 20), aemAlts: [...aemAlts].slice(0, 20) });

  // ── Structure / SEO group ──
  // headings: Jaccard over normalized heading-text sets.
  const pH = new Set((prod.headings || []).map(h => typeof h === 'string' ? h : h.text).map(s => s.toLowerCase()));
  const aH = new Set((aem.headings || []).map(h => typeof h === 'string' ? h : h.text).map(s => s.toLowerCase()));
  const hInter = [...pH].filter(x => aH.has(x)).length;
  const hUnion = new Set([...pH, ...aH]).size || 1;
  const jac = hInter / hUnion;
  add('headings', 'Headings (Jaccard)', jac > 0.6,
    `${hInter}/${hUnion} (Jaccard ${Math.round(jac * 100)}%)`,
    jac,
    { prodOutline: (prod.headings || []).map(h => ({ level: typeof h === 'string' ? 0 : h.level, text: typeof h === 'string' ? h : h.text, matched: aH.has((typeof h === 'string' ? h : h.text).toLowerCase()) })), aemOutline: (aem.headings || []).map(h => ({ level: typeof h === 'string' ? 0 : h.level, text: typeof h === 'string' ? h : h.text, matched: pH.has((typeof h === 'string' ? h : h.text).toLowerCase()) })) });

  // links: fraction of prod link-texts found in AEM.
  const pLinks = new Set(prod.links.map(l => l.text.toLowerCase()).filter(Boolean));
  const aLinks = new Set(aem.links.map(l => l.text.toLowerCase()).filter(Boolean));
  const linkHit = pLinks.size > 0 ? [...pLinks].filter(t => aLinks.has(t)).length / pLinks.size : 0;
  add('links', 'Links match', linkHit > 0.5,
    `${Math.round(linkHit * 100)}% of prod link-texts found`,
    linkHit,
    { matchedCount: [...pLinks].filter(t => aLinks.has(t)).length });

  // meta: partial credit (changed from binary).
  const metaKeys = ['title', 'description', 'canonical', 'ogTitle', 'ogImage', 'keywords'];
  const metaChecks = metaKeys.map(k => ({ key: k, prod: prod.meta?.[k] || '', aem: aem.meta?.[k] || '', match: normCompare(prod.meta?.[k], aem.meta?.[k]) }));
  const metaHits = metaChecks.filter(m => m.match).length;
  const metaScore = metaHits / metaKeys.length;
  add('meta', 'Meta tags', metaScore === 1,
    `${metaHits}/${metaKeys.length} matched`,
    metaScore,
    { details: metaChecks });

  // thaiBalance: Thai/Latin ratio delta.
  const pThai = prod.thaiRatio ?? 0;
  const aThai = aem.thaiRatio ?? 0;
  const tDelta = Math.abs(pThai - aThai);
  add('thaiBalance', 'Thai/English balance', tDelta <= THAI_RATIO_DELTA,
    `delta ${Math.round(tDelta * 100)}% (≤${Math.round(THAI_RATIO_DELTA * 100)}%)`,
    tDelta <= THAI_RATIO_DELTA ? 1 : 0,
    { prod: pThai, aem: aThai, delta: tDelta });

  // ── Weighted score (partial credit; insufficient checks excluded) ──
  let score = 0, possible = 0;
  for (const c of checks) {
    if (c.insufficient) continue;             // skip — weight not counted
    score += c.weight * (c.passed ? 1 : c.partial);
    possible += c.weight;
  }
  const parity = Math.min(100, Math.round((possible > 0 ? score / possible : 0) * 100));
  const gaps = checks.filter(c => !c.passed && !c.insufficient).map(c => ({ label: c.label, detail: c.detail, weight: c.weight }));

  // ── AEM-specific issues (unchanged from prior logic — flagged, not scored) ──
  const aemIssues = [];
  if (aem.leakedContentPaths?.length) aemIssues.push({ severity: 'high', label: 'Leaked /content/ paths', detail: `${aem.leakedContentPaths.length} found` });
  if (!aem.features?.login && prod.features?.login) aemIssues.push({ severity: 'high', label: 'Missing login', detail: 'prod has login, AEM does not' });
  if (!aem.features?.languageSwitch && prod.features?.languageSwitch) aemIssues.push({ severity: 'high', label: 'Missing language switcher' });
  const socialMissing = Object.entries(prod.social || {}).filter(([k, v]) => v && !aem.social?.[k]).map(([k]) => k);
  if (socialMissing.length) aemIssues.push({ severity: 'medium', label: 'Missing social icons', detail: socialMissing.join(', ') });
  if (tDelta > THAI_RATIO_DELTA) aemIssues.push({ severity: 'high', label: 'Thai/English balance differs', detail: `prod ${Math.round(pThai * 100)}% vs AEM ${Math.round(aThai * 100)}%` });

  // Broken links (HTTP status from AEM link check).
  const brokenLinks = [];
  if (aem.linkStatuses) {
    for (const [url, status] of Object.entries(aem.linkStatuses)) {
      if (status >= 400) brokenLinks.push({ url: url.slice(0, 80), status });
      else if (status === 0) brokenLinks.push({ url: url.slice(0, 80), status: 'unreachable' });
    }
  }
  if (brokenLinks.length) aemIssues.push({ severity: 'high', label: 'Broken links on AEM', detail: `${brokenLinks.length} links return error` });

  // Image distortion (unchanged — flagged, not scored).
  const imageIssues = [];
  // (distortion detection retained from prior logic — see git history for full body)

  return { parity, checks, gaps, aemIssues, brokenLinks, imageIssues, thaiIssues: [], insufficient };
}  // end of scoreParity
```

> **Note on image distortion:** the prior main-mode body contained detailed image-ratio pairing logic that flagged `imageIssues`. To keep this plan readable we kept only the `imageIssues = []` shell and a pointer to git history. In execution, **copy the existing image-distortion block verbatim** from the current `compare.js` (lines ~578-643) into the spot marked by the comment, so distortion still gets flagged. This preserves current behavior.

- [ ] **Step 4: Verify the file parses**

Run:
```bash
node --check src/compare.js && echo "OK"
```
Expected: `OK`

- [ ] **Step 5: Re-score existing results from cache (no browser) to confirm it runs**

Run:
```bash
npm run compare -- --limit=5 2>&1 | tail -8
```
Expected: runs without error; the 3 new Template checks show as `insufficient` (because cached metrics predate the extract change). Parity recalculates for the other 8 checks.

- [ ] **Step 6: Commit**

```bash
git add src/compare.js
git commit -m "feat(compare): rewrite main-mode scoreParity with 11 grouped checks"
```

---

## Task 4: Render grouped checks in `build-dashboard.js`

**Files:**
- Modify: `src/build-dashboard.js`
  - `renderPage()`: replace flat `checks-list` with 3 group blocks + sub-scores
  - `renderDashboard()`: add "หมวดที่ fail" filter dropdown
  - Add a small amount of CSS for group blocks

- [ ] **Step 1: Import CRITERIA_GROUPS**

At the top of `src/build-dashboard.js`, find the existing import:
```js
import { DIR } from '../config.js';
```
Change to:
```js
import { DIR, CRITERIA_GROUPS } from '../config.js';
```

- [ ] **Step 2: Find the checks-list rendering in renderPage**

Open `src/build-dashboard.js` and locate the `renderPage()` function and the block that renders `p.checks` as a flat list (search for `checks-list` or `check-block`). Note the exact lines — we'll replace this block.

- [ ] **Step 3: Replace the flat checks-list with grouped rendering**

Replace the checks-list block in `renderPage()` with:

```js
  // Grouped checks (3 groups) with sub-scores. Per-check weight% is NOT shown.
  const groupBlocks = CRITERIA_GROUPS.map(g => {
    const groupChecks = (p.checks || []).filter(c => g.checks.includes(c.id));
    const scored = groupChecks.filter(c => !c.insufficient);
    const earned = scored.reduce((s, c) => s + c.weight * (c.passed ? 1 : c.partial), 0);
    const possible = scored.reduce((s, c) => s + c.weight, 0);
    const pct = possible > 0 ? Math.round(earned / possible * 100) : 0;
    const rows = groupChecks.map(c => {
      const status = c.insufficient ? '–' : (c.passed ? '✓' : '✗');
      const cls = c.insufficient ? 'ins' : (c.passed ? 'ok' : 'bad');
      const tag = c.insufficient ? '<span class="ins-tag">insufficient</span>' : '';
      return `<div class="check-row"><span class="check-status ${cls}">${status}</span><span class="check-label">${esc(c.label)}${tag}</span><span class="check-detail">${esc(c.detail || '')}</span></div>`;
    }).join('');
    return `<div class="group-block">
      <div class="group-head ${g.id}"><span>${esc(g.label)}</span><span class="group-pct">${(earned * 100).toFixed(0)}/${(possible * 100).toFixed(0)} · ${pct}%</span></div>
      ${rows}
    </div>`;
  }).join('');
```

Then render `groupBlocks` where the old checks-list used to be. (The exact surrounding HTML depends on what's in `renderPage`; insert `${groupBlocks}` into the template at the same location.)

- [ ] **Step 4: Add CSS for group blocks**

In the `PAGE_CSS` constant (search for `const PAGE_CSS = SHARED +`), add these rules:

```css
.group-block { border:1px solid #e0e0e0; border-radius:8px; margin-bottom:10px; overflow:hidden; }
.group-head { padding:8px 12px; font-size:13px; font-weight:700; display:flex; justify-content:space-between; align-items:center; }
.group-head.template { background:#eef2ff; color:#1a2b5c; }
.group-head.content { background:#f0f7e6; color:#1a6b3c; }
.group-head.structure { background:#fdf0e6; color:#8a5a00; }
.group-pct { font-size:12px; opacity:.8; }
.check-row { display:flex; gap:10px; align-items:center; padding:7px 12px; font-size:12px; border-top:1px solid #f0f0f0; }
.check-status { font-weight:700; width:16px; text-align:center; }
.check-status.ok { color:#1a6b3c; } .check-status.bad { color:#c00; } .check-status.ins { color:#aaa; }
.check-label { font-weight:600; min-width:150px; }
.check-detail { color:#666; flex:1; }
.ins-tag { background:#eee; color:#888; font-size:9px; padding:1px 5px; border-radius:3px; margin-left:6px; text-transform:uppercase; font-weight:700; }
```

- [ ] **Step 5: Add "หมวดที่ fail" filter to the overview**

In `renderDashboard()`, find the filters block (search for `class="filters"`). Add a `<select>` for group filtering:

```html
<select id="groupFilter">
  <option value="">หมวดที่ fail: ทั้งหมด</option>
  <option value="template">Template</option>
  <option value="content">Content</option>
  <option value="structure">Structure</option>
</select>
```

Then, in the client-side filter logic (the JS that filters `ROWS`), add: a row passes the group filter if the selected group is empty OR if any of the row's checks in that group failed. Because `rowData` currently doesn't carry per-check pass state, augment `rowData` in the `pages.map` (around line 77) to include `failedGroups`: an array of group ids where at least one check failed (excluding insufficient).

In the `rowData` map (around line 89-99), add:

```js
      failedGroups: CRITERIA_GROUPS
        .filter(g => (p.checks || []).some(c => g.checks.includes(c.id) && !c.passed && !c.insufficient))
        .map(g => g.id),
```

Then in the filter JS, add: `if (groupVal && !row.failedGroups.includes(groupVal)) return false;`

- [ ] **Step 6: Build the dashboard and verify it renders**

Run:
```bash
npm run dashboard:main 2>&1 | tail -4
```
Expected: `632 drill-down pages` with no error. Open `output/dashboard.html` — the overview shows, and clicking into a page shows 3 group blocks.

- [ ] **Step 7: Commit**

```bash
git add src/build-dashboard.js
git commit -m "feat(dashboard): group checks into 3 sections + group filter"
```

---

## Task 5: Regenerate `criteria.html` from `WEIGHTS_MAIN`

**Files:**
- Modify: `src/build-docs.js`

- [ ] **Step 1: Open build-docs.js and find the criteria table**

`src/build-docs.js` currently renders a 6-row table from `WEIGHTS`. We replace it with an 11-row table grouped by `CRITERIA_GROUPS`, sourced from `WEIGHTS_MAIN`.

- [ ] **Step 2: Update imports**

Change the import line to add `WEIGHTS_MAIN`, `CRITERIA_GROUPS`:
```js
import { DIR, WEIGHTS_MAIN, CRITERIA_GROUPS, PASS_THRESHOLD, THAI_RATIO_DELTA, IMAGE_RATIO_TOLERANCE, TEXT_MATCH_TOLERANCE } from '../config.js';
```
(Remove `WEIGHTS` from the import if it's no longer referenced; otherwise leave it.)

- [ ] **Step 3: Replace the criteria table rows**

Replace the existing `<tr>` rows (the 6 WEIGHTS-based rows) with rows generated from `CRITERIA_GROUPS`. For each group, render a group-header row then its checks:

```js
const criteriaRows = CRITERIA_GROUPS.map(g => {
  const head = `<tr class="group"><td colspan="4"><b>${g.label}</b> — ${Math.round(g.weight * 100)}%</td></tr>`;
  const body = g.checks.map(id => {
    const labels = {
      headerMenu:      ['Header menu (label + count)', 'count เท่ากัน + label 100%'],
      footerMenu:      ['Footer menu (label + count)', 'count เท่ากัน + label 100%'],
      components:      ['Components (accordion/table/form/video)', 'แต่ละ type ≥ 80%'],
      contentLength:   ['Content length', 'AEM อยู่ใน ±' + Math.round(TEXT_MATCH_TOLERANCE * 100) + '% ของ prod'],
      missingText:     ['Missing text blocks', 'missing = 0'],
      missingKeywords: ['Missing keywords', 'missing = 0'],
      missingImage:    ['Missing image', 'count ≥ 80% + alt match > 50%'],
      headings:        ['Headings (Jaccard)', 'Jaccard > 0.6'],
      links:           ['Links match', 'match > 50%'],
      meta:            ['Meta tags', 'ทั้งหมดตรง (partial credit)'],
      thaiBalance:     ['Thai/English balance', 'delta ≤ ' + Math.round(THAI_RATIO_DELTA * 100) + '%'],
    }[id] || [id, ''];
    return `<tr><td><b>${labels[0]}</b></td><td>${Math.round(WEIGHTS_MAIN[id] * 100)}%</td><td>${labels[1]}</td><td></td></tr>`;
  }).join('');
  return head + body;
}).join('');
```

Then reference `${criteriaRows}` in the HTML template where the old rows were.

- [ ] **Step 4: Build criteria and verify**

Run:
```bash
npm run docs 2>&1 | tail -3
```
Expected: success. Open `output/criteria.html` — shows 3 group headers + 11 check rows.

- [ ] **Step 5: Commit**

```bash
git add src/build-docs.js
git commit -m "feat(docs): regenerate criteria.html from WEIGHTS_MAIN + groups"
```

---

## Task 6: Re-capture 20 pilot pages and verify

**Files:** none (uses existing pipeline; relies on the merge/preserve logic already in `compare.js`)

- [ ] **Step 1: Re-capture 20 pages (preserves the other 612)**

Run:
```bash
npm run compare -- --limit=20 --force 2>&1 | tail -10
```
Expected: log shows `20 refreshed · 612 preserved · 632 total`. The 20 re-captured pages now have the new metrics (`componentCounts`, `headerMenus`, `footerMenus`).

- [ ] **Step 2: Build both dashboards + criteria**

Run:
```bash
npm run dashboard && npm run docs 2>&1 | tail -8
```
Expected: main dashboard builds 632 pages; news dashboard builds its pages; criteria.html rebuilds.

- [ ] **Step 3: Eyeball verification (per AGENTS.md — no test suite)**

Open `output/dashboard.html` and check:
1. Overview shows 632 rows; the new "หมวดที่ fail" filter narrows rows.
2. Open a **re-captured** page (id 1-20): 3 group blocks render; Template group checks show ✓/✗ (real data, not `insufficient`).
3. Open a **preserved** page (id 21+): Template group checks show `– insufficient` (expected — old metrics).
4. Sub-scores in each group are consistent with the page parity.
5. `criteria.html` shows 11 checks in 3 groups summing to 100%.
6. News dashboard (`news-dashboard.html`) still builds and is unaffected.

- [ ] **Step 4: Commit the rebuilt output**

```bash
git add output/ && git commit -m "update dashboard + criteria: pilot criteria on 20 re-captured pages" && git push
```
(Auto-deploys to Vercel on push, per `AGENTS.md`.)

---

## Self-review notes

- **Spec coverage:** all 5 components (config, extract, compare, dashboard, docs) map to tasks 1-5; pilot rollout = task 6.
- **errorPage:** correctly absent from WEIGHTS_MAIN (404/blocked stays early-return parity=0, guard untouched in Task 3).
- **Meta partial:** Task 3 sets `partial: metaScore` (changed from prior binary).
- **Insufficient handling:** Task 3 Step 3 implements the "skip from possible + earned" rule so groupPct stays meaningful on old captures.
- **Type consistency:** `CRITERIA_GROUPS` ids in Task 1 match `WEIGHTS_MAIN` keys match check `id`s in Task 3 match `failedGroups`/filter in Task 4.
- **Image distortion:** called out in Task 3 Step 3 — copy the existing block verbatim so the flagged-issue behavior is preserved.
