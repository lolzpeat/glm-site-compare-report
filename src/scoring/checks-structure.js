// Structure & template group. headings/links/meta are straight ports of the
// pre-v2 checks.
//
// `template` scores COMPONENTS ONLY (accordion/table/form/video). Header and
// footer menus were dropped from per-page scoring 2026-08-05: they are
// site-wide chrome, so one mega-menu difference was reported as a per-page
// defect on every page — all 14 priority pages produced a byte-identical
// header diff (6 of 80 labels), which would be 632 identical "defects" on the
// full set and 632 rows of "เทมเพลตไม่ครบ" in the sheet's Open Issues. The
// comparison is correct, the granularity was not. scoreMenu is exported so
// build-dashboard.js can report it ONCE at site level instead.
import { META_KEYS, META_INFO_KEYS } from '../../config.js';
import { makeCheck, normCompare, assetPath, matchAssetPath, assetPathsEqual } from './util.js';

// True when a metrics object has the newer extract fields; older captures
// (300 of the 358 scored pages) mark `template` insufficient instead of failing.
const hasNewMetrics = (m) => !!(m && m.componentCounts && m.headerMenus && m.footerMenus);

// count equal + 100% label match; partial = matched / union so EXTRA labels
// on AEM reduce the score too (partial must never be 1.0 while failing).
// Labels are keyed without spaces: the two sites differ only in space
// placement on some entries ("การออม/การลงทุน" vs "การออม / การลงทุน",
// "…ธุรกิจ พร้อมขาย" vs "…ธุรกิจพร้อมขาย"), which is not a missing menu item.
// Thai has no inter-word spaces, so removing them cannot merge distinct labels.
const labelKey = (s) => (s || '').toLowerCase().replace(/\s+/g, '');
export function scoreMenu(prodMenus, aemMenus) {
  const keyToLabel = new Map();
  const keys = (menus) => new Set((menus || []).map(m => {
    const k = labelKey(m.label);
    if (k && !keyToLabel.has(k)) keyToLabel.set(k, m.label);
    return k;
  }).filter(Boolean));
  const pSet = keys(prodMenus);
  const aSet = keys(aemMenus);
  // Report the original label text, not the space-stripped key.
  const missing = [...pSet].filter(l => !aSet.has(l)).map(k => keyToLabel.get(k) || k);
  const extra = [...aSet].filter(l => !pSet.has(l)).map(k => keyToLabel.get(k) || k);
  const matched = pSet.size - missing.length;
  const union = pSet.size + extra.length;
  const hit = union > 0 ? matched / union : 1;
  const pass = pSet.size === aSet.size && missing.length === 0;
  return {
    pass, hit,
    detail: `${aSet.size}/${pSet.size} labels${missing.length ? ` · ${missing.length} missing` : ''}${extra.length ? ` · ${extra.length} extra` : ''}`,
    diff: { prodCount: pSet.size, aemCount: aSet.size, missing: missing.slice(0, 20), extra: extra.slice(0, 20) },
  };
}

// each prod-present component type must be ≥80% in AEM; prod-absent types
// must stay absent (ratio 0 otherwise); accordions must also be FILLED.
function scoreComponents(prod, aem) {
  // Content-scoped counts when both sides have them. Whole-page counts
  // included chrome and unrendered nodes: prod's "6 accordions" were the
  // hidden cookie banner (accordionItem open-cookie), compared against AEM's
  // zero — a guaranteed fail on every page that described nothing real.
  const scoped = !!(prod.mainComponentCounts && aem.mainComponentCounts);
  const pC = scoped ? prod.mainComponentCounts : (prod.componentCounts || {});
  const aC = scoped ? aem.mainComponentCounts : (aem.componentCounts || {});
  const types = ['accordion', 'table', 'form', 'video'];
  const emptyAcc = aem.emptyAccordions || 0;
  const perType = types.map(t => {
    const p = pC[t] || 0, a = aC[t] || 0;
    let ratio = p > 0 ? Math.min(1, a / (p * 0.8)) : (a === 0 ? 1 : 0);
    let ok = p === 0 ? a === 0 : a >= Math.ceil(p * 0.8);
    if (t === 'accordion' && a > 0 && emptyAcc > 0) {
      ok = false;
      ratio *= (a - emptyAcc) / a;
    }
    return { type: t, prod: p, aem: a, ratio, ok };
  });

  // Advisory-only components (carousel, tabs) with counts split per side so a component
  // prod has but AEM dropped is visible (a merged union couldn't distinguish).
  const advisory = ['carousel', 'tabs'].map(t => ({ type: t, prod: pC[t] || 0, aem: aC[t] || 0 })).filter(t => t.prod || t.aem);

  // Other components present on each side.
  const pOther = new Set(prod.otherComponents || []);
  const aOther = new Set(aem.otherComponents || []);
  const otherComponents = {
    prodOnly: [...pOther].filter(c => !aOther.has(c)),
    aemOnly: [...aOther].filter(c => !pOther.has(c)),
    both: [...pOther].filter(c => aOther.has(c)),
  };

  const detailParts = perType.map(t => `${t.type} ${t.aem}/${t.prod}${t.type === 'accordion' && emptyAcc ? ` (${emptyAcc} empty)` : ''}${t.ok ? '' : '✗'}`);
  const advisoryPart = advisory.length ? ` · advisory: ${advisory.map(t => `${t.type} ${t.aem}/${t.prod}`).join(', ')}` : '';

  return {
    pass: perType.every(t => t.ok),
    hit: perType.reduce((s, t) => s + t.ratio, 0) / perType.length,
    detail: detailParts.join(' · ') + advisoryPart + (scoped ? '' : ' · whole page (legacy capture)'),
    diff: { perType, advisory, emptyAccordions: emptyAcc, otherComponents, scope: scoped ? 'main' : 'full-page' },
  };
}

