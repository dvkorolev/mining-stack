const { test } = require('node:test');
const assert = require('node:assert');
const Database = require('better-sqlite3');
const { StatsRepository } = require('../dist/db/repositories/stats.repository.js');

function freshRepo() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE stats_raw (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp INTEGER NOT NULL,
      totalHashrate REAL, averageHashrate24h REAL, activeMiners INTEGER,
      totalMiners INTEGER, totalMined REAL, avgTemperature REAL,
      avgPower REAL, rejectionRate REAL
    );
    CREATE TABLE stats_hourly (
      timestamp INTEGER PRIMARY KEY,
      avgHashrate REAL, maxHashrate REAL, minHashrate REAL,
      avgActiveMiners REAL, totalMined REAL, avgTemperature REAL,
      avgPower REAL, avgRejectionRate REAL, dataPoints INTEGER
    );
    CREATE TABLE stats_daily (
      timestamp INTEGER PRIMARY KEY,
      avgHashrate REAL, maxHashrate REAL, minHashrate REAL,
      avgActiveMiners REAL, totalMined REAL, avgTemperature REAL,
      avgPower REAL, avgRejectionRate REAL, dataPoints INTEGER
    );
  `);
  return { db, repo: new StatsRepository(db) };
}

function sampleStats(ts, hashrate = 100) {
  return {
    timestamp: ts,
    totalHashrate: hashrate,
    averageHashrate24h: hashrate,
    activeMiners: 5,
    totalMiners: 6,
    totalMined: 0.01,
    avgTemperature: 65,
    avgPower: 3000,
    rejectionRate: 0.5,
  };
}

test('insertStats then getStats returns rows in the time range, ascending', () => {
  const { db, repo } = freshRepo();
  repo.insertStats(sampleStats(1000, 100));
  repo.insertStats(sampleStats(3000, 300));
  repo.insertStats(sampleStats(2000, 200));

  const rows = repo.getStats(1000, 3000);
  assert.strictEqual(rows.length, 3);
  assert.deepStrictEqual(rows.map(r => r.timestamp), [1000, 2000, 3000]);

  const narrow = repo.getStats(1500, 2500);
  assert.strictEqual(narrow.length, 1);
  assert.strictEqual(narrow[0].timestamp, 2000);
  db.close();
});

test('getRecentStats returns the last N in ascending order', () => {
  const { db, repo } = freshRepo();
  for (let i = 1; i <= 5; i++) repo.insertStats(sampleStats(i * 1000, i));
  const recent = repo.getRecentStats(3);
  assert.deepStrictEqual(recent.map(r => r.timestamp), [3000, 4000, 5000]);
  db.close();
});

test('cleanupInvalidStats removes out-of-range hashrate rows and returns the count', () => {
  const { db, repo } = freshRepo();
  repo.insertStats(sampleStats(1000, 100));      // valid
  repo.insertStats(sampleStats(2000, 999999));   // too high
  repo.insertStats(sampleStats(3000, -1));       // negative

  const removed = repo.cleanupInvalidStats(10000);
  assert.strictEqual(removed, 2);
  assert.strictEqual(repo.getStats(0, 9999).length, 1);
  db.close();
});

test('aggregateHourly buckets raw rows into stats_hourly', () => {
  const { db, repo } = freshRepo();
  const now = Date.now();
  // two points in the same hour bucket
  repo.insertStats(sampleStats(now, 100));
  repo.insertStats(sampleStats(now + 1000, 200));

  repo.aggregateHourly();
  const hourly = repo.getHourlyStats(0, now + 3600000);
  assert.strictEqual(hourly.length, 1);
  assert.strictEqual(hourly[0].dataPoints, 2);
  assert.strictEqual(hourly[0].avgHashrate, 150);
  db.close();
});

test('cleanupOldRawData deletes rows older than 24h, keeps recent', () => {
  const { db, repo } = freshRepo();
  const now = Date.now();
  repo.insertStats(sampleStats(now - (25 * 60 * 60 * 1000), 50)); // 25h old
  repo.insertStats(sampleStats(now, 100));                        // current

  repo.cleanupOldRawData();
  const remaining = repo.getStats(0, now + 1);
  assert.strictEqual(remaining.length, 1);
  assert.strictEqual(remaining[0].timestamp, now);
  db.close();
});
