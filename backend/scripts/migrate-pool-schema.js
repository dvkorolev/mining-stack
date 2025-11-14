/**
 * Pool Schema Migration Script
 * 
 * This script:
 * 1. Backs up the database
 * 2. Removes redundant pool tables (pools, pool_config)
 * 3. Adds usernames field to pool_accounts
 * 
 * Usage: node scripts/migrate-pool-schema.js
 */

const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '../../data/miners.db');
const BACKUP_PATH = DB_PATH + `.backup-${Date.now()}`;

console.log('🔄 Pool Schema Migration');
console.log('========================\n');

// Check if database exists
if (!fs.existsSync(DB_PATH)) {
  console.error(`❌ Database not found at: ${DB_PATH}`);
  process.exit(1);
}

console.log(`📂 Database: ${DB_PATH}`);
console.log(`💾 Backup: ${BACKUP_PATH}\n`);

try {
  // Step 1: Create backup
  console.log('1️⃣  Creating backup...');
  fs.copyFileSync(DB_PATH, BACKUP_PATH);
  console.log('   ✅ Backup created successfully\n');

  // Step 2: Open database
  console.log('2️⃣  Opening database...');
  const db = new Database(DB_PATH);
  console.log('   ✅ Database opened\n');

  // Step 3: Check if migration needed
  console.log('3️⃣  Checking current schema...');
  
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
  const tableNames = tables.map(t => t.name);
  
  const hasPools = tableNames.includes('pools');
  const hasPoolConfig = tableNames.includes('pool_config');
  const hasPoolAccounts = tableNames.includes('pool_accounts');
  
  console.log(`   - pools table: ${hasPools ? '✅ exists' : '❌ not found'}`);
  console.log(`   - pool_config table: ${hasPoolConfig ? '✅ exists' : '❌ not found'}`);
  console.log(`   - pool_accounts table: ${hasPoolAccounts ? '✅ exists' : '❌ not found'}\n`);

  if (!hasPools && !hasPoolConfig) {
    console.log('ℹ️  Migration already complete or not needed');
    db.close();
    process.exit(0);
  }

  // Step 4: Add usernames column to pool_accounts (if it doesn't exist)
  if (hasPoolAccounts) {
    console.log('4️⃣  Updating pool_accounts table...');
    
    // Check if usernames column already exists
    const columns = db.prepare('PRAGMA table_info(pool_accounts)').all();
    const hasUsernames = columns.some(col => col.name === 'usernames');
    
    if (!hasUsernames) {
      db.exec('ALTER TABLE pool_accounts ADD COLUMN usernames TEXT');
      console.log('   ✅ Added usernames column\n');
    } else {
      console.log('   ℹ️  usernames column already exists\n');
    }
  }

  // Step 5: Drop redundant tables
  console.log('5️⃣  Removing redundant tables...');
  
  if (hasPools) {
    // Check if there's data to warn about
    const poolCount = db.prepare('SELECT COUNT(*) as count FROM pools').get();
    if (poolCount.count > 0) {
      console.log(`   ⚠️  Warning: pools table has ${poolCount.count} records`);
      console.log('   These will be deleted (miners already have pool config)');
    }
    
    db.exec('DROP TABLE IF EXISTS pools');
    console.log('   ✅ Dropped pools table');
  }
  
  if (hasPoolConfig) {
    db.exec('DROP TABLE IF EXISTS pool_config');
    console.log('   ✅ Dropped pool_config table');
  }
  
  console.log('');

  // Step 6: Verify migration
  console.log('6️⃣  Verifying migration...');
  
  const newTables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
  const newTableNames = newTables.map(t => t.name);
  
  const poolsRemoved = !newTableNames.includes('pools');
  const poolConfigRemoved = !newTableNames.includes('pool_config');
  const poolAccountsExists = newTableNames.includes('pool_accounts');
  
  console.log(`   - pools table removed: ${poolsRemoved ? '✅' : '❌'}`);
  console.log(`   - pool_config table removed: ${poolConfigRemoved ? '✅' : '❌'}`);
  console.log(`   - pool_accounts table exists: ${poolAccountsExists ? '✅' : '❌'}\n`);

  // Step 7: Show pool_accounts structure
  if (poolAccountsExists) {
    console.log('7️⃣  Pool Accounts table structure:');
    const accountColumns = db.prepare('PRAGMA table_info(pool_accounts)').all();
    accountColumns.forEach(col => {
      console.log(`   - ${col.name} (${col.type})${col.notnull ? ' NOT NULL' : ''}`);
    });
    
    const accountCount = db.prepare('SELECT COUNT(*) as count FROM pool_accounts').get();
    console.log(`\n   📊 Total accounts: ${accountCount.count}\n`);
  }

  // Close database
  db.close();
  
  console.log('✅ Migration completed successfully!\n');
  console.log('📝 Next steps:');
  console.log('   1. Deploy backend with updated code');
  console.log('   2. Users should add "usernames" to their pool accounts');
  console.log('   3. Test pool earnings page\n');
  
  console.log(`💾 Backup saved at: ${BACKUP_PATH}\n`);

} catch (error) {
  console.error('\n❌ Migration failed:', error.message);
  console.error('\n📝 Error details:', error);
  console.error(`\n💾 Restore from backup: ${BACKUP_PATH}`);
  process.exit(1);
}