export function structureChecks(prod, aem) {
  const checks = [];

  // headings: Jaccard over normalised heading-text sets, with matched outlines.
  const headingText = (h) => (typeof h === 'string' ? h : h.text);
  const pH = new Set((prod.headings || []).map(headingText).map(s => s.toLowerCase()));
  const aH = new Set((aem.headings || []).map(headingText).map(s => s.toLowerCase()));
  const hInter = [...pH].filter(x => aH.has(x)).length;
  const hUnion = new Set([...pH, ...aH]).size || 1;
  const jac = hInter / hUnion;
  const outline = (hs, other) => (hs || []).map(h => ({
    level: typeof h === 'string' ? 0 : h.level,
    text: headingText(h),
    tag: typeof h === 'string' ? '' : h.tag,
    matched: other.has(headingText(h).toLowerCase()),
  }));
  checks.push(makeCheck('headings', 'Headings (Jaccard)', jac > 0.6,
    `${aem.headingCount}/${prod.headingCount} headings (Jaccard ${Math.round(jac * 100)}%)`,
    jac, { prodOutline: outline(prod.headings, aH), aemOutline: outline(aem.headings, pH) }));

  // links: fraction of prod link-texts found in AEM.
  const pLinks = new Set((prod.links || []).map(l => l.text.toLowerCase()).filter(Boolean));
  const aLinks = new Set((aem.links || []).map(l => l.text.toLowerCase()).filter(Boolean));
  const linkHit = pLinks.size > 0 ? [...pLinks].filter(t => aLinks.has(t)).length / pLinks.size : 0;
  checks.push(makeCheck('links', 'Links match', linkHit > 0.5,
    `${aem.linkCount}/${prod.linkCount} links (${Math.round(linkHit * 100)}% of prod link-texts found)`,
    linkHit, { matchedCount: [...pLinks].filter(t => aLinks.has(t)).length }));

  // meta: partial credit per matched key (META_KEYS). `canonical` is excluded
  // because prod emits none while AEM always does, and META_INFO_KEYS (keywords)
  // are reported but not scored — see config for the reasoning on each.
  // ogImage is matched on asset PRESENCE, with the path compared for
  // information only: both sites serve the same file from different hosts and
  // CMS roots, and AEM gives some assets an opaque hashed name that cannot be
  // matched structurally at all. `pathVerified` distinguishes a confirmed
  // same-path match from a presence-only one.
  const metaEntry = (k, scored) => ({
    key: k,
    scored,
    prod: prod.meta?.[k] || '',
    aem: aem.meta?.[k] || '',
    match: k === 'ogImage'
      ? matchAssetPath(prod.meta?.ogImage, aem.meta?.ogImage)
      : normCompare(prod.meta?.[k], aem.meta?.[k]),
    ...(k === 'ogImage' ? {
      prodPath: assetPath(prod.meta?.ogImage),
      aemPath: assetPath(aem.meta?.ogImage),
      pathVerified: assetPathsEqual(prod.meta?.ogImage, aem.meta?.ogImage),
    } : {}),
  });
  const metaChecks = META_KEYS.map(k => metaEntry(k, true));
  const metaInfo = META_INFO_KEYS.map(k => metaEntry(k, false));
  const metaHits = metaChecks.filter(m => m.match).length;
  const metaMissing = metaChecks.filter(m => m.prod && !m.match).map(m => m.key);
  // Presence note for the unscored keys, e.g. "keywords: prod ✓ / AEM ✗".
  const infoNote = metaInfo
    .map(m => `${m.key}: prod ${m.prod ? '✓' : '✗'} / AEM ${m.aem ? '✓' : '✗'}`)
    .join(' · ');
  checks.push(makeCheck('meta', 'Meta tags', metaHits === META_KEYS.length,
    `${metaHits}/${META_KEYS.length} matched` +
      (metaMissing.length ? ` — missing: ${metaMissing.join(', ')}` : '') +
      (infoNote ? ` · (not scored) ${infoNote}` : ''),
    metaHits / META_KEYS.length,
    { missing: metaMissing, details: metaChecks, info: metaInfo }));

  // template: page components only. Header/footer live in the site-level
  // report — see the header comment.
  const tCheck = (() => {
    if (!hasNewMetrics(prod) || !hasNewMetrics(aem)) {
      const c = makeCheck('template', 'Template (page components)', false,
        'insufficient data (page captured before criteria update)', 0, null);
      c.insufficient = true;
      return c;
    }
    const comp = scoreComponents(prod, aem);
    return makeCheck('template', 'Template (page components)',
      comp.pass, comp.detail, comp.hit, { components: comp.diff });
  })();
  checks.push(tCheck);

  return checks;
}
