/**
 * Miner Stats History Repository
 *
 * Owns the `miner_stats_history` table (per-miner time-series for Worker
 * Details graphs, 30-day retention). Extracted from DatabaseService (Phase 3.2).
 * Shares the single better-sqlite3 connection owned by DatabaseService.
 */

import Database from 'better-sqlite3';
import { logger } from '../../utils/logger';
import type { MinerStatsHistoryRecord } from '../../services/database.service';

export class MinerStatsHistoryRepository {
  constructor(private db: Database.Database) {}

  /**
   * Insert a miner stats history record
   */
  insertMinerStatsHistory(record: Omit<MinerStatsHistoryRecord, 'id'>): void {
    const stmt = this.db.prepare(`
      INSERT INTO miner_stats_history (miner_ip, timestamp, hashrate, temperature, fan_speed, power_usage, rejection_rate, uptime)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    try {
      stmt.run(
        record.miner_ip,
        record.timestamp,
        record.hashrate,
        record.temperature,
        record.fan_speed,
        record.power_usage,
        record.rejection_rate,
        record.uptime || 0
      );
    } catch (error) {
      logger.error(`Error inserting miner stats history for ${record.miner_ip}:`, error);
    }
  }

  /**
   * Get miner stats history for a specific miner
   * @param minerIp Miner IP address
   * @param startTime Start timestamp (ms)
   * @param endTime End timestamp (ms)
   */
  getMinerStatsHistory(minerIp: string, startTime: number, endTime: number): MinerStatsHistoryRecord[] {
    const stmt = this.db.prepare(`
      SELECT * FROM miner_stats_history
      WHERE miner_ip = ? AND timestamp >= ? AND timestamp <= ?
      ORDER BY timestamp ASC
    `);

    return stmt.all(minerIp, startTime, endTime) as MinerStatsHistoryRecord[];
  }

  /**
   * Clean up old miner stats history (keep last 30 days)
   * Since we have Grafana/Prometheus for long-term data
   */
  cleanupOldMinerStatsHistory(): number {
    const thirtyDaysAgo = Date.now() - (30 * 24 * 60 * 60 * 1000);

    const stmt = this.db.prepare(`
      DELETE FROM miner_stats_history WHERE timestamp < ?
    `);

    try {
      const result = stmt.run(thirtyDaysAgo);
      if (result.changes > 0) {
        logger.info(`Cleaned up ${result.changes} old miner stats history records (>30 days)`);
      }
      return result.changes;
    } catch (error) {
      logger.error('Error cleaning up miner stats history:', error);
      return 0;
    }
  }
}
