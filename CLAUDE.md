# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

The core agent documentation lives in AGENTS.md (stack, commands, architecture boundaries, the two pipelines, gotchas, deploy flow, conventions). It is imported here — treat it as part of this file:

@AGENTS.md

## Supplementary notes (not in AGENTS.md)

- **`src/review-new-criteria.js`** is a review-only pilot: it re-scores the existing main dataset (`data/results.json`) with the proposed new criteria (11 checks / 3 groups, weights defined locally in the file as `W`, not in `config.js` yet) and renders `output/review-new-criteria.html`. Checks whose metrics don't exist in `extract.js` yet are mocked and labelled "MOCK" in the UI. Run with `node src/review-new-criteria.js`. See the plan in commit `dc142e2` before promoting these weights into `config.js`.
- Per-pipeline dashboard builds exist alongside `npm run dashboard`: `npm run dashboard:main` and `npm run dashboard:news`.
- **`.secrets/`** holds a Google service-account key for sheet sync; it is gitignored — never commit or log its contents.
- **`data/results.json` has no automatic backup.** It's the one mutable local cache every script reads/writes — an exploratory/pilot scoring run against it can leave a small or mixed-schema dataset in place of a real full run, with no git history to recover from (gitignored). `cp data/results.json data/results.json.backup-<label>` before experimenting.
- **`npm run compare` is slow (20–40+ min for the full ~631 pages) and hits BBL's live production + AEM sites.** Don't launch it in the background without confirming scope with the user first (full run vs `--limit`/`--ids`/`--retry-failed`).
- **Before any real `node src/sync-sheet.js` write, run it with `--dry-run` first** — it's writing to a live Google Sheet shared with the team; catch wrong gid/scope/column issues before they land.
