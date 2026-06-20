const { test } = require('node:test');
const assert = require('node:assert');
const Database = require('better-sqlite3');
const { runMigrations, MIGRATIONS } = require('../dist/db/migrations.js');

function hasColumn(db, table, column) {
  const columns = db.pragma(`table_info(${table})`);
  return columns.some((col) => col.name === column);
}

function freshDb() {
  const db = new Database(':memory:');
  db.exec('CREATE TABLE miners (ip TEXT PRIMARY KEY, name TEXT)');
  return db;
}

test('fresh database gets mac column and version bump', () => {
  const db = freshDb();
  assert.strictEqual(db.pragma('user_version', { simple: true }), 0);

  runMigrations(db);

  assert.strictEqual(db.pragma('user_version', { simple: true }), 1);
  assert.ok(hasColumn(db, 'miners', 'mac'));

  db.close();
});

test('runMigrations is idempotent', () => {
  const db = freshDb();

  runMigrations(db);
  runMigrations(db);

  assert.strictEqual(db.pragma('user_version', { simple: true }), 1);
  assert.ok(hasColumn(db, 'miners', 'mac'));

  db.close();
});

test('already having mac column does not throw or duplicate', () => {
  const db = new Database(':memory:');
  db.exec('CREATE TABLE miners (ip TEXT PRIMARY KEY, name TEXT, mac TEXT)');
  assert.strictEqual(db.pragma('user_version', { simple: true }), 0);

  assert.doesNotThrow(() => runMigrations(db));

  assert.strictEqual(db.pragma('user_version', { simple: true }), 1);
  const columns = db.pragma('table_info(miners)');
  assert.strictEqual(columns.filter((col) => col.name === 'mac').length, 1);

  db.close();
});
