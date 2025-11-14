// backend/src/services/pools-config.service.ts
import fs from 'fs';
import yaml from 'js-yaml';
import path from 'path';
import { logger } from '../utils/logger';
import { getDatabase } from './database.service';
import type { MinerConfig } from '../config/miners.config';

export interface PoolConfig {
  id?: number;  // Pool ID from database
  url: string;
  name: string;
  algorithm: 'sha256' | 'scrypt' | 'multi';
  priority: 'high' | 'medium' | 'low';
}

export interface PoolsConfiguration {
  pools: PoolConfig[];
  config: {
    test_interval: number;
    enable_ping: boolean;
    connection_timeout: number;
    dns_timeout: number;
  };
}

/**
 * Load pools configuration from database
 */
export const loadPoolsConfig = (): PoolsConfiguration => {
  try {
    const db = getDatabase();
    const pools = db.getAllPools();
    const configData = db.getAllPoolConfig();

    const config: PoolsConfiguration = {
      pools: pools.map(p => ({
        id: p.id,
        url: p.url,
        name: p.name,
        algorithm: p.algorithm as 'sha256' | 'scrypt' | 'multi',
        priority: p.priority as 'high' | 'medium' | 'low',
      })),
      config: {
        test_interval: parseInt(configData.test_interval || '5', 10),
        enable_ping: configData.enable_ping === 'true',
        connection_timeout: parseInt(configData.connection_timeout || '5', 10),
        dns_timeout: parseInt(configData.dns_timeout || '3', 10),
      },
    };

    logger.info(`Loaded ${pools.length} pools from database`);
    return config;
  } catch (error) {
    logger.error('Failed to load pools configuration:', error);
    throw error;
  }
};

/**
 * Save pools configuration to database
 */
export const savePoolsConfig = async (config: PoolsConfiguration): Promise<void> => {
  try {
    // Validate before saving
    validatePoolsConfig(config);

    const db = getDatabase();

    // Save monitoring config
    db.setPoolConfig('test_interval', config.config.test_interval.toString());
    db.setPoolConfig('enable_ping', config.config.enable_ping.toString());
    db.setPoolConfig('connection_timeout', config.config.connection_timeout.toString());
    db.setPoolConfig('dns_timeout', config.config.dns_timeout.toString());

    logger.info('Pools configuration saved to database');
  } catch (error) {
    logger.error('Failed to save pools configuration:', error);
    throw error;
  }
};

/**
 * Validate pools configuration
 */
export const validatePoolsConfig = (config: PoolsConfiguration): void => {
  if (!config.pools || !Array.isArray(config.pools)) {
    throw new Error('Pools array is required');
  }

  if (!config.config) {
    throw new Error('Config section is required');
  }

  // Validate each pool
  config.pools.forEach((pool, index) => {
    if (!pool.url || typeof pool.url !== 'string') {
      throw new Error(`Pool ${index}: url is required and must be a string`);
    }

    if (!pool.name || typeof pool.name !== 'string') {
      throw new Error(`Pool ${index}: name is required and must be a string`);
    }

    if (!pool.algorithm || !['sha256', 'scrypt', 'multi'].includes(pool.algorithm)) {
      throw new Error(`Pool ${index}: algorithm must be sha256, scrypt, or multi`);
    }

    if (!pool.priority || !['high', 'medium', 'low'].includes(pool.priority)) {
      throw new Error(`Pool ${index}: priority must be high, medium, or low`);
    }

    // Validate URL format (hostname:port)
    if (!pool.url.includes(':')) {
      throw new Error(`Pool ${index}: url must be in format hostname:port`);
    }

    const [hostname, portStr] = pool.url.split(':');
    const port = parseInt(portStr, 10);

    if (!hostname || hostname.length === 0) {
      throw new Error(`Pool ${index}: invalid hostname in url`);
    }

    if (isNaN(port) || port < 1 || port > 65535) {
      throw new Error(`Pool ${index}: invalid port in url (must be 1-65535)`);
    }
  });

  // Validate config section
  if (typeof config.config.test_interval !== 'number' || config.config.test_interval < 1) {
    throw new Error('test_interval must be a number >= 1');
  }

  if (typeof config.config.enable_ping !== 'boolean') {
    throw new Error('enable_ping must be a boolean');
  }

  if (typeof config.config.connection_timeout !== 'number' || config.config.connection_timeout < 1) {
    throw new Error('connection_timeout must be a number >= 1');
  }

  if (typeof config.config.dns_timeout !== 'number' || config.config.dns_timeout < 1) {
    throw new Error('dns_timeout must be a number >= 1');
  }
};

/**
 * Get default pools configuration
 */
export const getDefaultPoolsConfig = (): PoolsConfiguration => {
  return {
    pools: [], // Start with empty pools - user should add their own
    config: {
      test_interval: 5,
      enable_ping: false,
      connection_timeout: 5,
      dns_timeout: 3,
    },
  };
};

