const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// lifecycle's import graph initializes the SQLite singleton at require time,
// so point it at a throwaway DATA_DIR before requiring the module.
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'mining-lifecycle-'));

const { startMining, stopMining } = require('../dist/services/mining/lifecycle.js');
const { simulateMiningStats } = require('../dist/services/mining/simulation.js');
const { getMiningStats } = require('../dist/services/mining/state.js');

// SIMULATION_MODE is unset (false) and METRICS_SOURCE defaults to prometheus,
// so startMining must not seed fake data into the live snapshot.
test('startMining/stopMining succeed and never seed fake data by default', async () => {
  const started = await startMining();
  assert.strictEqual(started.success, true);
  assert.strictEqual(started.stats.totalHashrate, 0);
  assert.strictEqual(getMiningStats().totalHashrate, 0);
  assert.deepStrictEqual(getMiningStats().miners, []);

  const stopped = await stopMining();
  assert.strictEqual(stopped.success, true);
});

test('simulateMiningStats returns a full MiningStats aggregate', () => {
  const stats = simulateMiningStats();
  assert.strictEqual(typeof stats.totalHashrate, 'number');
  assert.strictEqual(typeof stats.timestamp, 'number');
  assert.ok(Array.isArray(stats.miners));
  assert.ok(Array.isArray(stats.statsHistory));
  assert.strictEqual(stats.totalMiners, stats.miners.length);
  assert.ok(stats.aggregates, 'expected aggregates to be calculated');
  assert.strictEqual(typeof stats.aggregates.uptimePercent, 'number');
});
