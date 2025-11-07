// backend/src/config/miners.config.ts
import fs from 'fs';
import yaml from 'js-yaml';
import path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import { logger } from '../utils/logger';
import { getDatabase, MinerRecord } from '../services/database.service';

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

// Cache for miners (loaded from database)
let minersCache: MinerConfig[] = [];
let cacheTimestamp: number = 0;
const CACHE_TTL_MS = 5000; // 5 seconds cache

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
 * Convert database MinerRecord to MinerConfig
 */
const dbRecordToConfig = (record: MinerRecord): MinerConfig => {
  let credentials: { username?: string; password?: string } | undefined;
  
  if (record.credentials) {
    try {
      credentials = JSON.parse(record.credentials);
    } catch (error) {
      logger.warn(`Failed to parse credentials for ${record.name}`);
    }
  }
  
  return {
    ip: record.ip,
    name: record.name,
    model: record.model,
    alias: record.alias,
    username: credentials?.username,
    password: credentials?.password,
    api_port: record.api_port,
    status: 'offline' as const,
    lastSeen: new Date(),
    // Note: thresholds and pools are not stored in DB yet
    // They can be added as JSON columns if needed
  };
};

/**
 * Load miners configuration from database
 * @param owner Optional owner filter (Telegram chat ID). If not provided, loads all miners.
 */
export const loadMinersConfig = (owner?: string): MinerConfig[] => {
  try {
    const db = getDatabase();
    const records = owner ? db.getMinersByOwner(owner) : db.getAllMiners();
    
    const currentTime = new Date();
    minersCache = records.map(record => ({
      ...dbRecordToConfig(record),
      status: 'offline' as const,
      lastSeen: currentTime,
    }));
    
    cacheTimestamp = Date.now();
    logger.info(`Loaded configuration for ${minersCache.length} miners${owner ? ` (owner: ${owner.substring(0, 4)}***)` : ''}`);
    return minersCache;
  } catch (error) {
    logger.error('Failed to load miners configuration from database:', error);
    return [];
  }
};

/**
 * Get all configured miners
 * @param owner Optional owner filter (Telegram chat ID)
 * @param forceRefresh Force reload from database
 */
export const getMiners = (owner?: string, forceRefresh: boolean = false): MinerConfig[] => {
  // Refresh cache if expired or forced
  if (forceRefresh || Date.now() - cacheTimestamp > CACHE_TTL_MS) {
    loadMinersConfig(owner);
  }
  
  // If owner is specified and cache doesn't match, reload
  if (owner && minersCache.length > 0) {
    // Simple check: if we have a cache but need filtered results, reload
    loadMinersConfig(owner);
  }
  
  return [...minersCache];
};

/**
 * Get miner by ID (name or IP)
 */
export const getMinerById = (id: string): MinerConfig | undefined => {
  // Try cache first
  let miner = minersCache.find(m => m.name === id || m.ip === id);
  
  // If not in cache, try database
  if (!miner) {
    try {
      const db = getDatabase();
      const record = db.getMinerByName(id) || db.getMinerByIp(id);
      if (record) {
        miner = dbRecordToConfig(record);
        // Update cache
        minersCache.push(miner);
      }
    } catch (error) {
      logger.error(`Failed to get miner ${id} from database:`, error);
    }
  }
  
  return miner;
};

/**
 * Update miner status
 */
