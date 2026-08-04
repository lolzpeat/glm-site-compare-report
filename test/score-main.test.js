import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scoreMain } from '../src/scoring/score-main.js';
import { metrics } from './fixtures.js';

test('perfect parity scores 100 with insufficient checks excluded from denominator', () => {
  const blocks = ['หัวข้อที่หนึ่ง', 'หัวข้อที่สอง', 'หัวข้อที่สาม', 'หัวข้อที่สี่', 'หัวข้อที่ห้า'];
  const m = () => metrics({
    textLength: 1000, textBlocks: blocks,
    topWords: [{ w: 'เงินฝาก', c: 5 }],
    headings: [{ level: 2, text: 'บัญชี', tag: 'H2' }], headingCount: 1,
    links: [{ text: 'หน้าแรก', href: 'https://x.com/' }], linkCount: 1,
    images: [{ alt: 'รูป', src: 'https://x.com/a.jpg', naturalWidth: 10, naturalHeight: 10, renderedWidth: 10, renderedHeight: 10 }], imageCount: 1,
    headerMenus: [{ label: 'หน้าแรก' }], footerMenus: [{ label: 'ติดต่อ' }],
  });
  const r = scoreMain(m(), m(), {});
  // visualLayout + download checks are insufficient here (no context/no PDFs) —
  // they must be excluded, not counted as failures.
  assert.equal(r.parity, 100);
  const ins = r.checks.filter(c => c.insufficient).map(c => c.id).sort();
  assert.deepEqual(ins, ['deadDownloadLink', 'missingDownloadLink', 'visualLayout']);
  assert.equal(r.gaps.length, 0);
});

test('thaiBalance is advisory now — affects aemIssues/thaiIssues, never parity', () => {
  const a = metrics({ thaiRatio: 0.9 });
  const b = metrics({ thaiRatio: 0.1 });
  const r = scoreMain(a, b, {});
  assert.equal(r.checks.find(c => c.id === 'thaiBalance'), undefined);
  assert.equal(r.thaiIssues.length, 1);
  assert.ok(r.aemIssues.some(i => /Thai\/English/.test(i.label)));
});

test('formatting advisory fires on table drop', () => {
  const prod = metrics({ componentCounts: { ...metrics().componentCounts, table: 2 } });
  const r = scoreMain(prod, metrics(), {});
  assert.ok(r.aemIssues.some(i => /Formatting/.test(i.label)));
});

test('all 14 scored check ids are present exactly once', () => {
  const r = scoreMain(metrics(), metrics(), {});
  const ids = r.checks.map(c => c.id).sort();
  assert.deepEqual(ids, ['brokenImage', 'contentLength', 'contentOrder', 'deadDownloadLink',
    'headings', 'imageAlt', 'links', 'meta', 'missingDownloadLink', 'missingImage',
    'missingKeywords', 'missingText', 'template', 'visualLayout'].sort());
});
