# Design: New Criteria for Main Dashboard (Pilot)

**Date:** 2026-07-07
**Status:** Approved (pilot) — ready for implementation
**Scope:** Main dashboard only (`WEIGHTS_MAIN`). News mode (`scoreNews`) is untouched.

## Goal

Restructure the main-dashboard parity scoring from 6 technical metrics
(headings/links/text/meta/accordions/headerFooter) into 11 checks organized in
3 groups — **Template / Content / Structure** — that match how the migration/QA
team thinks about parity: "is the template (header/footer) intact, is the
content complete, is the structure/SEO preserved?"

This is a pilot. Weights and thresholds can be tuned later from `config.js`
without re-capturing pages (re-score from cached metrics).

## Constraints (from prior conversation)

1. **Pattern source:** user-suggested split into Template (header/footer menu
   labels + count) and Content (missing image / missing-incorrect content /
   missing component-modules), mixed with existing checks kept (Meta, Headings,
   Links, Thai/English balance).
2. **Header/Footer:** strict — count must match AND every label must match.
3. **Missing Image:** filename matching is impossible (AEM renames/resizes/
   caches with hash names). Use image count ≥80% + alt match >50%.
4. **Missing/Incorrect Content:** includes content length ±30%, missing text
   blocks, missing keywords, AND error pages.
5. **Missing Component/Modules:** accordion + table + form + video/embed (and
   remark any other component found heuristically).
6. **Error page (404/blocked):** keep as early-return parity=0 (load failure =
   broken), NOT a scored check.
7. **Pilot scope:** re-capture 20 pages first (preserve the other 612 via the
   existing merge/preserve logic). Mock the new-component checks until then.
8. **Drill-down UI:** group checks into 3 sections with sub-scores; per-check
   weight% is NOT shown in the drill-down rows (only in the criteria.html
   overview table).

## Non-goals

- No UI to edit weights from the browser (config.js remains the single source).
- No criteria profiles / no switching criteria sets at runtime.
- News pipeline + `scoreNews()` is not touched.
- No re-capture of all 632 pages in this pilot (only 20).

---

## Architecture

Stays within the existing boundaries (per `AGENTS.md`):

```
config.js              ← new WEIGHTS_MAIN (replaces WEIGHTS for main mode)
src/extract.js         ← add component counts + headerMenus/footerMenus arrays
src/compare.js         ← scoreParity() rewritten for main mode (11 checks)
src/build-dashboard.js ← render 3 groups + sub-scores in drill-down; add group filter
src/build-docs.js      ← regenerate criteria.html from WEIGHTS_MAIN
src/review-new-criteria.js  ← (already exists) one-off preview script; delete after pilot
```

`extract.js` remains fully self-contained (browser-only, no imports/closures).
`compare.js` still imports `EXTRACT_FN` from `extract.js`.

---

## Component 1 — `config.js`: `WEIGHTS_MAIN`

Replace `WEIGHTS` (6 checks) with `WEIGHTS_MAIN` (11 checks, sums to 1.00).
Keep `WEIGHTS` temporarily as `WEIGHTS_LEGACY` (commented, not exported) for
comparison during pilot; delete after pilot.

```js
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
  meta:            0.05,  // meta tags match (partial)
  thaiBalance:     0.02,  // Thai/Latin ratio delta
};
```

Group definitions (also in `config.js`, used by both compare + dashboard):

```js
export const CRITERIA_GROUPS = [
  { id: 'template',  label: 'Template',         weight: 0.25, checks: ['headerMenu','footerMenu','components'] },
  { id: 'content',   label: 'Content',          weight: 0.50, checks: ['contentLength','missingText','missingKeywords','missingImage'] },
  { id: 'structure', label: 'Structure / SEO',  weight: 0.25, checks: ['headings','links','meta','thaiBalance'] },
];
```

`errorPage` is deliberately **not** a check — 404/blocked stays an early-return
`parity=0` in `scoreParity()` (same as today).

---

## Component 2 — `extract.js`: new metrics

