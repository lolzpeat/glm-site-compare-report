// Advisory findings — surfaced in the dashboard and synced to the sheet's
// Open Issues, but never part of the weighted parity score. Ports the pre-v2
// aemIssues/brokenLinks/imageIssues logic, absorbs thaiBalance (demoted from
// the scored set), and adds the low-priority formatting heuristics.
import { THAI_RATIO_DELTA, IMAGE_RATIO_TOLERANCE } from '../../config.js';
import { filenameOf } from './util.js';

export function advisoryIssues(prod, aem) {
  const aemIssues = [];

  if (aem.leakedContentPaths?.length) aemIssues.push({ severity: 'high', label: 'Leaked /content/ paths', detail: `${aem.leakedContentPaths.length} found` });
  if (!aem.features?.login && prod.features?.login) aemIssues.push({ severity: 'high', label: 'Missing login', detail: 'prod has login, AEM does not' });
  if (!aem.features?.languageSwitch && prod.features?.languageSwitch) aemIssues.push({ severity: 'high', label: 'Missing language switcher' });
  const socialMissing = Object.entries(prod.social || {}).filter(([k, v]) => v && !aem.social?.[k]).map(([k]) => k);
  if (socialMissing.length) aemIssues.push({ severity: 'medium', label: 'Missing social icons', detail: socialMissing.join(', ') });

  // Thai/English balance — advisory in v2 (no longer a scored check, so the
  // pre-v2 double-count concern with gaps no longer applies).
  const pThai = prod.thaiRatio ?? 0;
  const aThai = aem.thaiRatio ?? 0;
  const tDelta = Math.abs(pThai - aThai);
  const thaiIssues = tDelta > THAI_RATIO_DELTA
    ? [{ severity: 'high', label: 'Thai/English balance differs', detail: `prod ${Math.round(pThai * 100)}% Thai vs AEM ${Math.round(aThai * 100)}% Thai` }]
    : [];
  if (thaiIssues.length) aemIssues.push({ severity: 'medium', label: 'Thai/English balance differs', detail: thaiIssues[0].detail });

  // Formatting (advisory, low priority per QA): heading text present on both
  // sides at a different level, or table count dropped.
  const prodLevels = new Map((prod.headings || []).filter(h => typeof h === 'object').map(h => [h.text.toLowerCase(), h.level]));
  let levelMismatch = 0;
  for (const h of (aem.headings || [])) {
    if (typeof h !== 'object') continue;
    const pl = prodLevels.get(h.text.toLowerCase());
    if (pl && pl !== h.level) levelMismatch++;
  }
  const tableDrop = (prod.componentCounts?.table || 0) - (aem.componentCounts?.table || 0);
  if (levelMismatch > 0 || tableDrop > 0) {
    aemIssues.push({
      severity: 'low', label: 'Formatting (advisory)',
      detail: [levelMismatch ? `${levelMismatch} heading(s) at wrong level` : '', tableDrop > 0 ? `${tableDrop} table(s) dropped` : ''].filter(Boolean).join(' · '),
    });
  }

  // Broken in-page links (HTTP status from the in-browser AEM link check).
  const brokenLinks = [];
  if (aem.linkStatuses) {
    for (const [url, status] of Object.entries(aem.linkStatuses)) {
      if (status >= 400) brokenLinks.push({ url: url.slice(0, 80), status });
      else if (status === 0) brokenLinks.push({ url: url.slice(0, 80), status: 'unreachable' });
    }
  }
  if (brokenLinks.length) aemIssues.push({ severity: 'high', label: 'Broken links on AEM', detail: `${brokenLinks.length} links return error` });

  // Image distortion/ratio — filename match first, order-based fill after.
  const prodImgs = prod.images || [];
  const aemImgs = aem.images || [];
  const imageIssues = [];
  const imgRatio = (w, h) => h > 0 ? w / h : 0;
  const imgDiffers = (a, b) => a > 0 && b > 0 && Math.abs(a - b) / a > IMAGE_RATIO_TOLERANCE;
  const usedAem = new Set();
  const pairs = [];
  for (const o of prodImgs) {
    const key = filenameOf(o.src);
    const idx = key ? aemImgs.findIndex((m, i) => !usedAem.has(i) && filenameOf(m.src) === key) : -1;
    if (idx !== -1) { usedAem.add(idx); pairs.push([o, aemImgs[idx]]); }
  }
  const restProd = prodImgs.filter(o => !pairs.some(([po]) => po === o));
  const restAem = aemImgs.filter((_, i) => !usedAem.has(i));
  restProd.forEach((o, i) => { if (restAem[i]) pairs.push([o, restAem[i]]); });
  for (const [o, m] of pairs) {
    const label = filenameOf(m.src) || m.src.slice(0, 40);
    const ro = imgRatio(o.renderedWidth, o.renderedHeight);
    const rm = imgRatio(m.renderedWidth, m.renderedHeight);
    const imgData = {
      label, kind: '', detail: '', prodSrc: o.src, aemSrc: m.src, prodAlt: o.alt || '', aemAlt: m.alt || '',
      prodRendered: `${o.renderedWidth}×${o.renderedHeight}`, aemRendered: `${m.renderedWidth}×${m.renderedHeight}`,
    };
    if (imgDiffers(ro, rm)) {
      imageIssues.push({ ...imgData, kind: 'ratio', detail: `rendered ratio prod ${ro.toFixed(2)} vs aem ${rm.toFixed(2)}` });
      continue;
    }
    const natM = imgRatio(m.naturalWidth, m.naturalHeight);
    const natO = imgRatio(o.naturalWidth, o.naturalHeight);
    if (imgDiffers(natM, rm) && !imgDiffers(natO, ro)) {
      imageIssues.push({ ...imgData, kind: 'distortion', detail: `distorted: natural ${natM.toFixed(2)} vs rendered ${rm.toFixed(2)}` });
    }
  }
  if (aemImgs.length < prodImgs.length - 2) {
    imageIssues.push({ label: '(page-wide)', detail: `AEM renders ${aemImgs.length} images vs ${prodImgs.length} on prod`, kind: 'missing' });
  }
  if (imageIssues.length) aemIssues.push({ severity: 'medium', label: 'Image distortion/ratio', detail: `${imageIssues.length} image issue(s)` });

  return { aemIssues, brokenLinks, imageIssues, thaiIssues };
}
