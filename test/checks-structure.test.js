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

test('meta gives partial credit per matched key, canonical excluded', () => {
  // canonical is no longer compared: prod emits none while AEM always does,
  // so the pair was a guaranteed mismatch carrying no signal.
  const prod = metrics({ meta: { title: 'A', description: 'B', ogTitle: '', ogImage: '', keywords: '', canonical: '' } });
  const aem = metrics({ meta: { title: 'A', description: 'X', ogTitle: '', ogImage: '', keywords: '', canonical: 'https://aem.example/th/x' } });
  const c = byId(structureChecks(prod, aem), 'meta');
  assert.equal(c.passed, false);
  assert.ok(Math.abs(c.partial - 4 / 5) < 1e-9, `expected 4/5, got ${c.partial}`);
  assert.deepEqual(c.diff.missing, ['description']);
  assert.equal(c.diff.details.some(d => d.key === 'canonical'), false);
});

test('meta matches ogImage by asset path across differing hosts and CMS roots', () => {
  const prod = metrics({ meta: { title: 'A', description: 'B', ogTitle: 'C', keywords: 'D',
    ogImage: 'https://www.bangkokbank.com/-/media/feature/page-content/logos/bbl_th-share-1200x630.png' } });
  const aem = metrics({ meta: { title: 'A', description: 'B', ogTitle: 'C', keywords: 'D',
    ogImage: 'https://main--site-prod--bangkok-bank.aem.live/content/dam/feature/page-content/logos/bbl-th-share-1200x630.png' } });
  const c = byId(structureChecks(prod, aem), 'meta');
  assert.equal(c.passed, true, 'same asset, different host/root/underscore must match');
  const og = c.diff.details.find(d => d.key === 'ogImage');
  assert.equal(og.prodPath, '/feature/page-content/logos/bbl-th-share-1200x630.png');
  assert.equal(og.prodPath, og.aemPath);
});

test('meta still fails ogImage when AEM dropped the image entirely', () => {
  const prod = metrics({ meta: { title: 'A', description: 'B', ogTitle: 'C', keywords: 'D',
    ogImage: 'https://www.bangkokbank.com/-/media/feature/x.png' } });
  const aem = metrics({ meta: { title: 'A', description: 'B', ogTitle: 'C', keywords: 'D', ogImage: '' } });
  const c = byId(structureChecks(prod, aem), 'meta');
  assert.equal(c.passed, false);
  assert.deepEqual(c.diff.missing, ['ogImage']);
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
