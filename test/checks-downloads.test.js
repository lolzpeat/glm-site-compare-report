import { test } from 'node:test';
import assert from 'node:assert/strict';
import { downloadChecks } from '../src/scoring/checks-downloads.js';
import { metrics } from './fixtures.js';

const byId = (arr, id) => arr.find(c => c.id === id);
const link = (href, text = 'ดาวน์โหลด') => ({ text, href });

test('missingDownloadLink matches by normalised basename, not URL', () => {
  const prod = metrics({ links: [link('https://bbl.co.th/files/Annual-Report.pdf'), link('https://bbl.co.th/files/fees.xlsx')] });
  const aem = metrics({ links: [link('https://aem.bbl.co.th/content/dam/x/annual-report-9f8e7d6c5b.pdf')] });
  const c = byId(downloadChecks(prod, aem, {}), 'missingDownloadLink');
  assert.equal(c.passed, false);
  assert.deepEqual(c.diff.missing, ['fees.xlsx']);
  assert.ok(Math.abs(c.partial - 0.5) < 1e-9);
});

test('missingDownloadLink is insufficient when prod has no download links', () => {
  const c = byId(downloadChecks(metrics({ links: [link('https://x.com/page.html')] }), metrics(), {}), 'missingDownloadLink');
  assert.equal(c.insufficient, true);
});

test('deadDownloadLink reads cached statuses; 0 and >=400 are dead', () => {
  const aem = metrics({ links: [link('https://a.com/ok.pdf'), link('https://a.com/gone.pdf'), link('https://a.com/timeout.pdf')] });
  const linkStatus = {
    'https://a.com/ok.pdf': { status: 200, checkedAt: 'x' },
    'https://a.com/gone.pdf': { status: 404, checkedAt: 'x' },
    'https://a.com/timeout.pdf': { status: 0, checkedAt: 'x' },
  };
  const c = byId(downloadChecks(metrics(), aem, { linkStatus }), 'deadDownloadLink');
  assert.equal(c.passed, false);
  assert.equal(c.diff.dead.length, 2);
  assert.ok(Math.abs(c.partial - 1 / 3) < 1e-9);
});

test('deadDownloadLink is insufficient without cache or without AEM downloads', () => {
  const aem = metrics({ links: [link('https://a.com/a.pdf')] });
  assert.equal(byId(downloadChecks(metrics(), aem, {}), 'deadDownloadLink').insufficient, true);
  assert.equal(byId(downloadChecks(metrics(), metrics(), { linkStatus: {} }), 'deadDownloadLink').insufficient, true);
});