All additions are browser-only DOM queries, appended to the returned metrics
object. Existing fields are unchanged (backward compatibility).

### Component counts (for `components` check)

```js
tables:     document.querySelectorAll('table').length,
tableRows:  document.querySelectorAll('table tr').length,
forms:      document.querySelectorAll('form').length,
formInputs: document.querySelectorAll('input, select, textarea').length,
videos:     document.querySelectorAll(
               'video, iframe[src*="youtube"], iframe[src*="youtu.be"], iframe[allow*="autoplay"]'
             ).length,
carousels:  document.querySelectorAll('[class*="carousel" i], [class*="slider" i], [data-carousel]').length,
tabs:       document.querySelectorAll('[role="tablist"], [class*="tabs" i], [class*="cmp-tabs"]').length,
```

### Header / Footer menu labels (for `headerMenu` / `footerMenu` checks)

```js
headerMenus: /* [{label, href}, ...] from <header> a[href], dedup by label */,
footerMenus: /* [{label, href}, ...] from <footer> a[href], dedup by label */,
```

Existing `headerLinkCount` / `footerLinkCount` are kept (the new arrays are the
source of truth; the counts are derived = `headerMenus.length`).

### Heuristic "other components" (remark only — not scored)

```js
otherComponents: /* array of detected-but-unclassified component hints, e.g.
                    [role="dialog"], canvas, large svg interactions.
                    Shown in drill-down as info, not in score. */
```

---

## Component 3 — `compare.js`: `scoreParity()` rewrite (main mode)

`scoreParity(prod, aem, newsMode)`:
- `newsMode === true` → `return scoreNews(...)` (unchanged).
- `newsMode === false` → new main scoring below.

### Early guard (unchanged)

404 / blocked / WAF detection stays. If either side is an error page →
`return { parity: 0, errorType, ... }` exactly as today. This is NOT a check;
it short-circuits the whole page.

### Main-mode scoring (11 checks via `add()`)

For each check we compute `passed` (binary) and `partial` (0..1 for weighted
credit). The final score is:

```
parity = Σ weight_i × (passed_i ? 1 : partial_i)   × 100
```

| Check | passed condition | partial |
|---|---|---|
| `headerMenu` | prod count == aem count AND label set equal (100%) | `= labelMatchPct` |
| `footerMenu` | prod count == aem count AND label set equal (100%) | `= labelMatchPct` |
| `components` | for every component type with prod>0: aem ≥ 80% of prod | `= avg ratio across types` |
| `contentLength` | `|1 − ratio| ≤ 0.30` | `= ratio` (capped 1) |
| `missingText` | missing blocks == 0 | `= 1 − missingRatio` |
| `missingKeywords` | missing keywords == 0 | `= 1 − missingRatio` |
| `missingImage` | count ≥ 80% AND alt match > 50% | `= avg(countRatio, altHit)` |
| `headings` | Jaccard > 0.6 | `= Jaccard` |
| `links` | link-text hit > 50% | `= hit` |
| `meta` | all 6 tags match | `= metaScore` (**changed from binary → partial**) |
| `thaiBalance` | delta ≤ 0.10 | binary (0 or 1) |

**Key change vs today:** `meta` no longer requires 100% match to earn any
credit — it gets partial credit = fraction of matched tags.

**Component ratio detail:** for `components`, iterate over the component types
that exist in prod (`accordion/table/form/video`, plus carousel/tabs as
advisory). For each type: `ratio = prod > 0 ? min(1, aem / (prod × 0.8)) : 1`.
Average the ratios for the partial value. Pass only when every prod-present
type meets ≥80%.

### Per-check `diff` payloads (for drill-down rendering)

Each `add()` call attaches a `diff` object the dashboard renders. Existing
diffs (headings outline, links list, keyword chips, meta table) are reused. New
diffs:

- `headerMenu` / `footerMenu`: `{ prodLabels, aemLabels, missing, extra, prodCount, aemCount }`
- `components`: `{ perType: [{type, prod, aem, ratio, ok}], otherComponents }`
- `missingImage`: `{ prodCount, aemCount, altMatchPct, prodAlts, aemAlts }`
- `thaiBalance`: `{ prod, aem, delta }`

