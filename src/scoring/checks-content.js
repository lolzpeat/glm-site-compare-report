// Missing-content group: contentLength, missingText, missingKeywords.
import { TEXT_MATCH_TOLERANCE, SEGMENT_MIN_CHARS, SEGMENT_TAIL_MIN_CHARS } from '../../config.js';
import { makeCheck, isDynamicBlock } from './util.js';

// Cut rendered text into sentence-sized units for missingText.
//
// Thai rarely uses sentence-ending punctuation — spaces separate clauses
// instead — so splitting on `.`/`?`/`!` alone yields one giant unit for a Thai
// page. Split on punctuation first, then accumulate space-separated tokens
// until each unit reaches SEGMENT_MIN_CHARS. Units long enough to be
// distinctive, short enough that one changed word doesn't fail a whole page.
export function segmentsOf(text) {
  const out = [];
  for (const part of String(text ?? '').split(/(?<=[.!?。])\s+/)) {
    let buf = '';
    for (const tok of part.split(' ')) {
      if (!tok) continue;
      buf = buf ? `${buf} ${tok}` : tok;
      if (buf.length >= SEGMENT_MIN_CHARS) { out.push(buf); buf = ''; }
    }
    if (buf.length >= SEGMENT_TAIL_MIN_CHARS) out.push(buf);   // trailing clause
  }
  return out;
}

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
  // A side whose main text collapsed to 0 while its raw text is substantial
  // never laid out at capture time — its zero is a capture artefact, not
  // deleted content, so both sides fall back to whole-page length instead.
  const layoutOk = (m) => !(m.mainTextLength === 0 && (m.mainTextRawLength || 0) > 200);
  const useMain = typeof prod.mainTextLength === 'number' && typeof aem.mainTextLength === 'number'
    && layoutOk(prod) && layoutOk(aem);
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

  // missingText — sentence-level over the RENDERED MAIN TEXT when available.
  //
  // The DOM-block comparison it replaces was structurally wrong here: prod puts
  // each holiday row in its own <p>/<li> while AEM uses <table><td>, so pages
  // whose text was byte-identical still reported ~85% of blocks "missing".
  // It also compared whole-page blocks, so mega-menu labels counted as lost
  // content. Segmenting the visible main text and asking only "does this
  // sentence appear anywhere in AEM's visible text" is immune to both: markup
  // shape stops mattering and chrome is already excluded.
  // Score from the FULL missing count in either mode; the 15-item cap is
  // display-only. (Pre-v2 sliced before computing the hit rate, so a page
  // missing 50 of 100 units scored identically to one missing 15.)
  const useSegments = typeof prod.mainTextFull === 'string' && typeof aem.mainTextFull === 'string'
    && prod.mainTextFull.length > 0;

  const units = useSegments
    ? segmentsOf(prod.mainTextFull).filter(t => !isDynamicBlock(t))
    : (prod.textBlocks || []).map(t => String(t).trim()).filter(t => t.length >= 8 && !isDynamicBlock(t));
  const unitSet = new Set(units);

  // Thai puts no spaces between words — a space is a phrase separator whose
  // placement can shift in migration without changing a single character of
  // meaning (observed: "…อดุลยเดชมหาราช บรมนาถบพิตร" vs "…อดุลยเดช มหาราชบรมนาถบพิตร").
  // Presence is therefore tested space-insensitively; segments that only match
  // once spacing is ignored are counted separately as a formatting signal, so
  // the difference is reported rather than silently erased.
  const despace = (s) => s.toLowerCase().replace(/\s+/g, '');
  const haystack = useSegments ? aem.mainTextFull.toLowerCase() : null;
  const haystackNoSpace = useSegments ? despace(aem.mainTextFull) : null;
  const aemBlockSet = useSegments ? null : new Set((aem.textBlocks || []).map(t => String(t).toLowerCase()));

  let spacingOnly = 0;
  const isPresent = (t) => {
    if (!useSegments) return aemBlockSet.has(t.toLowerCase());
    if (haystack.includes(t.toLowerCase())) return true;
    if (haystackNoSpace.includes(despace(t))) { spacingOnly++; return true; }
    return false;
  };

  const missingAll = [...unitSet].filter(t => !isPresent(t));
  const textHit = unitSet.size > 0 ? 1 - (missingAll.length / unitSet.size) : 1;
  checks.push(makeCheck('missingText',
    useSegments ? 'Missing text (sentences)' : 'Missing text blocks',
    missingAll.length === 0,
    `${missingAll.length}/${unitSet.size} prod ${useSegments ? 'sentence' : 'block'}(s) missing` +
      (useSegments ? ' · main content only' : ' · incl. header/footer (legacy capture)') +
      (spacingOnly ? ` · ${spacingOnly} matched only after ignoring spacing` : ''),
    textHit,
    {
      missingTextBlocks: missingAll.slice(0, 15),
      missingCount: missingAll.length,
      prodBlockCount: unitSet.size,
      spacingOnly,
      scope: useSegments ? 'main-sentences' : 'full-page-blocks',
    }));

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
