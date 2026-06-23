/**
 * Database Service
 * 
 * Handles SQLite database operations for persistent storage of mining statistics
 * Features:
 * - Time-series data storage
 * - Automatic data aggregation (hourly/daily)
 * - Data retention policies
 * - Backup/restore functionality
 */

import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { logger } from '../utils/logger';
import { config } from '../config/config';
import { runMigrations } from '../db/migrations';
import { SettingsRepository } from '../db/repositories/settings.repository';
import { StatsRepository } from '../db/repositories/stats.repository';
import { MinerStatsHistoryRepository } from '../db/repositories/miner-stats-history.repository';
import { MinerRepository } from '../db/repositories/miner.repository';
import { AlertRuleRepository } from '../db/repositories/alert-rule.repository';

export interface StatsRecord {
  id?: number;
  timestamp: number;
  totalHashrate: number;
  averageHashrate24h: number;
  activeMiners: number;
  totalMiners: number;
  totalMined: number;
  avgTemperature: number;
  avgPower: number;
  rejectionRate: number;
}

export interface AggregatedStats {
  period: string; // 'hour' or 'day'
  timestamp: number;
  avgHashrate: number;
  maxHashrate: number;
  minHashrate: number;
  avgActiveMiners: number;
  totalMined: number;
  avgTemperature: number;
  avgPower: number;
  avgRejectionRate: number;
  dataPoints: number;
}

export interface MinerRecord {
  ip: string;
  name: string;
  model: string;
  alias?: string;
  owner: string;
  owner_user_id?: number | null;
  status?: string;
  credentials?: string; // JSON string: {username, password}
  thresholds?: string; // JSON string: {hashrate: {expected}, power: {expected}}
  use_https?: number; // 0 or 1 (SQLite boolean)
  static_power?: number;
  api_port?: number;
  mac?: string | null;
  created_at?: number;
  updated_at?: number;
}

export interface UserRecord {
  id?: number;
  telegram_chat_id: string;
  display_name?: string | null;
  role: 'admin' | 'user';
  status?: 'active' | 'suspended';
  metadata?: string | null;
  created_at?: number;
  updated_at?: number;
  last_login_at?: number | null;
}

export interface AuditLogRecord {
  id?: number;
  timestamp?: number;
  user_id?: number | null;
  action: string;
  resource_type?: string | null;
  resource_id?: string | null;
  details?: string | null;
  result?: string;
  ip_address?: string | null;
  user_agent?: string | null;
}

export interface AlertRuleRecord {
  id?: number;
  name: string;
  display_name: string;
  description?: string;
  rule_group: string;
  severity: 'critical' | 'warning' | 'info';
  component: 'miner' | 'network' | 'farm' | 'system';
  expr: string;
  for_duration: string;
  summary_template: string;
  description_template?: string;
  scope: 'global' | 'per_miner' | 'per_owner';
  target_miner_ip?: string;
  target_owner?: string;
  enabled: number; // 0 or 1
  is_system: number; // 0 or 1
  created_by?: string;
  created_at?: number;
  updated_at?: number;
}

export interface PoolApiRecord {
  id?: number;
  name: string;
  api_base_url: string;
}

export interface PoolAccountRecord {
  id?: number;
  pool_api_id: number;
  account_name: string;
  usernames?: string; // Comma-separated list of pool usernames for matching
  api_key: string; // Encrypted
  coin?: string;
  notes?: string;
  created_at?: number;
  updated_at?: number;
}

export interface AlertRuleHistoryRecord {
  id?: number;
  rule_id: number;
  rule_name: string;
  action: 'created' | 'updated' | 'deleted' | 'enabled' | 'disabled';
  changed_by?: string;
  changes?: string; // JSON string
  timestamp?: number;
}

/**
 * Per-miner historical stats record for Worker Details graphs
 */
export interface MinerStatsHistoryRecord {
  id?: number;
  miner_ip: string;
  timestamp: number;
  hashrate: number;
  temperature: number;
  fan_speed: number;
  power_usage: number;
  rejection_rate: number;
  uptime?: number;
}

class DatabaseService {
  private db: Database.Database;
  private dbPath: string;

