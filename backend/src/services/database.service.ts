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
  status?: string;
  credentials?: string; // JSON string: {username, password}
  thresholds?: string; // JSON string: {hashrate: {expected}, power: {expected}}
  use_https?: number; // 0 or 1 (SQLite boolean)
  static_power?: number;
  api_port?: number;
  created_at?: number;
  updated_at?: number;
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

class DatabaseService {
  private db: Database.Database;
  private dbPath: string;

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
        status TEXT DEFAULT 'active',
        credentials TEXT,
        thresholds TEXT,
        use_https INTEGER DEFAULT 0,
        static_power INTEGER,
        api_port INTEGER,
        created_at INTEGER DEFAULT (strftime('%s', 'now')),
        updated_at INTEGER DEFAULT (strftime('%s', 'now'))
      );
      
      CREATE INDEX IF NOT EXISTS idx_miners_owner ON miners(owner);
      CREATE INDEX IF NOT EXISTS idx_miners_status ON miners(status);
      CREATE INDEX IF NOT EXISTS idx_miners_name ON miners(name);
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

    // Add pool_account_id to miners table (migration)
    try {
      this.db.exec(`ALTER TABLE miners ADD COLUMN pool_account_id INTEGER REFERENCES pool_accounts(id) ON DELETE SET NULL`);
      logger.info('Added pool_account_id column to miners table');
    } catch (error: any) {
      if (!error.message.includes('duplicate column')) {
        logger.warn('Could not add pool_account_id column:', error.message);
      }
    }

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

  /**
   * Insert raw stats record
   */
  insertStats(stats: StatsRecord): void {
    const stmt = this.db.prepare(`
      INSERT INTO stats_raw (
        timestamp, totalHashrate, averageHashrate24h, activeMiners, 
        totalMiners, totalMined, avgTemperature, avgPower, rejectionRate
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    try {
      stmt.run(
        stats.timestamp,
        stats.totalHashrate,
        stats.averageHashrate24h,
        stats.activeMiners,
        stats.totalMiners,
        stats.totalMined,
        stats.avgTemperature,
        stats.avgPower,
        stats.rejectionRate
      );
    } catch (error) {
      logger.error('Error inserting stats:', error);
      throw error;
    }
  }

  /**
   * Get raw stats for a time range
   */
  getStats(startTime: number, endTime: number): StatsRecord[] {
    const stmt = this.db.prepare(`
      SELECT * FROM stats_raw 
      WHERE timestamp >= ? AND timestamp <= ?
      ORDER BY timestamp ASC
    `);

    return stmt.all(startTime, endTime) as StatsRecord[];
  }

  /**
   * Get recent stats (last N records)
   */
  getRecentStats(limit: number = 60): StatsRecord[] {
    const stmt = this.db.prepare(`
      SELECT * FROM stats_raw 
      ORDER BY timestamp DESC 
      LIMIT ?
    `);

    return (stmt.all(limit) as StatsRecord[]).reverse();
  }

  /**
   * Get hourly aggregated stats
   */
  getHourlyStats(startTime: number, endTime: number): AggregatedStats[] {
    const stmt = this.db.prepare(`
      SELECT 
        'hour' as period,
        timestamp,
        avgHashrate,
        maxHashrate,
        minHashrate,
        avgActiveMiners,
        totalMined,
        avgTemperature,
        avgPower,
        avgRejectionRate,
        dataPoints
      FROM stats_hourly 
      WHERE timestamp >= ? AND timestamp <= ?
      ORDER BY timestamp ASC
    `);

    return stmt.all(startTime, endTime) as AggregatedStats[];
  }

  /**
   * Get daily aggregated stats
   */
  getDailyStats(startTime: number, endTime: number): AggregatedStats[] {
    const stmt = this.db.prepare(`
      SELECT 
        'day' as period,
        timestamp,
        avgHashrate,
        maxHashrate,
        minHashrate,
        avgActiveMiners,
        totalMined,
        avgTemperature,
        avgPower,
        avgRejectionRate,
        dataPoints
      FROM stats_daily 
      WHERE timestamp >= ? AND timestamp <= ?
      ORDER BY timestamp ASC
    `);

    return stmt.all(startTime, endTime) as AggregatedStats[];
  }

  /**
   * Aggregate raw data into hourly stats
   */
  aggregateHourly(): void {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO stats_hourly (
        timestamp, avgHashrate, maxHashrate, minHashrate, 
        avgActiveMiners, totalMined, avgTemperature, avgPower, 
        avgRejectionRate, dataPoints
      )
      SELECT 
        (timestamp / 3600000) * 3600000 as hour_timestamp,
        AVG(totalHashrate) as avgHashrate,
        MAX(totalHashrate) as maxHashrate,
        MIN(totalHashrate) as minHashrate,
        AVG(activeMiners) as avgActiveMiners,
        SUM(totalMined) as totalMined,
        AVG(avgTemperature) as avgTemperature,
        AVG(avgPower) as avgPower,
        AVG(rejectionRate) as avgRejectionRate,
        COUNT(*) as dataPoints
      FROM stats_raw
      WHERE timestamp >= (strftime('%s', 'now') - 86400) * 1000
      GROUP BY hour_timestamp
    `);

    try {
      const result = stmt.run();
      logger.info(`Aggregated ${result.changes} hourly records`);
    } catch (error) {
      logger.error('Error aggregating hourly stats:', error);
    }
  }

  /**
   * Aggregate hourly data into daily stats
   */
  aggregateDaily(): void {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO stats_daily (
        timestamp, avgHashrate, maxHashrate, minHashrate, 
        avgActiveMiners, totalMined, avgTemperature, avgPower, 
        avgRejectionRate, dataPoints
      )
      SELECT 
        (timestamp / 86400000) * 86400000 as day_timestamp,
        AVG(avgHashrate) as avgHashrate,
        MAX(maxHashrate) as maxHashrate,
        MIN(minHashrate) as minHashrate,
        AVG(avgActiveMiners) as avgActiveMiners,
        SUM(totalMined) as totalMined,
        AVG(avgTemperature) as avgTemperature,
        AVG(avgPower) as avgPower,
        AVG(avgRejectionRate) as avgRejectionRate,
        SUM(dataPoints) as dataPoints
      FROM stats_hourly
      WHERE timestamp >= (strftime('%s', 'now') - 2592000) * 1000
      GROUP BY day_timestamp
    `);

    try {
      const result = stmt.run();
      logger.info(`Aggregated ${result.changes} daily records`);
    } catch (error) {
      logger.error('Error aggregating daily stats:', error);
    }
  }

  /**
   * Clean up old raw data (keep last 24 hours)
   */
  cleanupOldRawData(): void {
    const cutoff = Date.now() - (24 * 60 * 60 * 1000); // 24 hours ago
    
    const stmt = this.db.prepare(`
      DELETE FROM stats_raw WHERE timestamp < ?
    `);

    try {
      const result = stmt.run(cutoff);
      if (result.changes > 0) {
        logger.info(`Cleaned up ${result.changes} old raw records`);
      }
    } catch (error) {
      logger.error('Error cleaning up raw data:', error);
    }
  }

  /**
   * Clean up old hourly data (keep last 30 days)
   */
  cleanupOldHourlyData(): void {
    const cutoff = Date.now() - (30 * 24 * 60 * 60 * 1000); // 30 days ago
    
    const stmt = this.db.prepare(`
      DELETE FROM stats_hourly WHERE timestamp < ?
    `);

    try {
      const result = stmt.run(cutoff);
      if (result.changes > 0) {
        logger.info(`Cleaned up ${result.changes} old hourly records`);
      }
    } catch (error) {
      logger.error('Error cleaning up hourly data:', error);
    }
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

  /**
   * Get a setting value
   */
  getSetting(key: string): string | null {
    const stmt = this.db.prepare('SELECT value FROM settings WHERE key = ?');
    const result = stmt.get(key) as { value: string } | undefined;
    return result ? result.value : null;
  }

  /**
   * Set a setting value
   */
  setSetting(key: string, value: string): void {
    const stmt = this.db.prepare(`
      INSERT INTO settings (key, value, updated_at) 
      VALUES (?, ?, strftime('%s', 'now'))
      ON CONFLICT(key) DO UPDATE SET 
        value = excluded.value,
        updated_at = strftime('%s', 'now')
    `);
    
    try {
      stmt.run(key, value);
      logger.info(`Setting updated: ${key}`);
    } catch (error) {
      logger.error(`Error updating setting ${key}:`, error);
      throw error;
    }
  }

  /**
   * Delete a setting
   */
  deleteSetting(key: string): void {
    const stmt = this.db.prepare('DELETE FROM settings WHERE key = ?');
    
    try {
      stmt.run(key);
      logger.info(`Setting deleted: ${key}`);
    } catch (error) {
      logger.error(`Error deleting setting ${key}:`, error);
      throw error;
    }
  }

  /**
   * Get all settings
   */
  getAllSettings(): Record<string, string> {
    const stmt = this.db.prepare('SELECT key, value FROM settings');
    const rows = stmt.all() as Array<{ key: string; value: string }>;
    
    const settings: Record<string, string> = {};
    rows.forEach(row => {
      settings[row.key] = row.value;
    });
    
    return settings;
  }

  /**
   * Insert or update a miner record
   */
  upsertMiner(miner: MinerRecord): void {
    const stmt = this.db.prepare(`
      INSERT INTO miners (
        ip, name, model, alias, owner, status, credentials, thresholds,
        use_https, static_power, api_port, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, strftime('%s', 'now'))
      ON CONFLICT(ip) DO UPDATE SET 
        name = excluded.name,
        model = excluded.model,
        alias = excluded.alias,
        owner = excluded.owner,
        status = excluded.status,
        credentials = excluded.credentials,
        thresholds = excluded.thresholds,
        use_https = excluded.use_https,
        static_power = excluded.static_power,
        api_port = excluded.api_port,
        updated_at = strftime('%s', 'now')
    `);
    
    try {
      stmt.run(
        miner.ip,
        miner.name,
        miner.model,
        miner.alias || null,
        miner.owner,
        miner.status || 'active',
        miner.credentials || null,
        miner.thresholds || null,
        miner.use_https || 0,
        miner.static_power || null,
        miner.api_port || null
      );
      logger.info(`Miner upserted: ${miner.name} (${miner.ip})`);
    } catch (error) {
      logger.error(`Error upserting miner ${miner.name}:`, error);
      throw error;
    }
  }

  /**
   * Get all miners for a specific owner
   */
  getMinersByOwner(owner: string): MinerRecord[] {
    const stmt = this.db.prepare(`
      SELECT * FROM miners 
      WHERE owner = ? 
      ORDER BY name ASC
    `);
    return stmt.all(owner) as MinerRecord[];
  }

  /**
   * Get all miners (admin only)
   */
  getAllMiners(): MinerRecord[] {
    const stmt = this.db.prepare(`
      SELECT * FROM miners 
      ORDER BY owner ASC, name ASC
    `);
    return stmt.all() as MinerRecord[];
  }

  /**
   * Get a single miner by IP
   */
  getMinerByIp(ip: string): MinerRecord | null {
    const stmt = this.db.prepare('SELECT * FROM miners WHERE ip = ?');
    const result = stmt.get(ip) as MinerRecord | undefined;
    return result || null;
  }

  /**
   * Get a single miner by name
   */
  getMinerByName(name: string): MinerRecord | null {
    const stmt = this.db.prepare('SELECT * FROM miners WHERE name = ?');
    const result = stmt.get(name) as MinerRecord | undefined;
    return result || null;
  }

  /**
   * Get a single miner by alias
   */
  getMinerByAlias(alias: string): MinerRecord | null {
    const stmt = this.db.prepare('SELECT * FROM miners WHERE alias = ?');
    const result = stmt.get(alias) as MinerRecord | undefined;
    return result || null;
  }

  /**
   * Delete a miner by IP
   */
  deleteMiner(ip: string): boolean {
    const stmt = this.db.prepare('DELETE FROM miners WHERE ip = ?');
    
    try {
      const result = stmt.run(ip);
      if (result.changes > 0) {
        logger.info(`Miner deleted: ${ip}`);
        return true;
      }
      return false;
    } catch (error) {
      logger.error(`Error deleting miner ${ip}:`, error);
      throw error;
    }
  }

  /**
   * Update miner status
   */
  updateMinerStatus(ip: string, status: string): void {
    const stmt = this.db.prepare(`
      UPDATE miners 
      SET status = ?, updated_at = strftime('%s', 'now') 
      WHERE ip = ?
    `);
    
    try {
      stmt.run(status, ip);
      logger.info(`Miner status updated: ${ip} -> ${status}`);
    } catch (error) {
      logger.error(`Error updating miner status ${ip}:`, error);
      throw error;
    }
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

  /**
   * Get miners using a specific pool URL
   */
  getMinersUsingPoolUrl(poolUrl: string): Array<{ miner_ip: string; name: string }> {
    const stmt = this.db.prepare(`
      SELECT DISTINCT mp.miner_ip, m.name
      FROM miner_pools mp
      JOIN miners m ON mp.miner_ip = m.ip
      WHERE mp.pool_url = ?
      ORDER BY m.name ASC
    `);
    return stmt.all(poolUrl) as Array<{ miner_ip: string; name: string }>;
  }

  /**
   * Set miner pools (from hardware sync)
   */
  setMinerPools(minerIp: string, pools: Array<{ url: string; user: string; password?: string; priority: number }>): void {
    const deleteStmt = this.db.prepare('DELETE FROM miner_pools WHERE miner_ip = ?');
    const insertStmt = this.db.prepare(`
      INSERT INTO miner_pools (miner_ip, pool_url, pool_priority, pool_user, pool_password, synced_at)
      VALUES (?, ?, ?, ?, ?, strftime('%s', 'now'))
    `);
    
    try {
      // Delete existing pools for this miner
      deleteStmt.run(minerIp);
      
      // Insert new pools
      for (const pool of pools) {
        insertStmt.run(minerIp, pool.url, pool.priority, pool.user, pool.password || null);
      }
      
      logger.info(`Updated ${pools.length} pool(s) for miner ${minerIp}`);
    } catch (error) {
      logger.error(`Error setting pools for miner ${minerIp}:`, error);
      throw error;
    }
  }

  /**
   * Get pools for a specific miner
   */
  getMinerPools(minerIp: string): Array<{ url: string; user: string; password?: string; priority: number }> {
    const stmt = this.db.prepare(`
      SELECT pool_url as url, pool_user as user, pool_password as password, pool_priority as priority
      FROM miner_pools
      WHERE miner_ip = ?
      ORDER BY pool_priority ASC
    `);
    
    return stmt.all(minerIp) as Array<{ url: string; user: string; password?: string; priority: number }>;
  }

  // Pool config methods removed - configuration moved to pool_accounts table

  /**
   * Clean up invalid stats data (e.g., unrealistic hashrate values)
   * @param maxHashrate Maximum realistic hashrate in TH/s (default: 10000)
   */
  cleanupInvalidStats(maxHashrate: number = 10000): number {
    try {
      const stmt = this.db.prepare(`
        DELETE FROM stats_raw 
        WHERE totalHashrate > ? OR totalHashrate < 0
      `);
      const result = stmt.run(maxHashrate);
      logger.info(`Cleaned up ${result.changes} invalid stats records (hashrate > ${maxHashrate} TH/s)`);
      return result.changes;
    } catch (error) {
      logger.error('Error cleaning up invalid stats:', error);
      throw error;
    }
  }

  // ==================== ALERT RULES MANAGEMENT ====================

  /**
   * Get all alert rules (optionally filtered)
   */
  getAllAlertRules(filters?: {
    enabled?: boolean;
    severity?: string;
    component?: string;
    scope?: string;
    owner?: string;
    minerIp?: string;
  }): AlertRuleRecord[] {
    let query = 'SELECT * FROM alert_rules WHERE 1=1';
    const params: any[] = [];

    if (filters?.enabled !== undefined) {
      query += ' AND enabled = ?';
      params.push(filters.enabled ? 1 : 0);
    }

    if (filters?.severity) {
      query += ' AND severity = ?';
      params.push(filters.severity);
    }

    if (filters?.component) {
      query += ' AND component = ?';
      params.push(filters.component);
    }

    if (filters?.scope) {
      query += ' AND scope = ?';
      params.push(filters.scope);
    }

    if (filters?.owner) {
      query += ' AND (scope = ? OR target_owner = ? OR target_owner IS NULL)';
      params.push('global', filters.owner);
    }

    if (filters?.minerIp) {
      query += ' AND (target_miner_ip = ? OR target_miner_ip IS NULL)';
      params.push(filters.minerIp);
    }

    query += ' ORDER BY rule_group ASC, severity DESC, name ASC';

    const stmt = this.db.prepare(query);
    return stmt.all(...params) as AlertRuleRecord[];
  }

  /**
   * Get alert rule by ID
   */
  getAlertRuleById(id: number): AlertRuleRecord | null {
    const stmt = this.db.prepare('SELECT * FROM alert_rules WHERE id = ?');
    const result = stmt.get(id) as AlertRuleRecord | undefined;
    return result || null;
  }

  /**
   * Get alert rule by name
   */
  getAlertRuleByName(name: string): AlertRuleRecord | null {
    const stmt = this.db.prepare('SELECT * FROM alert_rules WHERE name = ?');
    const result = stmt.get(name) as AlertRuleRecord | undefined;
    return result || null;
  }

  /**
   * Insert new alert rule
   */
  insertAlertRule(rule: Omit<AlertRuleRecord, 'id' | 'created_at' | 'updated_at'>): number {
    const stmt = this.db.prepare(`
      INSERT INTO alert_rules (
        name, display_name, description, rule_group, severity, component,
        expr, for_duration, summary_template, description_template,
        scope, target_miner_ip, target_owner, enabled, is_system, created_by
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    try {
      const result = stmt.run(
        rule.name,
        rule.display_name,
        rule.description || null,
        rule.rule_group,
        rule.severity,
        rule.component,
        rule.expr,
        rule.for_duration,
        rule.summary_template,
        rule.description_template || null,
        rule.scope,
        rule.target_miner_ip || null,
        rule.target_owner || null,
        rule.enabled,
        rule.is_system,
        rule.created_by || null
      );

      const ruleId = result.lastInsertRowid as number;

      // Log to history
      this.logAlertRuleHistory(ruleId, rule.name, 'created', rule.created_by);

      logger.info(`Alert rule created: ${rule.name} (ID: ${ruleId})`);
      return ruleId;
    } catch (error) {
      logger.error(`Error inserting alert rule ${rule.name}:`, error);
      throw error;
    }
  }

  /**
   * Update alert rule
   */
  updateAlertRule(id: number, updates: Partial<AlertRuleRecord>, changedBy?: string): boolean {
    const existing = this.getAlertRuleById(id);
    if (!existing) {
      return false;
    }

    // Build dynamic update query
    const fields: string[] = [];
    const params: any[] = [];

    if (updates.display_name !== undefined) {
      fields.push('display_name = ?');
      params.push(updates.display_name);
    }
    if (updates.description !== undefined) {
      fields.push('description = ?');
      params.push(updates.description);
    }
    if (updates.rule_group !== undefined) {
      fields.push('rule_group = ?');
      params.push(updates.rule_group);
    }
    if (updates.severity !== undefined) {
      fields.push('severity = ?');
      params.push(updates.severity);
    }
    if (updates.component !== undefined) {
      fields.push('component = ?');
      params.push(updates.component);
    }
    if (updates.expr !== undefined) {
      fields.push('expr = ?');
      params.push(updates.expr);
    }
    if (updates.for_duration !== undefined) {
      fields.push('for_duration = ?');
      params.push(updates.for_duration);
    }
    if (updates.summary_template !== undefined) {
      fields.push('summary_template = ?');
      params.push(updates.summary_template);
    }
    if (updates.description_template !== undefined) {
      fields.push('description_template = ?');
      params.push(updates.description_template);
    }
    if (updates.scope !== undefined) {
      fields.push('scope = ?');
      params.push(updates.scope);
    }
    if (updates.target_miner_ip !== undefined) {
      fields.push('target_miner_ip = ?');
      params.push(updates.target_miner_ip);
    }
    if (updates.target_owner !== undefined) {
      fields.push('target_owner = ?');
      params.push(updates.target_owner);
    }
    if (updates.enabled !== undefined) {
      fields.push('enabled = ?');
      params.push(updates.enabled);
    }

    if (fields.length === 0) {
      return false; // No updates
    }

    fields.push('updated_at = strftime(\'%s\', \'now\')');
    params.push(id);

    const stmt = this.db.prepare(`
      UPDATE alert_rules 
      SET ${fields.join(', ')}
      WHERE id = ?
    `);

    try {
      const result = stmt.run(...params);

      if (result.changes > 0) {
        // Log to history
        this.logAlertRuleHistory(id, existing.name, 'updated', changedBy, JSON.stringify(updates));
        logger.info(`Alert rule updated: ${existing.name} (ID: ${id})`);
        return true;
      }
      return false;
    } catch (error) {
      logger.error(`Error updating alert rule ${id}:`, error);
      throw error;
    }
  }

  /**
   * Delete alert rule
   */
  deleteAlertRule(id: number, changedBy?: string): boolean {
    const existing = this.getAlertRuleById(id);
    if (!existing) {
      return false;
    }

    // Don't allow deleting system rules
    if (existing.is_system === 1) {
      throw new Error('Cannot delete system alert rules. Disable them instead.');
    }

    const stmt = this.db.prepare('DELETE FROM alert_rules WHERE id = ?');

    try {
      const result = stmt.run(id);

      if (result.changes > 0) {
        // Log to history
        this.logAlertRuleHistory(id, existing.name, 'deleted', changedBy);
        logger.info(`Alert rule deleted: ${existing.name} (ID: ${id})`);
        return true;
      }
      return false;
    } catch (error) {
      logger.error(`Error deleting alert rule ${id}:`, error);
      throw error;
    }
  }

  /**
   * Toggle alert rule enabled status
   */
  toggleAlertRule(id: number, enabled: boolean, changedBy?: string): boolean {
    const existing = this.getAlertRuleById(id);
    if (!existing) {
      return false;
    }

    const stmt = this.db.prepare(`
      UPDATE alert_rules 
      SET enabled = ?, updated_at = strftime('%s', 'now')
      WHERE id = ?
    `);

    try {
      const result = stmt.run(enabled ? 1 : 0, id);

      if (result.changes > 0) {
        // Log to history
        const action = enabled ? 'enabled' : 'disabled';
        this.logAlertRuleHistory(id, existing.name, action, changedBy);
        logger.info(`Alert rule ${action}: ${existing.name} (ID: ${id})`);
        return true;
      }
      return false;
    } catch (error) {
      logger.error(`Error toggling alert rule ${id}:`, error);
      throw error;
    }
  }

  /**
   * Log alert rule change to history
   */
  private logAlertRuleHistory(
    ruleId: number,
    ruleName: string,
    action: 'created' | 'updated' | 'deleted' | 'enabled' | 'disabled',
    changedBy?: string,
    changes?: string
  ): void {
    const stmt = this.db.prepare(`
      INSERT INTO alert_rule_history (rule_id, rule_name, action, changed_by, changes)
      VALUES (?, ?, ?, ?, ?)
    `);

    try {
      stmt.run(ruleId, ruleName, action, changedBy || null, changes || null);
    } catch (error) {
      logger.error('Error logging alert rule history:', error);
      // Don't throw - history logging failure shouldn't break the main operation
    }
  }

  /**
   * Get alert rule history
   */
  getAlertRuleHistory(ruleId?: number, limit: number = 100): AlertRuleHistoryRecord[] {
    let query = 'SELECT * FROM alert_rule_history';
    const params: any[] = [];

    if (ruleId !== undefined) {
      query += ' WHERE rule_id = ?';
      params.push(ruleId);
    }

    query += ' ORDER BY timestamp DESC LIMIT ?';
    params.push(limit);

    const stmt = this.db.prepare(query);
    return stmt.all(...params) as AlertRuleHistoryRecord[];
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

  getPoolAccountById(id: number): (PoolAccountRecord & { pool_name: string; api_base_url: string }) | null {
    const stmt = this.db.prepare(`
      SELECT pa.*, p.name as pool_name, p.api_base_url
      FROM pool_accounts pa
      JOIN pool_apis p ON pa.pool_api_id = p.id
      WHERE pa.id = ?
    `);
    return stmt.get(id) as (PoolAccountRecord & { pool_name: string; api_base_url: string }) | null;
  }

  insertPoolAccount(account: Omit<PoolAccountRecord, 'id'>): number {
    const stmt = this.db.prepare(`
      INSERT INTO pool_accounts (pool_api_id, account_name, usernames, api_key, coin, notes, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, strftime('%s', 'now'), strftime('%s', 'now'))
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
