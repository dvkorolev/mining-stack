/**
 * Mining Service
 * 
 * Handles all mining-related operations including:
 * - Starting/stopping mining simulation
 * - Managing miner statistics
 * - Broadcasting updates via WebSocket
 * - Miner configuration management
 * 
 * @module services/mining
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import { config } from '../config/config';
import { broadcast } from './websocket.service';
import { getMiners, updateMinerStatus, getMinerById, loadMinersConfig } from '../config/miners.config';
import { logger } from '../utils/logger';
import { getDatabase, StatsRecord } from './database.service';

const execAsync = promisify(exec);

/**
 * Interface representing statistics for a single miner
 * @interface MinerStats
 */
export interface MinerStats {
  minerId: string;
  name: string;
  model: string;
  ip: string;
  status: 'online' | 'offline' | 'error';
  lastSeen: Date;
  currentHashrate: number;
  averageHashrate: number;
  shares: {
    accepted: number;
    rejected: number;
  };
  hardware: {
    temperature: number;
    fanSpeed: number;
    powerUsage: number;
  };
  uptime: number;
  errors: string[];
}

export interface MiningStats {
  totalHashrate: number;
  averageHashrate24h: number;
  activeMiners: number;
  totalMined: number;
  miners: MinerStats[];
  timestamp: number;
  statsHistory: {
    timestamp: number;
    hashrate: number;
  }[];
}

// In-memory storage for mining stats
let miningStats: MiningStats = {
  totalHashrate: 0,
  averageHashrate24h: 0,
  activeMiners: 0,
  totalMined: 0,
  miners: [],
  timestamp: Date.now(),
  statsHistory: []
};

// Track mining simulation intervals
let simulationInterval: NodeJS.Timeout | null = null;
let aggregationInterval: NodeJS.Timeout | null = null;
let cleanupInterval: NodeJS.Timeout | null = null;

// Get database instance
const db = getDatabase();

// Persistent miner state to avoid constant status changes
const minerPersistentState = new Map<string, {
  status: 'online' | 'offline' | 'error';
  lastHashrate: number;
  lastStatusChange: number;
}>();

// Minimum time between status changes (5 minutes)
const MIN_STATUS_CHANGE_INTERVAL = 5 * 60 * 1000;

/**
 * Simulate miner stats for a single miner
 * Uses configuration values for realistic simulation
 * Maintains persistent state to avoid constant status changes
 */
const simulateMinerStats = (miner: any): MinerStats => {
  const minerId = miner.name || miner.ip;
  const now = Date.now();
  
  // Get or initialize persistent state
  let state = minerPersistentState.get(minerId);
  if (!state) {
    // Initialize with online status for new miners
    const isOnline = Math.random() < config.simulation.onlineProbability;
    state = {
      status: isOnline ? 'online' : 'offline',
      lastHashrate: 0,
      lastStatusChange: now
    };
    minerPersistentState.set(minerId, state);
  }
  
  // Only consider status change if enough time has passed
  let status = state.status;
  if (now - state.lastStatusChange > MIN_STATUS_CHANGE_INTERVAL) {
    // Small chance of status change (5% every check after minimum interval)
    if (Math.random() < 0.05) {
      if (status === 'offline') {
        status = 'online';
      } else if (status === 'online' && Math.random() < config.simulation.errorProbability) {
        status = 'error';
      } else if (status === 'error') {
        status = 'online';
      } else if (Math.random() < 0.02) {
        // Very small chance to go offline
        status = 'offline';
      }
      state.status = status;
      state.lastStatusChange = now;
    }
  }
  
  const lastSeen = new Date();
  
  // Update miner status
  if (miner.name) {
    updateMinerStatus(miner.name, status);
  }
  
  // Generate realistic stats based on miner status with smoothing
  const baseHashrate = miner.model.includes('S19') ? 100 : 50;
  
  let currentHashrate = 0;
  if (status === 'online') {
    // Reduced variance to 2% for smoother changes
    const varianceRange = baseHashrate * 0.02;
    const hashrateVariance = Math.random() * varianceRange - (varianceRange / 2);
    const targetHashrate = Math.max(0, baseHashrate + hashrateVariance);
    
    // Apply exponential moving average for smooth transitions
    const alpha = 0.3; // Smoothing factor
    currentHashrate = state.lastHashrate === 0 
      ? targetHashrate 
      : alpha * targetHashrate + (1 - alpha) * state.lastHashrate;
    
    state.lastHashrate = currentHashrate;
  } else {
    state.lastHashrate = 0;
  }
  
  return {
    minerId,
    name: miner.alias || miner.name || miner.ip,
    model: miner.model,
    ip: miner.ip,
    status,
    lastSeen,
    currentHashrate,
    averageHashrate: currentHashrate * 0.98, // Slightly lower average
    shares: {
      accepted: Math.floor(Math.random() * 1000),
      rejected: Math.floor(Math.random() * 10)
    },
    hardware: {
      temperature: config.simulation.tempMin + Math.random() * (config.simulation.tempMax - config.simulation.tempMin),
      fanSpeed: config.simulation.fanMin + Math.random() * (config.simulation.fanMax - config.simulation.fanMin),
      powerUsage: config.simulation.powerMin + Math.random() * (config.simulation.powerMax - config.simulation.powerMin)
    },
    uptime: status === 'online' ? 3600 + Math.floor(Math.random() * 86400) : 0,
    errors: status === 'error' ? ['High temperature warning'] : []
  };
};

