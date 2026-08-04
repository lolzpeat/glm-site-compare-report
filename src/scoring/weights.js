// Single indirection between the scoring modules and config so the
// v2 → canonical promotion touches only this file. Also enforces the
// weight invariants at module load — with 14 entries the 1.00 sum is
// easy to break by hand.
import { WEIGHTS_MAIN_V2, CRITERIA_GROUPS_V2 } from '../../config.js';

export const W = WEIGHTS_MAIN_V2;
export const GROUPS = CRITERIA_GROUPS_V2;

const sum = Object.values(W).reduce((a, b) => a + b, 0);
if (Math.abs(sum - 1) > 1e-9) throw new Error(`WEIGHTS sum to ${sum}, expected 1.0`);
const groupIds = GROUPS.flatMap(g => g.checks);
const wIds = Object.keys(W);
if (new Set(groupIds).size !== groupIds.length) throw new Error('duplicate check id across CRITERIA_GROUPS');
if (groupIds.length !== wIds.length || !groupIds.every(id => id in W)) {
  throw new Error('CRITERIA_GROUPS checks and WEIGHTS keys do not match');
}
