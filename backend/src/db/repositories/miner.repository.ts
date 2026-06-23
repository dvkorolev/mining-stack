/**
 * Miner Repository
 *
 * Owns miner records (`miners`) and their per-miner pool config (`miner_pools`):
 * CRUD, lookups by ip/name/alias/owner, status updates, and pool sync.
 * Extracted from DatabaseService (Phase 3.2). Shares the single better-sqlite3
 * connection owned by DatabaseService.
 */

import Database from 'better-sqlite3';
import { logger } from '../../utils/logger';
import type { MinerRecord } from '../../services/database.service';

export class MinerRepository {
  constructor(private db: Database.Database) {}

  /**
   * Insert or update a miner record
   */
  upsertMiner(miner: MinerRecord): void {
    const stmt = this.db.prepare(`
      INSERT INTO miners (
        ip, name, model, alias, owner, owner_user_id, status, credentials, thresholds,
        use_https, static_power, api_port, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, strftime('%s', 'now'))
      ON CONFLICT(ip) DO UPDATE SET
        name = excluded.name,
        model = excluded.model,
        alias = excluded.alias,
        owner = excluded.owner,
        owner_user_id = excluded.owner_user_id,
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
        miner.owner_user_id || null,
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
  getMinersByOwner(ownerChatId: string): MinerRecord[] {
    const stmt = this.db.prepare(`
      SELECT m.* FROM miners m
      LEFT JOIN users u ON m.owner_user_id = u.id
      WHERE m.owner = ? OR u.telegram_chat_id = ?
      ORDER BY m.name ASC
    `);
    return stmt.all(ownerChatId, ownerChatId) as MinerRecord[];
  }

  /**
   * Get all miners (admin only)
   */
  getAllMiners(): MinerRecord[] {
    const stmt = this.db.prepare(`
      SELECT m.* FROM miners m
      LEFT JOIN users u ON m.owner_user_id = u.id
      ORDER BY COALESCE(u.telegram_chat_id, m.owner) ASC, m.name ASC
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
}
