/**
 * Settings Repository
 *
 * Owns the `settings` key/value table. Extracted from DatabaseService as the
 * first slice of the facade-over-repositories decomposition (Phase 3.2).
 * Shares the single better-sqlite3 connection owned by DatabaseService.
 */

import Database from 'better-sqlite3';
import { logger } from '../../utils/logger';

export class SettingsRepository {
  constructor(private db: Database.Database) {}

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
}