// Simulate mining stats for all miners
const simulateMiningStats = (): MiningStats => {
  const miners = getMiners();
  const minerStats = miners.map(simulateMinerStats);
  
  const totalHashrate = minerStats.reduce((sum, miner) => sum + miner.currentHashrate, 0);
  const activeMiners = minerStats.filter(m => m.status === 'online').length;
  
  // Calculate 24h average hashrate from history
  const statsHistory = [
    ...miningStats.statsHistory,
    { timestamp: Date.now(), hashrate: totalHashrate }
  ].slice(-config.mining.maxHistoryPoints);
  
  const averageHashrate24h = statsHistory.length > 0
    ? statsHistory.reduce((sum, stat) => sum + stat.hashrate, 0) / statsHistory.length
    : totalHashrate;
  
  // Realistic BTC mining calculation
  // Network hashrate ~600 EH/s = 600,000,000 TH/s
  // Block reward: 3.125 BTC per block (after 2024 halving)
  // Blocks per day: 144
  // Daily BTC: 450 BTC total for entire network
  // Formula: (miner_hashrate / network_hashrate) * daily_btc * time_fraction
  const networkHashrate = 600000000; // 600 EH/s in TH/s
  const dailyBTC = 450;
  const updateIntervalSeconds = config.mining.updateInterval / 1000;
  const timeFraction = updateIntervalSeconds / 86400; // fraction of a day
  const btcMined = (totalHashrate / networkHashrate) * dailyBTC * timeFraction;
  
  // Calculate additional metrics for database
  const avgTemperature = minerStats.length > 0
    ? minerStats.reduce((sum, m) => sum + (m.hardware?.temperature || 0), 0) / minerStats.length
    : 0;
  
  const avgPower = minerStats.reduce((sum, m) => sum + (m.hardware?.powerUsage || 0), 0);
  
  const totalShares = minerStats.reduce((sum, m) => sum + m.shares.accepted + m.shares.rejected, 0);
  const rejectedShares = minerStats.reduce((sum, m) => sum + m.shares.rejected, 0);
  const rejectionRate = totalShares > 0 ? (rejectedShares / totalShares) * 100 : 0;

  // Update global stats
  const stats: MiningStats = {
    totalHashrate,
    averageHashrate24h,
    activeMiners,
    totalMined: miningStats.totalMined + btcMined,
    miners: minerStats,
    timestamp: Date.now(),
    statsHistory
  };

  // Save to database
  try {
    const dbRecord: StatsRecord = {
      timestamp: stats.timestamp,
      totalHashrate: stats.totalHashrate,
      averageHashrate24h: stats.averageHashrate24h,
      activeMiners: stats.activeMiners,
      totalMiners: miners.length,
      totalMined: stats.totalMined,
      avgTemperature,
      avgPower,
      rejectionRate,
    };
    db.insertStats(dbRecord);
  } catch (error) {
    logger.error('Error saving stats to database:', error);
  }

  return stats;
};

// Get current mining stats
const getMiningStats = (): MiningStats => {
  return miningStats;
};

