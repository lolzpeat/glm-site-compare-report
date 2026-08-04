import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  makeCheck, isDynamicBlock, isDownloadHref, downloadBasename, lis, profileMatch,
  normCompare, filenameOf,
} from '../src/scoring/util.js';

test('makeCheck fills the standard shape and looks up weight', () => {
  const c = makeCheck('headings', 'Headings', false, 'detail', 0.4, { x: 1 });
  assert.equal(c.id, 'headings');
  assert.equal(c.weight, 0.04);
  assert.equal(c.passed, false);
  assert.equal(c.partial, 0.4);
  assert.deepEqual(c.diff, { x: 1 });
  const unknown = makeCheck('notAScoredId', 'X', true, 'd');
  assert.equal(unknown.weight, undefined);
  assert.equal(unknown.partial, 0);
  assert.equal(unknown.diff, null);
});

test('isDynamicBlock flags digit-heavy and Thai-month blocks', () => {
  assert.equal(isDynamicBlock('123,456.78 900'), true);
  assert.equal(isDynamicBlock('อัตราดอกเบี้ยเงินฝากประจำ'), false);
  assert.equal(isDynamicBlock('ณ วันที่ 12 มกราคม 2569'), true);
});

test('isDownloadHref matches by URL path extension only', () => {
  assert.equal(isDownloadHref('https://x.com/a/report.pdf'), true);
  assert.equal(isDownloadHref('https://x.com/a/report.PDF?v=2'), true);
  assert.equal(isDownloadHref('https://x.com/page?file=report.pdf'), false);
  assert.equal(isDownloadHref('https://x.com/a/page.html'), false);
  assert.equal(isDownloadHref('not a url'), false);
});

test('downloadBasename lowercases, decodes and strips trailing hash', () => {
  assert.equal(downloadBasename('https://x.com/dam/Annual-Report.pdf'), 'annual-report.pdf');
  assert.equal(downloadBasename('https://x.com/dam/annual-report-1a2b3c4d5e.pdf'), 'annual-report.pdf');
  assert.equal(downloadBasename('https://x.com/dam/fee%20table.xlsx'), 'fee table.xlsx');
});

test('lis finds the longest strictly-increasing subsequence with membership', () => {
  const r = lis([0, 4, 1, 2, 3]);
  assert.equal(r.length, 4);
  assert.deepEqual(r.keep, [true, false, true, true, true]);
  assert.deepEqual(lis([]), { length: 0, keep: [] });
  assert.equal(lis([5, 5, 5]).length, 1);
});

test('profileMatch is 1 for identical, null when unavailable, 0 for zero-mass', () => {
  assert.equal(profileMatch([0.5, 0.5], [0.5, 0.5]), 1);
  assert.equal(profileMatch(null, [1]), null);
  assert.equal(profileMatch([1, 0], [1, 0, 0]), null);
  assert.equal(profileMatch([0, 0], [1, 0]), 0);
  const m = profileMatch([1, 0], [0, 1]);
  assert.equal(m, 0);
});

test('normCompare ignores case, punctuation and whitespace; compares Thai text', () => {
  assert.equal(normCompare('ธนาคารกรุงเทพ – Bank', 'ธนาคารกรุงเทพ bank'), true);
  assert.equal(normCompare('Title A', 'Title B'), false);
  assert.equal(normCompare('', ''), true);
});

test('filenameOf falls back to lowercased input on malformed URLs', () => {
  assert.equal(filenameOf('not a url'), 'not a url');
  assert.equal(filenameOf('https://x.com/path/Report%20Q1.PDF'), 'report q1.pdf');
});
