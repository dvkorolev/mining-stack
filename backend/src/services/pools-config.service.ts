// backend/src/services/pools-config.service.ts
import fs from 'fs';
import yaml from 'js-yaml';
import path from 'path';
import { logger } from '../utils/logger';
import { withConfigLock, FileLockTimeout, FileLockError } from '../utils/fileLock';
import { getMiners } from '../config/miners.config';

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

const POOLS_CONFIG_PATH = process.env.POOLS_CONFIG_PATH || '/app/etc/pools.yaml';

/**
 * Load pools configuration from YAML file
 */
export const loadPoolsConfig = (): PoolsConfiguration => {
  try {
    if (!fs.existsSync(POOLS_CONFIG_PATH)) {
      logger.warn(`Pools config not found at ${POOLS_CONFIG_PATH}, returning defaults`);
      return getDefaultPoolsConfig();
    }

    const fileContents = fs.readFileSync(POOLS_CONFIG_PATH, 'utf8');
    const config = yaml.load(fileContents) as PoolsConfiguration;

    // Validate structure
    if (!config.pools || !Array.isArray(config.pools)) {
      throw new Error('Invalid pools configuration: pools array is missing');
    }

    logger.info(`Loaded ${config.pools.length} pools from configuration`);
    return config;
  } catch (error) {
    logger.error('Failed to load pools configuration:', error);
    throw error;
  }
};

/**
 * Save pools configuration to YAML file with file locking
 */
export const savePoolsConfig = async (config: PoolsConfiguration): Promise<void> => {
  try {
    // Validate configuration
    validatePoolsConfig(config);

    // Ensure directory exists
    const dir = path.dirname(POOLS_CONFIG_PATH);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    // Acquire lock and write file
    await withConfigLock(POOLS_CONFIG_PATH, () => {
      // Convert to YAML
      const yamlStr = yaml.dump(config, {
        indent: 2,
        lineWidth: 120,
        noRefs: true,
      });

      // Write to file
      fs.writeFileSync(POOLS_CONFIG_PATH, yamlStr, 'utf8');
    });

    logger.info(`Saved pools configuration with ${config.pools.length} pools`);
  } catch (error) {
    if (error instanceof FileLockTimeout) {
      logger.error('Failed to acquire lock on pools config:', error);
      throw new Error('Configuration file is locked by another process. Please try again.');
    } else if (error instanceof FileLockError) {
      logger.error('File lock error:', error);
      throw new Error('Failed to lock configuration file. Please try again.');
    }
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
  const config = loadPoolsConfig();

  // Check for duplicate URL
  if (config.pools.some(p => p.url === pool.url)) {
    throw new Error(`Pool with URL ${pool.url} already exists`);
  }

  config.pools.push(pool);
  await savePoolsConfig(config);

  return config;
};

/**
 * Update a pool in the configuration
 */
export const updatePool = async (oldUrl: string, updatedPool: PoolConfig): Promise<PoolsConfiguration> => {
  const config = loadPoolsConfig();

  const index = config.pools.findIndex(p => p.url === oldUrl);
  if (index === -1) {
    throw new Error(`Pool with URL ${oldUrl} not found`);
  }

  // If URL changed, check for duplicates
  if (oldUrl !== updatedPool.url && config.pools.some(p => p.url === updatedPool.url)) {
    throw new Error(`Pool with URL ${updatedPool.url} already exists`);
  }

  config.pools[index] = updatedPool;
  await savePoolsConfig(config);

  return config;
};

/**
 * Check if a pool is in use by any miners
 */
export const checkPoolUsage = (poolUrl: string): { inUse: boolean; minerCount: number; minerNames: string[] } => {
  try {
    const miners = getMiners(undefined, true); // Get all miners
    const minersUsingPool = miners.filter(miner => 
      miner.pools && miner.pools.some(pool => pool.url === poolUrl)
    );

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
  const config = loadPoolsConfig();

  const index = config.pools.findIndex(p => p.url === url);
  if (index === -1) {
    throw new Error(`Pool with URL ${url} not found`);
  }

  // Check if pool is in use by any miners
  const usage = checkPoolUsage(url);
  if (usage.inUse) {
    throw new Error(
      `Cannot delete pool: It is currently in use by ${usage.minerCount} miner(s): ${usage.minerNames.join(', ')}`
    );
  }

  config.pools.splice(index, 1);
  await savePoolsConfig(config);

  return config;
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
