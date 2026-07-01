const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// push-receiver's import graph initializes the SQLite singleton at require
// time, so point it at a throwaway DATA_DIR before requiring the module.
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'mining-push-'));

const { normalizeSchedulerMiner, updateMetricsFromScheduler } = require('../dist/services/mining/push-receiver.js');
const { getMiningStats } = require('../dist/services/mining/state.js');

const emptyOwnership = new Map();

// METRICS_SOURCE is unset here, so config defaults to 'prometheus'. The push
// receiver must acknowledge without writing the live snapshot — this pins the
// single-writer invariant (see CLAUDE.md "Live-stats source of truth").
test('push is ignored for live stats when METRICS_SOURCE is not push', async () => {
  const before = getMiningStats();
  await updateMetricsFromScheduler([
    { name: 'miner1', ip: '10.0.0.1', model: 'Antminer S19', hashrate: 95, state: 2, scrape_status: 2 },
  ]);
  assert.strictEqual(getMiningStats(), before);
  assert.strictEqual(getMiningStats().totalHashrate, 0);
  assert.deepStrictEqual(getMiningStats().miners, []);
});

test('normalize: SHA-256 miner mining → online, hashrate kept in TH/s', () => {
  const m = normalizeSchedulerMiner({
    name: 'miner1',
    ip: '10.0.0.1',
    model: 'Antminer S19',
    hashrate: 95.5,
    state: 2,
    scrape_status: 2,
    temp_max: 65,
    fan_speed: 5000,
    power: 3200,
    pool_accepted: 95,
    pool_rejected: 5,
    uptime: 3600,
  }, emptyOwnership);

  assert.strictEqual(m.algorithm, 'sha256');
  assert.strictEqual(m.status, 'online');
  assert.strictEqual(m.currentHashrate, 95.5);
  assert.ok(Math.abs(m.averageHashrate - 95.5 * 0.98) < 1e-9);
  assert.strictEqual(m.shares.rejectionRate, 5);
  assert.strictEqual(m.hardware.temperature, 65);
});

test('normalize: SCRYPT detected by model, hashrate_mhs converted MH/s → TH/s', () => {
  const m = normalizeSchedulerMiner({
    name: 'dg1',
    ip: '10.0.0.2',
    model: 'DG1+',
    hashrate_mhs: 9500,
    state: 2,
    scrape_status: 2,
  }, emptyOwnership);

  assert.strictEqual(m.algorithm, 'scrypt');
  assert.strictEqual(m.currentHashrate, 9500 / 1000000);
});

test('normalize: corrupted hashrate above 200 TH/s is zeroed', () => {
  const m = normalizeSchedulerMiner({
    name: 'broken',
    ip: '10.0.0.3',
    model: 'Antminer S19',
    hashrate: 5000,
    state: 2,
    scrape_status: 2,
  }, emptyOwnership);

  assert.strictEqual(m.currentHashrate, 0);
});

test('normalize: status mapping from scrape_status/state', () => {
  const base = { name: 'x', ip: '10.0.0.4', model: 'Antminer S19', hashrate: 1 };

  // Reachable but idle → offline
  assert.strictEqual(
    normalizeSchedulerMiner({ ...base, scrape_status: 2, state: 1 }, emptyOwnership).status,
    'offline'
  );
  // Reachable but faulty → offline (not error)
  assert.strictEqual(
    normalizeSchedulerMiner({ ...base, scrape_status: 2, state: 0 }, emptyOwnership).status,
    'offline'
  );
  // Timeout → error
  assert.strictEqual(
    normalizeSchedulerMiner({ ...base, scrape_status: 0, state: 2 }, emptyOwnership).status,
    'error'
  );
  // Connection refused / API error → error
  assert.strictEqual(
    normalizeSchedulerMiner({ ...base, scrape_status: -1, state: 2 }, emptyOwnership).status,
    'error'
  );
  // No scrape_status at all → offline
  assert.strictEqual(
    normalizeSchedulerMiner({ ...base, state: 2 }, emptyOwnership).status,
    'offline'
  );
});

test('normalize: owner resolved from ownership map, null becomes undefined', () => {
  const ownership = new Map([
    ['10.0.0.5', 'chat-123'],
    ['10.0.0.6', null],
  ]);
  const base = { model: 'Antminer S19', hashrate: 1, state: 2, scrape_status: 2 };

  assert.strictEqual(
    normalizeSchedulerMiner({ ...base, name: 'a', ip: '10.0.0.5' }, ownership).owner,
    'chat-123'
  );
  assert.strictEqual(
    normalizeSchedulerMiner({ ...base, name: 'b', ip: '10.0.0.6' }, ownership).owner,
    undefined
  );
});

test('normalize: faulty state with errors_count yields a critical MinerError', () => {
  const m = normalizeSchedulerMiner({
    name: 'faulty',
    ip: '10.0.0.7',
    model: 'Antminer S19',
    hashrate: 0,
    state: 0,
    scrape_status: 2,
    errors_count: 3,
  }, emptyOwnership);

  assert.strictEqual(m.errorCount, 1);
  assert.strictEqual(m.errors[0].code, 'MINER_ERROR');
  assert.strictEqual(m.errors[0].severity, 'critical');
  assert.strictEqual(m.lastError, m.errors[0]);
});
