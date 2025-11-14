// backend/src/services/miner-control.service.ts
import axios from 'axios';
import * as net from 'net';
import { logger } from '../utils/logger';
import { getMinerById } from '../config/miners.config';
import type { PoolConfig } from '../config/miners.config';
import { WhatsMiner, antminerRestart } from '../utils/miner-rebooter';

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
    
    // WhatsMiner: Use tokened TCP API with AES encryption
    if (isWhatsminer) {
      try {
        logger.info(`Restarting Whatsminer ${miner.name} (${miner.ip}) via tokened API`);
        const wm = new WhatsMiner(miner.ip, password);
        const result = await wm.restartBtminer(); // Restart mining software (btminer)
        logger.info(`✓ Whatsminer ${miner.name} restart successful`, { result });
        return { success: true, message: `Mining software (btminer) restart command sent to ${miner.name}` };
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        logger.error(`✗ Whatsminer restart failed for ${miner.name}: ${errorMsg}`);
        return { 
          success: false, 
          message: `Failed to restart ${miner.name}. ${errorMsg}. Ensure API is enabled in WhatsMinerTool and password is correct.` 
        };
      }
    }

    // Antminer: Use standard CGMiner restart command
    if (isAntminer) {
      try {
        logger.info(`Restarting Antminer ${miner.name} (${miner.ip}) via CGMiner API`);
        const result = await antminerRestart(miner.ip);
        logger.info(`✓ Antminer ${miner.name} restart successful`, { result });
        return { success: true, message: `Mining software (bmminer) restart command sent to ${miner.name}` };
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        logger.error(`✗ Antminer restart failed for ${miner.name}: ${errorMsg}`);
        return { 
          success: false, 
          message: `Failed to restart ${miner.name}. ${errorMsg}. Try restarting manually via web interface at http://${miner.ip}` 
        };
      }
    }

    // Generic miners (Avalon, Innosilicon, etc.): Try standard CGMiner restart
    try {
      logger.info(`Restarting ${miner.name} (${miner.ip}) via CGMiner API`);
      const result = await antminerRestart(miner.ip); // Same command works for most miners
      logger.info(`✓ Miner ${miner.name} restart successful`, { result });
      return { success: true, message: `Mining software restart command sent to ${miner.name}` };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error(`✗ Miner restart failed for ${miner.name}: ${errorMsg}`);
      return { 
        success: false, 
        message: `Failed to restart ${miner.name}. ${errorMsg}. Try restarting manually via miner web interface at http://${miner.ip}` 
      };
    }
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
    const isGoldshell = model.includes('dg1') || model.includes('hs') || model.includes('kd') || model.includes('goldshell');

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
    } else if (isGoldshell) {
      defaultUsername = 'admin';
      defaultPassword = 'admin';
    }
    
    const username = miner.username || defaultUsername;
    const password = miner.password || defaultPassword;

    logger.debug(`Detected miner type for ${miner.name}: Whatsminer=${isWhatsminer}, Antminer=${isAntminer}, Avalon=${isAvalonminer}, Innosilicon=${isInnosilicon}, Goldshell=${isGoldshell}`);

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

    if (isGoldshell) {
      // Goldshell DG1/HS/KD series - Uses CGI API
      methods.push(async () => {
        const response = await axios.get(`http://${miner.ip}/cgi-bin/pools.cgi`, {
          timeout: 5000,
          auth: { username, password },
        });
        
        if (response.data && response.data.POOLS) {
          return response.data.POOLS.map((pool: any) => ({
            url: (pool.url || '').replace(/^stratum\+tcp:\/\//, ''),
            user: pool.user || '',
            password: '***', // Goldshell doesn't expose passwords
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
            // Clean response: remove null bytes, control characters, and trailing garbage
            const cleanResponse = responseData
              .replace(/\0/g, '')           // Remove null bytes
              .replace(/[\x00-\x1F\x7F]/g, '') // Remove other control characters
              .trim();
            
            // Try to extract valid JSON if response has trailing data
            let jsonStr = cleanResponse;
            const firstBrace = cleanResponse.indexOf('{');
            const lastBrace = cleanResponse.lastIndexOf('}');
            if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
              jsonStr = cleanResponse.substring(firstBrace, lastBrace + 1);
            }
            
            const parsed = JSON.parse(jsonStr);
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
            reject(new Error(`Failed to parse CGMiner response: ${error}. Raw length: ${responseData.length}`));
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
    const errors: string[] = [];
    for (let i = 0; i < methods.length; i++) {
      const method = methods[i];
      try {
        logger.debug(`Trying pool retrieval method ${i + 1}/${methods.length} for ${miner.name}`);
        const pools = await method();
        if (pools && pools.length > 0) {
          logger.info(`✓ Retrieved ${pools.length} pools for ${miner.name} using method ${i + 1}`);
          return { success: true, pools };
        }
      } catch (error) {
        // Try next method
        const errorMsg = error instanceof Error ? error.message : String(error);
        const errorDetail = `Method ${i + 1}: ${errorMsg}`;
        errors.push(errorDetail);
        logger.debug(`Pool retrieval method ${i + 1} failed for ${miner.name}: ${errorMsg}`);
        continue;
      }
    }

    // If all methods fail, return helpful message with error details
    logger.warn(`Failed to sync pools for ${miner.name} (${miner.ip}). Tried ${methods.length} methods. Errors: ${errors.join('; ')}`);
    return { 
      success: false, 
      message: `Unable to retrieve pool configuration from ${miner.name}.\n\n` +
               `Tried ${methods.length} method(s):\n${errors.map((e, i) => `${i + 1}. ${e}`).join('\n')}\n\n` +
               `Please check:\n` +
               `• Miner is online at ${miner.ip}\n` +
               `• Credentials are correct (username: ${username})\n` +
               `• Miner web interface is accessible\n` +
               `• CGMiner API port 4028 is open\n\n` +
               `You can view pools manually at: http://${miner.ip}`
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
