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

test('meta scores 4 keys — canonical dropped, keywords reported but not scored', () => {
  // canonical: prod emits none while AEM always does — a guaranteed mismatch
  // carrying no signal. keywords: editorial, differs by CMS, so informational.
  const prod = metrics({ meta: { title: 'A', description: 'B', ogTitle: '', ogImage: '', keywords: 'kw', canonical: '' } });
  const aem = metrics({ meta: { title: 'A', description: 'X', ogTitle: '', ogImage: '', keywords: '', canonical: 'https://aem.example/th/x' } });
  const c = byId(structureChecks(prod, aem), 'meta');
  assert.equal(c.passed, false);
  assert.ok(Math.abs(c.partial - 3 / 4) < 1e-9, `expected 3/4, got ${c.partial}`);
  assert.deepEqual(c.diff.missing, ['description'], 'keywords must not count as a miss');
  assert.equal(c.diff.details.some(d => d.key === 'canonical'), false);
  assert.equal(c.diff.details.some(d => d.key === 'keywords'), false, 'keywords is not a scored key');
  const kw = c.diff.info.find(d => d.key === 'keywords');
  assert.equal(kw.scored, false);
  assert.equal(kw.prod, 'kw');
  assert.equal(kw.aem, '');
  assert.match(c.detail, /not scored.*keywords: prod ✓ \/ AEM ✗/);
});

test('a keywords difference alone cannot fail the meta check', () => {
  const base = { title: 'A', description: 'B', ogTitle: 'C', ogImage: 'https://p.example/-/media/a/x.png' };
  const prod = metrics({ meta: { ...base, keywords: 'สินเชื่อ, บัญชี' } });
  const aem = metrics({ meta: { ...base, ogImage: 'https://a.example/content/dam/a/x.png', keywords: '' } });
  const c = byId(structureChecks(prod, aem), 'meta');
  assert.equal(c.passed, true);
  assert.equal(c.partial, 1);
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

test('meta accepts an ogImage AEM serves under a hashed name, flagged as unverified', () => {
  // AEM rehosts some assets as /th/about-us/media-133d747e….jpg — no structural
  // relation to prod's path, so presence is all that can be checked.
  const base = { title: 'A', description: 'B', ogTitle: 'C', keywords: 'D' };
  const prod = metrics({ meta: { ...base, ogImage: 'https://www.bangkokbank.com/-/media/feature/page-content/banners/careers.jpg' } });
  const aem = metrics({ meta: { ...base, ogImage: 'https://main--site-prod--bangkok-bank.aem.live/th/about-us/media-133d747e8e774a409907a6135cdfba6614f8a4038.jpg' } });
  const c = byId(structureChecks(prod, aem), 'meta');
  assert.equal(c.passed, true, 'both sides carry an image → presence parity passes');
  const og = c.diff.details.find(d => d.key === 'ogImage');
  assert.equal(og.pathVerified, false, 'but the match must be marked unverified');
});

test('meta records ogImage path match as verified when the paths do line up', () => {
  const base = { title: 'A', description: 'B', ogTitle: 'C', keywords: 'D' };
  const prod = metrics({ meta: { ...base, ogImage: 'https://www.bangkokbank.com/-/media/feature/logos/bbl_th-1200x630.png' } });
  const aem = metrics({ meta: { ...base, ogImage: 'https://main--site-prod--bangkok-bank.aem.live/content/dam/feature/logos/bbl-th-1200x630.png' } });
  const og = byId(structureChecks(prod, aem), 'meta').diff.details.find(d => d.key === 'ogImage');
  assert.equal(og.pathVerified, true);
});

test('template menu labels ignore space placement but report original text', () => {
  const prod = metrics({ headerMenus: [{ label: 'ทรัพย์หลักประกันทางธุรกิจ พร้อมขาย' }, { label: 'ค้นหา' }],
    footerMenus: [{ label: 'การออม/การลงทุน' }] });
  const aem = metrics({ headerMenus: [{ label: 'ทรัพย์หลักประกันทางธุรกิจพร้อมขาย' }, { label: 'ค้นหา' }],
    footerMenus: [{ label: 'การออม / การลงทุน' }] });
  const c = byId(structureChecks(prod, aem), 'template');
  assert.deepEqual(c.diff.header.missing, [], 'moved space is not a missing menu item');
  assert.deepEqual(c.diff.footer.missing, []);
  assert.deepEqual(c.diff.footer.extra, []);
});

test('template reports a genuinely dropped menu item with its original label', () => {
  const prod = metrics({ headerMenus: [{ label: 'work café' }, { label: 'ค้นหา' }], footerMenus: [] });
  const aem = metrics({ headerMenus: [{ label: 'ค้นหา' }], footerMenus: [] });
  const c = byId(structureChecks(prod, aem), 'template');
  assert.deepEqual(c.diff.header.missing, ['work café'], 'label reported verbatim, not space-stripped');
});

test('template counts content-scoped components when both sides carry them', () => {
  const base = metrics().componentCounts;
  // Whole-page counts would fail (prod 6 hidden cookie accordions vs AEM 0);
  // the content-scoped counts agree, so the check must pass.
  const prod = metrics({ componentCounts: { ...base, accordion: 6 }, mainComponentCounts: { ...base, accordion: 0 },
    headerMenus: [], footerMenus: [] });
  const aem = metrics({ componentCounts: { ...base, accordion: 0 }, mainComponentCounts: { ...base, accordion: 0 },
    headerMenus: [], footerMenus: [] });
  const c = byId(structureChecks(prod, aem), 'template');
  assert.equal(c.diff.components.scope, 'main');
  assert.equal(c.diff.components.perType.find(t => t.type === 'accordion').ok, true);
  assert.equal(c.passed, true);
});
