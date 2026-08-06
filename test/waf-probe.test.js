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
