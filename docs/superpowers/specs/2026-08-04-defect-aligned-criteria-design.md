# Defect-Aligned Review Criteria — Design

**Date:** 2026-08-04
**Status:** Approved, ready for implementation planning
**Scope:** Main pipeline scoring only. News pipeline (`WEIGHTS_NEWS`, `scoreNews`) is untouched.

## Problem

QA reports that the majority of migration defects recur across many pages and fall into five
categories:

1. Missing assets
2. Content alignment issues
3. Improper content formatting
4. Missing content
5. PDF download link issues

The current criteria (`WEIGHTS_MAIN`, 11 checks in 3 groups) do not match that distribution:

| Defect category | Current coverage | Weight |
|---|---|---|
| Missing content | `contentLength`, `missingText`, `missingKeywords` | 40% |
| Missing assets | `missingImage` — `<img>` tag count + alt only | 10% |
| Improper formatting | none direct | ~0% |
| Content alignment | none | 0% |
| PDF download links | none PDF-specific | 0% |

Half the weight sits on checks outside the reported defect set: header/footer menus (15%) and
headings/links/meta/Thai-balance (25%).

### Clarified definitions

- **Content alignment** means two distinct things to QA: (a) visual layout is off — content
  centered vs left, wrong column width, collapsed spacing; and (b) content is present but in the
  wrong order relative to production.
- **Missing assets** covers images missing entirely, images present but broken (tag renders, file
  never loads), PDF/download links missing or dead, and non-image assets dropped.
- **Improper formatting** is low priority. It is scored as advisory only in this phase.

### Evidence already in the cache

`data/results.json` holds full extracted metrics for all 358 scored pages (of 632 total; 258 are
`aem404`). Querying it directly shows defects the current criteria cannot see:

- 172 pages have `.pdf` links on production; **20 of them have zero `.pdf` links on AEM.** The
  `links` check only compares link *text*, so these score as passing.
- **263 pages** have at least one AEM image with `naturalWidth === 0` — a tag that rendered but
  whose file never loaded. `missingImage` counts tags, so these score as passing.
- All 632 pages have `prod.jpg` and `aem.jpg` on disk under `data/screenshots/<id>/`.

Separately, only **58 of 358** scored pages carry the `headerMenu`/`footerMenu`/`components`
metrics; the rest predate them and score as `insufficient`.

## Approach

Rebuild the criteria around the five defect categories, deriving every new check from metrics
**already captured**. No page re-capture, so no WAF exposure and no risk to the existing dataset.

Rejected alternatives:

- **Re-weight only.** Shifting weight between the existing 11 checks cannot detect broken images,
  PDF links, or alignment. It changes how loudly existing checks complain, not what they detect.
- **Full rebuild with re-capture.** Adds true element geometry, CSS background images, and list
  structure, but costs a full chunked `safe-run` (~632 pages, 20-min pauses, 5+ hours) with ban
  risk. Deferred to phase 2 (see below), to run when a re-capture is needed anyway.

## Criteria

Five groups, named after the defect categories so the dashboard reads back in QA's own language.
Weights sum to 1.00.

### Missing content — 30%

| id | weight | pass condition | partial credit |
|---|---|---|---|
| `contentLength` | 0.10 | `abs(1 - aem.textLength / prod.textLength) <= TEXT_MATCH_TOLERANCE` | `min(1, ratio)` |
| `missingText` | 0.12 | no prod text block absent from AEM | `1 - missing / prodBlockCount` |
| `missingKeywords` | 0.08 | no prod top-30 keyword absent from AEM | `1 - missing / prodKeywordCount` |

Logic carried over from the current implementation unchanged; only the weights move. Prod blocks
are filtered to `length >= 8` and non-dynamic (`isDynamicBlock`).

### Missing assets — 25%

| id | weight | pass condition | partial credit |
|---|---|---|---|
| `missingImage` | 0.10 | `aemCount >= ceil(prodCount * 0.8)` | `min(1, aemCount / ceil(prodCount * 0.8))` |
| `brokenImage` | 0.11 | no AEM image failed to load | `1 - broken / aemImageCount` |
| `imageAlt` | 0.04 | prod-alt hit rate > 0.5 | hit rate |

`missingImage` and `imageAlt` are the current `missingImage` check split apart — count and alt
parity are different defects and were previously averaged into one score, which let a good alt
rate mask a missing image.

