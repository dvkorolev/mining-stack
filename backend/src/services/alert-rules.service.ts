/**
 * Alert Rules Service
 * 
 * Manages Prometheus alert rules stored in SQLite database
 * Features:
 * - CRUD operations for alert rules
 * - Generate Prometheus YAML from database
 * - Validate PromQL expressions
 * - Handle rule scopes (global/per-miner/per-owner)
 * - Automatic Prometheus reload after changes
 */

import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';
import { getDatabase, AlertRuleRecord } from './database.service';
import { reloadPrometheusConfig } from './prometheus.service';
import { logger } from '../utils/logger';

export interface AlertRuleFilters {
  enabled?: boolean;
  severity?: 'critical' | 'warning' | 'info';
  component?: 'miner' | 'network' | 'farm' | 'system';
  scope?: 'global' | 'per_miner' | 'per_owner';
  owner?: string;
  minerIp?: string;
}

export interface CreateAlertRuleParams {
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
  scope?: 'global' | 'per_miner' | 'per_owner';
  target_miner_ip?: string;
  target_owner?: string;
  enabled?: boolean;
  created_by?: string;
}

export interface UpdateAlertRuleParams {
  display_name?: string;
  description?: string;
  rule_group?: string;
  severity?: 'critical' | 'warning' | 'info';
  component?: 'miner' | 'network' | 'farm' | 'system';
  expr?: string;
  for_duration?: string;
  summary_template?: string;
  description_template?: string;
  scope?: 'global' | 'per_miner' | 'per_owner';
  target_miner_ip?: string;
  target_owner?: string;
  enabled?: boolean;
}

/**
 * Get all alert rules with optional filtering
 */
export function getAllAlertRules(filters?: AlertRuleFilters): AlertRuleRecord[] {
  const db = getDatabase();
  return db.getAllAlertRules(filters);
}

/**
 * Get alert rule by ID
 */
export function getAlertRuleById(id: number): AlertRuleRecord | null {
  const db = getDatabase();
  return db.getAlertRuleById(id);
}

/**
 * Get alert rule by name
 */
export function getAlertRuleByName(name: string): AlertRuleRecord | null {
  const db = getDatabase();
  return db.getAlertRuleByName(name);
}

/**
 * Create new alert rule
 */
export function createAlertRule(params: CreateAlertRuleParams): { success: boolean; ruleId?: number; error?: string } {
  try {
    // Validate required fields
    if (!params.name || !params.display_name || !params.expr || !params.for_duration || !params.summary_template) {
      return { success: false, error: 'Missing required fields' };
    }

    // Validate PromQL expression (basic validation)
    const exprValidation = validatePromQLExpression(params.expr);
    if (!exprValidation.valid) {
      return { success: false, error: `Invalid PromQL expression: ${exprValidation.error}` };
    }

    // Validate duration format
    if (!validateDuration(params.for_duration)) {
      return { success: false, error: 'Invalid duration format. Use format like: 5m, 10m, 1h' };
    }

    // Check if rule with same name already exists
    const existing = getAlertRuleByName(params.name);
    if (existing) {
      return { success: false, error: `Alert rule with name "${params.name}" already exists` };
    }

    const db = getDatabase();
    const rule: Omit<AlertRuleRecord, 'id' | 'created_at' | 'updated_at'> = {
      name: params.name,
      display_name: params.display_name,
      description: params.description,
      rule_group: params.rule_group || 'custom',
      severity: params.severity,
      component: params.component,
      expr: params.expr,
      for_duration: params.for_duration,
      summary_template: params.summary_template,
      description_template: params.description_template,
      scope: params.scope || 'global',
      target_miner_ip: params.target_miner_ip,
      target_owner: params.target_owner,
      enabled: params.enabled !== undefined ? (params.enabled ? 1 : 0) : 1,
      is_system: 0, // User-created rules are not system rules
      created_by: params.created_by,
    };

    const ruleId = db.insertAlertRule(rule);

    // Regenerate Prometheus YAML and reload (async, don't wait)
    regeneratePrometheusYAML().catch(err => {
      logger.warn('Failed to auto-regenerate Prometheus YAML:', err);
    });

    return { success: true, ruleId };
  } catch (error: any) {
    logger.error('Error creating alert rule:', error);
    return { success: false, error: error.message || 'Failed to create alert rule' };
  }
}

