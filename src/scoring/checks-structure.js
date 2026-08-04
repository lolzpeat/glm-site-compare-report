// Structure & template group. headings/links/meta are straight ports of the
// pre-v2 checks. `template` merges the pre-v2 headerMenu/footerMenu/components
// checks into one 2% check — their logic is unchanged and their per-part diffs
// survive under diff.{header,footer,components} for the drill-down view.
import { META_KEYS } from '../../config.js';
import { makeCheck, normCompare, assetPath, matchAssetPath, assetPathsEqual } from './util.js';

// True when a metrics object has the newer extract fields; older captures
// (300 of the 358 scored pages) mark `template` insufficient instead of failing.
const hasNewMetrics = (m) => !!(m && m.componentCounts && m.headerMenus && m.footerMenus);

// count equal + 100% label match; partial = matched / union so EXTRA labels
// on AEM reduce the score too (partial must never be 1.0 while failing).
function scoreMenu(prodMenus, aemMenus) {
  const pSet = new Set((prodMenus || []).map(m => (m.label || '').toLowerCase()).filter(Boolean));
  const aSet = new Set((aemMenus || []).map(m => (m.label || '').toLowerCase()).filter(Boolean));
  const missing = [...pSet].filter(l => !aSet.has(l));
  const extra = [...aSet].filter(l => !pSet.has(l));
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
  const pC = prod.componentCounts || {};
  const aC = aem.componentCounts || {};
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
    detail: detailParts.join(' · ') + advisoryPart,
    diff: { perType, advisory, emptyAccordions: emptyAcc, otherComponents },
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

  // meta: partial credit per matched key (META_KEYS — `canonical` excluded,
  // see config). ogImage is matched on asset PRESENCE, with the path compared
  // for information only: both sites serve the same file from different hosts
  // and CMS roots, and AEM gives some assets an opaque hashed name that cannot
  // be matched structurally at all. `pathVerified` in the diff distinguishes a
  // confirmed same-path match from a presence-only one.
  const metaChecks = META_KEYS.map(k => ({
    key: k,
    prod: prod.meta?.[k] || '',
    aem: aem.meta?.[k] || '',
    match: k === 'ogImage'
      ? matchAssetPath(prod.meta?.ogImage, aem.meta?.ogImage)
      : normCompare(prod.meta?.[k], aem.meta?.[k]),
    ...(k === 'ogImage' ? {
      prodPath: assetPath(prod.meta?.ogImage),
      aemPath: assetPath(aem.meta?.ogImage),
      // true = same path verified; false = both present but AEM's hashed name
      // makes the paths incomparable, so presence alone was accepted.
      pathVerified: assetPathsEqual(prod.meta?.ogImage, aem.meta?.ogImage),
    } : {}),
  }));
  const metaHits = metaChecks.filter(m => m.match).length;
  const metaMissing = metaChecks.filter(m => m.prod && !m.match).map(m => m.key);
  checks.push(makeCheck('meta', 'Meta tags', metaHits === META_KEYS.length,
    `${metaHits}/${META_KEYS.length} matched` + (metaMissing.length ? ` — missing: ${metaMissing.join(', ')}` : ''),
    metaHits / META_KEYS.length, { missing: metaMissing, details: metaChecks }));

  // template: header + footer + components merged.
  const tCheck = (() => {
    if (!hasNewMetrics(prod) || !hasNewMetrics(aem)) {
      const c = makeCheck('template', 'Template (header/footer/components)', false,
        'insufficient data (page captured before criteria update)', 0, null);
      c.insufficient = true;
      return c;
    }
    const hm = scoreMenu(prod.headerMenus, aem.headerMenus);
    const fm = scoreMenu(prod.footerMenus, aem.footerMenus);
    const comp = scoreComponents(prod, aem);
    return makeCheck('template', 'Template (header/footer/components)',
      hm.pass && fm.pass && comp.pass,
      `header ${hm.detail} · footer ${fm.detail} · ${comp.detail}`,
      (hm.hit + fm.hit + comp.hit) / 3,
      { header: hm.diff, footer: fm.diff, components: comp.diff });
  })();
  checks.push(tCheck);

  return checks;
}
