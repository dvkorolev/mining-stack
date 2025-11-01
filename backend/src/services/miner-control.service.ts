// backend/src/services/miner-control.service.ts
import axios from 'axios';
import { logger } from '../utils/logger';
import { getMinerById } from '../config/miners.config';
import type { PoolConfig } from '../config/miners.config';

/**
 * Reboot a single miner via its API
 */
export const rebootMiner = async (minerId: string): Promise<{ success: boolean; message: string }> => {
  try {
    const miner = getMinerById(minerId);
    if (!miner) {
      return { success: false, message: `Miner ${minerId} not found` };
    }

    logger.info(`Rebooting miner: ${miner.name} (${miner.ip})`);

    // Try different reboot endpoints based on miner type
    const endpoints = [
      { url: `http://${miner.ip}/cgi-bin/reboot.cgi`, method: 'get' },  // Antminer
      { url: `http://${miner.ip}/api/reboot`, method: 'post' },         // Whatsminer
      { url: `http://${miner.ip}/reboot`, method: 'post' },             // Generic
    ];

    for (const endpoint of endpoints) {
      try {
        await axios({
          method: endpoint.method as 'get' | 'post',
          url: endpoint.url,
          timeout: 5000,
          auth: {
            username: 'root',
            password: 'root', // Default credentials - should be configurable
          },
        });

        logger.info(`Miner ${miner.name} reboot command sent successfully`);
        return { success: true, message: `Reboot command sent to ${miner.name}` };
      } catch (error) {
        // Try next endpoint
        continue;
      }
    }

    return { success: false, message: `Failed to reboot ${miner.name} - no compatible API found` };
  } catch (error) {
    logger.error(`Error rebooting miner ${minerId}:`, error);
    return { success: false, message: `Error rebooting miner: ${error}` };
  }
};

/**
 * Reboot multiple miners
 */
export const rebootMiners = async (minerIds: string[]): Promise<{
  success: boolean;
  results: Array<{ minerId: string; success: boolean; message: string }>;
}> => {
  logger.info(`Rebooting ${minerIds.length} miners`);

  const results = await Promise.all(
    minerIds.map(async (minerId) => {
      const result = await rebootMiner(minerId);
      return { minerId, ...result };
    })
  );

  const successCount = results.filter(r => r.success).length;

  return {
    success: successCount > 0,
    results,
  };
};

/**
 * Get pool configuration from a miner
 */
export const getMinerPools = async (minerId: string): Promise<{
  success: boolean;
  pools?: PoolConfig[];
  message?: string;
}> => {
  try {
    const miner = getMinerById(minerId);
    if (!miner) {
      return { success: false, message: `Miner ${minerId} not found` };
    }

    logger.info(`Getting pool config for: ${miner.name} (${miner.ip})`);

    // Try cgminer API (port 4028)
    try {
      const response = await axios.post(
        `http://${miner.ip}:4028`,
        { command: 'pools' },
        { timeout: 5000 }
      );

      if (response.data && response.data.POOLS) {
        const pools: PoolConfig[] = response.data.POOLS.map((pool: any) => ({
          url: pool.URL || '',
          user: pool.User || '',
          password: '***', // Don't expose password
        }));

        return { success: true, pools };
      }
    } catch (error) {
      // Try HTTP API
      try {
        const response = await axios.get(`http://${miner.ip}/cgi-bin/get_miner_conf.cgi`, {
          timeout: 5000,
          auth: { username: 'root', password: 'root' },
        });

        // Parse response for pool info
        // This varies by miner type - implement as needed
        return { success: false, message: 'HTTP API pool retrieval not yet implemented' };
      } catch (httpError) {
        return { success: false, message: 'Failed to retrieve pool configuration' };
      }
    }

    return { success: false, message: 'No compatible API found' };
  } catch (error) {
    logger.error(`Error getting pools for miner ${minerId}:`, error);
    return { success: false, message: `Error: ${error}` };
  }
};

/**
 * Update pool configuration for a miner
 */
export const updateMinerPools = async (
  minerId: string,
  pools: PoolConfig[]
): Promise<{ success: boolean; message: string }> => {
  try {
    const miner = getMinerById(minerId);
    if (!miner) {
      return { success: false, message: `Miner ${minerId} not found` };
    }

    logger.info(`Updating pool config for: ${miner.name} (${miner.ip})`);

    // This is miner-specific - implement based on miner API
    // For Antminer S19:
    try {
      const response = await axios.post(
        `http://${miner.ip}/cgi-bin/set_miner_conf.cgi`,
        {
          pools: pools.map((pool, index) => ({
            [`_ant_pool${index + 1}url`]: pool.url,
            [`_ant_pool${index + 1}user`]: pool.user,
            [`_ant_pool${index + 1}pw`]: pool.password || '',
          })),
        },
        {
          timeout: 10000,
          auth: { username: 'root', password: 'root' },
        }
      );

      return { success: true, message: `Pool configuration updated for ${miner.name}` };
    } catch (error) {
      return { success: false, message: `Failed to update pool configuration: ${error}` };
    }
  } catch (error) {
    logger.error(`Error updating pools for miner ${minerId}:`, error);
    return { success: false, message: `Error: ${error}` };
  }
};

/**
 * Bulk update pools for multiple miners
 */
export const bulkUpdatePools = async (
  minerIds: string[],
  pools: PoolConfig[]
): Promise<{
  success: boolean;
  results: Array<{ minerId: string; success: boolean; message: string }>;
}> => {
  logger.info(`Bulk updating pools for ${minerIds.length} miners`);

  const results = await Promise.all(
    minerIds.map(async (minerId) => {
      const result = await updateMinerPools(minerId, pools);
      return { minerId, ...result };
    })
  );

  const successCount = results.filter(r => r.success).length;

  return {
    success: successCount > 0,
    results,
  };
};
