# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

The core agent documentation lives in AGENTS.md (stack, commands, architecture boundaries, the two pipelines, gotchas, deploy flow, conventions). It is imported here — treat it as part of this file:

@AGENTS.md

## Supplementary notes (not in AGENTS.md)

- **Criteria v2 are live** — `WEIGHTS_MAIN_V2` / `CRITERIA_GROUPS_V2` in `config.js` (12 checks / 5 groups). Weight/threshold changes need NO recapture: `node src/rescore.js --source=<results> --out=<results>` re-scores cached metrics. `src/review-new-criteria.js` is the superseded pilot; ignore it.
- **Priority pipeline** (ชุดที่ลูกค้า focus, จาก QA sheet tab): `npm run fetch:priority` → capture ด้วย `--urls=data/urls-priority.csv --output=data/results-priority.json --shots-dir=data/screenshots/priority` → `node src/layout-profile.js --source=…` → `node src/rescore.js …` → `node src/build-dashboard.js --source=… --prefix=priority --criteria=v2`. Page id = ตำแหน่งแถวใน CSV; `fetch-priority-urls.js` ล็อกลำดับแถวเดิมไว้ข้าม sheet edits — ห้ามเรียง CSV ใหม่เอง ไม่งั้นคะแนนไปผูกผิด URL.
- **`npm run sync-meta` backfills sheet metadata without re-capturing.** `node src/sync-meta.js --urls=<csv> --source=<results> [--dry-run]` copies `category` / `subCategory` / `sheetStatus` from a urls CSV into an existing results file — no browser, no network, no re-scoring. Use it when the QA sheet gains or corrects those columns after a capture has already run (that is why the priority dashboard's category filters were empty until 2026-08-06). `compare.js` syncs the same fields but only for pages it walks, and walking uncaptured pages means live requests; `rescore.js` never reads the CSV. It matches pages by id and **aborts the whole write if any `prodUrl` disagrees** — a sheet row inserted or removed shifts every id below it. Sub-Category `-` means "none" and maps to empty. Safe to run between capture chunks: `compare.js` loads the results file at process start, so only the ~1-2 min a chunk is actually running is unsafe — guard with `pgrep -f "src/compare.js"`. **Re-run it after every capture, not just once.** `compare.js` writes these fields itself from the CSV, but *verbatim* — so a `-` reaches the dashboard as a junk sub-category option grouping unrelated pages (this happened to 4 pages on 2026-08-07). Only `sync-meta.js` normalizes.
- Per-pipeline dashboard builds exist alongside `npm run dashboard`: `npm run dashboard:main` and `npm run dashboard:news`.
- **`.secrets/`** holds a Google service-account key for sheet sync; it is gitignored — never commit or log its contents.
- **`data/results.json` has no automatic backup.** It's the one mutable local cache every script reads/writes — an exploratory/pilot scoring run against it can leave a small or mixed-schema dataset in place of a real full run, with no git history to recover from (gitignored). `cp data/results.json data/results.json.backup-<label>` before experimenting.
- **`npm run compare` is slow (20–40+ min for the full ~631 pages) and hits BBL's live production + AEM sites.** Don't launch it in the background without confirming scope with the user first (full run vs `--limit`/`--ids`/`--retry-failed`).
- **Before any real `node src/sync-sheet.js` write, run it with `--dry-run` first** — it's writing to a live Google Sheet shared with the team; catch wrong gid/scope/column issues before they land.
