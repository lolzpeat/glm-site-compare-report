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

import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readStatus, appendStatus } from '../src/waf-probe.js';

const entry = (n) => ({ state: 'ok', prod: 'ok', aem: 'ok', at: `2026-08-06T00:00:${String(n).padStart(2, '0')}Z`, source: 'cli' });

test('status file: missing file reads as empty', () => {
  const p = join(mkdtempSync(join(tmpdir(), 'waf-')), 'waf-status.json');
  assert.deepEqual(readStatus(p), { current: null, history: [] });
});

test('status file: append sets current and grows history, capped at max', () => {
  const p = join(mkdtempSync(join(tmpdir(), 'waf-')), 'waf-status.json');
  for (let i = 0; i < 5; i++) appendStatus(p, entry(i), 3);
  const st = readStatus(p);
  assert.equal(st.current.at, entry(4).at);
  assert.equal(st.history.length, 3, 'history capped');
  assert.equal(st.history[0].at, entry(2).at, 'oldest dropped');
});

test('status file: corrupt file reads as empty instead of throwing', async () => {
  const p = join(mkdtempSync(join(tmpdir(), 'waf-')), 'waf-status.json');
  appendStatus(p, entry(0), 3);
  const fs = await import('node:fs');
  fs.writeFileSync(p, '{not json');   // simulate corruption
  assert.deepEqual(readStatus(p), { current: null, history: [] });
});
