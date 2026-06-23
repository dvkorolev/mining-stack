/**
 * Pool Repository
 *
 * Owns pool API definitions (`pool_apis`) and pool accounts (`pool_accounts`):
 * CRUD plus joined account reads. Extracted from DatabaseService (Phase 3.2).
 * Shares the single better-sqlite3 connection owned by DatabaseService.
 *
 * Note: seeding of default pool APIs (initializeDefaultPoolApis) stays on the
 * facade because it runs during schema init, before repositories exist.
 */

import Database from 'better-sqlite3';
import type { PoolApiRecord, PoolAccountRecord } from '../../services/database.service';

export class PoolRepository {
  constructor(private db: Database.Database) {}

  // --- Pool APIs ---

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

  // --- Pool accounts ---

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
}