**`brokenImage`** flags AEM images where `renderedWidth > 0 && naturalWidth === 0 &&
naturalHeight === 0`, excluding `.svg` sources and `data:` URIs (both legitimately report zero
natural dimensions). It is `insufficient` when AEM has zero images — there is nothing to be
broken. It does **not** key off prod's image count: an image AEM renders and fails to load is a
defect regardless of what prod had.

When prod has zero images, `missingImage` passes only if AEM also has zero, and `imageAlt` is
`insufficient`.

#### Calibration gate

263 of 358 pages currently carry at least one zero-natural-width AEM image. That rate is too high
to be entirely real — lazy-loaded images below the fold and inline SVG are expected false
positives. Before `brokenImage` ships at 0.11:

1. Sample 20 flagged pages at random.
2. Open each page's `aem.jpg` and confirm a visibly broken or blank image region.
3. If precision is below 80%, ship `brokenImage` as advisory-only and move its 0.11 to
   `missingImage`, recording the observed precision in this document.

### Content alignment — 20%

| id | weight | pass condition | partial credit |
|---|---|---|---|
| `contentOrder` | 0.10 | order score >= `CONTENT_ORDER_PASS` | order score |
| `visualLayout` | 0.10 | profile match >= `LAYOUT_PROFILE_PASS` | profile match |

**`contentOrder`** measures sequence, isolated from presence. Take the prod text blocks that also
exist in AEM (blocks missing entirely are already scored by `missingText`), map each to the index
of its **first** occurrence in AEM's block sequence — repeated boilerplate must not produce
ambiguous mappings — and compute the longest increasing subsequence of those indices. Score =
`LIS length / shared block count`. A page whose sections were reordered scores low even though
every block is present. `insufficient` when fewer than `CONTENT_ORDER_MIN_BLOCKS` blocks are
shared — LIS over a tiny sample is noise.

**`visualLayout`** compares the horizontal distribution of content, not pixels. Production and AEM
full-page screenshots have different heights, so a direct diff is meaningless; a page that is
merely longer must not be flagged. For each screenshot:

1. Load with `sharp`, convert to greyscale, resize to `SCREENSHOT_MAX_WIDTH` (800px) if needed.
2. For each column, sum the absolute deviation of each pixel from that row's median — an "ink
   mass" per column that ignores flat background.
3. Aggregate columns into `LAYOUT_PROFILE_BINS` (64) bins and normalise so the profile sums to 1.

Score = histogram intersection between the two profiles (`1 - 0.5 * L1 distance`). This is
height-invariant and detects centered-vs-left content, wrong column width, and collapsed margins.
`insufficient` when either screenshot is missing or unreadable.

Both thresholds start at `CONTENT_ORDER_PASS = 0.90` and `LAYOUT_PROFILE_PASS = 0.85` and are
calibrated against hand-checked pages during verification.

### Download links — 15%

| id | weight | pass condition | partial credit |
|---|---|---|---|
| `missingDownloadLink` | 0.09 | every prod download filename present on AEM | `found / prodDownloadCount` |
| `deadDownloadLink` | 0.06 | no AEM download URL returns >= 400 | `1 - dead / aemDownloadCount` |

A download link is an `href` whose path ends in one of `DOWNLOAD_EXTENSIONS`
(`.pdf .doc .docx .xls .xlsx .zip`), case-insensitive, query and fragment stripped.

**Matching is by normalised basename, not full URL.** AEM re-hosts assets under `/content/dam/...`
with different paths, so full-URL comparison would report every PDF as missing. The basename is
lowercased and stripped of a trailing `-<hash>` suffix where present.

Both checks are `insufficient` when the relevant side has no download links — a page with no PDFs
is neither passing nor failing a PDF check, and excluding it from the denominator keeps its score
comparable to pages that do have them.

`deadDownloadLink` reads cached HTTP statuses from `data/link-status.json` (see
`check-downloads.js` below) and is `insufficient` for any page whose URLs have no cached status.

### Structure & template — 10%

| id | weight | pass condition | partial credit |
|---|---|---|---|
| `headings` | 0.04 | Jaccard > 0.6 | Jaccard |
| `links` | 0.02 | prod link-text hit > 0.5 | hit rate |
| `meta` | 0.02 | all 6 meta keys match | `matched / 6` |
| `template` | 0.02 | header + footer + component parity all pass | mean of the three sub-scores |

