/**
 * Stats Repository
 *
 * Owns the time-series stats tables (`stats_raw`, `stats_hourly`, `stats_daily`):
 * inserts, range/recent reads, hourly/daily aggregation, and retention cleanup.
 * Extracted from DatabaseService (Phase 3.2). Shares the single better-sqlite3
 * connection owned by DatabaseService.
 */

import Database from 'better-sqlite3';
import { logger } from '../../utils/logger';
import type { StatsRecord, AggregatedStats } from '../../services/database.service';

export class StatsRepository {
  constructor(private db: Database.Database) {}

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
}
