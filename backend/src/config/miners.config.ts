// backend/src/config/miners.config.ts
import fs from 'fs';
import yaml from 'js-yaml';
import path from 'path';
import { logger } from '../utils/logger';

export interface MinerConfig {
  ip: string;
  name: string;
  model: string;
  alias?: string;
  status?: 'online' | 'offline' | 'error';
  lastSeen?: Date;
  // Add more miner-specific configuration as needed
}

let miners: MinerConfig[] = [];

/**
 * Load miners configuration from YAML file
 */
export const loadMinersConfig = (): MinerConfig[] => {
  try {
    // Import config here to avoid circular dependency
    const { config: appConfig } = require('./config');
    
    // Look for config in configured path first, then fall back to local etc directory
    const configPath = fs.existsSync(appConfig.paths.minerConfig)
      ? appConfig.paths.minerConfig
      : appConfig.paths.minerConfigFallback;
    const fileContents = fs.readFileSync(configPath, 'utf8');
    const config = yaml.load(fileContents) as { miners: MinerConfig[] };
    
    if (config && Array.isArray(config.miners)) {
      const currentTime = new Date();
      miners = config.miners.map(miner => {
        return ({
          ...miner,
          status: 'offline',
          lastSeen: currentTime
        });
      });
      
      logger.info(`Loaded configuration for ${miners.length} miners`);
      return miners;
    }
    
    throw new Error('Invalid miners configuration format');
  } catch (error) {
    logger.error('Failed to load miners configuration:', error);
    return [];
  }
};

/**
 * Get all configured miners
 */
export const getMiners = (): MinerConfig[] => [...miners];

/**
 * Get miner by ID (name or IP)
 */
export const getMinerById = (id: string): MinerConfig | undefined => {
  return miners.find(miner => miner.name === id || miner.ip === id);
};

/**
 * Update miner status
 */
export const updateMinerStatus = (minerId: string, status: 'online' | 'offline' | 'error'): MinerConfig | null => {
  const miner = getMinerById(minerId);
  if (!miner) return null;
  
  miner.status = status;
  miner.lastSeen = new Date();
  return { ...miner };
};

// Load miners configuration on startup
loadMinersConfig();