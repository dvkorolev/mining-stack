#!/usr/bin/env ts-node
/**
 * One-Time Migration Script: YAML to Database
 * 
 * This script migrates miner configuration from etc/miners.yaml to the SQLite database.
 * 
 * Usage:
 *   npm run migrate
 * 
 * Or directly:
 *   npx ts-node src/scripts/migrate-yaml-to-db.ts
 * 
 * Environment Variables:
 *   ADMIN_TELEGRAM_CHAT_ID - The Telegram chat ID to assign as the owner for all migrated miners
 *   MINERS_YAML_PATH - Path to miners.yaml (default: etc/miners.yaml)
 */

import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';
import { getDatabase, MinerRecord } from '../services/database.service';
import { logger } from '../utils/logger';

interface YamlMiner {
  ip: string;
  name: string;
  model: string;
  alias?: string;
  credentials?: {
    username?: string;
    password?: string;
  };
  useHttps?: boolean;
  static_power?: number;
  api_port?: number;
}

interface MinersYaml {
  miners: YamlMiner[];
}

const ADMIN_CHAT_ID = process.env.ADMIN_TELEGRAM_CHAT_ID || '';
const YAML_PATH = process.env.MINERS_YAML_PATH || path.join(__dirname, '../../../etc/miners.yaml');

async function migrateYamlToDb(): Promise<void> {
  logger.info('Starting YAML to Database migration...');

  // Validate admin chat ID
  if (!ADMIN_CHAT_ID) {
    logger.error('ADMIN_TELEGRAM_CHAT_ID environment variable is required');
    logger.error('Please set it before running the migration:');
    logger.error('  export ADMIN_TELEGRAM_CHAT_ID="your_telegram_chat_id"');
    logger.error('  npm run migrate');
    process.exit(1);
  }

  // Check if YAML file exists
  if (!fs.existsSync(YAML_PATH)) {
    logger.error(`Miners YAML file not found at: ${YAML_PATH}`);
    logger.error('Please ensure the file exists or set MINERS_YAML_PATH environment variable');
    process.exit(1);
  }

  try {
    // Read and parse YAML file
    const yamlContent = fs.readFileSync(YAML_PATH, 'utf8');
    const config = yaml.load(yamlContent) as MinersYaml;

    if (!config.miners || !Array.isArray(config.miners)) {
      logger.error('Invalid YAML format: "miners" array not found');
      process.exit(1);
    }

    logger.info(`Found ${config.miners.length} miners in YAML file`);

    // Get database instance
    const db = getDatabase();

    let successCount = 0;
    let errorCount = 0;

    // Migrate each miner
    for (const yamlMiner of config.miners) {
      try {
        // Validate required fields
        if (!yamlMiner.ip || !yamlMiner.name || !yamlMiner.model) {
          logger.warn(`Skipping miner with missing required fields: ${JSON.stringify(yamlMiner)}`);
          errorCount++;
          continue;
        }

        // Convert YAML miner to database record
        const minerRecord: MinerRecord = {
          ip: yamlMiner.ip,
          name: yamlMiner.name,
          model: yamlMiner.model,
          alias: yamlMiner.alias,
          owner: ADMIN_CHAT_ID,
          status: 'active',
          credentials: yamlMiner.credentials ? JSON.stringify(yamlMiner.credentials) : undefined,
          use_https: yamlMiner.useHttps ? 1 : 0,
          static_power: yamlMiner.static_power,
          api_port: yamlMiner.api_port,
        };

        // Insert or update in database
        db.upsertMiner(minerRecord);
        successCount++;
        logger.info(`✓ Migrated: ${minerRecord.name} (${minerRecord.ip})`);
      } catch (error) {
        errorCount++;
        logger.error(`✗ Failed to migrate miner ${yamlMiner.name}:`, error);
      }
    }

    // Summary
    logger.info('');
    logger.info('='.repeat(60));
    logger.info('Migration Summary:');
    logger.info(`  Total miners in YAML: ${config.miners.length}`);
    logger.info(`  Successfully migrated: ${successCount}`);
    logger.info(`  Failed: ${errorCount}`);
    logger.info(`  Owner (admin): ${ADMIN_CHAT_ID}`);
    logger.info('='.repeat(60));

    if (errorCount > 0) {
      logger.warn('Migration completed with errors. Please review the logs above.');
      process.exit(1);
    } else {
      logger.info('✓ Migration completed successfully!');
      logger.info('');
      logger.info('Next steps:');
      logger.info('  1. Verify the migrated data in the database');
      logger.info('  2. Update your services to read from the database instead of YAML');
      logger.info('  3. Consider backing up or archiving the YAML file');
      process.exit(0);
    }
  } catch (error) {
    logger.error('Migration failed:', error);
    process.exit(1);
  }
}

// Run migration
migrateYamlToDb().catch((error) => {
  logger.error('Unexpected error during migration:', error);
  process.exit(1);
});
