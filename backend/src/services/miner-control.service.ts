// backend/src/services/miner-control.service.ts
import axios from 'axios';
import * as net from 'net';
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
      // Try multiple Whatsminer endpoints (different firmware versions)
      endpoints.push(
        { url: `${protocol}://${miner.ip}/cgi-bin/luci/admin/network/iface_reconnect/lan`, method: 'get', desc: 'Whatsminer reboot (v1)' },
        { url: `${protocol}://${miner.ip}/cgi-bin/reboot.cgi`, method: 'get', desc: 'Whatsminer reboot (v2)' },
        { url: `${protocol}://${miner.ip}/cgi-bin/luci/admin/system/reboot`, method: 'post', desc: 'Whatsminer system reboot', data: 'token=' },
        { url: `${protocol}://${miner.ip}/cgi-bin/restart_cgminer.cgi`, method: 'get', desc: 'Whatsminer CGMiner restart' }
      );
    }
    
    if (isAntminer) {
      // Antminer uses CGI - try multiple endpoints for different firmware versions
      endpoints.push(
        { url: `${protocol}://${miner.ip}/cgi-bin/reboot.cgi`, method: 'get', desc: 'Antminer reboot (CGI)' },
        { url: `${protocol}://${miner.ip}/cgi-bin/luci/admin/system/reboot`, method: 'post', desc: 'Antminer reboot (Luci)' },
        { url: `${protocol}://${miner.ip}/api/system/reboot`, method: 'post', desc: 'Antminer reboot (API)' }
      );
    }
    
    // Generic fallbacks (work for many miners)
    endpoints.push(
      { url: `${protocol}://${miner.ip}/api/reboot`, method: 'post', desc: 'Generic API reboot' },
      { url: `${protocol}://${miner.ip}/reboot`, method: 'post', desc: 'Generic reboot' }
    );
    
    // Note: CGMiner API restart will be tried separately below using TCP socket

    for (const endpoint of endpoints) {
      try {
        logger.info(`Trying ${endpoint.desc} for ${miner.name} (${miner.ip})`);
        const config: any = {
          method: endpoint.method as 'get' | 'post',
          url: endpoint.url,
          timeout: 5000,
          auth: {
            username,
            password,
          },
        };
        
        // Add data if provided (for CGMiner API)
        if ((endpoint as any).data) {
          config.data = (endpoint as any).data;
          config.headers = { 'Content-Type': 'application/json' };
        }
        
        await axios(config);

        logger.info(`✓ Miner ${miner.name} reboot command sent successfully via ${endpoint.desc}`);
        return { success: true, message: `Reboot command sent to ${miner.name} via ${endpoint.desc}` };
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        logger.debug(`✗ ${endpoint.desc} failed: ${errorMsg}`);
        continue;
      }
    }

    // Note: CGMiner API 'restart' command only restarts mining software, not the device
    // It also returns "invalid cmd" error for most miners
    // We rely on HTTP/CGI endpoints above for actual device reboot

    return { 
      success: false, 
      message: `Failed to reboot ${miner.name} - no compatible API found. Tried ${endpoints.length} different endpoints. Try rebooting manually via miner web interface at http://${miner.ip}` 
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

    // Detect miner type from model string
    const model = miner.model?.toLowerCase() || '';
    const isWhatsminer = model.includes('m3') || model.includes('m5') || model.includes('m2') || 
                         model.includes('whatsminer');
    const isAntminer = model.includes('s19') || model.includes('s17') || model.includes('s9') || 
                       model.includes('t19') || model.includes('t17') || model.includes('antminer');
    const isAvalonminer = model.includes('avalon') || model.includes('a1');
    const isInnosilicon = model.includes('a10') || model.includes('a11') || model.includes('innosilicon');

    // Get credentials based on miner type
    let defaultUsername = 'root';
    let defaultPassword = 'root';
    
    if (isWhatsminer) {
      defaultUsername = 'admin';
      defaultPassword = 'admin';
    } else if (isAvalonminer) {
      defaultUsername = 'root';
      defaultPassword = 'root';
    } else if (isInnosilicon) {
      defaultUsername = 'admin';
      defaultPassword = 'admin';
    }
    
    const username = miner.username || defaultUsername;
    const password = miner.password || defaultPassword;

    logger.debug(`Detected miner type for ${miner.name}: Whatsminer=${isWhatsminer}, Antminer=${isAntminer}, Avalon=${isAvalonminer}, Innosilicon=${isInnosilicon}`);

    // Try different methods based on miner type
    const methods = [];

    if (isWhatsminer) {
      // Method 1: Whatsminer API v1 (older models)
      methods.push(async () => {
        const response = await axios.get(`http://${miner.ip}/cgi-bin/luci/admin/network/cgminer`, {
          timeout: 5000,
          auth: { username, password },
        });
        
        if (response.data && response.data.pools) {
          return response.data.pools.map((pool: any) => ({
            url: pool.url || pool.URL || '',
            user: pool.user || pool.worker || pool.User || '',
            password: '***',
          }));
        }
        throw new Error('No pool data');
      });

      // Method 2: Whatsminer API v2 (newer models like M30S++)
      methods.push(async () => {
        const response = await axios.get(`http://${miner.ip}/cgi-bin/luci/admin/status/overview`, {
          timeout: 5000,
          auth: { username, password },
        });
        
        // Parse pool info from overview
        if (response.data && response.data.pool) {
          const poolData = response.data.pool;
          const pools: PoolConfig[] = [];
          
          // Whatsminer often has pool1, pool2, pool3
          for (let i = 1; i <= 3; i++) {
            const poolKey = `pool${i}`;
            if (poolData[poolKey]) {
              const pool = poolData[poolKey];
              pools.push({
                url: pool.url || pool.URL || '',
                user: pool.user || pool.worker || '',
                password: '***',
              });
            }
          }
          
          if (pools.length > 0) return pools;
        }
        throw new Error('No pool data');
      });

      // Method 3: Direct pool endpoint
      methods.push(async () => {
        const response = await axios.get(`http://${miner.ip}/cgi-bin/luci/admin/network/cgminer/pool`, {
          timeout: 5000,
          auth: { username, password },
        });
        
        if (response.data && response.data.pools) {
          return response.data.pools.map((pool: any) => ({
            url: pool.url || '',
            user: pool.user || pool.worker || '',
            password: '***',
          }));
        }
        throw new Error('No pool data');
      });
    }

    if (isAntminer) {
      // Method 1: Antminer CGI (most common)
      methods.push(async () => {
        const response = await axios.get(`http://${miner.ip}/cgi-bin/get_miner_conf.cgi`, {
          timeout: 5000,
          auth: { username, password },
        });
        
        const data = response.data;
        const pools: PoolConfig[] = [];
        
        // Try different pool naming conventions
        for (let i = 1; i <= 3; i++) {
          const url = data[`_ant_pool${i}url`] || data[`pool${i}url`];
          const user = data[`_ant_pool${i}user`] || data[`pool${i}user`];
          if (url) {
            pools.push({ url, user: user || '', password: '***' });
          }
        }
        
        if (pools.length > 0) return pools;
        throw new Error('No pools found');
      });

      // Method 2: Newer Antminer API
      methods.push(async () => {
        const response = await axios.get(`http://${miner.ip}/cgi-bin/pools.cgi`, {
          timeout: 5000,
          auth: { username, password },
        });
        
        if (response.data && response.data.pools) {
          return response.data.pools.map((pool: any) => ({
            url: pool.url || '',
            user: pool.user || '',
            password: '***',
          }));
        }
        throw new Error('No pool data');
      });
    }

    if (isAvalonminer) {
      // Avalon CGI
      methods.push(async () => {
        const response = await axios.get(`http://${miner.ip}/cgi-bin/luci/admin/avalon/pool`, {
          timeout: 5000,
          auth: { username, password },
        });
        
        if (response.data && response.data.pools) {
          return response.data.pools.map((pool: any) => ({
            url: pool.url || '',
            user: pool.user || pool.worker || '',
            password: '***',
          }));
        }
        throw new Error('No pool data');
      });
    }

    // Generic CGMiner API (works for many miners including Whatsminer, Antminer, Avalon)
    // This is the most reliable method for Whatsminer M30S++ models
    methods.push(async () => {
      return new Promise<PoolConfig[]>((resolve, reject) => {
        const client = new net.Socket();
        const command = JSON.stringify({ command: 'pools' });
        let responseData = '';

        client.setTimeout(5000);

        client.on('data', (data) => {
          responseData += data.toString();
        });

        client.on('end', () => {
          try {
            const parsed = JSON.parse(responseData);
            if (parsed && parsed.POOLS) {
              const pools = parsed.POOLS.map((pool: any) => ({
                url: pool.URL || pool.url || '',
                user: pool.User || pool.user || pool.Worker || '',
                password: '***',
              }));
              resolve(pools);
            } else {
              reject(new Error('No pool data in response'));
            }
          } catch (error) {
            reject(new Error(`Failed to parse CGMiner response: ${error}`));
          }
        });

        client.on('timeout', () => {
          client.destroy();
          reject(new Error('CGMiner API timeout'));
        });

        client.on('error', (error) => {
          reject(error);
        });

        client.connect(4028, miner.ip, () => {
          client.write(command);
        });
      });
    });

    // Try each method
    for (const method of methods) {
      try {
        const pools = await method();
        if (pools && pools.length > 0) {
          logger.info(`Retrieved ${pools.length} pools for ${miner.name}`);
          return { success: true, pools };
        }
      } catch (error) {
        // Try next method
        const errorMsg = error instanceof Error ? error.message : String(error);
        logger.debug(`Pool retrieval method failed for ${miner.name}: ${errorMsg}`);
        continue;
      }
    }

    // If all methods fail, return helpful message
    return { 
      success: false, 
      message: `Unable to retrieve pool configuration. Please check:\n• Miner is online at ${miner.ip}\n• Credentials are correct (${username})\n• Miner API is accessible\n\nYou can view pools manually at: http://${miner.ip}` 
    };
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
