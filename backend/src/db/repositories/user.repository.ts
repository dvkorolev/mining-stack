/**
 * User Repository
 *
 * Owns user accounts (`users`) and the audit log (`audit_logs`): lookups,
 * upsert, get-or-create by Telegram chat id, last-login bump, and audit
 * inserts. Extracted from DatabaseService (Phase 3.2). Shares the single
 * better-sqlite3 connection owned by DatabaseService.
 */

import Database from 'better-sqlite3';
import type { UserRecord, AuditLogRecord } from '../../services/database.service';

export class UserRepository {
  constructor(private db: Database.Database) {}

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
}
