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

    // Detect miner type from model
    const model = miner.model?.toLowerCase() || '';
    const isWhatsminer = model.includes('m30') || model.includes('m50') || model.includes('m20');
    const isAntminer = model.includes('s19') || model.includes('s17') || model.includes('t19');
    
    // Get credentials from config or use defaults
    const defaultUsername = isWhatsminer ? 'admin' : 'root';
    const defaultPassword = isWhatsminer ? 'admin' : 'root';
    const username = miner.username || defaultUsername;
    const password = miner.password || defaultPassword;
    
    // Determine protocol (HTTP or HTTPS) - default to HTTP for miners
    const protocol = 'http';
    
    // Try miner-specific endpoints first
    const endpoints = [];
    
    if (isWhatsminer) {
      // Whatsminer uses HTTP/HTTPS API on port 80/443
      endpoints.push(
        { url: `${protocol}://${miner.ip}/cgi-bin/luci/admin/network/iface_reconnect/lan`, method: 'get', desc: 'Whatsminer reboot' }
      );
    }
    
    if (isAntminer) {
      // Antminer uses CGI
      endpoints.push(
        { url: `${protocol}://${miner.ip}/cgi-bin/reboot.cgi`, method: 'get', desc: 'Antminer reboot' }
      );
    }
    
    // Generic fallbacks
    endpoints.push(
      { url: `${protocol}://${miner.ip}/api/reboot`, method: 'post', desc: 'Generic API reboot' },
      { url: `${protocol}://${miner.ip}/reboot`, method: 'post', desc: 'Generic reboot' }
    );

    for (const endpoint of endpoints) {
      try {
        logger.debug(`Trying ${endpoint.desc} for ${miner.name} with credentials from config`);
        await axios({
          method: endpoint.method as 'get' | 'post',
          url: endpoint.url,
          timeout: 5000,
          auth: {
            username,
            password,
          },
        });

        logger.info(`Miner ${miner.name} reboot command sent successfully via ${endpoint.desc}`);
        return { success: true, message: `Reboot command sent to ${miner.name}` };
      } catch (error) {
        // Try next endpoint
        continue;
      }
    }

    return { 
      success: false, 
      message: `Failed to reboot ${miner.name} - no compatible API found. Try rebooting manually via miner web interface at http://${miner.ip}` 
    };
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
