const { test } = require('node:test');
const assert = require('node:assert');
const Database = require('better-sqlite3');
const { PoolRepository } = require('../dist/db/repositories/pool.repository.js');

function freshRepo() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE pool_apis (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT, api_base_url TEXT
    );
    CREATE TABLE pool_accounts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      pool_api_id INTEGER, account_name TEXT, usernames TEXT, api_key TEXT,
      coin TEXT, notes TEXT, created_at INTEGER, updated_at INTEGER,
      owner_user_id INTEGER
    );
  `);
  return { db, repo: new PoolRepository(db) };
}

test('pool API CRUD: insert, list, update, delete', () => {
  const { db, repo } = freshRepo();
  const id = repo.insertPoolApi({ name: 'EMCD', api_base_url: 'https://api.emcd.io/v2' });
  assert.ok(id > 0);
  assert.deepStrictEqual(repo.getAllPoolApis().map(p => p.name), ['EMCD']);

  repo.updatePoolApi(id, { name: 'EMCD2', api_base_url: 'https://x' });
  assert.strictEqual(repo.getAllPoolApis()[0].name, 'EMCD2');

  repo.deletePoolApi(id);
  assert.strictEqual(repo.getAllPoolApis().length, 0);
  db.close();
});

test('pool accounts join pool_apis for pool_name on read', () => {
  const { db, repo } = freshRepo();
  const apiId = repo.insertPoolApi({ name: 'EMCD', api_base_url: 'u' });
  // insert directly to control all columns (insertPoolAccount preserves legacy bind shape)
  const acctId = db.prepare(
    `INSERT INTO pool_accounts (pool_api_id, account_name, api_key, coin) VALUES (?, ?, ?, ?)`
  ).run(apiId, 'main', 'key123', 'btc').lastInsertRowid;

  const all = repo.getAllPoolAccounts();
  assert.strictEqual(all.length, 1);
  assert.strictEqual(all[0].pool_name, 'EMCD');
  assert.strictEqual(all[0].account_name, 'main');

  const one = repo.getPoolAccountById(acctId);
  assert.strictEqual(one.pool_name, 'EMCD');
  assert.strictEqual(repo.getPoolAccountById(999), null);
  db.close();
});

test('updatePoolAccount COALESCE only changes provided fields', () => {
  const { db, repo } = freshRepo();
  const apiId = repo.insertPoolApi({ name: 'EMCD', api_base_url: 'u' });
  const acctId = db.prepare(
    `INSERT INTO pool_accounts (pool_api_id, account_name, api_key, coin, notes) VALUES (?, ?, ?, ?, ?)`
  ).run(apiId, 'main', 'key123', 'btc', 'orig').lastInsertRowid;

  repo.updatePoolAccount(acctId, { account_name: 'renamed' });
  const row = repo.getPoolAccountById(acctId);
  assert.strictEqual(row.account_name, 'renamed');
  assert.strictEqual(row.api_key, 'key123'); // unchanged
  assert.strictEqual(row.notes, 'orig');     // unchanged
  db.close();
});

test('deletePoolAccount removes the row', () => {
  const { db, repo } = freshRepo();
  const apiId = repo.insertPoolApi({ name: 'EMCD', api_base_url: 'u' });
  const acctId = db.prepare(
    `INSERT INTO pool_accounts (pool_api_id, account_name, api_key) VALUES (?, ?, ?)`
  ).run(apiId, 'main', 'k').lastInsertRowid;

  repo.deletePoolAccount(acctId);
  assert.strictEqual(repo.getAllPoolAccounts().length, 0);
  db.close();
});