### Resume / preserve interaction

`processPair()`'s cached re-score branch already syncs metadata from the CSV
(category fix from earlier). The new checks are computed from the same metrics
object, so a cached re-score picks them up automatically — **except** the new
extract fields (`tables/forms/videos/headerMenus/footerMenus`) which only exist
on pages captured after the `extract.js` change. For pages captured before the
change, the new checks degrade gracefully: missing fields count as "no data"
and the check is skipped (weight redistributed, or marked `insufficient`).

> **Pilot note:** Because of this, only the 20 re-captured pages will have
> real component/headerMenu/footerMenu data. The other 612 will show those
> checks as `insufficient` until re-captured. This is acceptable for a pilot.

---

## Component 4 — `build-dashboard.js`: grouped rendering

### Drill-down page (`renderPage()`)

Replace the flat `checks-list` with three group blocks. Each block shows:
- group header: emoji + label + sub-score `earned/possible · pct%`
- the group's checks as rows: `✓/✗ | label | detail` (**no weight%** in rows)

Sub-score per group:

```
groupEarned = Σ_{check in group} weight × (passed ? 1 : partial)
groupPossible = Σ_{check in group} weight
groupPct = groupEarned / groupPossible
```

Existing check diffs (expandable bodies) are preserved. New check diffs get
renderers that reuse existing CSS patterns (chip-list, side-by-side outline).

Insufficient-data checks (pilot, see above) render with a neutral `–` status
and a small `insufficient` tag instead of ✓/✗.

### Overview dashboard (`renderDashboard()`)

- `pages-table` columns unchanged (Parity / Gaps / Status).
- Add a filter dropdown: "หมวดที่ fail" → Template / Content / Structure /
  ทั้งหมด. Filters rows where the chosen group has at least one failed check.
- The "Gaps" count now reflects 11 checks instead of 6, so numbers will rise —
  this is expected.

---

## Component 5 — `build-docs.js`: `criteria.html`

Regenerate the criteria overview table from `WEIGHTS_MAIN` + `CRITERIA_GROUPS`,
showing 11 checks in 3 groups with pass/fail rules (this is the only place
weight% values are displayed to users).

---

## Pilot rollout

1. Implement Components 1–5.
2. Re-capture 20 pages (preserve 612): `npm run compare -- --limit=20 --force`.
3. Build dashboard + criteria: `npm run dashboard && npm run docs`.
4. Review the 20-page pilot in the dashboard. Adjust `WEIGHTS_MAIN` from
   `config.js` and re-score (no re-capture needed) until satisfied.
5. Roll forward: re-capture all 632 when ready; delete
   `src/review-new-criteria.js` and `WEIGHTS_LEGACY`.

## Testing / verification

No automated test suite (per `AGENTS.md`). Verification = run the pipeline and
eyeball the dashboard:

- 20 pilot pages render with real data (no MOCK/insufficient tags).
- 612 preserved pages show new-component checks as `insufficient` (expected).
- Group sub-scores add up: groupEarned/possible is consistent with the page
  parity.
- Filter "หมวดที่ fail" narrows the table correctly.
- `criteria.html` shows 11 checks in 3 groups, summing to 100%.
- News dashboard still builds and is unaffected.

## Files touched

| File | Change |
|---|---|
| `config.js` | add `WEIGHTS_MAIN`, `CRITERIA_GROUPS`; keep `WEIGHTS` as legacy |
| `src/extract.js` | add component counts + headerMenus/footerMenus + otherComponents |
| `src/compare.js` | rewrite main-mode `scoreParity()` (11 checks); keep `scoreNews` |
| `src/build-dashboard.js` | group rendering + sub-scores + group filter |
| `src/build-docs.js` | regenerate criteria.html from WEIGHTS_MAIN |
| `src/review-new-criteria.js` | (exists) delete at end of pilot |