/**
 * Add a pool to the configuration
 */
export const addPool = async (pool: PoolConfig): Promise<PoolsConfiguration> => {
  const db = getDatabase();

  // Check for duplicate URL
  const existing = db.getPoolByUrl(pool.url);
  if (existing) {
    throw new Error(`Pool with URL ${pool.url} already exists`);
  }

  db.insertPool(pool);
  return loadPoolsConfig();
};

/**
 * Update a pool in the configuration
 */
export const updatePool = async (oldUrl: string, updatedPool: PoolConfig): Promise<PoolsConfiguration> => {
  const db = getDatabase();

  const existing = db.getPoolByUrl(oldUrl);
  if (!existing) {
    throw new Error(`Pool with URL ${oldUrl} not found`);
  }

  // If URL changed, check for duplicates
  if (oldUrl !== updatedPool.url) {
    const duplicate = db.getPoolByUrl(updatedPool.url);
    if (duplicate) {
      throw new Error(`Pool with URL ${updatedPool.url} already exists`);
    }
  }

  db.updatePool(oldUrl, updatedPool);
  return loadPoolsConfig();
};

/**
 * Check if a pool is in use by any miners
 */
export const checkPoolUsage = (poolUrl: string): { inUse: boolean; minerCount: number; minerNames: string[] } => {
  try {
    const db = getDatabase();
    const pool = db.getPoolByUrl(poolUrl);
    
    if (!pool) {
      return { inUse: false, minerCount: 0, minerNames: [] };
    }

    const minersUsingPool = db.getMinersUsingPool(pool.id);

    return {
      inUse: minersUsingPool.length > 0,
      minerCount: minersUsingPool.length,
      minerNames: minersUsingPool.map(m => m.name),
    };
  } catch (error) {
    logger.error('Error checking pool usage:', error);
    // If we can't check, assume it's not in use to avoid blocking deletion
    return { inUse: false, minerCount: 0, minerNames: [] };
  }
};

/**
 * Delete a pool from the configuration
 */
export const deletePool = async (url: string): Promise<PoolsConfiguration> => {
  const db = getDatabase();

  const existing = db.getPoolByUrl(url);
  if (!existing) {
    throw new Error(`Pool with URL ${url} not found`);
  }

  // Check if pool is in use by any miners
  const usage = checkPoolUsage(url);
  if (usage.inUse) {
    throw new Error(
      `Cannot delete pool: It is currently in use by ${usage.minerCount} miner(s): ${usage.minerNames.join(', ')}`
    );
  }

  db.deletePool(url);
  return loadPoolsConfig();
};

/**
 * Trigger pool collection in python-scheduler
 */
export const triggerPoolCollection = async (): Promise<{ success: boolean; message: string }> => {
  try {
    const pythonSchedulerUrl = process.env.JOB_RUNNER_URL || 'http://python-scheduler:8000';
    const response = await fetch(`${pythonSchedulerUrl}/collect-pools`, {
      method: 'POST',
    });

    if (!response.ok) {
      throw new Error(`Python scheduler returned ${response.status}`);
    }

    const data = await response.json();
    return { success: true, message: 'Pool collection triggered successfully', ...data };
  } catch (error) {
    logger.error('Failed to trigger pool collection:', error);
    return { success: false, message: `Failed to trigger pool collection: ${error}` };
  }
};

// ==================== YAML IMPORT/EXPORT ====================

const POOLS_CONFIG_PATH = process.env.POOLS_CONFIG_PATH || '/app/etc/pools.yaml';

/**
 * Import pools from YAML file to database (one-time migration or restore)
 * This is called on startup if the database is empty and YAML file exists
 */
