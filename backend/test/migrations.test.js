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

test('fresh database gets mac and role columns and version bump', () => {
  const db = freshDb();
  assert.strictEqual(db.pragma('user_version', { simple: true }), 0);

  runMigrations(db);

  assert.strictEqual(db.pragma('user_version', { simple: true }), 2);
  assert.ok(hasColumn(db, 'miners', 'mac'));
  assert.ok(hasColumn(db, 'miners', 'role'));

  db.close();
});

test('runMigrations is idempotent', () => {
  const db = freshDb();

  runMigrations(db);
  runMigrations(db);

  assert.strictEqual(db.pragma('user_version', { simple: true }), 2);
  assert.ok(hasColumn(db, 'miners', 'mac'));
  assert.ok(hasColumn(db, 'miners', 'role'));

  db.close();
});

test('already having mac column does not throw or duplicate', () => {
  const db = new Database(':memory:');
  db.exec('CREATE TABLE miners (ip TEXT PRIMARY KEY, name TEXT, mac TEXT)');
  assert.strictEqual(db.pragma('user_version', { simple: true }), 0);

  assert.doesNotThrow(() => runMigrations(db));

  assert.strictEqual(db.pragma('user_version', { simple: true }), 2);
  const columns = db.pragma('table_info(miners)');
  assert.strictEqual(columns.filter((col) => col.name === 'mac').length, 1);
  assert.strictEqual(columns.filter((col) => col.name === 'role').length, 1);

  db.close();
});

test('add_miner_role marks the two parked machines and leaves the rest production', () => {
  const db = freshDb();
  const insert = db.prepare('INSERT INTO miners (ip, name) VALUES (?, ?)');
  insert.run('192.168.2.58', 'whatsminer-058');
  insert.run('192.168.2.117', 'whatsminer-117');
  insert.run('192.168.2.53', 'whatsminer-053');

  runMigrations(db);

  const roles = Object.fromEntries(
    db.prepare('SELECT ip, role FROM miners').all().map((row) => [row.ip, row.role])
  );
  assert.deepStrictEqual(roles, {
    '192.168.2.58': 'stand',
    '192.168.2.117': 'stand',
    '192.168.2.53': 'production',
  });

  db.close();
});

test('role column rejects a third value', () => {
  const db = freshDb();
  runMigrations(db);
  db.prepare("INSERT INTO miners (ip, name) VALUES ('10.0.0.1', 'rig1')").run();

  assert.throws(
    () => db.prepare("UPDATE miners SET role = 'maintenance'").run(),
    /CHECK constraint failed/
  );

  db.close();
});
