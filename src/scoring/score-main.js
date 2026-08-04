// v2 main-mode scorer. Assembles the five check groups, computes the weighted
// parity with `insufficient` checks excluded from the denominator, and demotes
// any check whose id is absent from W (weight undefined) to an advisory —
// that mechanism is how the brokenImage calibration gate can turn the check
// advisory-only by removing its weight from config, with no code change here.
import { W } from './weights.js';
import { contentChecks } from './checks-content.js';
import { assetChecks } from './checks-assets.js';
import { alignmentChecks } from './checks-alignment.js';
import { downloadChecks } from './checks-downloads.js';
import { structureChecks } from './checks-structure.js';
import { advisoryIssues } from './advisory.js';

export function scoreMain(prod, aem, context = {}) {
  const all = [
    ...contentChecks(prod, aem),
    ...assetChecks(prod, aem),
    ...alignmentChecks(prod, aem, context),
    ...downloadChecks(prod, aem, context),
    ...structureChecks(prod, aem),
  ];
  const checks = all.filter(c => c.weight !== undefined);
  const demoted = all.filter(c => c.weight === undefined);

  let score = 0, possible = 0;
  for (const c of checks) {
    if (c.insufficient) continue;             // excluded — weight not counted
    score += c.weight * (c.passed ? 1 : c.partial);
    possible += c.weight;
  }
  const parity = Math.min(100, Math.round((possible > 0 ? score / possible : 0) * 100));
  const gaps = checks.filter(c => !c.passed && !c.insufficient).map(c => ({ label: c.label, detail: c.detail, weight: c.weight }));

  const adv = advisoryIssues(prod, aem);
  for (const c of demoted) {
    if (!c.passed && !c.insufficient) adv.aemIssues.push({ severity: 'medium', label: `${c.label} (advisory)`, detail: c.detail });
  }

  return { parity, checks, gaps, ...adv };
}
