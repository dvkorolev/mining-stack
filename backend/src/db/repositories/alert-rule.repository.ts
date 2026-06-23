/**
 * Alert Rule Repository
 *
 * Owns alert-rule definitions (`alert_rules`) and their change log
 * (`alert_rule_history`): CRUD, enable/disable toggling, filtered listing,
 * and history. Extracted from DatabaseService (Phase 3.2). Shares the single
 * better-sqlite3 connection owned by DatabaseService.
 */

import Database from 'better-sqlite3';
import { logger } from '../../utils/logger';
import type { AlertRuleRecord, AlertRuleHistoryRecord } from '../../services/database.service';

export class AlertRuleRepository {
  constructor(private db: Database.Database) {}

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
}
