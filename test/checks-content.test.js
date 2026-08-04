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

test('contentLength uses main-content length when both sides have it', () => {
  // Shared chrome (identical header/footer) inflates the whole-page ratio:
  // 5000/20000 = 25% full-page, but only 3000/18000 = 17% of real content.
  const prod = metrics({ textLength: 20000, mainTextLength: 18000, mainTextSource: 'main' });
  const aem = metrics({ textLength: 5000, mainTextLength: 3000, mainTextSource: 'main' });
  const c = byId(contentChecks(prod, aem), 'contentLength');
  assert.equal(c.diff.scope, 'main');
  assert.equal(c.diff.ratio, 17);
  assert.match(c.detail, /3000\/18000/);
  assert.match(c.detail, /main content only/);
});

test('contentLength falls back to whole-page length when either side lacks it', () => {
  const prod = metrics({ textLength: 20000, mainTextLength: 18000 });
  const aem = metrics({ textLength: 5000 });                    // legacy capture
  const c = byId(contentChecks(prod, aem), 'contentLength');
  assert.equal(c.diff.scope, 'full-page');
  assert.equal(c.diff.ratio, 25);
  assert.match(c.detail, /legacy capture/);
});

test('missingText reports prod blocks absent from AEM, dynamic blocks filtered', () => {
  const prod = metrics({ textBlocks: ['บริการบัญชีเงินเดือน', 'สิทธิประโยชน์พิเศษ', '12 มกราคม 2569'] });
  const aem = metrics({ textBlocks: ['บริการบัญชีเงินเดือน'] });
  const c = byId(contentChecks(prod, aem), 'missingText');
  assert.equal(c.passed, false);
  assert.deepEqual(c.diff.missingTextBlocks, ['สิทธิประโยชน์พิเศษ']);  // date block filtered as dynamic
  assert.ok(Math.abs(c.partial - 0.5) < 1e-9);
});

test('missingText scores the FULL missing count, not the 15-block display cap', () => {
  // 40 prod blocks, 30 missing from AEM. The diff list is capped at 15 for the
  // UI, but the score must reflect all 30 (pre-v2 scored 1 - 15/40 = 0.625).
  const prodBlocks = Array.from({ length: 40 }, (_, i) => `บล็อกเนื้อหาลำดับที่ ${'ก'.repeat(i + 1)}`);
  const prod = metrics({ textBlocks: prodBlocks });
  const aem = metrics({ textBlocks: prodBlocks.slice(0, 10) });
  const c = byId(contentChecks(prod, aem), 'missingText');
  assert.equal(c.diff.missingCount, 30, 'full count reported for scoring');
  assert.equal(c.diff.missingTextBlocks.length, 15, 'display list still capped at 15');
  assert.ok(Math.abs(c.partial - 0.25) < 1e-9, `expected 1-30/40=0.25, got ${c.partial}`);
  assert.match(c.detail, /30\/40/);
});

test('missingKeywords scores hit rate over prod top-30', () => {
  const prod = metrics({ topWords: [{ w: 'สินเชื่อ', c: 9 }, { w: 'ดอกเบี้ย', c: 5 }] });
  const aem = metrics({ topWords: [{ w: 'สินเชื่อ', c: 7 }] });
  const c = byId(contentChecks(prod, aem), 'missingKeywords');
  assert.equal(c.passed, false);
  assert.deepEqual(c.diff.missingKeywords, ['ดอกเบี้ย']);
  assert.ok(Math.abs(c.partial - 0.5) < 1e-9);
});

test('contentLength ignores main metrics when a side never laid out', () => {
  // mainTextLength 0 with a large raw length means the capture ran before
  // layout settled — that zero must not be scored as deleted content.
  const prod = metrics({ textLength: 20000, mainTextLength: 18000, mainTextRawLength: 18000 });
  const aem = metrics({ textLength: 5000, mainTextLength: 0, mainTextRawLength: 4200 });
  const c = byId(contentChecks(prod, aem), 'contentLength');
  assert.equal(c.diff.scope, 'full-page');
  assert.equal(c.diff.ratio, 25);
});

