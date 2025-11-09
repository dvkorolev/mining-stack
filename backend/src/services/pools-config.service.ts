// backend/src/services/pools-config.service.ts
import { logger } from '../utils/logger';
import { FileLockTimeout, FileLockError } from '../utils/fileLock';
import { getDatabase } from './database.service';

// Re-export lock errors for use in routes
export { FileLockTimeout, FileLockError };

export interface PoolConfig {
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