  // Per-domain repositories (facade-over-repositories decomposition, Phase 3.2)
  private settings: SettingsRepository;
  private stats: StatsRepository;
  private minerStatsHistory: MinerStatsHistoryRepository;
  private miners: MinerRepository;
  private alertRules: AlertRuleRepository;

  constructor() {
    // Ensure database directory exists
    const dbDir = path.join(config.paths.data || '/opt/mining-stack/data');
    if (!fs.existsSync(dbDir)) {
      fs.mkdirSync(dbDir, { recursive: true });
    }

    this.dbPath = path.join(dbDir, 'mining-stats.db');
    this.db = new Database(this.dbPath);
    this.db.pragma('journal_mode = WAL'); // Better performance for concurrent access
    
    this.initializeDatabase();

    // Instantiate repositories after the schema is ready; they share this.db
    this.settings = new SettingsRepository(this.db);
    this.stats = new StatsRepository(this.db);
    this.minerStatsHistory = new MinerStatsHistoryRepository(this.db);
    this.miners = new MinerRepository(this.db);
    this.alertRules = new AlertRuleRepository(this.db);

    logger.info(`Database initialized at ${this.dbPath}`);
  }

  /**
   * Initialize database schema
   */
  private initializeDatabase(): void {
    // Raw stats table - stores every data point
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS stats_raw (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp INTEGER NOT NULL,
        totalHashrate REAL NOT NULL,
        averageHashrate24h REAL NOT NULL,
        activeMiners INTEGER NOT NULL,
        totalMiners INTEGER NOT NULL,
        totalMined REAL NOT NULL,
        avgTemperature REAL NOT NULL,
        avgPower REAL NOT NULL,
        rejectionRate REAL NOT NULL,
        created_at INTEGER DEFAULT (strftime('%s', 'now'))
      );
      
      CREATE INDEX IF NOT EXISTS idx_stats_timestamp ON stats_raw(timestamp);
      CREATE INDEX IF NOT EXISTS idx_stats_created ON stats_raw(created_at);
    `);

    // Hourly aggregated stats
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS stats_hourly (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp INTEGER NOT NULL UNIQUE,
        avgHashrate REAL NOT NULL,
        maxHashrate REAL NOT NULL,
        minHashrate REAL NOT NULL,
        avgActiveMiners REAL NOT NULL,
        totalMined REAL NOT NULL,
        avgTemperature REAL NOT NULL,
        avgPower REAL NOT NULL,
        avgRejectionRate REAL NOT NULL,
        dataPoints INTEGER NOT NULL,
        created_at INTEGER DEFAULT (strftime('%s', 'now'))
      );
      
      CREATE INDEX IF NOT EXISTS idx_hourly_timestamp ON stats_hourly(timestamp);
    `);

    // Daily aggregated stats
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS stats_daily (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp INTEGER NOT NULL UNIQUE,
        avgHashrate REAL NOT NULL,
        maxHashrate REAL NOT NULL,
        minHashrate REAL NOT NULL,
        avgActiveMiners REAL NOT NULL,
        totalMined REAL NOT NULL,
        avgTemperature REAL NOT NULL,
        avgPower REAL NOT NULL,
        avgRejectionRate REAL NOT NULL,
        dataPoints INTEGER NOT NULL,
        created_at INTEGER DEFAULT (strftime('%s', 'now'))
      );
      