export const importPoolsFromYAML = (): { imported: number; skipped: number; errors: string[] } => {
  const result = { imported: 0, skipped: 0, errors: [] as string[] };

  try {
    if (!fs.existsSync(POOLS_CONFIG_PATH)) {
      logger.info(`No YAML file found at ${POOLS_CONFIG_PATH}, skipping import`);
      return result;
    }

    const fileContents = fs.readFileSync(POOLS_CONFIG_PATH, 'utf8');
    const yamlConfig = yaml.load(fileContents) as PoolsConfiguration;

    if (!yamlConfig.pools || !Array.isArray(yamlConfig.pools)) {
      logger.warn('Invalid YAML structure: pools array is missing');
      return result;
    }

    const db = getDatabase();

    // Import pools
    for (const pool of yamlConfig.pools) {
      try {
        // Check if pool already exists
        const existing = db.getPoolByUrl(pool.url);
        if (existing) {
          logger.info(`Pool ${pool.name} already exists, skipping`);
          result.skipped++;
          continue;
        }

        // Insert pool
        db.insertPool(pool);
        result.imported++;
        logger.info(`Imported pool: ${pool.name} (${pool.url})`);
      } catch (error) {
        const errorMsg = `Failed to import pool ${pool.name}: ${error instanceof Error ? error.message : 'Unknown error'}`;
        logger.error(errorMsg);
        result.errors.push(errorMsg);
      }
    }

    // Import monitoring config
    if (yamlConfig.config) {
      try {
        db.setPoolConfig('test_interval', yamlConfig.config.test_interval.toString());
        db.setPoolConfig('enable_ping', yamlConfig.config.enable_ping.toString());
        db.setPoolConfig('connection_timeout', yamlConfig.config.connection_timeout.toString());
        db.setPoolConfig('dns_timeout', yamlConfig.config.dns_timeout.toString());
        logger.info('Imported pool monitoring configuration');
      } catch (error) {
        logger.error('Failed to import pool config:', error);
      }
    }

    logger.info(`YAML import complete: ${result.imported} imported, ${result.skipped} skipped, ${result.errors.length} errors`);
    return result;
  } catch (error) {
    logger.error('Failed to import pools from YAML:', error);
    result.errors.push(`Import failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    return result;
  }
};

/**
 * Export current pools configuration to YAML format
 * Returns YAML string that can be saved to file or sent to client
 */
export const exportPoolsToYAML = (): string => {
  try {
    const config = loadPoolsConfig();
    
    const yamlStr = yaml.dump(config, {
      indent: 2,
      lineWidth: -1,
      noRefs: true,
      sortKeys: false,
    });

    logger.info('Exported pools configuration to YAML format');
    return yamlStr;
  } catch (error) {
    logger.error('Failed to export pools to YAML:', error);
    throw error;
  }
};

/**
 * Save current pools configuration to YAML file
 * This creates a backup of the current database state
 */
export const backupPoolsToYAML = (backupPath?: string): void => {
  try {
    const yamlStr = exportPoolsToYAML();
    const filePath = backupPath || POOLS_CONFIG_PATH;

    // Ensure directory exists
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    fs.writeFileSync(filePath, yamlStr, 'utf8');
    logger.info(`Pools configuration backed up to ${filePath}`);
  } catch (error) {
    logger.error('Failed to backup pools to YAML:', error);
    throw error;
  }
};

/**
 * Initialize pools from YAML on first startup
 * Called during application initialization
 */
export const initializePoolsFromYAML = (): void => {
  try {
    const db = getDatabase();
    const existingPools = db.getAllPools();

    // Only import if database is empty
    if (existingPools.length === 0) {
      logger.info('Database is empty, attempting to import from YAML...');
      const result = importPoolsFromYAML();
      
      if (result.imported > 0) {
        logger.info(`Successfully initialized ${result.imported} pools from YAML`);
      } else if (result.errors.length > 0) {
        logger.warn(`YAML import completed with errors: ${result.errors.join(', ')}`);
      } else {
        logger.info('No pools imported from YAML (file not found or empty)');
      }
    } else {
      logger.info(`Database already contains ${existingPools.length} pools, skipping YAML import`);
    }
  } catch (error) {
    logger.error('Failed to initialize pools from YAML:', error);
    // Don't throw - allow application to start even if YAML import fails
  }
};

// ==================== SYNC FROM MINERS ====================

/**
 * Sync pools from all miners
 * Queries each miner to get its actual pool configuration
 */
export const syncPoolsFromMiners = async (): Promise<{
  success: boolean;
  message: string;
  results: Array<{
    minerName: string;
    minerIp: string;
    success: boolean;
    pools?: Array<{ url: string; user: string }>;
    error?: string;
  }>;
}> => {
  try {
    const { getMiners } = require('../config/miners.config');
    const { getMinerPools } = require('./miner-control.service');
    
    const miners = getMiners();
    
    if (miners.length === 0) {
      return {
        success: false,
        message: 'No miners configured',
        results: [],
      };
    }

    logger.info(`Syncing pools from ${miners.length} miners...`);
    
    const results = await Promise.all(
      miners.map(async (miner: MinerConfig) => {
        try {
          const poolsResult = await getMinerPools(miner.name);
          
          return {
            minerName: miner.name,
            minerIp: miner.ip,
            success: poolsResult.success,
            pools: poolsResult.pools,
            error: poolsResult.message,
          };
        } catch (error) {
          return {
            minerName: miner.name,
            minerIp: miner.ip,
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error',
          };
        }
      })
    );

    const successCount = results.filter(r => r.success).length;
    
    return {
      success: true,
      message: `Synced ${successCount} of ${miners.length} miners`,
      results,
    };
  } catch (error) {
    logger.error('Failed to sync pools from miners:', error);
    return {
      success: false,
      message: `Failed to sync: ${error instanceof Error ? error.message : 'Unknown error'}`,
      results: [],
    };
  }
};
