// backend/src/config/miners.config.ts
import fs from 'fs';
import yaml from 'js-yaml';
import path from 'path';
import { logger } from '../utils/logger';

export interface MinerThresholds {
  temperature?: {
    warning?: number;    // Default: 75°C
    critical?: number;   // Default: 85°C
    shutdown?: number;   // Default: 90°C
  };
  hashrate?: {
    expected?: number;      // Expected hashrate in TH/s
    warningPercent?: number; // Default: 20% below expected
    criticalPercent?: number; // Default: 50% below expected
  };
  power?: {
    expected?: number;      // Expected power in W
    warningPercent?: number; // Default: 15% deviation
  };
  rejectionRate?: {
    warning?: number;    // Default: 2%
    critical?: number;   // Default: 5%
  };
  fanSpeed?: {
    warning?: number;    // Default: 3000 RPM
    critical?: number;   // Default: 2000 RPM
  };
}

export interface MinerConfig {
  ip: string;
  name?: string;  // Optional - will be auto-generated from IP if not provided
  model: string;
  alias?: string;
  owner?: string;  // Support for owner field
  status?: 'online' | 'offline' | 'error';
  lastSeen?: Date;
  thresholds?: MinerThresholds;  // Per-miner threshold overrides
  // Add more miner-specific configuration as needed
}

let miners: MinerConfig[] = [];

/**
 * Get effective thresholds for a miner (global defaults + per-miner overrides)
 */
export const getEffectiveThresholds = (miner: MinerConfig): Required<MinerThresholds> => {
  const { config: appConfig } = require('./config');
  const globalThresholds = appConfig.thresholds;
  
  return {
    temperature: {
      warning: miner.thresholds?.temperature?.warning ?? globalThresholds.temperature.warning,
      critical: miner.thresholds?.temperature?.critical ?? globalThresholds.temperature.critical,
      shutdown: miner.thresholds?.temperature?.shutdown ?? globalThresholds.temperature.shutdown,
    },
    hashrate: {
      expected: miner.thresholds?.hashrate?.expected ?? 0, // Must be set per-miner
      warningPercent: miner.thresholds?.hashrate?.warningPercent ?? globalThresholds.hashrate.warningPercent,
      criticalPercent: miner.thresholds?.hashrate?.criticalPercent ?? globalThresholds.hashrate.criticalPercent,
    },
    power: {
      expected: miner.thresholds?.power?.expected ?? 0, // Must be set per-miner
      warningPercent: miner.thresholds?.power?.warningPercent ?? globalThresholds.power.warningPercent,
    },
    rejectionRate: {
      warning: miner.thresholds?.rejectionRate?.warning ?? globalThresholds.rejectionRate.warning,
      critical: miner.thresholds?.rejectionRate?.critical ?? globalThresholds.rejectionRate.critical,
    },
    fanSpeed: {
      warning: miner.thresholds?.fanSpeed?.warning ?? globalThresholds.fanSpeed.warning,
      critical: miner.thresholds?.fanSpeed?.critical ?? globalThresholds.fanSpeed.critical,
    },
  };
};

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
        // Auto-generate name from IP if not provided
        const name = miner.name || `miner-${miner.ip.replace(/\./g, '-')}`;
        
        return ({
          ...miner,
          name,
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

/**
 * Save miners configuration to YAML file
 */
export const saveMinersConfig = (minersToSave: MinerConfig[]): void => {
  try {
    const { config: appConfig } = require('./config');
    const configPath = appConfig.paths.minerConfig;
    
    // Ensure directory exists
    const dir = path.dirname(configPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    
    // Prepare data for YAML (remove runtime fields)
    const minersData = minersToSave.map(m => {
      const data: any = {
        ip: m.ip,
        name: m.name,
        model: m.model,
        alias: m.alias,
        owner: m.owner,
      };
      
      // Include thresholds if they exist
      if (m.thresholds) {
        data.thresholds = m.thresholds;
      }
      
      return data;
    });
    
    const data = { miners: minersData };
    const yamlStr = yaml.dump(data, {
      indent: 2,
      lineWidth: -1,
      noRefs: true,
    });
    
    fs.writeFileSync(configPath, yamlStr, 'utf8');
    logger.info(`Saved ${minersToSave.length} miners to ${configPath}`);
  } catch (error) {
    logger.error('Failed to save miners configuration:', error);
    throw error;
  }
};

/**
 * Add new miner
 */
export const addMiner = (minerData: Omit<MinerConfig, 'status' | 'lastSeen'>): MinerConfig => {
  try {
    // Validate required fields
    if (!minerData.ip || !minerData.model) {
      throw new Error('IP and model are required');
    }
    
    // Check if miner with same IP already exists
    const existing = miners.find(m => m.ip === minerData.ip);
    if (existing) {
      throw new Error(`Miner with IP ${minerData.ip} already exists`);
    }
    
    const newMiner: MinerConfig = {
      ...minerData,
      name: minerData.name || `miner-${minerData.ip.replace(/\./g, '-')}`,
      status: 'offline',
      lastSeen: new Date(),
    };
    
    miners.push(newMiner);
    saveMinersConfig(miners);
    
    logger.info(`Added new miner: ${newMiner.name} (${newMiner.ip})`);
    return newMiner;
  } catch (error) {
    logger.error('Failed to add miner:', error);
    throw error;
  }
};

/**
 * Update existing miner
 */
export const updateMiner = (minerId: string, updates: Partial<MinerConfig>): MinerConfig | null => {
  try {
    const index = miners.findIndex(m => m.name === minerId || m.ip === minerId);
    if (index === -1) {
      logger.warn(`Miner ${minerId} not found for update`);
      return null;
    }
    
    // Don't allow changing IP to one that already exists
    if (updates.ip && updates.ip !== miners[index].ip) {
      const existing = miners.find(m => m.ip === updates.ip);
      if (existing) {
        throw new Error(`Miner with IP ${updates.ip} already exists`);
      }
    }
    
    miners[index] = { 
      ...miners[index], 
      ...updates,
      lastSeen: new Date(),
    };
    
    saveMinersConfig(miners);
    
    logger.info(`Updated miner: ${miners[index].name} (${miners[index].ip})`);
    return miners[index];
  } catch (error) {
    logger.error('Failed to update miner:', error);
    throw error;
  }
};

/**
 * Delete miner
 */
export const deleteMiner = (minerId: string): boolean => {
  try {
    const index = miners.findIndex(m => m.name === minerId || m.ip === minerId);
    if (index === -1) {
      logger.warn(`Miner ${minerId} not found for deletion`);
      return false;
    }
    
    const deletedMiner = miners[index];
    miners.splice(index, 1);
    saveMinersConfig(miners);
    
    logger.info(`Deleted miner: ${deletedMiner.name} (${deletedMiner.ip})`);
    return true;
  } catch (error) {
    logger.error('Failed to delete miner:', error);
    throw error;
  }
};

// Load miners configuration on startup
loadMinersConfig();