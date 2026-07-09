# AGENTS.md

Agent memory for the **BBL Migration Parity Checker** — compares production Bangkok Bank pages (Sitecore) against their AEM-migrated versions at scale, before go-live. Read the human-facing `README.md` for usage; this file captures what is not obvious from the code alone.

## Stack

- **Node.js 18+, ESM** (`"type": "module"` in `package.json`). All imports need the `.js` extension; no CommonJS, no transpile/build step — scripts run directly via `node`.
- **No test suite, no linter, no typecheck.** Verification = run the pipeline and eyeball the dashboard.
- Runtime deps: `puppeteer-core` (does **not** ship a browser) + `sharp` (image resize).

## Commands

```bash
npm install                      # puppeteer-core + sharp (once)
npm run fetch                    # main URL list (sheet gid 1796448275)
npm run fetch:news               # news URL list (gid 1728025962)
npm run compare                  # main pipeline, concurrency 4
npm run compare:news             # news pipeline (concurrency 1 — see WAF gotcha)
npm run safe-run                 # chunked recapture (50 pages/chunk, pause 20m) — avoids the WAF ban
npm run dashboard                # builds BOTH main + news dashboards
npm run docs                     # rebuilds output/criteria.html
npm run sync-sheet               # write results back to the QA Google Sheet (see below)
npm run all                      # fetch → compare → dashboard → docs
```

## Architecture boundaries (read before editing)

```
config.js          ← single source of truth for ALL thresholds, paths, weights
src/fetch-urls.js  ← downloads sheet CSV → data/urls*.csv
src/extract.js     ← ⚠️ special — runs INSIDE the browser via page.evaluate()
src/compare.js     ← main pipeline; imports EXTRACT_FN from extract.js
src/safe-run.js    ← chunked wrapper around compare.js (spawn per --ids range, pause between)
src/build-dashboard.js  ← renders output/dashboard.html + per-page drill-downs
src/build-docs.js       ← renders output/criteria.html
src/google-auth.js      ← service-account JWT → OAuth2 access token (no external deps)
src/sync-sheet.js       ← writes results.json back to the QA Google Sheet (separate spreadsheet)
```

- **`config.js` is the only place for tunables.** Every weight, threshold, timeout, and path is imported from here. Never hardcode a threshold inside a script. `WEIGHTS` and `WEIGHTS_NEWS` must each sum to `1.0`.
- **`src/extract.js` must be fully self-contained.** It is serialized and injected into the live page — **no `import`, no closure over Node variables, only browser APIs**. Returns a plain object of metrics. Breaking this silently breaks extraction.
- **`src/compare.js` imports `EXTRACT_FN` from `extract.js`** — keep that export name stable.
- CLI args are parsed by hand with `process.argv.find(a => a.startsWith('--flag='))`, not a parser. Add new flags in the same style; they are documented in the README's "CLI Flags" section.

## Two pipelines (don't conflate)

| | Main | News |
|---|---|---|
| Sheet gid | `1796448275` | `1728025962` |
| URL file | `data/urls.csv` | `data/urls-news.csv` |
| Results | `data/results.json` | `data/results-news.json` |
| Concurrency | 4 | **1** (WAF blocks parallel news requests) |
| Scoring | `WEIGHTS` | `WEIGHTS_NEWS` (news-specific containers) |

`npm run dashboard` runs `build-dashboard.js` **twice** (main, then `--prefix=news`). Both must keep working.

## Gotchas