test('contentLength still uses main when a side is legitimately empty', () => {
  // mainTextLength 0 AND raw ~0 is a genuinely empty main container.
  const prod = metrics({ textLength: 20000, mainTextLength: 18000, mainTextRawLength: 18000 });
  const aem = metrics({ textLength: 5000, mainTextLength: 0, mainTextRawLength: 0 });
  const c = byId(contentChecks(prod, aem), 'contentLength');
  assert.equal(c.diff.scope, 'main');
  assert.equal(c.diff.ratio, 0);
});

test('missingText compares sentences against AEM rendered text, ignoring markup shape', () => {
  // The regression this replaces: prod puts each row in its own <p>/<li> while
  // AEM uses <table><td>, so byte-identical text scored as ~85% missing.
  const text = 'วันหยุดประจำปีธนาคาร ปี 2569 ตามระเบียบของธนาคารแห่งประเทศไทย วันพฤหัสบดี 1 มกราคม วันขึ้นปีใหม่ วันศุกร์ 2 มกราคม วันหยุดทำการเพิ่มเป็นกรณีพิเศษ';
  const prod = metrics({ mainTextFull: text, textBlocks: text.split(' ') });
  const aem = metrics({ mainTextFull: text, textBlocks: [] });   // same text, no matching blocks
  const c = byId(contentChecks(prod, aem), 'missingText');
  assert.equal(c.diff.scope, 'main-sentences');
  assert.equal(c.passed, true, 'identical rendered text must not report missing sentences');
  assert.equal(c.partial, 1);
});

test('missingText still detects genuinely absent sentences', () => {
  const kept = 'ธนาคารกรุงเทพให้บริการสินเชื่อเพื่อที่อยู่อาศัยแก่ลูกค้าบุคคลทุกกลุ่มรายได้อย่างทั่วถึง';
  const dropped = 'เงื่อนไขการชำระคืนเงินกู้และอัตราดอกเบี้ยพิเศษสำหรับลูกค้าที่สมัครผ่านช่องทางออนไลน์เท่านั้น';
  const prod = metrics({ mainTextFull: `${kept} ${dropped}` });
  const aem = metrics({ mainTextFull: kept });
  const c = byId(contentChecks(prod, aem), 'missingText');
  assert.equal(c.passed, false);
  assert.ok(c.diff.missingCount >= 1, 'the dropped sentence must be reported');
  assert.ok(c.partial < 1);
});

test('missingText falls back to block comparison on legacy captures', () => {
  const prod = metrics({ textBlocks: ['บริการบัญชีเงินเดือนสำหรับองค์กร', 'สิทธิประโยชน์พิเศษสำหรับพนักงาน'] });
  const aem = metrics({ textBlocks: ['บริการบัญชีเงินเดือนสำหรับองค์กร'] });
  const c = byId(contentChecks(prod, aem), 'missingText');
  assert.equal(c.diff.scope, 'full-page-blocks');
  assert.equal(c.diff.missingCount, 1);
});

test('missingText treats a moved Thai space as present, but counts it as a spacing diff', () => {
  const prodText = 'พระบาทสมเด็จพระบรมชนกาธิเบศร มหาภูมิพลอดุลยเดชมหาราช บรมนาถบพิตร วันชาติ และวันพ่อแห่งชาติ';
  const aemText  = 'พระบาทสมเด็จพระบรมชนกาธิเบศร มหาภูมิพลอดุลยเดช มหาราชบรมนาถบพิตร วันชาติ และวันพ่อแห่งชาติ';
  const c = byId(contentChecks(metrics({ mainTextFull: prodText }), metrics({ mainTextFull: aemText })), 'missingText');
  assert.equal(c.passed, true, 'space placement is not missing content');
  assert.equal(c.diff.missingCount, 0);
  assert.ok(c.diff.spacingOnly >= 1, 'but the spacing difference must still be reported');
  assert.match(c.detail, /ignoring spacing/);
});
