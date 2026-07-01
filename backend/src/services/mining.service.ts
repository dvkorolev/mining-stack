/**
 * Mining Service (facade)
 *
 * Public entry point for mining operations. The implementation lives in
 * ./mining/*: `simulation` (fake data, SIMULATION_MODE only), `state` (live
 * snapshot, single writer), `stats-reader` (Prometheus read path),
 * `push-receiver` (scheduler push path) and `lifecycle` (interval
 * orchestration). This facade keeps the public API stable: owner-filtered
 * stats queries, per-miner queries, history/DB passthroughs and miner
 * control, plus re-exports of the lifecycle and push entry points.
 *
 * @module services/mining
 */

import { getMinerById, updateMinerStatus } from '../config/miners.config';
import { logger } from '../utils/logger';
import { getDatabase } from './database.service';
import { startMining, stopMining } from './mining/lifecycle';
import { updateMetricsFromScheduler } from './mining/push-receiver';
import { getMiningStats as getLiveStats } from './mining/state';

/**
 * Interface for detailed error information
 */
export interface MinerError {
  code: string;
  message: string;
  description: string;
  severity: 'critical' | 'warning' | 'info';
  timestamp: number;
  details?: Record<string, any>;
}

/**
 * Interface representing statistics for a single miner
 * @interface MinerStats
 */
export interface MinerStats {
  minerId: string;
  name: string;
  model: string;
  ip: string;
  alias?: string;
  owner?: string; // Telegram Chat ID for access control
  algorithm?: 'sha256' | 'scrypt'; // Mining algorithm
  status: 'online' | 'offline' | 'error';
  statusMessage?: string; // Human-readable status message
  lastSeen: Date;
  currentHashrate: number; // Always in TH/s for consistency
  averageHashrate: number; // Always in TH/s for consistency
  shares: {
    accepted: number;
    rejected: number;
    rejectionRate?: number; // Percentage (0-100)
  };
  hardware: {
    temperature: number;
    fanSpeed: number;
    powerUsage: number;
  };
  uptime: number;
  errors: MinerError[]; // Changed from string[] to MinerError[]
  errorCount: number; // Total number of errors
  lastError?: MinerError; // Most recent error for quick access
}

export interface MiningStats {
  totalHashrate: number; // Total combined hashrate (SHA256 + SCRYPT in TH/s)
  totalHashrateSha256: number; // SHA256 hashrate in TH/s
  totalHashrateScrypt: number; // SCRYPT hashrate in TH/s (for display convert to GH/s)
  averageHashrate24h: number; // Combined average
  averageHashrate24hSha256: number; // SHA256 24h average in TH/s
  averageHashrate24hScrypt: number; // SCRYPT 24h average in TH/s
  activeMiners: number;
  activeMinersSha256: number; // Active SHA256 miners
  activeMinersScrypt: number; // Active SCRYPT miners
  totalMiners: number;
  totalMined: number;
  miners: MinerStats[];
  timestamp: number;
  statsHistory: {
    timestamp: number;
    hashrate: number;
    hashrateSha256: number;
    hashrateScrypt: number;
  }[];
  // Aggregate statistics (calculated once in backend)
  aggregates?: {
    avgEfficiency: number; // GH/W
    totalPower: number; // W
    avgTemperature: number; // °C
    rejectionRate: number; // %
    maxHashrate: number; // TH/s (from last 24h, SHA256 only)
    minHashrate: number; // TH/s (from last 24h, SHA256 only)
    maxHashrateScrypt: number; // TH/s (from last 24h, SCRYPT only)
    minHashrateScrypt: number; // TH/s (from last 24h, SCRYPT only)
    uptimePercent: number; // %
  };
}

// The live mining-stats snapshot lives in ./mining/state (single
// reader/writer). This facade only READS it — the writers are the lifecycle
// interval (simulation/Prometheus) and the push receiver (METRICS_SOURCE=push).

// Get database instance
const db = getDatabase();

