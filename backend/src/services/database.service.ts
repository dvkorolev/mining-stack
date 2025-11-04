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

    logger.info('Database schema initialized');
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
