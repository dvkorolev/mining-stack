const { test } = require('node:test');
const assert = require('node:assert');
const Database = require('better-sqlite3');
const { SettingsRepository } = require('../dist/db/repositories/settings.repository.js');

function freshRepo() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at INTEGER
    )
  `);
  return { db, repo: new SettingsRepository(db) };
}

test('getSetting returns null for a missing key', () => {
  const { db, repo } = freshRepo();
  assert.strictEqual(repo.getSetting('nope'), null);
  db.close();
});

test('setSetting inserts then getSetting reads it back', () => {
  const { db, repo } = freshRepo();
  repo.setSetting('telegram_chat_id', '12345');
  assert.strictEqual(repo.getSetting('telegram_chat_id'), '12345');
  db.close();
});

test('setSetting upserts (overwrites) an existing key', () => {
  const { db, repo } = freshRepo();
  repo.setSetting('k', 'first');
  repo.setSetting('k', 'second');
  assert.strictEqual(repo.getSetting('k'), 'second');
  const count = db.prepare('SELECT COUNT(*) AS n FROM settings WHERE key = ?').get('k').n;
  assert.strictEqual(count, 1);
  db.close();
});

test('deleteSetting removes the key', () => {
  const { db, repo } = freshRepo();
  repo.setSetting('k', 'v');
  repo.deleteSetting('k');
  assert.strictEqual(repo.getSetting('k'), null);
  db.close();
});

test('getAllSettings returns a key/value map of all rows', () => {
  const { db, repo } = freshRepo();
  repo.setSetting('a', '1');
  repo.setSetting('b', '2');
  assert.deepStrictEqual(repo.getAllSettings(), { a: '1', b: '2' });
  db.close();
});
