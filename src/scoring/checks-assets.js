// Missing-assets group. The pre-v2 `missingImage` averaged count and alt
// parity into one score, letting a good alt rate mask missing images —
// they are split into independent checks here. `brokenImage` is new: a tag
// that renders (>0 rendered width) whose file never loaded (0×0 natural).
import { makeCheck } from './util.js';

// svg and data: URIs legitimately report zero natural dimensions.
const brokenExcluded = (src = '') => /^data:/i.test(src) || /\.svg([?#]|$)/i.test(src);

export function assetChecks(prod, aem) {
  const checks = [];
  // Content-scoped images when both sides carry them. Whole-page image lists
  // are dominated by chrome (prod: 34 of 44 images sit in header/footer), so
  // alt parity was comparing mega-menu icons between two sites that label
  // their chrome differently — 0% on every page, telling us nothing.
  const scoped = Array.isArray(prod.mainImages) && Array.isArray(aem.mainImages);
  const prodImgs = scoped ? prod.mainImages : (prod.images || []);
  const aemImgs = scoped ? aem.mainImages : (aem.images || []);
  const scopeNote = scoped ? ' · main content only' : ' · whole page (legacy capture)';

  // missingImage counts CSS background-images alongside <img>. Prod serves much
  // of its content imagery as backgrounds, so an <img>-only count was blind
  // exactly where it mattered: prod 2 vs AEM 20 on Board-of-Directors "passed"
  // because AEM had more tags, while prod's real photos were never counted.
  // Captures predating mainBgImages fall back to <img>-only rather than
  // silently comparing a background-aware side against one that isn't.
  const bgScoped = Array.isArray(prod.mainBgImages) && Array.isArray(aem.mainBgImages);
  const prodBg = bgScoped ? prod.mainBgImages : [];
  const aemBg = bgScoped ? aem.mainBgImages : [];
  const prodTotal = prodImgs.length + prodBg.length;
  const aemTotal = aemImgs.length + aemBg.length;
  const bgNote = bgScoped ? ` (${prodImgs.length} img + ${prodBg.length} css / ${aemImgs.length} img + ${aemBg.length} css)` : ' · <img> only (legacy capture)';

  // count ≥80% of prod. When prod has none, AEM adding images is a template
  // mismatch — partial must be 0, not 1 (pre-v2 invariant kept).
  const target = Math.ceil(prodTotal * 0.8);
  const countPass = prodTotal === 0 ? aemTotal === 0 : aemTotal >= target;
  const countPartial = prodTotal === 0 ? (aemTotal === 0 ? 1 : 0) : Math.min(1, aemTotal / target);
  checks.push(makeCheck('missingImage', 'Missing image (count ≥80%)', countPass,
    `${aemTotal}/${prodTotal} images${scopeNote}${bgNote}`, countPartial,
    { prodCount: prodTotal, aemCount: aemTotal, prodImgCount: prodImgs.length, aemImgCount: aemImgs.length,
      prodBgCount: prodBg.length, aemBgCount: aemBg.length, bgScoped,
      scope: scoped ? 'main' : 'full-page' }));

  // brokenImage: AEM-side only — an image AEM added and failed to load is a
  // defect regardless of what prod had. Insufficient when AEM has no images.
  // Only images that FINISHED loading can be judged: `complete === false`
  // means the fetch was still in flight when the page was captured, not that
  // the image is broken. Proven on real pages — every URL flagged under the
  // old naturalWidth-only rule returned HTTP 200 with a valid image body, and
  // a full scroll-through loaded all of them. Captures predating the field
  // (complete === undefined) are excluded rather than guessed at.
  const candidates = aemImgs.filter(i => !brokenExcluded(i.src) && i.complete === true);
  const broken = candidates.filter(i => i.renderedWidth > 0 && i.naturalWidth === 0 && i.naturalHeight === 0);
  const bCheck = makeCheck('brokenImage', 'Broken image (fails to load on AEM)', broken.length === 0,
    `${broken.length}/${candidates.length} AEM image(s) fail to load${scopeNote}`,
    candidates.length > 0 ? 1 - broken.length / candidates.length : 1,
    { broken: broken.slice(0, 20).map(i => ({ src: i.src, alt: i.alt })), candidateCount: candidates.length });
  if (aemImgs.length === 0) { bCheck.insufficient = true; bCheck.passed = false; bCheck.partial = 0; bCheck.detail = 'AEM has no images — nothing to check'; }
  checks.push(bCheck);

  // imageAlt was removed 2026-08-05: prod and AEM cannot be compared on alt
  // text. Prod writes Thai alts, AEM writes English ("แนวทางการดำเนินธุรกิจ
  // อย่างยั่งยืน" vs "guidelines-for-sustainable-business" — the same asset),
  // so exact matching could never pass. Worse, prod serves its content imagery
  // by some means extract.js cannot see: the Board-of-Directors page carries 7
  // <img> in the ENTIRE document, all chrome, while AEM carries 20 in main
  // with real director names. The check scored AEM at 0% for having better alt
  // text than prod, and failed 9 of 14 priority pages identically.

  return checks;
}
