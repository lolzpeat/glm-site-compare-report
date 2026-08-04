// Missing-content group: contentLength, missingText, missingKeywords.
import { TEXT_MATCH_TOLERANCE } from '../../config.js';
import { makeCheck, isDynamicBlock } from './util.js';

export function contentChecks(prod, aem) {
  const checks = [];

  // contentLength: text within ±TEXT_MATCH_TOLERANCE. Partial degrades on
  // both sides of 1.0 (the pre-v2 code let ratio>1 exceed full credit).
  //
  // Prefers main-content length (header/footer/nav excluded) when BOTH sides
  // carry it. The global chrome is near-identical across the two sites, so
  // counting it dilutes the ratio toward 1 and flatters AEM. Captures predating
  // the metric fall back to whole-page length, flagged in `detail` and `scope`
  // so a legacy page is never silently compared against a main-only one.
  const useMain = typeof prod.mainTextLength === 'number' && typeof aem.mainTextLength === 'number';
  const pLen = useMain ? prod.mainTextLength : prod.textLength;
  const aLen = useMain ? aem.mainTextLength : aem.textLength;
  const ratio = pLen > 0 ? aLen / pLen : 0;
  const lenPass = Math.abs(1 - ratio) <= TEXT_MATCH_TOLERANCE;
  const sample = (m) => (useMain ? (m.mainTextSample || m.bodyTextSample) : m.bodyTextSample) || '';
  checks.push(makeCheck('contentLength',
    `Content length (±${Math.round(TEXT_MATCH_TOLERANCE * 100)}%)`, lenPass,
    `${aLen}/${pLen} chars (${Math.round(ratio * 100)}%)` +
      (useMain ? ' · main content only' : ' · incl. header/footer (legacy capture)'),
    lenPass ? 1 : Math.max(0, 1 - Math.abs(1 - ratio)),
    {
      ratio: Math.round(ratio * 100),
      scope: useMain ? 'main' : 'full-page',
      prodSource: useMain ? prod.mainTextSource : null,
      aemSource: useMain ? aem.mainTextSource : null,
      prodSample: sample(prod).slice(0, 600),
      aemSample: sample(aem).slice(0, 600),
    }));

  // missingText: prod text blocks not present in AEM.
  const aemBlockSet = new Set((aem.textBlocks || []).map(t => String(t).toLowerCase()));
  const prodBlocks = (prod.textBlocks || []).map(t => String(t).trim()).filter(t => t.length >= 8 && !isDynamicBlock(t));
  const prodBlocksSet = new Set(prodBlocks);
  // Score from the FULL missing count; the 15-block cap is display-only.
  // (Pre-v2 sliced before computing textHit, so any page missing 50 of 100
  // blocks scored identically to one missing 15 — every scored page in the
  // dataset exceeded the cap, so the partial credit was uniformly inflated.)
  const missingAll = [...new Set(prodBlocks.filter(t => !aemBlockSet.has(t.toLowerCase())))];
  const missingTextBlocks = missingAll.slice(0, 15);
  const textHit = prodBlocksSet.size > 0 ? 1 - (missingAll.length / prodBlocksSet.size) : 1;
  checks.push(makeCheck('missingText', 'Missing text blocks', missingAll.length === 0,
    `${missingAll.length}/${prodBlocksSet.size} prod block(s) missing`, textHit,
    { missingTextBlocks, missingCount: missingAll.length, prodBlockCount: prodBlocksSet.size }));

  // missingKeywords: prod top keywords absent from AEM.
  const prodWordMap = new Map((prod.topWords || []).map(w => [w.w, w.c]));
  const aemWordMap = new Map((aem.topWords || []).map(w => [w.w, w.c]));
  const prodKey = [...prodWordMap.keys()].slice(0, 30);
  const missingKeywords = prodKey.filter(w => !aemWordMap.has(w)).slice(0, 20);
  const kwHit = prodKey.length > 0 ? 1 - (missingKeywords.length / prodKey.length) : 1;
  checks.push(makeCheck('missingKeywords', 'Missing keywords', missingKeywords.length === 0,
    `${missingKeywords.length}/${prodKey.length} prod keywords missing`, kwHit,
    { missingKeywords, sharedCount: prodKey.length - missingKeywords.length }));

  return checks;
}
