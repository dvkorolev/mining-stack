const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// stats-reader's import graph initializes the SQLite singleton at require time,
// so point it at a throwaway DATA_DIR before requiring the module.
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'mining-history-'));

const {
  shouldWriteHistoryRow,
  forgetRetiredHistoryRows,
  lastHistoryRow,
  HISTORY_HEARTBEAT_MS,
} = require('../dist/services/mining/stats-reader.js');

const IP = '192.168.2.145';
const T0 = 1788001522471;

function row(overrides = {}) {
  return {
    hashrate: 101.7,
    temperature: 72,
    fanSpeed: 4800,
    powerUsage: 3210,
    rejectionRate: 0.4,
    uptime: 86400,
    ...overrides,
  };
}

function reset() {
  lastHistoryRow.clear();
}

// Records a write the way the caller does, so the tests exercise the same
// state transition the production path performs.
function write(ip, r, at) {
  lastHistoryRow.set(ip, { ...r, writtenAt: at });
}

test('first row for a miner is always written', () => {
  reset();
  assert.strictEqual(shouldWriteHistoryRow(IP, row(), T0), true);
});

test('an identical row inside the heartbeat window is skipped', () => {
  reset();
  write(IP, row(), T0);
  // 30s later, which is MINING_UPDATE_INTERVAL — the case that produced 75%
  // duplicate rows on the Pi.
  assert.strictEqual(shouldWriteHistoryRow(IP, row(), T0 + 30_000), false);
});

test('four consecutive 30s ticks collapse to one write at a 2min data cadence', () => {
  reset();
  let writes = 0;
  // Two scheduler poll windows: values change only at the start of each.
  const samples = [
    row({ uptime: 86400 }), row({ uptime: 86400 }), row({ uptime: 86400 }), row({ uptime: 86400 }),
    row({ uptime: 86520 }), row({ uptime: 86520 }), row({ uptime: 86520 }), row({ uptime: 86520 }),
  ];
  samples.forEach((r, i) => {
    const at = T0 + i * 30_000;
    if (shouldWriteHistoryRow(IP, r, at)) {
      write(IP, r, at);
      writes += 1;
    }
  });
  assert.strictEqual(writes, 2, 'eight 30s ticks over two poll windows should write twice');
});

test('every persisted field is compared, not just hashrate', () => {
  const fields = ['hashrate', 'temperature', 'fanSpeed', 'powerUsage', 'rejectionRate', 'uptime'];
  for (const field of fields) {
    reset();
    write(IP, row(), T0);
    const changed = row({ [field]: row()[field] + 1 });
    assert.strictEqual(
      shouldWriteHistoryRow(IP, changed, T0 + 30_000),
      true,
      `a change in ${field} must force a write`
    );
  }
});

test('the heartbeat writes an unchanged row once the interval has elapsed', () => {
  reset();
  write(IP, row(), T0);
  assert.strictEqual(shouldWriteHistoryRow(IP, row(), T0 + HISTORY_HEARTBEAT_MS - 1), false);
  assert.strictEqual(shouldWriteHistoryRow(IP, row(), T0 + HISTORY_HEARTBEAT_MS), true);
});

test('a steady miner still leaves points, so graphs cannot gap unboundedly', () => {
  reset();
  let writes = 0;
  // 120 unchanging 30s ticks — i=0..119, so the window spans 0..3570s.
  for (let i = 0; i < 120; i += 1) {
    const at = T0 + i * 30_000;
    if (shouldWriteHistoryRow(IP, row(), at)) {
      write(IP, row(), at);
      writes += 1;
    }
  }
  // The first row, then one per 600s heartbeat at t=600,1200,1800,2400,3000.
  // t=3600 falls outside the window, so 6 — against 120 without dedupe.
  assert.strictEqual(writes, 6, 'just under an hour of identical readings should write 6 points');
});

test('miners are tracked independently', () => {
  reset();
  write(IP, row(), T0);
  assert.strictEqual(shouldWriteHistoryRow('192.168.2.117', row(), T0 + 30_000), true);
});

test('retired miners are dropped so the cache cannot grow without bound', () => {
  reset();
  write(IP, row(), T0);
  write('192.168.2.117', row(), T0);
  write('192.168.2.58', row(), T0);
  assert.strictEqual(lastHistoryRow.size, 3);

  forgetRetiredHistoryRows(new Set([IP, '192.168.2.117']));
  assert.strictEqual(lastHistoryRow.size, 2);
  assert.strictEqual(lastHistoryRow.has('192.168.2.58'), false);

  // A miner that comes back is treated as new and writes immediately.
  assert.strictEqual(shouldWriteHistoryRow('192.168.2.58', row(), T0 + 30_000), true);
});
