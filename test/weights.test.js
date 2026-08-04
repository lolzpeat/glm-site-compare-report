import { test } from 'node:test';
import assert from 'node:assert/strict';
import { W, GROUPS } from '../src/scoring/weights.js';

test('weights sum to exactly 1.0', () => {
  const sum = Object.values(W).reduce((a, b) => a + b, 0);
  assert.ok(Math.abs(sum - 1) < 1e-9, `sum is ${sum}`);
});

test('groups and weights list the same check ids exactly once', () => {
  const groupIds = GROUPS.flatMap(g => g.checks);
  assert.equal(new Set(groupIds).size, groupIds.length, 'duplicate id across groups');
  assert.deepEqual([...groupIds].sort(), Object.keys(W).sort());
});

test('group weights are the sum of their check weights', () => {
  for (const g of GROUPS) {
    const sum = g.checks.reduce((a, id) => a + W[id], 0);
    assert.ok(Math.abs(sum - g.weight) < 1e-9, `${g.id}: ${sum} != ${g.weight}`);
  }
});
