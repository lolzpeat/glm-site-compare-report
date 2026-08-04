import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assetChecks } from '../src/scoring/checks-assets.js';
import { metrics } from './fixtures.js';

const img = (over = {}) => ({ alt: '', src: 'https://x.com/a.jpg', naturalWidth: 100, naturalHeight: 50, renderedWidth: 100, renderedHeight: 50, ...over });
const byId = (arr, id) => arr.find(c => c.id === id);

test('missingImage: count-only, 80% floor', () => {
  const prod = metrics({ images: [img(), img(), img(), img(), img()] });   // 5 → ceil(4) needed
  const pass = byId(assetChecks(prod, metrics({ images: [img(), img(), img(), img()] })), 'missingImage');
  assert.equal(pass.passed, true);
  const fail = byId(assetChecks(prod, metrics({ images: [img(), img()] })), 'missingImage');
  assert.equal(fail.passed, false);
  assert.ok(Math.abs(fail.partial - 0.5) < 1e-9);   // 2/4
});

test('missingImage: prod zero images — AEM adding some fails with 0 partial', () => {
  const c = byId(assetChecks(metrics(), metrics({ images: [img()] })), 'missingImage');
  assert.equal(c.passed, false);
  assert.equal(c.partial, 0);
});

test('brokenImage flags rendered-but-unloaded, excluding svg and data URIs', () => {
  const aem = metrics({ images: [
    img(),                                                                      // fine
    img({ src: 'https://x.com/broken.jpg', naturalWidth: 0, naturalHeight: 0 }), // broken
    img({ src: 'https://x.com/icon.svg', naturalWidth: 0, naturalHeight: 0 }),   // excluded
    img({ src: 'data:image/png;base64,xx', naturalWidth: 0, naturalHeight: 0 }), // excluded
  ] });
  const c = byId(assetChecks(metrics({ images: [img()] }), aem), 'brokenImage');
  assert.equal(c.passed, false);
  assert.equal(c.diff.broken.length, 1);
  assert.equal(c.diff.broken[0].src, 'https://x.com/broken.jpg');
  assert.ok(Math.abs(c.partial - 0.5) < 1e-9);   // 1 broken of 2 candidates
});

test('brokenImage is insufficient (not failed) when AEM has no images', () => {
  const c = byId(assetChecks(metrics({ images: [img()] }), metrics()), 'brokenImage');
  assert.equal(c.insufficient, true);
});

test('imageAlt: hit rate over prod alts; insufficient when prod has none', () => {
  const prod = metrics({ images: [img({ alt: 'บัตรเดบิต' }), img({ alt: 'สาขา' })] });
  const aem = metrics({ images: [img({ alt: 'บัตรเดบิต' })] });
  const c = byId(assetChecks(prod, aem), 'imageAlt');
  assert.equal(c.passed, false);
  assert.ok(Math.abs(c.partial - 0.5) < 1e-9);
  const ins = byId(assetChecks(metrics({ images: [img()] }), aem), 'imageAlt');
  assert.equal(ins.insufficient, true);
});