// Start the mining process
const startMining = async (minerConfig: any = {}) => {
  try {
    logger.info('Starting mining simulation');
    
    // Clear any existing intervals
    if (simulationInterval) {
      clearInterval(simulationInterval);
    }
    if (aggregationInterval) {
      clearInterval(aggregationInterval);
    }
    if (cleanupInterval) {
      clearInterval(cleanupInterval);
    }
    
    // Start simulation
    simulationInterval = setInterval(() => {
      try {
        const stats = simulateMiningStats();
        miningStats = stats; // Update in-memory stats
        broadcast({ type: 'mining-stats', data: stats });
      } catch (error) {
        logger.error('Error in mining simulation:', error);
      }
    }, config.mining.updateInterval);

    // Start hourly aggregation (every hour)
    aggregationInterval = setInterval(() => {
      try {
        logger.info('Running hourly aggregation');
        db.aggregateHourly();
        db.aggregateDaily();
      } catch (error) {
        logger.error('Error in aggregation:', error);
      }
    }, 60 * 60 * 1000); // 1 hour

    // Start cleanup (every 6 hours)
    cleanupInterval = setInterval(() => {
      try {
        logger.info('Running data cleanup');
        db.cleanupOldRawData();
        db.cleanupOldHourlyData();
      } catch (error) {
        logger.error('Error in cleanup:', error);
      }
    }, 6 * 60 * 60 * 1000); // 6 hours

    // Initial stats update
    const initialStats = simulateMiningStats();
    miningStats = initialStats;
    
    // Run initial aggregation
    db.aggregateHourly();
    db.aggregateDaily();
    
    return { 
      success: true, 
      message: 'Mining simulation started successfully',
      stats: initialStats
    };
  } catch (error) {
    logger.error('Error starting mining simulation:', error);
    throw new Error('Failed to start mining simulation');
  }
};

// Stop the mining process
const stopMining = async () => {
  try {
    logger.info('Stopping mining simulation');
    
    // Clear all intervals
    if (simulationInterval) {
      clearInterval(simulationInterval);
      simulationInterval = null;
    }
    if (aggregationInterval) {
      clearInterval(aggregationInterval);
      aggregationInterval = null;
    }
    if (cleanupInterval) {
      clearInterval(cleanupInterval);
      cleanupInterval = null;
    }
    
    // Update all miners to offline status
    const miners = getMiners();
    miners.forEach(miner => {
      if (miner.name) {
        updateMinerStatus(miner.name, 'offline');
      }
    });
    
    return { 
      success: true, 
      message: 'Mining simulation stopped successfully' 
    };
  } catch (error) {
    logger.error('Error stopping mining simulation:', error);
    throw new Error('Failed to stop mining simulation');
  }
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
  const minerStats = miningStats.miners.find(m => m.minerId === minerId);
  if (minerStats) {
    return minerStats;
  }
  
  // Otherwise return basic info
  return {
    minerId: miner.name || miner.ip,
    name: miner.alias || miner.name || miner.ip,
    model: miner.model,
    ip: miner.ip,
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

// Trigger network scan for miners
const discoverMiners = async (): Promise<{ success: boolean; message: string; miners: any[] }> => {
  try {
    logger.info('Starting miner auto-discovery...');
    
    // Run the Python discovery script
    const scriptPath = process.env.NODE_ENV === 'production' 
      ? '/opt/mining-stack/bin/farm_init.py'
      : path.join(process.cwd(), 'bin', 'farm_init.py');
    
    const { stdout, stderr } = await execAsync(`python3 ${scriptPath}`);
    
    if (stderr && !stderr.includes('Found network')) {
      logger.warn('Discovery script warnings:', stderr);
    }
    
    if (stdout) {
      logger.info('Discovery output:', stdout);
    }
    
    // Reload miners configuration
    const newMiners = loadMinersConfig();
    
    return {
      success: true,
      message: `Discovered ${newMiners.length} miners`,
      miners: newMiners,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logger.error('Error during auto-discovery:', errorMessage);
    throw new Error(`Failed to discover miners: ${errorMessage}`);
  }
};

export {
  getMiningStats,
  getMinerStats,
  getHistoricalStats,
  getDatabaseInfo,
  backupDatabase,
  discoverMiners,
  startMining,
  stopMining,
  restartMiner,
  updateMinerConfig
};
