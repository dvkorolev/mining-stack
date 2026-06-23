const { test } = require('node:test');
const assert = require('node:assert');
const Database = require('better-sqlite3');
const { MinerRepository } = require('../dist/db/repositories/miner.repository.js');

function freshRepo() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      telegram_chat_id TEXT
    );
    CREATE TABLE miners (
      ip TEXT PRIMARY KEY,
      name TEXT, model TEXT, alias TEXT, owner TEXT,
      owner_user_id INTEGER, status TEXT, credentials TEXT, thresholds TEXT,
      use_https INTEGER, static_power REAL, api_port INTEGER, updated_at INTEGER
    );
    CREATE TABLE miner_pools (
      miner_ip TEXT, pool_url TEXT, pool_priority INTEGER,
      pool_user TEXT, pool_password TEXT, synced_at INTEGER
    );
  `);
  return { db, repo: new MinerRepository(db) };
}

function miner(ip, name, owner = 'alice') {
  return { ip, name, model: 'S19', owner };
}

test('upsertMiner inserts then getMinerByIp reads it back', () => {
  const { db, repo } = freshRepo();
  repo.upsertMiner(miner('10.0.0.1', 'rig1'));
  const m = repo.getMinerByIp('10.0.0.1');
  assert.strictEqual(m.name, 'rig1');
  assert.strictEqual(m.status, 'active'); // default applied
  db.close();
});

test('upsertMiner updates an existing row on ip conflict', () => {
  const { db, repo } = freshRepo();
  repo.upsertMiner(miner('10.0.0.1', 'rig1'));
  repo.upsertMiner({ ...miner('10.0.0.1', 'rig1-renamed'), status: 'disabled' });
  assert.strictEqual(repo.getAllMiners().length, 1);
  const m = repo.getMinerByIp('10.0.0.1');
  assert.strictEqual(m.name, 'rig1-renamed');
  assert.strictEqual(m.status, 'disabled');
  db.close();
});

test('getMinerByName / getMinerByAlias / missing returns null', () => {
  const { db, repo } = freshRepo();
  repo.upsertMiner({ ...miner('10.0.0.1', 'rig1'), alias: 'front-left' });
  assert.strictEqual(repo.getMinerByName('rig1').ip, '10.0.0.1');
  assert.strictEqual(repo.getMinerByAlias('front-left').ip, '10.0.0.1');
  assert.strictEqual(repo.getMinerByIp('10.9.9.9'), null);
  db.close();
});

test('getMinersByOwner matches direct owner and joined telegram_chat_id', () => {
  const { db, repo } = freshRepo();
  const uid = db.prepare('INSERT INTO users (telegram_chat_id) VALUES (?)').run('555').lastInsertRowid;
  repo.upsertMiner(miner('10.0.0.1', 'rig1', 'alice'));
  repo.upsertMiner({ ...miner('10.0.0.2', 'rig2', 'unused'), owner_user_id: uid });

  assert.deepStrictEqual(repo.getMinersByOwner('alice').map(m => m.ip), ['10.0.0.1']);
  assert.deepStrictEqual(repo.getMinersByOwner('555').map(m => m.ip), ['10.0.0.2']);
  db.close();
});

test('deleteMiner returns true when a row is removed, false otherwise', () => {
  const { db, repo } = freshRepo();
  repo.upsertMiner(miner('10.0.0.1', 'rig1'));
  assert.strictEqual(repo.deleteMiner('10.0.0.1'), true);
  assert.strictEqual(repo.deleteMiner('10.0.0.1'), false);
  assert.strictEqual(repo.getMinerByIp('10.0.0.1'), null);
  db.close();
});

test('updateMinerStatus changes the status', () => {
  const { db, repo } = freshRepo();
  repo.upsertMiner(miner('10.0.0.1', 'rig1'));
  repo.updateMinerStatus('10.0.0.1', 'faulty');
  assert.strictEqual(repo.getMinerByIp('10.0.0.1').status, 'faulty');
  db.close();
});

test('setMinerPools replaces pools; getMinerPools returns them by priority', () => {
  const { db, repo } = freshRepo();
  repo.upsertMiner(miner('10.0.0.1', 'rig1'));
  repo.setMinerPools('10.0.0.1', [
    { url: 'stratum+tcp://b', user: 'u2', priority: 2 },
    { url: 'stratum+tcp://a', user: 'u1', password: 'pw', priority: 1 },
  ]);

  let pools = repo.getMinerPools('10.0.0.1');
  assert.deepStrictEqual(pools.map(p => p.url), ['stratum+tcp://a', 'stratum+tcp://b']);
  assert.strictEqual(pools[0].password, 'pw');

  // replace (not append)
  repo.setMinerPools('10.0.0.1', [{ url: 'stratum+tcp://c', user: 'u3', priority: 1 }]);
  pools = repo.getMinerPools('10.0.0.1');
  assert.strictEqual(pools.length, 1);
  assert.strictEqual(pools[0].url, 'stratum+tcp://c');
  db.close();
});

test('getMinersUsingPoolUrl joins miner_pools to miners', () => {
  const { db, repo } = freshRepo();
  repo.upsertMiner(miner('10.0.0.1', 'rig1'));
  repo.setMinerPools('10.0.0.1', [{ url: 'stratum+tcp://shared', user: 'u', priority: 1 }]);
  const rows = repo.getMinersUsingPoolUrl('stratum+tcp://shared');
  assert.deepStrictEqual(rows, [{ miner_ip: '10.0.0.1', name: 'rig1' }]);
  db.close();
});
