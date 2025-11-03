// backend/src/config/miners.config.ts
import fs from 'fs';
import yaml from 'js-yaml';
import path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import { logger } from '../utils/logger';

const execAsync = promisify(exec);

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

export interface PoolConfig {
  url: string;
  user: string;
  password?: string;
}

export interface MinerConfig {
  ip: string;
  name: string;  // Required - will be auto-generated from IP if not provided
  model: string;
  alias?: string;
  // Flat authentication fields (aligned with Python collectors)
  username?: string;  // For CGI fallback (default: 'root')
  password?: string;  // For CGI fallback (default: 'root')
  api_port?: number;  // Custom CGMiner API port (default: 4028)
  algorithm?: 'sha256' | 'scrypt';  // Explicit algorithm override (auto-detected if not specified)
  // Runtime fields (not saved to YAML)
  status?: 'online' | 'offline' | 'error';
  lastSeen?: Date;
  // Optional configuration
  thresholds?: MinerThresholds;  // Per-miner threshold overrides
  pools?: PoolConfig[];  // Mining pool configuration
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
      miners = config.miners.map((miner: any) => {
        // Auto-generate name from IP if not provided
        const name = miner.name || `miner-${miner.ip.replace(/\./g, '-')}`;
        
        // Migrate old nested credentials to flat fields (backward compatibility)
        let username = miner.username;
        let password = miner.password;
        
        if (!username && miner.credentials) {
          username = miner.credentials.username;
          password = miner.credentials.password;
          logger.info(`Migrating credentials for ${name} to flat structure`);
        }
        
        return {
          ip: miner.ip,
          name,
          model: miner.model,
          alias: miner.alias,
          username,
          password,
          api_port: miner.api_port,
          status: 'offline' as const,
          lastSeen: currentTime,
          thresholds: miner.thresholds,
          pools: miner.pools
        };
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
 * Regenerate Prometheus rules after config change
 */
const regeneratePrometheusRules = async (): Promise<void> => {
  try {
    const pythonPath = process.env.NODE_ENV === 'production'
      ? '/opt/mining-stack/venv/bin/python3'
      : path.join(process.cwd(), 'venv', 'bin', 'python3');
    
    const scriptPath = process.env.NODE_ENV === 'production'
      ? '/opt/mining-stack/bin/generate_prometheus_rules.py'
      : path.join(process.cwd(), 'bin', 'generate_prometheus_rules.py');
    
    if (!fs.existsSync(pythonPath) || !fs.existsSync(scriptPath)) {
      logger.warn('Prometheus rule generation skipped: Python or script not found');
      return;
    }
    
    logger.info('Regenerating Prometheus rules...');
    await execAsync(`${pythonPath} ${scriptPath}`);
    
    // Reload Prometheus (only in production)
    if (process.env.NODE_ENV === 'production') {
      try {
        await execAsync('docker exec mining-stack-prometheus-1 kill -HUP 1');
        logger.info('Prometheus rules regenerated and reloaded');
      } catch (error) {
        logger.warn('Failed to reload Prometheus (container might not be running)');
      }
    } else {
      logger.info('Prometheus rules regenerated (reload skipped in development)');
    }
  } catch (error) {
    logger.error('Failed to regenerate Prometheus rules:', error);
    // Don't throw - config was saved successfully
  }
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
      };
      
      // Add optional fields only if present (aligned with Python collectors)
      if (m.alias) data.alias = m.alias;
      if (m.username) data.username = m.username;
      if (m.password) data.password = m.password;
      if (m.api_port) data.api_port = m.api_port;
      if (m.algorithm) data.algorithm = m.algorithm;
      if (m.thresholds) data.thresholds = m.thresholds;
      if (m.pools) data.pools = m.pools;
      
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
    
    // Regenerate Prometheus rules after save (async, don't wait)
    regeneratePrometheusRules().catch(err => {
      logger.warn('Failed to auto-regenerate Prometheus rules:', err);
    });
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