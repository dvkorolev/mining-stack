const { test } = require('node:test');
const assert = require('node:assert');
const Database = require('better-sqlite3');
const { UserRepository } = require('../dist/db/repositories/user.repository.js');

function freshRepo() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      telegram_chat_id TEXT, display_name TEXT, role TEXT, status TEXT,
      metadata TEXT, created_at INTEGER, updated_at INTEGER, last_login_at INTEGER
    );
    CREATE TABLE audit_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp INTEGER, user_id INTEGER, action TEXT, resource_type TEXT,
      resource_id TEXT, details TEXT, result TEXT, ip_address TEXT, user_agent TEXT
    );
  `);
  return { db, repo: new UserRepository(db) };
}

test('upsertUser inserts (no id) and returns new id; lookups work', () => {
  const { db, repo } = freshRepo();
  const id = repo.upsertUser({ telegram_chat_id: '100', role: 'admin' });
  assert.ok(id > 0);
  assert.strictEqual(repo.getUserById(id).telegram_chat_id, '100');
  assert.strictEqual(repo.getUserByChatId('100').id, id);
  assert.strictEqual(repo.getUserByChatId('999'), null);
  assert.strictEqual(repo.getUserById(id).status, 'active'); // default applied
  db.close();
});

test('upsertUser with an id updates in place', () => {
  const { db, repo } = freshRepo();
  const id = repo.upsertUser({ telegram_chat_id: '100', role: 'user' });
  const same = repo.upsertUser({ id, telegram_chat_id: '100', role: 'admin', display_name: 'Bob' });
  assert.strictEqual(same, id);
  const u = repo.getUserById(id);
  assert.strictEqual(u.role, 'admin');
  assert.strictEqual(u.display_name, 'Bob');
  db.close();
});

test('getOrCreateUserByChatId creates once then returns the existing row', () => {
  const { db, repo } = freshRepo();
  const created = repo.getOrCreateUserByChatId('555', 'admin');
  assert.strictEqual(created.telegram_chat_id, '555');
  assert.strictEqual(created.role, 'admin');

  const again = repo.getOrCreateUserByChatId('555');
  assert.strictEqual(again.id, created.id);
  assert.strictEqual(db.prepare('SELECT COUNT(*) AS n FROM users').get().n, 1);
  db.close();
});

test('updateUserLastLogin sets last_login_at', () => {
  const { db, repo } = freshRepo();
  const id = repo.upsertUser({ telegram_chat_id: '100', role: 'user' });
  assert.strictEqual(repo.getUserById(id).last_login_at, null);
  repo.updateUserLastLogin(id);
  assert.ok(repo.getUserById(id).last_login_at > 0);
  db.close();
});

test('insertAuditLog writes a row with defaults (result=success, timestamp set)', () => {
  const { db, repo } = freshRepo();
  repo.insertAuditLog({ action: 'login', user_id: 1 });
  const row = db.prepare('SELECT * FROM audit_logs').get();
  assert.strictEqual(row.action, 'login');
  assert.strictEqual(row.result, 'success');
  assert.ok(row.timestamp > 0);
  db.close();
});
