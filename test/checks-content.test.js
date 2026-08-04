import { test } from 'node:test';
import assert from 'node:assert/strict';
import { contentChecks } from '../src/scoring/checks-content.js';
import { metrics } from './fixtures.js';

const byId = (arr, id) => arr.find(c => c.id === id);

test('identical content passes all three checks', () => {
  const blocks = ['หัวข้อหลักของหน้า', 'รายละเอียดผลิตภัณฑ์เงินฝาก', 'เงื่อนไขการให้บริการ'];
  const words = [{ w: 'เงินฝาก', c: 5 }, { w: 'บัญชี', c: 3 }];
  const m = metrics({ textLength: 1000, textBlocks: blocks, topWords: words });
  const checks = contentChecks(m, metrics({ textLength: 1000, textBlocks: blocks, topWords: words }));
  assert.equal(checks.length, 3);
  for (const c of checks) assert.equal(c.passed, true, c.id);
});

test('contentLength partial degrades on BOTH too-short and too-long', () => {
  const prod = metrics({ textLength: 1000 });
  const short = byId(contentChecks(prod, metrics({ textLength: 500 })), 'contentLength');
  assert.equal(short.passed, false);
  assert.ok(Math.abs(short.partial - 0.5) < 1e-9);
  const long = byId(contentChecks(prod, metrics({ textLength: 1600 })), 'contentLength');
  assert.equal(long.passed, false);
  assert.ok(long.partial <= 1, 'partial must never exceed 1');   // old code awarded 1.6 here
  assert.ok(Math.abs(long.partial - 0.4) < 1e-9);                // 1 - |1 - 1.6|
});

test('missingText reports prod blocks absent from AEM, dynamic blocks filtered', () => {
  const prod = metrics({ textBlocks: ['บริการบัญชีเงินเดือน', 'สิทธิประโยชน์พิเศษ', '12 มกราคม 2569'] });
  const aem = metrics({ textBlocks: ['บริการบัญชีเงินเดือน'] });
  const c = byId(contentChecks(prod, aem), 'missingText');
  assert.equal(c.passed, false);
  assert.deepEqual(c.diff.missingTextBlocks, ['สิทธิประโยชน์พิเศษ']);  // date block filtered as dynamic
  assert.ok(Math.abs(c.partial - 0.5) < 1e-9);
});

test('missingKeywords scores hit rate over prod top-30', () => {
  const prod = metrics({ topWords: [{ w: 'สินเชื่อ', c: 9 }, { w: 'ดอกเบี้ย', c: 5 }] });
  const aem = metrics({ topWords: [{ w: 'สินเชื่อ', c: 7 }] });
  const c = byId(contentChecks(prod, aem), 'missingKeywords');
  assert.equal(c.passed, false);
  assert.deepEqual(c.diff.missingKeywords, ['ดอกเบี้ย']);
  assert.ok(Math.abs(c.partial - 0.5) < 1e-9);
});