`template` merges the current `headerMenu`, `footerMenu`, and `components` checks into one. Their
logic is unchanged and their sub-results are preserved in the check's `diff` for the drill-down
view; only their combined contribution to the score drops from 25% to 2%. They remain
`insufficient` for pages captured before those metrics existed.

### Advisory — not scored

Surfaced in the dashboard and in `aemIssues`, excluded from the weighted score:

- `formatting` — heading-level mismatch and table-count drop. Low priority per QA; a real
  formatting check needs phase-2 DOM metrics.
- `thaiBalance` — moves out of the score into advisory.
- `leakedContentPaths`, image distortion/ratio, broken in-page links, missing login / language
  switcher / social icons — all as today.

## Architecture

`scoreParity` in `compare.js` is roughly 350 of that file's 1074 lines. The new checks are
extracted into focused modules rather than growing it further.

```
config.js                       WEIGHTS_MAIN rewritten, CRITERIA_GROUPS rewritten, new thresholds
src/scoring/score-main.js       assembles checks, weighted total, gaps, group sub-scores
src/scoring/checks-content.js   contentLength, missingText, missingKeywords
src/scoring/checks-assets.js    missingImage, brokenImage, imageAlt
src/scoring/checks-alignment.js contentOrder, visualLayout
src/scoring/checks-downloads.js missingDownloadLink, deadDownloadLink
src/scoring/checks-structure.js headings, links, meta, template
src/compare.js                  imports score-main.js; news mode and error-page guard unchanged
```

Each `checks-*.js` module exports a pure function taking `(prod, aem, context)` and returning an
array of check objects in the existing shape:

```js
{ id, weight, label, passed, detail, partial, diff, insufficient? }
```

`context` carries the cached side-inputs — layout profiles and link statuses — so the check
modules stay pure and synchronous, and so a scoring change never triggers I/O.

### New standalone passes

Both cache their output, so re-scoring after a weight tweak costs no image reads and no network.

```
data/results.json ─┬─ src/layout-profile.js  → data/layout-profiles.json
                   ├─ src/check-downloads.js → data/link-status.json
                   └─ src/rescore.js ─────────→ score-main.js → data/results-v2.json
                                                              → build-dashboard.js
```

**`src/layout-profile.js`** walks `data/screenshots/<id>/{prod,aem}.jpg`, computes the 64-bin
column profile for each, and writes `data/layout-profiles.json` keyed by page id. Entries record
the source file `mtimeMs` so a re-run only recomputes screenshots that changed. Unreadable or
missing images are recorded as `null` rather than omitted, so `rescore.js` can distinguish "not
yet computed" from "cannot be computed".

**`src/check-downloads.js`** harvests every download URL from both sides across all pages,
**dedupes by URL** (the 172 PDF-bearing pages share far fewer distinct files), and issues `HEAD`
requests. It hits BBL hosts, so it inherits the WAF discipline documented in AGENTS.md: bounded
concurrency (`LINK_HEAD_CONCURRENCY`), per-request pacing (`LINK_HEAD_PACING_MS`), a request
timeout, and an abort if the blocked ratio exceeds `SAFE_BLOCK_ABORT_RATIO`. Results are written
to `data/link-status.json` as `{ url: { status, checkedAt } }` and reused on subsequent runs
unless `--force`.

**`src/rescore.js`** reads a results file, recomputes `checks` / `parity` / `gaps` / `aemIssues`
for every page from its cached `prod` and `aem` metrics, and writes the result. It never
re-captures. Flags:

- `--source=` (default `data/results.json`)
- `--out=` (default `data/results-v2.json`)
- `--ids=` for spot-checking a subset

Pages with an `errorType` (`404`, `blocked`) keep their existing single `error` check and are not
re-scored — the error-page guard in `scoreParity` runs before any check logic, and re-scoring
cannot change its verdict.

### Rollout

Side file first, then promote:

1. `rescore.js` writes `data/results-v2.json`. `data/results.json` is not modified.
2. `build-dashboard.js --source=data/results-v2.json --prefix=v2` renders a parallel dashboard.
3. Compare parity distributions and hand-check pages (see Verification).
4. Only after review: point `compare.js` at the new scoring so future captures use it, and
   replace `data/results.json`.

Because step 4 overwrites the one mutable, gitignored, un-backed-up cache in the project,
`rescore.js` copies to `data/results.json.backup-<timestamp>` before any in-place write.

