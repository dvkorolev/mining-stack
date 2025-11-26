/**
 * User & Audit Schema Migration Script
 *
 * Steps:
 * 1. Back up the database
 * 2. Ensure users & audit_logs tables exist
 * 3. Add owner_user_id column to miners (if missing)
 * 4. Migrate existing miner owners into users table
 *
 * Usage: DB_PATH=/path/to/mining-stats.db node scripts/migrate-user-schema.js
 */

const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');

const DEFAULT_DB_PATH = path.join(__dirname, '../../data/mining-stats.db');
const DB_PATH = process.env.DB_PATH || DEFAULT_DB_PATH;
const BACKUP_PATH = DB_PATH + `.backup-${Date.now()}`;
const ADMIN_TELEGRAM_CHAT_ID = process.env.ADMIN_TELEGRAM_CHAT_ID || null;

console.log('🔄 User & Audit Schema Migration');
console.log('================================\n');

if (!fs.existsSync(DB_PATH)) {
  console.error(`❌ Database not found at: ${DB_PATH}`);
  process.exit(1);
}

console.log(`📂 Database: ${DB_PATH}`);
console.log(`💾 Backup: ${BACKUP_PATH}\n`);

try {
  console.log('1️⃣  Creating backup...');
  fs.copyFileSync(DB_PATH, BACKUP_PATH);
  console.log('   ✅ Backup created successfully\n');

  console.log('2️⃣  Opening database...');
  const db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  console.log('   ✅ Database opened\n');

  const exec = (sql) => db.exec(sql);

  console.log('3️⃣  Ensuring users table exists...');
  exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      telegram_chat_id TEXT UNIQUE NOT NULL,
      display_name TEXT,
      role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('admin', 'user')),
      status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended')),
      metadata TEXT,
      created_at INTEGER DEFAULT (strftime('%s','now')),
      updated_at INTEGER DEFAULT (strftime('%s','now')),
      last_login_at INTEGER
    );

    CREATE INDEX IF NOT EXISTS idx_users_chat_id ON users(telegram_chat_id);
    CREATE INDEX IF NOT EXISTS idx_users_status ON users(status);
  `);
  console.log('   ✅ users table ready\n');

  console.log('4️⃣  Ensuring audit_logs table exists...');
  exec(`
    CREATE TABLE IF NOT EXISTS audit_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp INTEGER NOT NULL DEFAULT (strftime('%s','now')),
      user_id INTEGER,
      action TEXT NOT NULL,
      resource_type TEXT,
      resource_id TEXT,
      details TEXT,
      result TEXT DEFAULT 'success',
      ip_address TEXT,
      user_agent TEXT,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
    );

    CREATE INDEX IF NOT EXISTS idx_audit_logs_user ON audit_logs(user_id);
    CREATE INDEX IF NOT EXISTS idx_audit_logs_action ON audit_logs(action);
    CREATE INDEX IF NOT EXISTS idx_audit_logs_timestamp ON audit_logs(timestamp);
  `);
  console.log('   ✅ audit_logs table ready\n');

  console.log('5️⃣  Checking miners.owner_user_id column...');
  const minerColumns = db.prepare('PRAGMA table_info(miners)').all();
  const hasOwnerUserId = minerColumns.some((col) => col.name === 'owner_user_id');
  if (!hasOwnerUserId) {
    exec(`ALTER TABLE miners ADD COLUMN owner_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL`);
    exec(`CREATE INDEX IF NOT EXISTS idx_miners_owner_user ON miners(owner_user_id);`);
    console.log('   ✅ Added owner_user_id column to miners\n');
  } else {
    console.log('   ℹ️  owner_user_id column already exists\n');
  }

  console.log('6️⃣  Migrating miner owners to users table...');
  const getUserStmt = db.prepare('SELECT id, role FROM users WHERE telegram_chat_id = ?');
  const insertUserStmt = db.prepare(`
    INSERT INTO users (telegram_chat_id, display_name, role)
    VALUES (?, ?, ?)
  `);
  const updateMinerStmt = db.prepare('UPDATE miners SET owner_user_id = ? WHERE owner = ?');

  const owners = db.prepare('SELECT DISTINCT owner FROM miners WHERE owner IS NOT NULL AND owner != ""').all();
  let createdUsers = 0;
  let updatedMiners = 0;

  const migrateOwner = db.transaction((owner) => {
    let user = getUserStmt.get(owner.owner);
    if (!user) {
      const role = owner.owner === ADMIN_TELEGRAM_CHAT_ID ? 'admin' : 'user';
      const result = insertUserStmt.run(owner.owner, null, role);
      createdUsers += 1;
      user = { id: result.lastInsertRowid, role };
      console.log(`   ➕ Created user for chat ${owner.owner} (role: ${role})`);
    }
    const res = updateMinerStmt.run(user.id, owner.owner);
    updatedMiners += res.changes;
  });

  owners.forEach((owner) => migrateOwner(owner));

  console.log(`   ✅ Users created: ${createdUsers}`);
  console.log(`   ✅ Miners updated: ${updatedMiners}\n`);

  console.log('7️⃣  Migration summary:');
  console.log(`   - Total users: ${db.prepare('SELECT COUNT(*) as count FROM users').get().count}`);
  console.log(`   - Miners with owner_user_id: ${db.prepare('SELECT COUNT(*) as count FROM miners WHERE owner_user_id IS NOT NULL').get().count}`);

  db.close();
  console.log('\n✅ Migration completed successfully!');
  console.log(`💾 Backup saved at: ${BACKUP_PATH}`);
} catch (error) {
  console.error('\n❌ Migration failed:', error.message);
  console.error(error);
  console.error(`\n💾 Restore from backup: ${BACKUP_PATH}`);
  process.exit(1);
}
