import { test } from 'node:test';
import assert from 'node:assert/strict';
import { structureChecks } from '../src/scoring/checks-structure.js';
import { metrics } from './fixtures.js';

const byId = (arr, id) => arr.find(c => c.id === id);

test('headings: Jaccard over normalised text sets', () => {
  const prod = metrics({ headings: [{ level: 2, text: 'บัญชีเงินฝาก', tag: 'H2' }, { level: 2, text: 'สินเชื่อ', tag: 'H2' }], headingCount: 2 });
  const aem = metrics({ headings: [{ level: 2, text: 'บัญชีเงินฝาก', tag: 'H2' }], headingCount: 1 });
  const c = byId(structureChecks(prod, aem), 'headings');
  assert.equal(c.passed, false);            // Jaccard 0.5 ≤ 0.6
  assert.ok(Math.abs(c.partial - 0.5) < 1e-9);
});

test('meta gives partial credit per matched key', () => {
  const prod = metrics({ meta: { title: 'A', description: 'B', canonical: '', ogTitle: '', ogImage: '', keywords: '' } });
  const aem = metrics({ meta: { title: 'A', description: 'X', canonical: '', ogTitle: '', ogImage: '', keywords: '' } });
  const c = byId(structureChecks(prod, aem), 'meta');
  assert.equal(c.passed, false);
  assert.ok(Math.abs(c.partial - 5 / 6) < 1e-9);   // 5 of 6 keys match ('' === '')
  assert.deepEqual(c.diff.missing, ['description']);
});

test('template merges header/footer/components; insufficient on old captures', () => {
  const menus = [{ label: 'หน้าแรก' }, { label: 'ผลิตภัณฑ์' }];
  const prod = metrics({ headerMenus: menus, footerMenus: menus });
  const aem = metrics({ headerMenus: menus, footerMenus: [{ label: 'หน้าแรก' }] });
  const c = byId(structureChecks(prod, aem), 'template');
  assert.equal(c.passed, false);           // footer label missing
  assert.ok(c.partial > 0 && c.partial < 1);
  assert.equal(c.diff.footer.missing.length, 1);
  // old capture (no headerMenus/componentCounts) → insufficient
  const old = { ...metrics() };
  delete old.headerMenus; delete old.footerMenus; delete old.componentCounts;
  assert.equal(byId(structureChecks(old, aem), 'template').insufficient, true);
});

test('template fails when accordions match count but are empty shells', () => {
  const prod = metrics({ componentCounts: { ...metrics().componentCounts, accordion: 2 }, accordionCount: 2 });
  const aem = metrics({ componentCounts: { ...metrics().componentCounts, accordion: 2 }, accordionCount: 2, emptyAccordions: 2 });
  const c = byId(structureChecks(prod, aem), 'template');
  assert.equal(c.passed, false);
});

test('template diff.components carries advisory + otherComponents for the drill-down', () => {
  const prod = metrics({ componentCounts: { ...metrics().componentCounts, carousel: 2 }, otherComponents: ['map', 'dialog/modal'] });
  const aem = metrics({ otherComponents: ['dialog/modal'] });
  const c = byId(structureChecks(prod, aem), 'template');
  assert.deepEqual(c.diff.components.advisory, [{ type: 'carousel', prod: 2, aem: 0 }]);
  assert.deepEqual(c.diff.components.otherComponents, { prodOnly: ['map'], aemOnly: [], both: ['dialog/modal'] });
  assert.ok(c.detail.includes('advisory: carousel 0/2'));
});
