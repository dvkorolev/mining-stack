const { test } = require('node:test');
const assert = require('node:assert');
const { getMiningStats, setMiningStats } = require('../dist/services/mining/state.js');

// state.ts owns the single live MiningStats snapshot with one reader and one
// writer. These tests pin that contract: the getter returns the live value,
// the setter replaces it, and the getter hands back the same reference.

test('default snapshot is zeroed with empty miners/history', () => {
  const stats = getMiningStats();
  assert.strictEqual(stats.totalHashrate, 0);
  assert.strictEqual(stats.activeMiners, 0);
  assert.strictEqual(stats.totalMiners, 0);
  assert.deepStrictEqual(stats.miners, []);
  assert.deepStrictEqual(stats.statsHistory, []);
});

test('setMiningStats replaces the live snapshot', () => {
  const next = {
    totalHashrate: 123,
    totalHashrateSha256: 100,
    totalHashrateScrypt: 23,
    averageHashrate24h: 120,
    averageHashrate24hSha256: 98,
    averageHashrate24hScrypt: 22,
    activeMiners: 3,
    activeMinersSha256: 2,
    activeMinersScrypt: 1,
    totalMiners: 4,
    totalMined: 0.5,
    miners: [],
    timestamp: 1700000000000,
    statsHistory: [],
  };
  setMiningStats(next);
  assert.strictEqual(getMiningStats().totalHashrate, 123);
  assert.strictEqual(getMiningStats().activeMiners, 3);
});

test('getMiningStats returns the live reference (not a copy)', () => {
  const ref = { totalHashrate: 7, miners: [], statsHistory: [] };
  setMiningStats(ref);
  assert.strictEqual(getMiningStats(), ref);
});
