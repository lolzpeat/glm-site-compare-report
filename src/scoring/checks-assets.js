// Missing-assets group. The pre-v2 `missingImage` averaged count and alt
// parity into one score, letting a good alt rate mask missing images —
// they are split into independent checks here. `brokenImage` is new: a tag
// that renders (>0 rendered width) whose file never loaded (0×0 natural).
import { makeCheck } from './util.js';

// svg and data: URIs legitimately report zero natural dimensions.
const brokenExcluded = (src = '') => /^data:/i.test(src) || /\.svg([?#]|$)/i.test(src);

export function assetChecks(prod, aem) {
  const checks = [];
  const prodImgs = prod.images || [];
  const aemImgs = aem.images || [];

  // missingImage: count ≥80% of prod. When prod has none, AEM adding images
  // is a template mismatch — partial must be 0, not 1 (pre-v2 invariant kept).
  const target = Math.ceil(prodImgs.length * 0.8);
  const countPass = prodImgs.length === 0 ? aemImgs.length === 0 : aemImgs.length >= target;
  const countPartial = prodImgs.length === 0 ? (aemImgs.length === 0 ? 1 : 0) : Math.min(1, aemImgs.length / target);
  checks.push(makeCheck('missingImage', 'Missing image (count ≥80%)', countPass,
    `${aemImgs.length}/${prodImgs.length} images`, countPartial,
    { prodCount: prodImgs.length, aemCount: aemImgs.length }));

  // brokenImage: AEM-side only — an image AEM added and failed to load is a
  // defect regardless of what prod had. Insufficient when AEM has no images.
  const candidates = aemImgs.filter(i => !brokenExcluded(i.src));
  const broken = candidates.filter(i => i.renderedWidth > 0 && i.naturalWidth === 0 && i.naturalHeight === 0);
  const bCheck = makeCheck('brokenImage', 'Broken image (fails to load on AEM)', broken.length === 0,
    `${broken.length}/${candidates.length} AEM image(s) fail to load`,
    candidates.length > 0 ? 1 - broken.length / candidates.length : 1,
    { broken: broken.slice(0, 20).map(i => ({ src: i.src, alt: i.alt })), candidateCount: candidates.length });
  if (aemImgs.length === 0) { bCheck.insufficient = true; bCheck.passed = false; bCheck.partial = 0; bCheck.detail = 'AEM has no images — nothing to check'; }
  checks.push(bCheck);

  // imageAlt: fraction of prod alt texts present on AEM.
  const prodAlts = new Set(prodImgs.map(i => (i.alt || '').toLowerCase()).filter(Boolean));
  const aemAlts = new Set(aemImgs.map(i => (i.alt || '').toLowerCase()).filter(Boolean));
  const altHit = prodAlts.size > 0 ? [...prodAlts].filter(a => aemAlts.has(a)).length / prodAlts.size : 0;
  const aCheck = makeCheck('imageAlt', 'Image alt text (>50% match)', altHit > 0.5,
    `alt match ${Math.round(altHit * 100)}%`, altHit,
    { altMatchPct: Math.round(altHit * 100), missingAlts: [...prodAlts].filter(a => !aemAlts.has(a)).slice(0, 20), prodAltCount: prodAlts.size });
  if (prodAlts.size === 0) { aCheck.insufficient = true; aCheck.passed = false; aCheck.partial = 0; aCheck.detail = 'prod has no image alt texts'; }
  checks.push(aCheck);

  return checks;
}
