import { exec } from 'child_process';
import { promisify } from 'util';
import { config } from '../config/config';
import { broadcast } from './websocket.service';
import { getMiners, updateMinerStatus, getMinerById } from '../config/miners.config';
import { logger } from '../utils/logger';

declare const setInterval: (handler: TimerHandler, timeout?: number, ...args: any[]) => number;
declare const clearInterval: (handle?: number) => void;

const execAsync = promisify(exec);

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
  activeMiners: 0,
  totalMined: 0,
  miners: [],
  timestamp: Date.now(),
  statsHistory: []
};

// Track mining simulation intervals
let simulationInterval: NodeJS.Timeout | null = null;

// Simulate miner stats for a single miner
const simulateMinerStats = (miner: any): MinerStats => {
  const isOnline = Math.random() > 0.1; // 90% chance of being online
  const hasError = isOnline && Math.random() < 0.2; // 20% chance of error if online
  
  const status = !isOnline ? 'offline' : hasError ? 'error' : 'online';
  const lastSeen = new Date();
  
  // Update miner status
  updateMinerStatus(miner.name, status);
  
  // Generate realistic stats based on miner status
  const baseHashrate = miner.model.includes('S19') ? 100 : 50; // Different base hashrate based on model
  const hashrateVariance = Math.random() * 20 - 10; // ±10% variance
  const currentHashrate = status === 'online' ? Math.max(0, baseHashrate + hashrateVariance) : 0;
  
  return {
    minerId: miner.name,
    name: miner.alias || miner.name,
    model: miner.model,
    ip: miner.ip,
    status,
    lastSeen,
    currentHashrate,
    averageHashrate: currentHashrate * (0.9 + Math.random() * 0.2), // Slight variation for average
    shares: {
      accepted: Math.floor(Math.random() * 1000),
      rejected: Math.floor(Math.random() * 10)
    },
    hardware: {
      temperature: 60 + Math.random() * 30, // 60-90°C
      fanSpeed: 3000 + Math.random() * 2000, // 3000-5000 RPM
      powerUsage: 2000 + Math.random() * 1000 // 2000-3000W
    },
    uptime: status === 'online' ? 3600 + Math.floor(Math.random() * 86400) : 0, // 1h-1d if online
    errors: status === 'error' ? ['High temperature warning'] : []
  };
};

// Simulate mining stats for all miners
const simulateMiningStats = (): MiningStats => {
  const miners = getMiners();
  const minerStats = miners.map(simulateMinerStats);
  
  const totalHashrate = minerStats.reduce((sum, miner) => sum + miner.currentHashrate, 0);
  const activeMiners = minerStats.filter(m => m.status === 'online').length;
  
  // Update global stats
  const stats: MiningStats = {
    totalHashrate,
    activeMiners,
    totalMined: miningStats.totalMined + (totalHashrate / 10000), // Simulate some mining
    miners: minerStats,
    timestamp: Date.now(),
    statsHistory: [
      ...miningStats.statsHistory,
      { timestamp: Date.now(), hashrate: totalHashrate }
    ].slice(-config.mining.maxHistoryPoints)
  };

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
    
    // Clear any existing interval
    if (simulationInterval) {
      clearInterval(simulationInterval);
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

    // Initial stats update
    const initialStats = simulateMiningStats();
    miningStats = initialStats;
    
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
    
    // Clear the simulation interval
    if (simulationInterval) {
      clearInterval(simulationInterval);
      simulationInterval = null;
    }
    
    // Update all miners to offline status
    const miners = getMiners();
    miners.forEach(miner => updateMinerStatus(miner.name, 'offline'));
    
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
    minerId: miner.name,
    name: miner.alias || miner.name,
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

export type { MiningStats, MinerStats };

export {
  getMiningStats,
  getMinerStats,
  startMining,
  stopMining,
  restartMiner,
  updateMinerConfig
};
