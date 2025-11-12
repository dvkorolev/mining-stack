#!/usr/bin/env ts-node
/**
 * Migration Script: Import Alert Rules from YAML to Database
 * 
 * This script reads existing Prometheus alert rules from YAML files
 * and imports them into the SQLite database as system rules.
 * 
 * Usage:
 *   npm run migrate:alert-rules
 * 
 * Or directly:
 *   npx ts-node src/scripts/migrate-alert-rules.ts
 */

import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';
import { getDatabase, AlertRuleRecord } from '../services/database.service';
import { logger } from '../utils/logger';

interface PrometheusRule {
  alert: string;
  expr: string;
  for: string;
  labels: {
    severity: 'critical' | 'warning' | 'info';
    component: 'miner' | 'network' | 'farm';
    [key: string]: string;
  };
  annotations: {
    summary: string;
    description?: string;
  };
}

interface PrometheusRuleGroup {
  name: string;
  interval?: string;
  rules: PrometheusRule[];
}

interface PrometheusRulesFile {
  groups: PrometheusRuleGroup[];
}

const RULES_DIR = process.env.NODE_ENV === 'production'
  ? '/opt/mining-stack/docker/prometheus/rules'
  : path.join(__dirname, '../../../docker/prometheus/rules');

const RULE_FILES = [
  'mining_alerts.yml',
  'pool_network_alerts.yml',
];

async function migrateAlertRules(): Promise<void> {
  logger.info('Starting alert rules migration from YAML to database...');

  const db = getDatabase();
  let totalRules = 0;
  let successCount = 0;
  let errorCount = 0;
  let skippedCount = 0;

  for (const fileName of RULE_FILES) {
    const filePath = path.join(RULES_DIR, fileName);

    if (!fs.existsSync(filePath)) {
      logger.warn(`Rule file not found: ${filePath}`);
      continue;
    }

    try {
      logger.info(`Processing ${fileName}...`);

      // Read and parse YAML file
      const yamlContent = fs.readFileSync(filePath, 'utf8');
      const rulesFile = yaml.load(yamlContent) as PrometheusRulesFile;

      if (!rulesFile.groups || !Array.isArray(rulesFile.groups)) {
        logger.error(`Invalid YAML format in ${fileName}: "groups" array not found`);
        continue;
      }

      // Process each group
      for (const group of rulesFile.groups) {
        logger.info(`  Processing group: ${group.name} (${group.rules.length} rules)`);

        for (const rule of group.rules) {
          totalRules++;

          try {
            // Check if rule already exists
            const existing = db.getAlertRuleByName(rule.alert);
            if (existing) {
              logger.info(`    ⊘ Skipped (already exists): ${rule.alert}`);
              skippedCount++;
              continue;
            }

            // Determine scope based on rule expression
            let scope: 'global' | 'per_miner' | 'per_owner' = 'global';
            let targetMinerIp: string | undefined;
            let targetOwner: string | undefined;

            // Per-miner rules have specific miner references in the expression
            // (This is a heuristic - adjust as needed)
            if (rule.expr.includes('name="') || rule.expr.includes('ip="')) {
              scope = 'per_miner';
              // Extract miner IP if present (optional - can be set later)
            }

            // Create alert rule record
            const alertRule: Omit<AlertRuleRecord, 'id' | 'created_at' | 'updated_at'> = {
              name: rule.alert,
              display_name: rule.alert.replace(/([A-Z])/g, ' $1').trim(), // Convert camelCase to Title Case
              description: rule.annotations.description || rule.annotations.summary,
              rule_group: group.name,
              severity: rule.labels.severity,
              component: rule.labels.component,
              expr: rule.expr,
              for_duration: rule.for,
              summary_template: rule.annotations.summary,
              description_template: rule.annotations.description,
              scope,
              target_miner_ip: targetMinerIp,
              target_owner: targetOwner,
              enabled: 1, // Enable by default
              is_system: 1, // Mark as system rule
              created_by: 'system_migration',
            };

            // Insert into database
            const ruleId = db.insertAlertRule(alertRule);
            successCount++;
            logger.info(`    ✓ Migrated: ${rule.alert} (ID: ${ruleId})`);
          } catch (error) {
            errorCount++;
            logger.error(`    ✗ Failed to migrate rule ${rule.alert}:`, error);
          }
        }
      }
    } catch (error) {
      logger.error(`Failed to process ${fileName}:`, error);
    }
  }

  // Summary
  logger.info('');
  logger.info('='.repeat(60));
  logger.info('Alert Rules Migration Summary:');
  logger.info(`  Total rules found: ${totalRules}`);
  logger.info(`  Successfully migrated: ${successCount}`);
  logger.info(`  Skipped (already exist): ${skippedCount}`);
  logger.info(`  Failed: ${errorCount}`);
  logger.info('='.repeat(60));

  if (errorCount > 0) {
    logger.warn('Migration completed with errors. Please review the logs above.');
    process.exit(1);
  } else {
    logger.info('✓ Migration completed successfully!');
    logger.info('');
    logger.info('Next steps:');
    logger.info('  1. Verify the migrated rules in the database');
    logger.info('  2. Use the API to manage alert rules dynamically');
    logger.info('  3. Prometheus YAML files will be generated from the database');
    process.exit(0);
  }
}

// Run migration
migrateAlertRules().catch(error => {
  logger.error('Migration failed:', error);
  process.exit(1);
});