/**
 * Update existing alert rule
 */
export function updateAlertRule(
  id: number,
  updates: UpdateAlertRuleParams,
  changedBy?: string
): { success: boolean; error?: string } {
  try {
    // Validate PromQL expression if provided
    if (updates.expr) {
      const exprValidation = validatePromQLExpression(updates.expr);
      if (!exprValidation.valid) {
        return { success: false, error: `Invalid PromQL expression: ${exprValidation.error}` };
      }
    }

    // Validate duration format if provided
    if (updates.for_duration && !validateDuration(updates.for_duration)) {
      return { success: false, error: 'Invalid duration format. Use format like: 5m, 10m, 1h' };
    }

    // Convert boolean enabled to number for database
    const dbUpdates: Partial<AlertRuleRecord> = {
      ...updates,
      enabled: updates.enabled !== undefined ? (updates.enabled ? 1 : 0) : undefined,
    };

    const db = getDatabase();
    const success = db.updateAlertRule(id, dbUpdates, changedBy);

    if (!success) {
      return { success: false, error: 'Alert rule not found' };
    }

    // Regenerate Prometheus YAML and reload (async, don't wait)
    regeneratePrometheusYAML().catch(err => {
      logger.warn('Failed to auto-regenerate Prometheus YAML:', err);
    });

    return { success: true };
  } catch (error: any) {
    logger.error('Error updating alert rule:', error);
    return { success: false, error: error.message || 'Failed to update alert rule' };
  }
}

/**
 * Delete alert rule
 */
export function deleteAlertRule(id: number, changedBy?: string): { success: boolean; error?: string } {
  try {
    const db = getDatabase();
    const success = db.deleteAlertRule(id, changedBy);

    if (!success) {
      return { success: false, error: 'Alert rule not found' };
    }

    // Regenerate Prometheus YAML and reload (async, don't wait)
    regeneratePrometheusYAML().catch(err => {
      logger.warn('Failed to auto-regenerate Prometheus YAML:', err);
    });

    return { success: true };
  } catch (error: any) {
    logger.error('Error deleting alert rule:', error);
    return { success: false, error: error.message || 'Failed to delete alert rule' };
  }
}

/**
 * Toggle alert rule enabled status
 */
export function toggleAlertRule(
  id: number,
  enabled: boolean,
  changedBy?: string
): { success: boolean; error?: string } {
  try {
    const db = getDatabase();
    const success = db.toggleAlertRule(id, enabled, changedBy);

    if (!success) {
      return { success: false, error: 'Alert rule not found' };
    }

    // Regenerate Prometheus YAML and reload (async, don't wait)
    regeneratePrometheusYAML().catch(err => {
      logger.warn('Failed to auto-regenerate Prometheus YAML:', err);
    });

    return { success: true };
  } catch (error: any) {
    logger.error('Error toggling alert rule:', error);
    return { success: false, error: error.message || 'Failed to toggle alert rule' };
  }
}

/**
 * Get alert rule history
 */
export function getAlertRuleHistory(ruleId?: number, limit: number = 100) {
  const db = getDatabase();
  return db.getAlertRuleHistory(ruleId, limit);
}

/**
 * Generate Prometheus YAML files from database rules
 */
