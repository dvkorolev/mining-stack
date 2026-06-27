const { test } = require('node:test');
const assert = require('node:assert');
const Database = require('better-sqlite3');
const { MinerStatsHistoryRepository } = require('../dist/db/repositories/miner-stats-history.repository.js');

function freshRepo() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE miner_stats_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      miner_ip TEXT NOT NULL,
      timestamp INTEGER NOT NULL,
      hashrate REAL, temperature REAL, fan_speed REAL,
      power_usage REAL, rejection_rate REAL, uptime INTEGER
    )
  `);
  return { db, repo: new MinerStatsHistoryRepository(db) };
}

function sample(ip, ts, hashrate = 90) {
  return {
    miner_ip: ip,
    timestamp: ts,
    hashrate,
    temperature: 65,
    fan_speed: 4000,
    power_usage: 3200,
    rejection_rate: 0.3,
    uptime: 3600,
  };
}

test('insert then get returns records for the miner in the range, ascending', () => {
  const { db, repo } = freshRepo();
  repo.insertMinerStatsHistory(sample('10.0.0.1', 3000, 30));
  repo.insertMinerStatsHistory(sample('10.0.0.1', 1000, 10));
  repo.insertMinerStatsHistory(sample('10.0.0.2', 2000, 20)); // different miner

  const rows = repo.getMinerStatsHistory('10.0.0.1', 0, 9999);
  assert.strictEqual(rows.length, 2);
  assert.deepStrictEqual(rows.map(r => r.timestamp), [1000, 3000]);
  db.close();
});

test('get filters by time window', () => {
  const { db, repo } = freshRepo();
  repo.insertMinerStatsHistory(sample('10.0.0.1', 1000));
  repo.insertMinerStatsHistory(sample('10.0.0.1', 5000));
  const rows = repo.getMinerStatsHistory('10.0.0.1', 2000, 6000);
  assert.strictEqual(rows.length, 1);
  assert.strictEqual(rows[0].timestamp, 5000);
  db.close();
});

test('missing uptime defaults to 0', () => {
  const { db, repo } = freshRepo();
  const rec = sample('10.0.0.1', 1000);
  delete rec.uptime;
  repo.insertMinerStatsHistory(rec);
  const rows = repo.getMinerStatsHistory('10.0.0.1', 0, 9999);
  assert.strictEqual(rows[0].uptime, 0);
  db.close();
});

test('cleanupOldMinerStatsHistory deletes rows older than 30 days, returns count', () => {
  const { db, repo } = freshRepo();
  const now = Date.now();
  repo.insertMinerStatsHistory(sample('10.0.0.1', now - (31 * 24 * 60 * 60 * 1000))); // 31d old
  repo.insertMinerStatsHistory(sample('10.0.0.1', now));                              // current

  const removed = repo.cleanupOldMinerStatsHistory();
  assert.strictEqual(removed, 1);
  const remaining = repo.getMinerStatsHistory('10.0.0.1', 0, now + 1);
  assert.strictEqual(remaining.length, 1);
  assert.strictEqual(remaining[0].timestamp, now);
  db.close();
});