// Get current mining stats (optionally filtered by owner)
const getMiningStats = (owner?: string): MiningStats => {
  // If no owner specified, return global stats
  if (!owner) {
    return getLiveStats();
  }

  // Filter miners by owner and recalculate stats
  const ownerMiners = getLiveStats().miners.filter(m => m.owner === owner);

  if (ownerMiners.length === 0) {
    return {
      ...getLiveStats(),
      totalHashrate: 0,
      totalHashrateSha256: 0,
      totalHashrateScrypt: 0,
      averageHashrate24hSha256: 0,
      averageHashrate24hScrypt: 0,
      activeMiners: 0,
      activeMinersSha256: 0,
      activeMinersScrypt: 0,
      totalMiners: 0,
      miners: [],
    };
  }

  const activeMiners = ownerMiners.filter(m => m.status === 'online').length;
  const activeMinersSha256 = ownerMiners.filter(m => m.status === 'online' && m.algorithm === 'sha256').length;
  const activeMinersScrypt = ownerMiners.filter(m => m.status === 'online' && m.algorithm === 'scrypt').length;

  const totalHashrate = ownerMiners
    .filter(m => m.status === 'online')
    .reduce((sum, m) => sum + (m.currentHashrate || 0), 0);
  const totalHashrateSha256 = ownerMiners
    .filter(m => m.status === 'online' && m.algorithm === 'sha256')
    .reduce((sum, m) => sum + (m.currentHashrate || 0), 0);
  const totalHashrateScrypt = ownerMiners
    .filter(m => m.status === 'online' && m.algorithm === 'scrypt')
    .reduce((sum, m) => sum + (m.currentHashrate || 0), 0);

  const avgTemperature = ownerMiners
    .filter(m => m.hardware?.temperature)
    .reduce((sum, m) => sum + (m.hardware?.temperature || 0), 0) /
    (ownerMiners.filter(m => m.hardware?.temperature).length || 1);

  const avgPower = ownerMiners
    .filter(m => m.hardware?.powerUsage)
    .reduce((sum, m) => sum + (m.hardware?.powerUsage || 0), 0) /
    (ownerMiners.filter(m => m.hardware?.powerUsage).length || 1);

  return {
    ...getLiveStats(),
    totalHashrate,
    totalHashrateSha256,
    totalHashrateScrypt,
    activeMiners,
    activeMinersSha256,
    activeMinersScrypt,
    totalMiners: ownerMiners.length,
    miners: ownerMiners,
  };
};

// Restart a specific miner
const restartMiner = async (minerId: string) => {
  try {
    const miner = getMinerById(minerId);
    if (!miner) {
      throw new Error(`Miner ${minerId} not found`);
    }

    logger.info(`Restarting miner ${minerId}...`);

    // Simulate restart by setting to offline and then back to online
    updateMinerStatus(minerId, 'offline');

    // After a short delay, set back to online
    setTimeout(() => {
      updateMinerStatus(minerId, 'online');
      logger.info(`Miner ${minerId} restarted successfully`);
    }, 5000);

    return {
      success: true,
      message: `Miner ${minerId} restart initiated`,
      miner: getMinerById(minerId)
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logger.error(`Error restarting miner ${minerId}:`, errorMessage);
    throw new Error(`Failed to restart miner ${minerId}: ${errorMessage}`);
  }
};

// Update miner configuration
const updateMinerConfig = async (minerId: string, newConfig: any) => {
  try {
    const miner = getMinerById(minerId);
    if (!miner) {
      throw new Error(`Miner ${minerId} not found`);
    }

    logger.info(`Updating config for miner ${minerId}`, { newConfig });

    // In a real implementation, this would update the miner's configuration
    // For now, we'll just log it and return the updated config
    const updatedMiner = { ...miner, ...newConfig };

    return {
      success: true,
      message: `Configuration updated for miner ${minerId}`,
      miner: updatedMiner
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logger.error(`Error updating config for miner ${minerId}:`, errorMessage);
    throw new Error(`Failed to update config for miner ${minerId}: ${errorMessage}`);
  }
};

// Get detailed stats for a specific miner
const getMinerStats = (minerId: string) => {
  const miner = getMinerById(minerId);
  if (!miner) {
    throw new Error(`Miner ${minerId} not found`);
  }

  // If we have stats for this miner, return them
  const minerStats = getLiveStats().miners.find(m => m.minerId === minerId);
  if (minerStats) {
    return minerStats;
  }

  // Otherwise return basic info
  return {
    minerId: miner.name || miner.ip,
    name: miner.alias || miner.name || miner.ip,
    model: miner.model,
    ip: miner.ip,
    algorithm: undefined, // Will be detected when metrics arrive
    status: miner.status || 'offline',
    lastSeen: miner.lastSeen || new Date(0),
    currentHashrate: 0,
    averageHashrate: 0,
    shares: { accepted: 0, rejected: 0 },
    hardware: { temperature: 0, fanSpeed: 0, powerUsage: 0 },
    uptime: 0,
    errors: []
  };
};

// Get historical stats from database
const getHistoricalStats = (startTime: number, endTime: number, granularity: 'raw' | 'hourly' | 'daily' = 'raw') => {
  try {
    switch (granularity) {
      case 'hourly':
        return db.getHourlyStats(startTime, endTime);
      case 'daily':
        return db.getDailyStats(startTime, endTime);
      default:
        return db.getStats(startTime, endTime);
    }
  } catch (error) {
    logger.error('Error fetching historical stats:', error);
    throw new Error('Failed to fetch historical stats');
  }
};

// Get database statistics
const getDatabaseInfo = () => {
  try {
    return db.getDatabaseStats();
  } catch (error) {
    logger.error('Error fetching database info:', error);
    throw new Error('Failed to fetch database info');
  }
};

// Backup database
const backupDatabase = (backupPath: string) => {
  try {
    db.backup(backupPath);
    return { success: true, message: `Database backed up to ${backupPath}` };
  } catch (error) {
    logger.error('Error backing up database:', error);
    throw new Error('Failed to backup database');
  }
};

export {
  getMiningStats,
  getMinerStats,
  getHistoricalStats,
  getDatabaseInfo,
  backupDatabase,
  startMining,
  stopMining,
  restartMiner,
  updateMinerConfig,
  updateMetricsFromScheduler
};