### Configuration

All new tunables go in `config.js`; no thresholds inside scripts.

```
WEIGHTS_MAIN            rewritten — 14 scored checks, sums to 1.00
CRITERIA_GROUPS         rewritten — 5 groups matching the defect categories
DOWNLOAD_EXTENSIONS     ['.pdf', '.doc', '.docx', '.xls', '.xlsx', '.zip']
BROKEN_IMAGE_IGNORE     ['.svg']  — plus data: URIs, handled in code
CONTENT_ORDER_PASS      0.90
CONTENT_ORDER_MIN_BLOCKS 5
LAYOUT_PROFILE_BINS     64
LAYOUT_PROFILE_PASS     0.85
LINK_HEAD_CONCURRENCY   4
LINK_HEAD_PACING_MS     250
LINK_HEAD_TIMEOUT       10000
LAYOUT_PROFILE_PATH     data/layout-profiles.json
LINK_STATUS_PATH        data/link-status.json
```

`WEIGHTS_MAIN` must sum to 1.0 — the existing invariant. A startup assertion in `score-main.js`
enforces it, since the sum is now spread across 14 entries and easy to break by hand.

### Downstream updates

**`src/build-dashboard.js`** renders 5 groups instead of 3 and needs diff renderers for the four
new check ids. `brokenImage` lists the failing image sources; `missingDownloadLink` lists the
absent filenames with their prod URLs; `contentOrder` shows the out-of-sequence blocks;
`visualLayout` shows the two profiles side by side above the existing screenshot pair.

**`src/sync-sheet.js`** requires a `CHECK_LABELS_TH` entry for every new check id —
`brokenImage`, `imageAlt`, `contentOrder`, `visualLayout`, `missingDownloadLink`,
`deadDownloadLink`, `template`. Without one, the Thai "Open Issues" column silently falls back to
the raw English label. This is a known trap recorded in AGENTS.md.

**`src/build-docs.js`** regenerates `output/criteria.html` from the new groups.

**`src/review-new-criteria.js`** is superseded by this work — its 11-check pilot is what became
the current `WEIGHTS_MAIN`. It should be deleted rather than left as a second, stale definition of
"new criteria".

## Verification

The repo has no test suite; verification is running the pipeline and inspecting output.

1. **Weight invariant** — `WEIGHTS_MAIN` sums to 1.0; every id in `CRITERIA_GROUPS` exists in
   `WEIGHTS_MAIN` and vice versa. Asserted at module load.
2. **Re-score is lossless where it should be** — pages with an `errorType` come out of
   `rescore.js` byte-identical to their input.
3. **Distribution comparison** — parity histogram of `results-v2.json` against `results.json`.
   A large uniform shift is expected (weights moved); a collapse to near-zero or near-100 is a bug.
4. **`brokenImage` calibration gate** — the 20-page precision check described above. This gates
   the check's weight, not just its correctness.
5. **Hand-check 15 pages** — three drawn from the failures of each new check
   (`brokenImage`, `contentOrder`, `visualLayout`, `missingDownloadLink`, `deadDownloadLink`),
   each confirmed against its cached screenshots and its live AEM URL. Threshold values for
   `CONTENT_ORDER_PASS` and `LAYOUT_PROFILE_PASS` are tuned from what this sample shows.
6. **`--dry-run` before any sheet write**, per the standing rule for `sync-sheet.js`.

## Phase 2 — deferred, requires re-capture

Not built now. Recorded here so it can be switched on when a full `safe-run` happens, which is
owed regardless: 300 of the 358 scored pages predate the `headerMenu`/`footerMenu`/`components`
metrics.

New metrics in `src/extract.js` (which must stay self-contained — no imports, browser APIs only):

- **Element geometry** — bounding box (`x`, `width`) of each major content block, giving a true
  DOM-based alignment signal that replaces the screenshot heuristic in `visualLayout`.
- **CSS background images** — `getComputedStyle(el).backgroundImage` URLs, closing the
  "non-image assets dropped" gap that `<img>`-only extraction misses.
- **List and inline structure** — `ul` / `ol` / `li` counts, and `strong` / `em` / inline-link
  counts per block, which upgrades `formatting` from advisory to scored.

When these land, `visualLayout` switches from the screenshot profile to element geometry, and
`formatting` takes weight from the structure group.
