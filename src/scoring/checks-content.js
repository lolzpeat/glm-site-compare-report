// Missing-content group: contentLength, missingText, missingKeywords.
import { TEXT_MATCH_TOLERANCE } from '../../config.js';
import { makeCheck, isDynamicBlock } from './util.js';

export function contentChecks(prod, aem) {
  const checks = [];

  // contentLength: text within ±TEXT_MATCH_TOLERANCE. Partial degrades on
  // both sides of 1.0 (the pre-v2 code let ratio>1 exceed full credit).
  const ratio = prod.textLength > 0 ? aem.textLength / prod.textLength : 0;
  const lenPass = Math.abs(1 - ratio) <= TEXT_MATCH_TOLERANCE;
  checks.push(makeCheck('contentLength',
    `Content length (±${Math.round(TEXT_MATCH_TOLERANCE * 100)}%)`, lenPass,
    `${aem.textLength}/${prod.textLength} chars (${Math.round(ratio * 100)}%)`,
    lenPass ? 1 : Math.max(0, 1 - Math.abs(1 - ratio)),
    { ratio: Math.round(ratio * 100), prodSample: (prod.bodyTextSample || '').slice(0, 600), aemSample: (aem.bodyTextSample || '').slice(0, 600) }));

  // missingText: prod text blocks not present in AEM.
  const aemBlockSet = new Set((aem.textBlocks || []).map(t => String(t).toLowerCase()));
  const prodBlocks = (prod.textBlocks || []).map(t => String(t).trim()).filter(t => t.length >= 8 && !isDynamicBlock(t));
  const prodBlocksSet = new Set(prodBlocks);
  const missingTextBlocks = [...new Set(prodBlocks.filter(t => !aemBlockSet.has(t.toLowerCase())))].slice(0, 15);
  const textHit = prodBlocksSet.size > 0 ? 1 - (missingTextBlocks.length / prodBlocksSet.size) : 1;
  checks.push(makeCheck('missingText', 'Missing text blocks', missingTextBlocks.length === 0,
    `${missingTextBlocks.length} prod block(s) missing`, textHit,
    { missingTextBlocks, prodBlockCount: prodBlocksSet.size }));

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