- **News concurrency must stay 1.** Higher values trigger the site's WAF/anti-bot → `BLOCKED` status. Do not "optimize" this.
- **A full `--force` run at concurrency 4 gets the whole IP banned by Akamai.** Happened 2026-07-08: after ~200 pages the WAF started serving "Access Denied" to every request on BOTH prod and AEM, then dropped connections outright (`ERR_HTTP2_PROTOCOL_ERROR`); the ban persisted after the run ended. For full re-captures use `--concurrency=1` (or 2 max), verify the first ~20 pages look sane before letting it continue, and back up `data/results.json` first — a banned run "succeeds" fast and fills the file with garbage.
- **The ban can persist for a day+ and is IP/reputation-based, not just a per-session or rate-window thing — don't over-trust a small sample.** Retried 95 `blocked` pages on 2026-07-09 across several attempts: same-network retry — 94/95 instant `ERR_HTTP2_PROTOCOL_ERROR`; `--pacing=6000` (6s between requests) — no improvement (1/18); switching to a fresh `browser.createBrowserContext()` per page pair (isolating cookies/session — see `processPair`) — a 5-page spot-check got 4/5 through, but the full 87-page follow-up only recovered 5/87 (82 still `blocked`). The small sample was misleading; don't declare the block "fixed" from a handful of successes — validate against a run of 50+ pages before concluding. `processPair` classifies the connection-drop signature (`ERR_HTTP2_PROTOCOL_ERROR`) as `errorType: 'blocked'` (matching the Access-Denied-page path) instead of silently scoring it as a genuine 0%-parity failure — this classification is correct either way, but doesn't make the ban go away. `--pacing=N` (ms delay per page per worker, `REQUEST_PACING_MS` in config.js) and per-pair browser contexts are both in place and don't hurt, but neither reliably clears the underlying block — expect to need a genuinely different IP (or enough elapsed time) for a real recapture.
- **`npm run safe-run` is the WAF-aware way to do a full recapture — use it instead of `npm run compare --force` for runs >~100 pages.** It runs compare.js in small id-range chunks (`--ids=1-50`, `51-100`, ...) with a long pause between them (`SAFE_CHUNK_PAUSE_MS`, default 20 min) so each chunk lands in a fresh WAF rate window instead of piling onto the last one. Ban analysis of the 632-page baseline (`results-632.json.bak`) shows blocks cluster mid-run after ~120-200 heavy page-loads and then lift on their own within ~15 min — a sliding-window ban, which is exactly what chunking defeats (pacing alone can't, because it never clears the window). `safe-run.js` spawns a fresh compare.js process per chunk, so each gets its own browser, and relies on compare.js's `mergePreserved` to keep pages outside the chunk verbatim — interrupting safe-run (Ctrl-C) and re-running resumes from the next incomplete chunk (chunks where every page already has real checks are skipped). It also ABORTS automatically if a chunk finishes ≥`SAFE_BLOCK_ABORT_RATIO` (default 50%) BLOCKED — a chunk that's mostly blocked means the IP is banned and continuing would only write garbage; the human should wait/switch-IP and re-run. Chunk size, pause, concurrency, and the abort ratio are all `SAFE_*` tunables in config.js; the resume logic treats a page as "done" only if its `checks` contain a real check id (not the single `error` placeholder blocked/failed pages get).
- **`NAV_WAIT_UNTIL = 'domcontentloaded'`, never `networkidle0`.** Tracking/analytics keep the network busy forever on prod; waiting for idle times out every page. AEM is client-rendered, so `compare.js` additionally scroll-stimulates lazy content (`MIN_TEXT_LEN`, `SCROLL_STIMULATE_*`).
- **Chrome path is machine-specific.** `config.js` hardcodes a path under `/Users/prapon.t/.cache/puppeteer/...`. Override without editing the file via `PUPPETEER_EXECUTABLE_PATH=<path>`. `puppeteer-core` will not download one.
- **`data/` is gitignored and regeneratable.** `output/` is **committed** — it *is* the deployed site. Never gitignore `output/`.
- **Screenshot paths in `results.json` are stored relative-to-ROOT** (e.g. `data/screenshots/1/prod.jpg`), not absolute. This makes the file portable — the project can be moved/renamed/cloned to another machine without every screenshot reference breaking (an absolute-prefix mismatch once silently broke every dashboard image after a project move). `compare.js` (`relShot`, the `relative(ROOT, abs)` helper) writes relative paths; `build-dashboard.js` (`resolveShot`) resolves them back to absolute via ROOT, and also tolerates legacy absolute paths (resolves only if they still exist). Don't reintroduce absolute-path storage in compare.js.
- **Resume by default.** `compare.js` skips already-captured pages (by id in the results file). Use `--force` to re-capture from scratch; without it, logic changes won't be reflected until the page is re-captured.
- **Interrupting a run never loses data.** On every save (incremental every 10 pages + final), ALL previously-known pages act as the fallback and this run's processed pages take priority (`mergePreserved`). A full run killed mid-way keeps every page it hadn't reached. Don't "simplify" `preserveMap` back to out-of-scope-only — that reintroduces the truncation bug where an interrupted full run wiped unreached pages from results.json.
- **Page `id` is assigned once in `readPairs()` and travels with the pair object**, not derived from array position. This is what makes `--ids=3,7,19-25` and `--retry-failed` safe — filtering `pairs` down to an arbitrary scattered subset doesn't renumber anything or corrupt the merge with `preserveMap`. Don't reintroduce `index+1`-based id assignment anywhere in the pipeline.
- **`--retry-failed` targets pages with no `checks` in the current results file** (load failed, WAF block, etc.) — it does NOT include pages never attempted at all; use `--ids=` or a full run for those. Requires an existing results file (throws otherwise).
- **`sync-sheet.js` targets a different spreadsheet than `SHEET_CSV_URL`.** The QA master file (`SYNC_SPREADSHEET_ID` in `config.js`) has manual tracking columns (`Automatiion Validation Status`, `Open Issues`, `Fix & Update Status`, `Human Recheck Status`, `Adobe Recheck Status`) that don't exist on the read-side sheet. Sync only writes columns F/G; never touch the human/Adobe recheck columns. Requires `.secrets/sheet-sync-key.json` shared as **Editor** on that sheet — Viewer access will 403 on write.
- **`SYNC_SPREADSHEET_ID` must be a native Google Sheet, not an uploaded .xlsx.** The Sheets API `batchUpdate`/`values` write endpoints reject Office-format files outright ("must not be an Office file") regardless of sharing permissions — this bit us once already. If the source file gets re-uploaded/replaced as .xlsx, convert it via File → Save as Google Sheets before pointing sync at it.
- **`Automatiion Validation Status` is a GLOBAL round counter, not a per-row or pass/fail label.** Every row synced in the same run gets the identical "Nth Validation" label — it does NOT parse each cell individually (an earlier version did; that caused rows to drift out of sync with each other). Pass/fail/gap detail lives in `Open Issues` instead. Don't reintroduce parity percentages into the status column without checking with the user first.
- **The round only advances on a genuinely new compare run, not on every sync-sheet.js invocation.** `data/sync-state.json` (gitignored, keyed by results-file path, shape `{ generatedAt, round }`) records the last-synced run. If the current `results.json`'s `generatedAt` matches what's stored, the sync is treated as a re-sync of the same data — round stays put, only `Open Issues` is rewritten. Deleting `sync-state.json` resets the counter to start over at round 1 on the next sync.
- **`Open Issues` is a concise Thai summary, not raw English check labels.** `sync-sheet.js` maps check `id`s (from `p.checks`, not `p.gaps` — gaps don't carry `id`) through `CHECK_LABELS_TH`, plus a regex-based fallback (`AEM_ISSUE_LABELS_TH`) for `aemIssues` entries that lack an id. Capped at `SYNC_ISSUES_MAX` (config.js) with a "+N รายการ" suffix. Adding a new check id anywhere (compare.js, the new-criteria pilot, or news scoring) needs a matching entry in `CHECK_LABELS_TH` or it silently falls back to the raw English label.

## Deploy

`output/` is the Vercel site root (`vercel.json` → `outputDirectory: "output"`). Update flow:

```bash
npm run dashboard
git add output/ && git commit -m "update dashboard" && git push   # auto-deploys on push to main
```

Live: https://glm-site-compare-report.vercel.app

## Conventions

- **Logging:** emoji-prefixed `console.log` (🚀 start, ✅ done, 📥 cached, ❌ error). Match this when adding status lines.
- **Language:** code + comments are English; README + dashboard copy are Thai. Keep that split.
- **Screenshots:** referenced by relative path from `output/`, never base64-embedded (keeps the dashboard small).