export async function regeneratePrometheusYAML(): Promise<{ success: boolean; message: string }> {
  try {
    logger.info('Regenerating Prometheus YAML from database...');

    const db = getDatabase();
    const rules = db.getAllAlertRules({ enabled: true });

    if (rules.length === 0) {
      logger.warn('No enabled alert rules found in database');
      return { success: false, message: 'No enabled alert rules found' };
    }

    // Group rules by rule_group
    const groupedRules = rules.reduce((acc, rule) => {
      if (!acc[rule.rule_group]) {
        acc[rule.rule_group] = [];
      }
      acc[rule.rule_group].push(rule);
      return acc;
    }, {} as Record<string, AlertRuleRecord[]>);

    // Generate YAML structure
    const groups = Object.entries(groupedRules).map(([groupName, groupRules]) => ({
      name: groupName,
      interval: '30s',
      rules: groupRules.map(rule => ({
        alert: rule.name,
        expr: rule.expr,
        for: rule.for_duration,
        labels: {
          severity: rule.severity,
          component: rule.component,
        },
        annotations: {
          summary: rule.summary_template,
          ...(rule.description_template && { description: rule.description_template }),
        },
      })),
    }));

    const yamlContent = yaml.dump({ groups }, { indent: 2, lineWidth: -1 });

    // Determine output path - write to mounted Prometheus rules directory
    const rulesDir = process.env.NODE_ENV === 'production'
      ? '/app/prometheus-rules'
      : path.join(__dirname, '../../../docker/prometheus/rules');

    // Ensure directory exists
    if (!fs.existsSync(rulesDir)) {
      fs.mkdirSync(rulesDir, { recursive: true });
    }

    // Write to file (overwrite mining_alerts.yml with all rules)
    const outputPath = path.join(rulesDir, 'mining_alerts.yml');
    fs.writeFileSync(outputPath, yamlContent, 'utf8');

    logger.info(`Prometheus YAML generated: ${outputPath} (${rules.length} rules in ${groups.length} groups)`);

    // Reload Prometheus (only in production)
    if (process.env.NODE_ENV === 'production') {
      const reloadResult = await reloadPrometheusConfig();
      if (reloadResult.success) {
        logger.info('Prometheus configuration reloaded successfully');
        return { success: true, message: `Generated ${rules.length} rules and reloaded Prometheus` };
      } else {
        logger.warn('Prometheus reload failed:', reloadResult.message);
        return { success: true, message: `Generated ${rules.length} rules but Prometheus reload failed` };
      }
    } else {
      logger.info('Prometheus reload skipped (development mode)');
      return { success: true, message: `Generated ${rules.length} rules (reload skipped in dev mode)` };
    }
  } catch (error: any) {
    logger.error('Error regenerating Prometheus YAML:', error);
    return { success: false, message: error.message || 'Failed to regenerate Prometheus YAML' };
  }
}

/**
 * Validate PromQL expression (basic validation)
 */
function validatePromQLExpression(expr: string): { valid: boolean; error?: string } {
  if (!expr || expr.trim().length === 0) {
    return { valid: false, error: 'Expression cannot be empty' };
  }

  // Basic syntax checks
  const openBraces = (expr.match(/{/g) || []).length;
  const closeBraces = (expr.match(/}/g) || []).length;
  if (openBraces !== closeBraces) {
    return { valid: false, error: 'Mismatched braces in expression' };
  }

  const openParens = (expr.match(/\(/g) || []).length;
  const closeParens = (expr.match(/\)/g) || []).length;
  if (openParens !== closeParens) {
    return { valid: false, error: 'Mismatched parentheses in expression' };
  }

  // Check for common PromQL keywords/functions
  const hasMetric = /[a-zA-Z_][a-zA-Z0-9_]*/.test(expr);
  if (!hasMetric) {
    return { valid: false, error: 'Expression must contain at least one metric name' };
  }

  return { valid: true };
}

/**
 * Validate duration format (e.g., 5m, 10m, 1h, 30s)
 */
function validateDuration(duration: string): boolean {
  return /^\d+[smhd]$/.test(duration);
}