      CREATE INDEX IF NOT EXISTS idx_daily_timestamp ON stats_daily(timestamp);
    `);

    // Settings table for application configuration
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at INTEGER DEFAULT (strftime('%s', 'now'))
      );
    `);

    // Miners table for multi-user miner inventory
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS miners (
        ip TEXT PRIMARY KEY NOT NULL,
        name TEXT UNIQUE NOT NULL,
        model TEXT NOT NULL,
        alias TEXT,
        owner TEXT NOT NULL,
        owner_user_id INTEGER,
        status TEXT DEFAULT 'active',
        credentials TEXT,
        thresholds TEXT,
        use_https INTEGER DEFAULT 0,
        static_power INTEGER,
        api_port INTEGER,
        created_at INTEGER DEFAULT (strftime('%s', 'now')),
        updated_at INTEGER DEFAULT (strftime('%s', 'now')),
        FOREIGN KEY (owner_user_id) REFERENCES users(id) ON DELETE SET NULL
      );
      
      CREATE INDEX IF NOT EXISTS idx_miners_owner ON miners(owner);
      CREATE INDEX IF NOT EXISTS idx_miners_owner_user ON miners(owner_user_id);
      CREATE INDEX IF NOT EXISTS idx_miners_status ON miners(status);
      CREATE INDEX IF NOT EXISTS idx_miners_name ON miners(name);
    `);

    // Users table for RBAC foundation
    this.db.exec(`
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

    // Audit logs table for sensitive action tracking
    this.db.exec(`
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

    // Miner-Pools join table (many-to-many relationship)
    // NOTE: Stores actual pool configuration from miners (synced from hardware)
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS miner_pools (
        miner_ip TEXT NOT NULL,
        pool_url TEXT NOT NULL,
        pool_priority INTEGER NOT NULL DEFAULT 0,
        pool_user TEXT NOT NULL,
        pool_password TEXT,
        synced_at INTEGER DEFAULT (strftime('%s', 'now')),
        FOREIGN KEY (miner_ip) REFERENCES miners(ip) ON DELETE CASCADE,
        PRIMARY KEY (miner_ip, pool_priority)
      );

      CREATE INDEX IF NOT EXISTS idx_miner_pools_miner_ip ON miner_pools(miner_ip);
      CREATE INDEX IF NOT EXISTS idx_miner_pools_url ON miner_pools(pool_url);
    `);

    // Alert rules table for dynamic alert management
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS alert_rules (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT UNIQUE NOT NULL,
        display_name TEXT NOT NULL,
        description TEXT,
        rule_group TEXT NOT NULL,
        severity TEXT NOT NULL CHECK (severity IN ('critical', 'warning', 'info')),
        component TEXT NOT NULL CHECK (component IN ('miner', 'network', 'farm', 'system')),
        expr TEXT NOT NULL,
        for_duration TEXT NOT NULL,
        summary_template TEXT NOT NULL,
        description_template TEXT,
        scope TEXT NOT NULL DEFAULT 'global' CHECK (scope IN ('global', 'per_miner', 'per_owner')),
        target_miner_ip TEXT,
        target_owner TEXT,
        enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
        is_system INTEGER NOT NULL DEFAULT 0 CHECK (is_system IN (0, 1)),
        created_by TEXT,
        created_at INTEGER DEFAULT (strftime('%s', 'now')),
        updated_at INTEGER DEFAULT (strftime('%s', 'now'))
      );

      CREATE INDEX IF NOT EXISTS idx_alert_rules_enabled ON alert_rules(enabled);
      CREATE INDEX IF NOT EXISTS idx_alert_rules_severity ON alert_rules(severity);
      CREATE INDEX IF NOT EXISTS idx_alert_rules_scope ON alert_rules(scope);
      CREATE INDEX IF NOT EXISTS idx_alert_rules_owner ON alert_rules(target_owner);
      CREATE INDEX IF NOT EXISTS idx_alert_rules_miner ON alert_rules(target_miner_ip);
      CREATE INDEX IF NOT EXISTS idx_alert_rules_group ON alert_rules(rule_group);
    `);

    // Alert rule history for audit trail
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS alert_rule_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        rule_id INTEGER NOT NULL,
        rule_name TEXT NOT NULL,
        action TEXT NOT NULL CHECK (action IN ('created', 'updated', 'deleted', 'enabled', 'disabled')),
        changed_by TEXT,
        changes TEXT,
        timestamp INTEGER DEFAULT (strftime('%s', 'now')),
        FOREIGN KEY (rule_id) REFERENCES alert_rules(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_alert_rule_history_rule ON alert_rule_history(rule_id);
      CREATE INDEX IF NOT EXISTS idx_alert_rule_history_timestamp ON alert_rule_history(timestamp DESC);
    `);

    // Per-miner historical stats for Worker Details graphs (Strata OS)
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS miner_stats_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        miner_ip TEXT NOT NULL,
        timestamp INTEGER NOT NULL,
        hashrate REAL NOT NULL DEFAULT 0,
        temperature REAL NOT NULL DEFAULT 0,
        fan_speed INTEGER NOT NULL DEFAULT 0,
        power_usage INTEGER NOT NULL DEFAULT 0,
        rejection_rate REAL NOT NULL DEFAULT 0,
        uptime INTEGER DEFAULT 0,
        FOREIGN KEY (miner_ip) REFERENCES miners(ip) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_miner_stats_history_ip ON miner_stats_history(miner_ip);
      CREATE INDEX IF NOT EXISTS idx_miner_stats_history_timestamp ON miner_stats_history(timestamp);
      CREATE INDEX IF NOT EXISTS idx_miner_stats_history_ip_time ON miner_stats_history(miner_ip, timestamp);
    `);
    
    // Add thresholds column if it doesn't exist (migration for existing databases)
    try {
      this.db.exec(`ALTER TABLE miners ADD COLUMN thresholds TEXT`);
      logger.info('Added thresholds column to miners table');
    } catch (error: any) {
      // Column already exists, ignore error
      if (!error.message.includes('duplicate column')) {
        logger.warn('Could not add thresholds column:', error.message);
      }
    }

    // Add owner_user_id column if it doesn't exist (migration)
    try {
      this.db.exec(`ALTER TABLE miners ADD COLUMN owner_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL`);
      this.db.exec(`CREATE INDEX IF NOT EXISTS idx_miners_owner_user ON miners(owner_user_id)`);
      logger.info('Added owner_user_id column to miners table');
    } catch (error: any) {
      if (!error.message.includes('duplicate column')) {
        logger.warn('Could not add owner_user_id column:', error.message);
      }
    }

    // Add pool_account_id to miners table (migration)
    try {
      this.db.exec(`ALTER TABLE miners ADD COLUMN pool_account_id INTEGER REFERENCES pool_accounts(id) ON DELETE SET NULL`);
      logger.info('Added pool_account_id column to miners table');
    } catch (error: any) {
      if (!error.message.includes('duplicate column')) {
        logger.warn('Could not add pool_account_id column:', error.message);
      }
    }

    runMigrations(this.db);

    // Initialize default pool APIs
    this.initializeDefaultPoolApis();

    logger.info('Database schema initialized');
  }

  /**
   * Initialize default pool APIs (EMCD)
   */
  private initializeDefaultPoolApis(): void {
    try {
      const existing = this.db.prepare('SELECT COUNT(*) as count FROM pool_apis').get() as { count: number };
      
      if (existing.count === 0) {
        // Add EMCD as default pool API
        this.db.prepare('INSERT INTO pool_apis (name, api_base_url) VALUES (?, ?)').run('EMCD', 'https://api.emcd.io/v2');
        logger.info('Initialized default pool APIs');
      }
    } catch (error) {
      logger.warn('Could not initialize default pool APIs:', error);
    }
  }

  // --- Time-series stats (delegated to StatsRepository) ---

  insertStats(stats: StatsRecord): void {
    this.stats.insertStats(stats);
  }

  getStats(startTime: number, endTime: number): StatsRecord[] {
    return this.stats.getStats(startTime, endTime);
  }

  getRecentStats(limit: number = 60): StatsRecord[] {
    return this.stats.getRecentStats(limit);
  }

  getHourlyStats(startTime: number, endTime: number): AggregatedStats[] {
    return this.stats.getHourlyStats(startTime, endTime);
  }

  getDailyStats(startTime: number, endTime: number): AggregatedStats[] {
    return this.stats.getDailyStats(startTime, endTime);
  }

  aggregateHourly(): void {
    this.stats.aggregateHourly();
  }

  aggregateDaily(): void {
    this.stats.aggregateDaily();
  }

  cleanupOldRawData(): void {
    this.stats.cleanupOldRawData();
  }

  cleanupOldHourlyData(): void {
    this.stats.cleanupOldHourlyData();
  }

  /**
   * Get database statistics
   */
  getDatabaseStats(): {
    rawRecords: number;
    hourlyRecords: number;
    dailyRecords: number;
    dbSize: number;
    oldestRecord: number | null;
    newestRecord: number | null;
  } {
    const rawCount = this.db.prepare('SELECT COUNT(*) as count FROM stats_raw').get() as { count: number };
    const hourlyCount = this.db.prepare('SELECT COUNT(*) as count FROM stats_hourly').get() as { count: number };
    const dailyCount = this.db.prepare('SELECT COUNT(*) as count FROM stats_daily').get() as { count: number };
    
    const oldest = this.db.prepare('SELECT MIN(timestamp) as ts FROM stats_raw').get() as { ts: number | null };
    const newest = this.db.prepare('SELECT MAX(timestamp) as ts FROM stats_raw').get() as { ts: number | null };
    
    let dbSize = 0;
    try {
      const stats = fs.statSync(this.dbPath);
      dbSize = stats.size;
    } catch (error) {
      logger.error('Error getting database size:', error);
    }

    return {
      rawRecords: rawCount.count,
      hourlyRecords: hourlyCount.count,
      dailyRecords: dailyCount.count,
      dbSize,
      oldestRecord: oldest.ts,
      newestRecord: newest.ts,
    };
  }

  /**
   * Backup database to file
   */
  backup(backupPath: string): void {
    try {
      this.db.backup(backupPath);
      logger.info(`Database backed up to ${backupPath}`);
    } catch (error) {
      logger.error('Error backing up database:', error);
      throw error;
    }
  }

  // --- Settings (delegated to SettingsRepository) ---

  getSetting(key: string): string | null {
    return this.settings.getSetting(key);
  }

  setSetting(key: string, value: string): void {
    this.settings.setSetting(key, value);
  }

  deleteSetting(key: string): void {
    this.settings.deleteSetting(key);
  }

  getAllSettings(): Record<string, string> {
    return this.settings.getAllSettings();
  }

  // --- Miners (delegated to MinerRepository) ---

  upsertMiner(miner: MinerRecord): void {
    this.miners.upsertMiner(miner);
  }

  getMinersByOwner(ownerChatId: string): MinerRecord[] {
    return this.miners.getMinersByOwner(ownerChatId);
  }

  getAllMiners(): MinerRecord[] {
    return this.miners.getAllMiners();
  }

  getMinerByIp(ip: string): MinerRecord | null {
    return this.miners.getMinerByIp(ip);
  }

  getMinerByName(name: string): MinerRecord | null {
    return this.miners.getMinerByName(name);
  }

  getMinerByAlias(alias: string): MinerRecord | null {
    return this.miners.getMinerByAlias(alias);
  }

  deleteMiner(ip: string): boolean {
    return this.miners.deleteMiner(ip);
  }

  updateMinerStatus(ip: string, status: string): void {
    this.miners.updateMinerStatus(ip, status);
  }

  /**
   * Optimize database (vacuum and analyze)
   */
  optimize(): void {
    try {
      this.db.exec('VACUUM');
      this.db.exec('ANALYZE');
      logger.info('Database optimized');
    } catch (error) {
      logger.error('Error optimizing database:', error);
    }
  }

  // ==================== POOL MANAGEMENT METHODS ====================

  // Pool management methods removed - miners store pool config directly

  getMinersUsingPoolUrl(poolUrl: string): Array<{ miner_ip: string; name: string }> {
    return this.miners.getMinersUsingPoolUrl(poolUrl);
  }

  setMinerPools(minerIp: string, pools: Array<{ url: string; user: string; password?: string; priority: number }>): void {
    this.miners.setMinerPools(minerIp, pools);
  }

  getMinerPools(minerIp: string): Array<{ url: string; user: string; password?: string; priority: number }> {
    return this.miners.getMinerPools(minerIp);
  }

  // Pool config methods removed - configuration moved to pool_accounts table

  /**
   * Clean up invalid stats data (e.g., unrealistic hashrate values)
   * @param maxHashrate Maximum realistic hashrate in TH/s (default: 10000)
   */
  cleanupInvalidStats(maxHashrate: number = 10000): number {
    return this.stats.cleanupInvalidStats(maxHashrate);
  }

  // --- Miner stats history (delegated to MinerStatsHistoryRepository) ---

  insertMinerStatsHistory(record: Omit<MinerStatsHistoryRecord, 'id'>): void {
    this.minerStatsHistory.insertMinerStatsHistory(record);
  }

  getMinerStatsHistory(minerIp: string, startTime: number, endTime: number): MinerStatsHistoryRecord[] {
    return this.minerStatsHistory.getMinerStatsHistory(minerIp, startTime, endTime);
  }

  cleanupOldMinerStatsHistory(): number {
    return this.minerStatsHistory.cleanupOldMinerStatsHistory();
  }

  // --- Alert rules (delegated to AlertRuleRepository) ---

  getAllAlertRules(filters?: {
    enabled?: boolean;
    severity?: string;
    component?: string;
    scope?: string;
    owner?: string;
    minerIp?: string;
  }): AlertRuleRecord[] {
    return this.alertRules.getAllAlertRules(filters);
  }

  getAlertRuleById(id: number): AlertRuleRecord | null {
    return this.alertRules.getAlertRuleById(id);
  }

  getAlertRuleByName(name: string): AlertRuleRecord | null {
    return this.alertRules.getAlertRuleByName(name);
  }

  insertAlertRule(rule: Omit<AlertRuleRecord, 'id' | 'created_at' | 'updated_at'>): number {
    return this.alertRules.insertAlertRule(rule);
  }

  updateAlertRule(id: number, updates: Partial<AlertRuleRecord>, changedBy?: string): boolean {
    return this.alertRules.updateAlertRule(id, updates, changedBy);
  }

  deleteAlertRule(id: number, changedBy?: string): boolean {
    return this.alertRules.deleteAlertRule(id, changedBy);
  }

  toggleAlertRule(id: number, enabled: boolean, changedBy?: string): boolean {
    return this.alertRules.toggleAlertRule(id, enabled, changedBy);
  }

  getAlertRuleHistory(ruleId?: number, limit: number = 100): AlertRuleHistoryRecord[] {
    return this.alertRules.getAlertRuleHistory(ruleId, limit);
  }

  // ================== POOL API MONITORING METHODS ==================

  getAllPoolApis(): PoolApiRecord[] {
    return this.db.prepare('SELECT * FROM pool_apis').all() as PoolApiRecord[];
  }

  insertPoolApi(poolApi: Omit<PoolApiRecord, 'id'>): number {
    const stmt = this.db.prepare('INSERT INTO pool_apis (name, api_base_url) VALUES (?, ?)');
    const result = stmt.run(poolApi.name, poolApi.api_base_url);
    return result.lastInsertRowid as number;
  }

  updatePoolApi(id: number, poolApi: Omit<PoolApiRecord, 'id'>): void {
    this.db.prepare('UPDATE pool_apis SET name = ?, api_base_url = ? WHERE id = ?').run(poolApi.name, poolApi.api_base_url, id);
  }

  deletePoolApi(id: number): void {
    this.db.prepare('DELETE FROM pool_apis WHERE id = ?').run(id);
  }

  getAllPoolAccounts(): (PoolAccountRecord & { pool_name: string })[] {
    const stmt = this.db.prepare(`
      SELECT pa.*, p.name as pool_name
      FROM pool_accounts pa
      JOIN pool_apis p ON pa.pool_api_id = p.id
    `);
    return stmt.all() as (PoolAccountRecord & { pool_name: string })[];
  }

  getPoolAccountById(id: number): (PoolAccountRecord & { pool_name: string }) | null {
    const stmt = this.db.prepare(`
      SELECT pa.*, p.name as pool_name
      FROM pool_accounts pa
      JOIN pool_apis p ON pa.pool_api_id = p.id
      WHERE pa.id = ?
    `);
    const result = stmt.get(id) as (PoolAccountRecord & { pool_name: string }) | undefined;
    return result || null;
  }

  // ==================== USER MANAGEMENT ====================

  getUserByChatId(chatId: string): UserRecord | null {
    const stmt = this.db.prepare('SELECT * FROM users WHERE telegram_chat_id = ?');
    const result = stmt.get(chatId) as UserRecord | undefined;
    return result || null;
  }

  getUserById(id: number): UserRecord | null {
    const stmt = this.db.prepare('SELECT * FROM users WHERE id = ?');
    const result = stmt.get(id) as UserRecord | undefined;
    return result || null;
  }

  upsertUser(user: UserRecord): number {
    if (user.id) {
      const stmt = this.db.prepare(`
        UPDATE users
        SET telegram_chat_id = ?,
            display_name = ?,
            role = ?,
            status = ?,
            metadata = ?,
            updated_at = strftime('%s','now'),
            last_login_at = COALESCE(?, last_login_at)
        WHERE id = ?
      `);
      stmt.run(
        user.telegram_chat_id,
        user.display_name || null,
        user.role,
        user.status || 'active',
        user.metadata || null,
        user.last_login_at || null,
        user.id
      );
      return user.id;
    }

    const insert = this.db.prepare(`
      INSERT INTO users (
        telegram_chat_id, display_name, role, status, metadata, created_at, updated_at, last_login_at
      ) VALUES (?, ?, ?, ?, ?, strftime('%s','now'), strftime('%s','now'), ?)
    `);

    const result = insert.run(
      user.telegram_chat_id,
      user.display_name || null,
      user.role,
      user.status || 'active',
      user.metadata || null,
      user.last_login_at || null
    );

    return result.lastInsertRowid as number;
  }

  getOrCreateUserByChatId(chatId: string, role: 'admin' | 'user' = 'user'): UserRecord {
    let existing = this.getUserByChatId(chatId);
    if (existing) {
      return existing;
    }

    const id = this.upsertUser({ telegram_chat_id: chatId, role });
    return this.getUserById(id)!;
  }

  updateUserLastLogin(userId: number): void {
    const stmt = this.db.prepare(`
      UPDATE users
      SET last_login_at = strftime('%s','now'),
          updated_at = strftime('%s','now')
      WHERE id = ?
    `);
    stmt.run(userId);
  }

  // ==================== AUDIT LOGGING ====================

  insertAuditLog(entry: AuditLogRecord): void {
    const stmt = this.db.prepare(`
      INSERT INTO audit_logs (
        timestamp, user_id, action, resource_type, resource_id,
        details, result, ip_address, user_agent
      ) VALUES (
        COALESCE(?, strftime('%s','now')),
        ?, ?, ?, ?, ?, ?, ?, ?
      )
    `);

    stmt.run(
      entry.timestamp || null,
      entry.user_id || null,
      entry.action,
      entry.resource_type || null,
      entry.resource_id || null,
      entry.details || null,
      entry.result || 'success',
      entry.ip_address || null,
      entry.user_agent || null
    );
  }

  insertPoolAccount(account: Omit<PoolAccountRecord, 'id'>): number {
    const stmt = this.db.prepare(`
      INSERT INTO pool_accounts (pool_api_id, account_name, usernames, api_key, coin, notes, created_at, updated_at, owner_user_id)
      VALUES (?, ?, ?, ?, ?, ?, strftime('%s', 'now'), strftime('%s', 'now'), ?)
    `);
    const result = stmt.run(
      account.pool_api_id,
      account.account_name,
      account.usernames || null,
      account.api_key,
      account.coin || 'btc',
      account.notes || null
    );
    return result.lastInsertRowid as number;
  }

  updatePoolAccount(id: number, account: Partial<Omit<PoolAccountRecord, 'id'>>): void {
    const stmt = this.db.prepare(`
      UPDATE pool_accounts 
      SET pool_api_id = COALESCE(?, pool_api_id),
          account_name = COALESCE(?, account_name),
          usernames = COALESCE(?, usernames),
          api_key = COALESCE(?, api_key),
          coin = COALESCE(?, coin),
          notes = COALESCE(?, notes),
          updated_at = strftime('%s', 'now')
      WHERE id = ?
    `);
    stmt.run(
      account.pool_api_id !== undefined ? account.pool_api_id : null,
      account.account_name !== undefined ? account.account_name : null,
      account.usernames !== undefined ? account.usernames : null,
      account.api_key !== undefined ? account.api_key : null,
      account.coin !== undefined ? account.coin : null,
      account.notes !== undefined ? account.notes : null,
      id
    );
  }

  deletePoolAccount(id: number): void {
    this.db.prepare('DELETE FROM pool_accounts WHERE id = ?').run(id);
  }

  /**
   * Close database connection
   */
  close(): void {
    this.db.close();
    logger.info('Database connection closed');
  }
}

// Singleton instance
let dbInstance: DatabaseService | null = null;

export const getDatabase = (): DatabaseService => {
  if (!dbInstance) {
    dbInstance = new DatabaseService();
  }
  return dbInstance;
};

export const closeDatabase = (): void => {
  if (dbInstance) {
    dbInstance.close();
    dbInstance = null;
  }
};

export default DatabaseService;
