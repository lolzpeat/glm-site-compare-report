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
