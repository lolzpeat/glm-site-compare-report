import { test } from 'node:test';
import assert from 'node:assert/strict';
import { alignmentChecks } from '../src/scoring/checks-alignment.js';
import { metrics } from './fixtures.js';

const byId = (arr, id) => arr.find(c => c.id === id);
const blocks = ['หัวข้อที่หนึ่ง', 'หัวข้อที่สอง', 'หัวข้อที่สาม', 'หัวข้อที่สี่', 'หัวข้อที่ห้า', 'หัวข้อที่หก'];

test('contentOrder passes when shared blocks keep prod order', () => {
  const c = byId(alignmentChecks(metrics({ textBlocks: blocks }), metrics({ textBlocks: blocks }), {}), 'contentOrder');
  assert.equal(c.passed, true);
  assert.equal(c.partial, 1);
});

test('contentOrder fails when sections are reordered, and names the moved blocks', () => {
  const shuffled = [blocks[5], blocks[0], blocks[1], blocks[2], blocks[3], blocks[4]];
  const c = byId(alignmentChecks(metrics({ textBlocks: blocks }), metrics({ textBlocks: shuffled }), {}), 'contentOrder');
  assert.equal(c.passed, false);
  assert.ok(Math.abs(c.partial - 5 / 6) < 1e-9);
  assert.deepEqual(c.diff.outOfOrder, ['หัวข้อที่หก']);
});

test('contentOrder is insufficient below CONTENT_ORDER_MIN_BLOCKS shared blocks', () => {
  const c = byId(alignmentChecks(metrics({ textBlocks: blocks.slice(0, 3) }), metrics({ textBlocks: blocks.slice(0, 3) }), {}), 'contentOrder');
  assert.equal(c.insufficient, true);
});

test('visualLayout scores from context profiles, insufficient without them', () => {
  const ins = byId(alignmentChecks(metrics(), metrics(), {}), 'visualLayout');
  assert.equal(ins.insufficient, true);
  const same = { layout: { prod: [0.25, 0.5, 0.25], aem: [0.25, 0.5, 0.25] } };
  const ok = byId(alignmentChecks(metrics(), metrics(), same), 'visualLayout');
  assert.equal(ok.passed, true);
  const shifted = { layout: { prod: [1, 0, 0], aem: [0, 0, 1] } };
  const bad = byId(alignmentChecks(metrics(), metrics(), shifted), 'visualLayout');
  assert.equal(bad.passed, false);
  assert.equal(bad.partial, 0);
});
