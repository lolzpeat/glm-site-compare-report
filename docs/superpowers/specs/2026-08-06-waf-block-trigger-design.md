# WAF Block-Check Trigger — Design

**Date:** 2026-08-06 · **Status:** approved by user (approach A)

## Problem

Knowing whether the Akamai WAF is currently blocking us is a recurring need:
before starting a capture, while one is running, and when a human simply
wonders. Today that knowledge lives in throwaway probe scripts recreated per
session (`.probe-one-tmp.mjs`), and the one wrong way to check — curl — looks
exactly like an IP ban and cost hours on 2026-08-05 (see AGENTS.md). The
block-classification logic (ok / Access-Denied / connection-drop) is subtle
and must live in exactly one place.

## Decision

One module, three entry points. `src/waf-probe.js` owns probing and
classification; the CLI, the watcher, and compare.js's pre-flight are thin
consumers. All three write to one shared status file so they can trust each
other's recent results instead of re-probing.

## Components

### 1. `src/chrome.js` (extracted, not new behavior)

`resolveChrome()` currently lives inside compare.js (line ~1000, globs
`CHROME_EXECUTABLE_PATH`). It moves to `src/chrome.js`; compare.js imports it.
waf-probe.js must NOT import compare.js — compare.js executes a run on import.

### 2. `src/waf-probe.js`

- `classify({ status, title, bodySample, navError })` → `'ok' | 'denied' | 'drop'`
  — pure function, unit-tested. `denied` covers Access-Denied pages and
  RETRYABLE_HTTP_STATUS responses (429/5xx); `drop` covers navigation/connection
  errors.
- `probeOnce({ source })` — puppeteer-core with the pipeline's own UA and
  viewport, one page per host (prod + AEM probe URLs from config), isolated
  context per page. Returns `{ state, prod, aem, at, durationMs, source }`
  where `state === 'ok'` only when both hosts are ok. Appends the result to
  the status file.
- `waitUntilClear({ source })` — used by pre-flight:
  1. Read status file; if `current.at` is fresher than `WAF_STATUS_FRESH_MS`
     (2 min) trust it.
  2. Otherwise probe. If blocked, wait a jittered `WAF_PREFLIGHT_RETRY_MS`
     (5–20 min) and repeat.
  3. Give up after `WAF_PREFLIGHT_MAX_WAIT_MS` (6 h) with exit-worthy error —
     a nohup'd run must not hang invisibly forever.
- CLI:
  - `node src/waf-probe.js` (= `npm run probe`) — probe once, print current
    state + last 5 history entries, exit 0 if ok / 1 if blocked (scripts can
    gate on the exit code; replaces the tmp probe in the capture loop).
  - `node src/waf-probe.js --watch` — loop forever at jittered
    `WAF_WATCH_INTERVAL_MS` (10–20 min). On state CHANGE only, fire a macOS
    notification via `osascript -e 'display notification ...'` and log.
    Started manually; no auto-start.

### 3. Status file `data/waf-status.json` (gitignored via data/)

```json
{
  "current": { "state": "ok", "prod": "ok", "aem": "ok", "at": "ISO", "source": "watch" },
  "history": [ { "state": "...", "prod": "...", "aem": "...", "at": "ISO", "source": "cli|watch|preflight" } ]
}
```

History capped at 200 entries (oldest dropped) — enough to see when blocks
cluster. Plain synchronous write; concurrent writers are last-writer-wins,
acceptable for a small advisory file.

### 4. compare.js pre-flight

Before the worker pool starts: `await waitUntilClear({ source: 'preflight' })`
unless `--no-wait` is passed (flag documented in README's CLI Flags section).
While waiting it logs why and when the next retry is.

### 5. Config additions (config.js, per repo convention)

`WAF_PROBE_URLS` (prod + aem probe pages), `WAF_WATCH_INTERVAL_MS` ([600e3,
1200e3] jitter range), `WAF_PREFLIGHT_RETRY_MS` ([300e3, 1200e3]),
`WAF_PREFLIGHT_MAX_WAIT_MS` (6 h), `WAF_STATUS_FRESH_MS` (120e3),
`WAF_STATUS_PATH`, `WAF_HISTORY_MAX` (200).

## Testing

- `classify()`: 200-ok, Access-Denied title, 429, 503, nav-error drop.
- Status file: append + 200-entry cap round-trip.
- Browser/osascript paths stay thin and untested, matching repo practice.

## Out of scope (YAGNI)

LINE/Slack notifications · dashboard status panel · auto-starting the watcher
· probing during an active capture run (the capture's own results are the
signal there).

## Constraints

- Never probe with curl — Akamai rejects its TLS fingerprint outright
  (AGENTS.md, 2026-08-05). The probe must use the pipeline's own browser.
- The watcher's probe traffic spends the same WAF budget as captures; the
  10–20 min jitter keeps it to 3–6 loads/hour.