export const updateMinerStatus = (minerId: string, status: 'online' | 'offline' | 'error'): MinerConfig | null => {
  const miner = getMinerById(minerId);
  if (!miner) return null;
  
  miner.status = status;
  miner.lastSeen = new Date();
  
  // Update database status
  try {
    const db = getDatabase();
    db.updateMinerStatus(miner.ip, status);
  } catch (error) {
    logger.error(`Failed to update miner status in database for ${minerId}:`, error);
  }
  
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
 * Save miners configuration to database (deprecated - use addMiner/updateMiner instead)
 * Kept for backward compatibility
 */
export const saveMinersConfig = (minersToSave: MinerConfig[]): void => {
  logger.warn('saveMinersConfig is deprecated. Use addMiner/updateMiner for individual operations.');
  // This function is kept for backward compatibility but does nothing
  // Individual miners should be added/updated using addMiner/updateMiner
};

/**
 * Add new miner
 * @param minerData Miner configuration data
 * @param owner Owner's Telegram chat ID (required for multi-user support)
 */
export const addMiner = (minerData: Omit<MinerConfig, 'status' | 'lastSeen'>, owner: string): MinerConfig => {
  try {
    // Validate required fields
    if (!minerData.ip || !minerData.model) {
      throw new Error('IP and model are required');
    }
    
    if (!owner) {
      throw new Error('Owner (Telegram chat ID) is required');
    }
    
    const db = getDatabase();
    
    // Check if miner with same IP already exists
    const existing = db.getMinerByIp(minerData.ip);
    if (existing) {
      throw new Error(`Miner with IP ${minerData.ip} already exists`);
    }
    
    const name = minerData.name || `miner-${minerData.ip.replace(/\./g, '-')}`;
    
    // Prepare credentials JSON
    const credentials = (minerData.username || minerData.password) 
      ? JSON.stringify({ username: minerData.username, password: minerData.password })
      : undefined;
    
    const minerRecord: MinerRecord = {
      ip: minerData.ip,
      name,
      model: minerData.model,
      alias: minerData.alias,
      owner,
      status: 'active',
      credentials,
      api_port: minerData.api_port,
    };
    
    db.upsertMiner(minerRecord);
    
    const newMiner: MinerConfig = {
      ...minerData,
      name,
      status: 'offline',
      lastSeen: new Date(),
    };
    
    // Update cache
    minersCache.push(newMiner);
    
    // Regenerate Prometheus rules after add (async, don't wait)
    regeneratePrometheusRules().catch(err => {
      logger.warn('Failed to auto-regenerate Prometheus rules:', err);
    });
    
    logger.info(`Added new miner: ${newMiner.name} (${newMiner.ip}) for owner ${owner.substring(0, 4)}***`);
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
    const db = getDatabase();
    const existing = db.getMinerByName(minerId) || db.getMinerByIp(minerId);
    
    if (!existing) {
      logger.warn(`Miner ${minerId} not found for update`);
      return null;
    }
    
    // Don't allow changing IP to one that already exists
    if (updates.ip && updates.ip !== existing.ip) {
      const ipExists = db.getMinerByIp(updates.ip);
      if (ipExists) {
        throw new Error(`Miner with IP ${updates.ip} already exists`);
      }
    }
    
    // Prepare updated credentials if username/password changed
    let credentials = existing.credentials;
    if (updates.username !== undefined || updates.password !== undefined) {
      const currentCreds = credentials ? JSON.parse(credentials) : {};
      credentials = JSON.stringify({
        username: updates.username ?? currentCreds.username,
        password: updates.password ?? currentCreds.password,
      });
    }
    
    const updatedRecord: MinerRecord = {
      ip: updates.ip ?? existing.ip,
      name: updates.name ?? existing.name,
      model: updates.model ?? existing.model,
      alias: updates.alias ?? existing.alias,
      owner: existing.owner, // Owner cannot be changed
      status: existing.status,
      credentials,
      api_port: updates.api_port ?? existing.api_port,
    };
    
    db.upsertMiner(updatedRecord);
    
    // Update cache
    const cacheIndex = minersCache.findIndex(m => m.name === minerId || m.ip === minerId);
    if (cacheIndex !== -1) {
      minersCache[cacheIndex] = {
        ...minersCache[cacheIndex],
        ...updates,
        lastSeen: new Date(),
      };
    }
    
    // Regenerate Prometheus rules after update (async, don't wait)
    regeneratePrometheusRules().catch(err => {
      logger.warn('Failed to auto-regenerate Prometheus rules:', err);
    });
    
    logger.info(`Updated miner: ${updatedRecord.name} (${updatedRecord.ip})`);
    return dbRecordToConfig(updatedRecord);
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
    const db = getDatabase();
    const existing = db.getMinerByName(minerId) || db.getMinerByIp(minerId);
    
    if (!existing) {
      logger.warn(`Miner ${minerId} not found for deletion`);
      return false;
    }
    
    const success = db.deleteMiner(existing.ip);
    
    if (success) {
      // Update cache
      const cacheIndex = minersCache.findIndex(m => m.name === minerId || m.ip === minerId);
      if (cacheIndex !== -1) {
        minersCache.splice(cacheIndex, 1);
      }
      
      // Regenerate Prometheus rules after delete (async, don't wait)
      regeneratePrometheusRules().catch(err => {
        logger.warn('Failed to auto-regenerate Prometheus rules:', err);
      });
      
      logger.info(`Deleted miner: ${existing.name} (${existing.ip})`);
    }
    
    return success;
  } catch (error) {
    logger.error('Failed to delete miner:', error);
    throw error;
  }
};

// Load miners configuration on startup
loadMinersConfig();