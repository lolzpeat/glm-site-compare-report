// Content-alignment group. contentOrder isolates *sequence* from *presence*
// (missingText already scores absent blocks): shared blocks are mapped to
// their FIRST index in AEM's sequence — repeated boilerplate must not create
// ambiguous mappings — and scored by longest-increasing-subsequence coverage.
// visualLayout compares cached screenshot column profiles (height-invariant;
// a merely-longer page must not be flagged).
import { CONTENT_ORDER_PASS, CONTENT_ORDER_MIN_BLOCKS, LAYOUT_PROFILE_PASS } from '../../config.js';
import { makeCheck, isDynamicBlock, lis, profileMatch } from './util.js';

export function alignmentChecks(prod, aem, context = {}) {
  const checks = [];

  // ── contentOrder ──
  const prodSeq = (prod.textBlocks || []).map(t => String(t).trim()).filter(t => t.length >= 8 && !isDynamicBlock(t));
  const aemFirst = new Map();
  (aem.textBlocks || []).forEach((t, i) => {
    const k = String(t).trim().toLowerCase();
    if (!aemFirst.has(k)) aemFirst.set(k, i);
  });
  const seen = new Set();
  const shared = [];   // prod block text, in prod order, deduped
  const indices = [];  // matching first-index in AEM
  for (const b of prodSeq) {
    const k = b.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    if (aemFirst.has(k)) { shared.push(b); indices.push(aemFirst.get(k)); }
  }
  const { length: inOrder, keep } = lis(indices);
  const orderScore = indices.length > 0 ? inOrder / indices.length : 0;
  const oCheck = makeCheck('contentOrder', 'Content order (sequence)', orderScore >= CONTENT_ORDER_PASS,
    `${inOrder}/${indices.length} shared block(s) in prod order (${Math.round(orderScore * 100)}%)`,
    orderScore,
    { sharedCount: indices.length, inOrder, outOfOrder: shared.filter((_, i) => !keep[i]).slice(0, 15) });
  if (indices.length < CONTENT_ORDER_MIN_BLOCKS) {
    oCheck.insufficient = true; oCheck.passed = false; oCheck.partial = 0;
    oCheck.detail = `only ${indices.length} shared block(s) — too few to judge order`;
  }
  checks.push(oCheck);

  // ── visualLayout ──
  const match = profileMatch(context.layout?.prod, context.layout?.aem);
  const vCheck = makeCheck('visualLayout', 'Visual layout (column profile)', (match ?? 0) >= LAYOUT_PROFILE_PASS,
    match == null ? 'no layout profile cached — run: npm run layout-profile' : `profile match ${Math.round(match * 100)}%`,
    match ?? 0,
    match == null ? null : { match: Math.round(match * 100), prodBins: context.layout.prod, aemBins: context.layout.aem });
  if (match == null) { vCheck.insufficient = true; vCheck.passed = false; }
  checks.push(vCheck);

  return checks;
}
