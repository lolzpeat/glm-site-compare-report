// Download-links group. Presence is matched by normalised basename because
// AEM re-hosts assets under /content/dam/ with different paths (full-URL
// comparison would report every file missing). Liveness comes from the
// data/link-status.json cache built by src/check-downloads.js — this module
// itself never touches the network.
import { makeCheck, isDownloadHref, downloadBasename } from './util.js';

export function downloadChecks(prod, aem, context = {}) {
  const checks = [];
  const downloads = (m) => (m.links || []).filter(l => isDownloadHref(l.href));
  const prodDl = downloads(prod);
  const aemDl = downloads(aem);

  // missingDownloadLink
  const prodNames = new Set(prodDl.map(l => downloadBasename(l.href)));
  const aemNames = new Set(aemDl.map(l => downloadBasename(l.href)));
  const missing = [...prodNames].filter(n => !aemNames.has(n));
  const mCheck = makeCheck('missingDownloadLink', 'Download links present',
    missing.length === 0,
    `${prodNames.size - missing.length}/${prodNames.size} prod download file(s) found on AEM`,
    prodNames.size > 0 ? 1 - missing.length / prodNames.size : 0,
    { missing: missing.slice(0, 20), prodCount: prodNames.size, aemCount: aemNames.size,
      prodLinks: prodDl.slice(0, 20).map(l => ({ text: l.text, href: l.href })) });
  if (prodNames.size === 0) { mCheck.insufficient = true; mCheck.passed = false; mCheck.partial = 0; mCheck.detail = 'prod has no download links'; }
  checks.push(mCheck);

  // deadDownloadLink — AEM side only.
  const status = context.linkStatus || null;
  const aemUrls = [...new Set(aemDl.map(l => l.href))];
  const checked = status ? aemUrls.filter(u => status[u] !== undefined) : [];
  const dead = checked.filter(u => status[u].status >= 400 || status[u].status === 0);
  const dCheck = makeCheck('deadDownloadLink', 'Download links alive',
    dead.length === 0,
    `${dead.length}/${checked.length} AEM download link(s) dead`,
    checked.length > 0 ? 1 - dead.length / checked.length : 0,
    { dead: dead.slice(0, 20).map(u => ({ url: u, status: status?.[u]?.status })), checkedCount: checked.length, totalCount: aemUrls.length });
  if (aemUrls.length === 0) { dCheck.insufficient = true; dCheck.passed = false; dCheck.partial = 0; dCheck.detail = 'AEM has no download links'; }
  else if (checked.length === 0) { dCheck.insufficient = true; dCheck.passed = false; dCheck.partial = 0; dCheck.detail = 'no cached link status — run: npm run check-downloads'; }
  checks.push(dCheck);

  return checks;
}
