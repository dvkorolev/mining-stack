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
import fs from 'fs';
import { config } from '../config/config';
import { broadcast } from './websocket.service';
import { getMiners, updateMinerStatus, getMinerById, loadMinersConfig } from '../config/miners.config';
import { logger } from '../utils/logger';
import { getDatabase, StatsRecord } from './database.service';
import { simulateMinerStats } from './mining/simulation';
import { getMiningStats as getLiveStats, setMiningStats as setLiveStats } from './mining/state';
import { getRealMiningStats, calculateAggregates } from './mining/stats-reader';

const execAsync = promisify(exec);

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

// The live mining-stats snapshot now lives in ./mining/state (single
// reader/writer). getLiveStats()/setLiveStats() are the local aliases for that
// module's getMiningStats()/setMiningStats(); setLiveStats is the one writer.

// Track mining simulation intervals
let simulationInterval: NodeJS.Timeout | null = null;
let aggregationInterval: NodeJS.Timeout | null = null;
let cleanupInterval: NodeJS.Timeout | null = null;

// Get database instance
const db = getDatabase();





// Simulate mining stats for all miners
const simulateMiningStats = (): MiningStats => {
  const miners = getMiners();
  const minerStats = miners.map(simulateMinerStats);
  
  // Calculate total hashrates by algorithm
  const totalHashrate = minerStats.reduce((sum, miner) => sum + miner.currentHashrate, 0);
  const totalHashrateSha256 = minerStats
    .filter(m => m.algorithm === 'sha256')
    .reduce((sum, miner) => sum + miner.currentHashrate, 0);
  const totalHashrateScrypt = minerStats
    .filter(m => m.algorithm === 'scrypt')
    .reduce((sum, miner) => sum + miner.currentHashrate, 0);
  
  const activeMiners = minerStats.filter(m => m.status === 'online').length;
  const activeMinersSha256 = minerStats.filter(m => m.status === 'online' && m.algorithm === 'sha256').length;
  const activeMinersScrypt = minerStats.filter(m => m.status === 'online' && m.algorithm === 'scrypt').length;
  
  // Calculate 24h average hashrate from history
  // Filter out corrupted values (> 5000 TH/s) from existing history
  const MAX_REALISTIC_HASHRATE = 5000;
  const cleanHistory = getLiveStats().statsHistory.filter(h => 
    h.hashrate > 0 && h.hashrate <= MAX_REALISTIC_HASHRATE
  ).map(h => ({
    timestamp: h.timestamp,
    hashrate: h.hashrate,
    hashrateSha256: h.hashrateSha256 || 0,
    hashrateScrypt: h.hashrateScrypt || 0
  }));
  const statsHistory = [
    ...cleanHistory,
    { 
      timestamp: Date.now(), 
      hashrate: totalHashrate,
      hashrateSha256: totalHashrateSha256,
      hashrateScrypt: totalHashrateScrypt
    }
  ].slice(-config.mining.maxHistoryPoints);
  
  // Calculate 24h average using only data from last 24 hours
  const twentyFourHoursAgo = Date.now() - (24 * 60 * 60 * 1000);
  const recentStats = statsHistory.filter(stat => stat.timestamp >= twentyFourHoursAgo);
  const averageHashrate24h = recentStats.length > 0
    ? recentStats.reduce((sum, stat) => sum + stat.hashrate, 0) / recentStats.length
    : totalHashrate;
  const averageHashrate24hSha256 = recentStats.length > 0
    ? recentStats.reduce((sum, stat) => sum + stat.hashrateSha256, 0) / recentStats.length
    : totalHashrateSha256;
  const averageHashrate24hScrypt = recentStats.length > 0
    ? recentStats.reduce((sum, stat) => sum + stat.hashrateScrypt, 0) / recentStats.length
    : totalHashrateScrypt;
  
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

  // Calculate aggregates
  const aggregates = calculateAggregates(minerStats, statsHistory);
  
  // Update global stats
  const stats: MiningStats = {
    totalHashrate,
    totalHashrateSha256,
    totalHashrateScrypt,
    averageHashrate24h,
    averageHashrate24hSha256,
    averageHashrate24hScrypt,
    activeMiners,
    activeMinersSha256,
    activeMinersScrypt,
    totalMiners: miners.length,
    totalMined: getLiveStats().totalMined + btcMined,
    miners: minerStats,
    timestamp: Date.now(),
    statsHistory,
    aggregates
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

// Start the mining process
const startMining = async (minerConfig: any = {}) => {
  try {
    if (config.mining.simulationMode) {
      logger.warn('SIMULATION_MODE is enabled: serving SIMULATED (fake) mining data, not real metrics.');
    }
    logger.info(`Starting mining in ${config.mining.simulationMode ? 'SIMULATION' : (config.mining.metricsSource === 'push' ? 'real-data (scheduler push)' : 'real-data (Prometheus)')} mode`);
    
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
    
    // Start stats update interval (real data or simulation)
    simulationInterval = setInterval(async () => {
      try {
        if (config.mining.simulationMode) {
          const stats = simulateMiningStats();
          setLiveStats(stats); // Update in-memory stats
          broadcast({ type: 'mining-stats', data: stats });
        } else if (config.mining.metricsSource === 'push') {
          // push path is authoritative; the interval must not overwrite live stats
        } else {
          const stats = await getRealMiningStats();
          setLiveStats(stats); // Update in-memory stats
          broadcast({ type: 'mining-stats', data: stats });
        }
      } catch (error) {
        logger.error('Error updating mining stats:', error);
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
        db.cleanupOldMinerStatsHistory(); // 30-day retention for per-miner history
      } catch (error) {
        logger.error('Error in cleanup:', error);
      }
    }, 6 * 60 * 60 * 1000); // 6 hours

    // Initial stats update
    let initialStats = getLiveStats();
    if (config.mining.simulationMode) {
      initialStats = simulateMiningStats();
      setLiveStats(initialStats);
    }
    
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

/**
 * Update metrics from python-scheduler push
 * This replaces polling Prometheus - scheduler pushes metrics directly
 */
const updateMetricsFromScheduler = async (
  miners: any[],
  timestamp?: number,
  collectionInfo?: any
): Promise<void> => {
  try {
    logger.info(`Processing metrics push: ${miners.length} miners`);

    if (config.mining.metricsSource !== 'push') {
      logger.debug(`METRICS_SOURCE=${config.mining.metricsSource}; ignoring scheduler push for live stats (Prometheus is source of truth)`);
      return;
    }

    // Get miner ownership from database
    const db = getDatabase();
    const allMinersFromDb = db.getAllMiners();
    const ownershipMap = new Map(allMinersFromDb.map(m => [m.ip, m.owner]));
    
    // Get all configured miners (to include those not yet scraped after restart)
    const configuredMiners = getMiners();
    const pushedMinerIps = new Set(miners.map(m => m.ip));
    
    // Convert scheduler format to our MinerStats format
    const minerStats: MinerStats[] = miners.map(m => {
      // Log temperature values for debugging
      if (m.hashrate > 0 && (!m.temp_max || m.temp_max === 0)) {
        logger.warn(`⚠️  Received temp_max=0 for ${m.name} (${m.ip}) despite hashrate=${m.hashrate}`);
      }
      
      // Determine status from scheduler data using new scrape_status field
      // scrape_status: 2=success, 1=partial, 0.4-0.6=fallback, 0=timeout, -1=refused, -2=error
      // state: 2=mining, 1=idle, 0=faulty
      let status: 'online' | 'offline' | 'error' = 'offline';
      
      if (m.scrape_status !== undefined) {
        if (m.scrape_status > 0) {
          // Data was successfully collected (primary or fallback)
          if (m.state === 2) {
            status = 'online';  // Mining with hashrate
          } else if (m.state === 1) {
            status = 'offline'; // Idle (not mining intentionally)
          } else if (m.state === 0) {
            status = 'offline'; // Faulty but reachable (treat as offline, not error)
          } else {
            status = 'offline'; // Unknown state, default to offline
          }
        } else if (m.scrape_status === 0) {
          // Connection timeout - miner is unreachable
          status = 'error';
        } else {
          // Negative status means connection/API error
          status = 'error';
        }
      }
      
      // Build error list
      const errors: MinerError[] = [];
      if (m.errors_count > 0 && m.state === 0) {
        errors.push({
          code: 'MINER_ERROR',
          message: 'Miner Error',
          description: 'Miner reported error state',
          severity: 'critical',
          timestamp: Date.now(),
        });
      }
      
      const accepted = m.pool_accepted || 0;
      const rejected = m.pool_rejected || 0;
      
      // Calculate rejection rate from lifetime totals (aligned with Grafana)
      const total = accepted + rejected;
      const rejectionRate = total > 0 ? (rejected / total) * 100 : 0;
      
      // Detect algorithm - prioritize model-based detection over hashrate_mhs field
      // Model-based detection is more reliable than checking hashrate_mhs field
      const modelLower = (m.model || '').toLowerCase();
      const isScryptByModel = modelLower.includes('dg1') || modelLower.includes('l3') || modelLower.includes('l7');
      
      // Only use hashrate_mhs as secondary indicator if model is ambiguous
      // AND only if hashrate_mhs is significantly large (> 1000 MH/s = 1 GH/s)
      const hasScryptHashrate = m.hashrate_mhs !== undefined && m.hashrate_mhs > 1000;
      
      const isScrypt = isScryptByModel || (!modelLower && hasScryptHashrate);
      const algorithm = isScrypt ? 'scrypt' : 'sha256';
      
      // Normalize hashrate to TH/s for consistency
      // For SCRYPT: hashrate is in MH/s or GH/s, convert to TH/s
      // For SHA-256: hashrate is already in TH/s
      let hashrateInThs = 0;
      if (isScrypt) {
        // SCRYPT: hashrate_mhs (MH/s) or hashrate (GH/s)
        if (m.hashrate_mhs && m.hashrate_mhs > 0) {
          hashrateInThs = m.hashrate_mhs / 1000000; // MH/s to TH/s
        } else {
          hashrateInThs = (m.hashrate || 0) / 1000; // GH/s to TH/s
        }
      } else {
        // SHA-256: hashrate is in TH/s
        hashrateInThs = m.hashrate || 0;
      }
      
      // Validate and cap individual miner hashrate (max 200 TH/s per miner is realistic)
      const MAX_MINER_HASHRATE = 200; // TH/s (even S21 Pro is ~200 TH/s)
      if (hashrateInThs > MAX_MINER_HASHRATE) {
        logger.warn(`⚠️  Capping corrupted hashrate for ${m.name}: ${hashrateInThs.toFixed(2)} TH/s → ${MAX_MINER_HASHRATE} TH/s`);
        hashrateInThs = 0; // Set to 0 to indicate data corruption
      }
      
      return {
        minerId: m.name || m.ip,
        name: m.name || m.ip,
        model: m.model || 'Unknown',
        ip: m.ip,
        owner: ownershipMap.get(m.ip) || undefined,
        algorithm,
        status,
        statusMessage: status.toUpperCase(),
        lastSeen: new Date(),
        currentHashrate: hashrateInThs,
        averageHashrate: hashrateInThs * 0.98,
        shares: {
          accepted,
          rejected,
          rejectionRate,
        },
        hardware: {
          temperature: m.temp_max || 0,
          fanSpeed: m.fan_speed || 0,
          powerUsage: m.power || 0,
        },
        uptime: m.uptime || 0,
        errors,
        errorCount: errors.length,
        lastError: errors.length > 0 ? errors[0] : undefined,
      };
    });
    
    // Add configured miners that weren't in the push (not yet scraped after restart)
    for (const configMiner of configuredMiners) {
      if (!pushedMinerIps.has(configMiner.ip)) {
        logger.info(`Adding configured miner not in push: ${configMiner.name} (${configMiner.ip})`);
        minerStats.push({
          minerId: configMiner.name || configMiner.ip,
          name: configMiner.alias || configMiner.name || configMiner.ip,
          model: configMiner.model,
          ip: configMiner.ip,
          owner: ownershipMap.get(configMiner.ip) || undefined,
          algorithm: undefined, // Will be detected when metrics arrive
          status: 'offline',
          statusMessage: 'PENDING', // Not yet scraped
          lastSeen: new Date(0), // Never seen
          currentHashrate: 0,
          averageHashrate: 0,
          shares: { accepted: 0, rejected: 0 },
          hardware: { temperature: 0, fanSpeed: 0, powerUsage: 0 },
          uptime: 0,
          errors: [],
          errorCount: 0,
          lastError: undefined,
        });
      }
    }
    
    // Calculate aggregates by algorithm
    let totalHashrate = minerStats.reduce((sum, m) => sum + m.currentHashrate, 0);
    let totalHashrateSha256 = minerStats
      .filter(m => m.algorithm === 'sha256')
      .reduce((sum, m) => sum + m.currentHashrate, 0);
    let totalHashrateScrypt = minerStats
      .filter(m => m.algorithm === 'scrypt')
      .reduce((sum, m) => sum + m.currentHashrate, 0);
    
    // Safety check: Cap total hashrate to realistic farm value
    const MAX_FARM_HASHRATE = 5000; // TH/s
    if (totalHashrate > MAX_FARM_HASHRATE) {
      logger.error(`🚨 CORRUPTED TOTAL HASHRATE DETECTED: ${totalHashrate.toFixed(2)} TH/s > ${MAX_FARM_HASHRATE} TH/s`);
      logger.error(`Miners contributing to total:`, minerStats.map(m => ({ name: m.name, hashrate: m.currentHashrate })));
      // Cap to max realistic value
      totalHashrate = MAX_FARM_HASHRATE;
      totalHashrateSha256 = Math.min(totalHashrateSha256, MAX_FARM_HASHRATE);
      totalHashrateScrypt = Math.min(totalHashrateScrypt, MAX_FARM_HASHRATE);
    }
    
    const activeMiners = minerStats.filter(m => m.status === 'online' || m.status === 'error').length;
    const activeMinersSha256 = minerStats.filter(m => (m.status === 'online' || m.status === 'error') && m.algorithm === 'sha256').length;
    const activeMinersScrypt = minerStats.filter(m => (m.status === 'online' || m.status === 'error') && m.algorithm === 'scrypt').length;
    
    // Update stats history
    // Filter out corrupted values (> 5000 TH/s) from existing history
    const MAX_REALISTIC_HASHRATE = 5000;
    const cleanHistory = getLiveStats().statsHistory.filter(h => 
      h.hashrate > 0 && h.hashrate <= MAX_REALISTIC_HASHRATE
    ).map(h => ({
      timestamp: h.timestamp,
      hashrate: h.hashrate,
      hashrateSha256: h.hashrateSha256 || 0,
      hashrateScrypt: h.hashrateScrypt || 0
    }));
    const statsHistory = [
      ...cleanHistory,
      { 
        timestamp: timestamp || Date.now(), 
        hashrate: totalHashrate,
        hashrateSha256: totalHashrateSha256,
        hashrateScrypt: totalHashrateScrypt
      }
    ].slice(-config.mining.maxHistoryPoints);
    
    // Calculate 24h average using only data from last 24 hours
    const twentyFourHoursAgo = Date.now() - (24 * 60 * 60 * 1000);
    const recentStats = statsHistory.filter(stat => stat.timestamp >= twentyFourHoursAgo);
    const averageHashrate24h = recentStats.length > 0
      ? recentStats.reduce((sum, stat) => sum + stat.hashrate, 0) / recentStats.length
      : totalHashrate;
    const averageHashrate24hSha256 = recentStats.length > 0
      ? recentStats.reduce((sum, stat) => sum + stat.hashrateSha256, 0) / recentStats.length
      : totalHashrateSha256;
    const averageHashrate24hScrypt = recentStats.length > 0
      ? recentStats.reduce((sum, stat) => sum + stat.hashrateScrypt, 0) / recentStats.length
      : totalHashrateScrypt;
    
    // Calculate aggregates
    const aggregates = calculateAggregates(minerStats, statsHistory);
    
    // Update global stats
    setLiveStats({
      totalHashrate,
      totalHashrateSha256,
      totalHashrateScrypt,
      averageHashrate24h,
      averageHashrate24hSha256,
      averageHashrate24hScrypt,
      activeMiners,
      activeMinersSha256,
      activeMinersScrypt,
      totalMiners: minerStats.length, // Use merged count (includes configured miners not yet scraped)
      totalMined: getLiveStats().totalMined, // Keep existing total
      miners: minerStats,
      timestamp: timestamp || Date.now(),
      statsHistory,
      aggregates
    });

    // Save to database
    try {
      const avgTemperature = minerStats.length > 0
        ? minerStats.reduce((sum, m) => sum + (m.hardware?.temperature || 0), 0) / minerStats.length
        : 0;
      
      const avgPower = minerStats.reduce((sum, m) => sum + (m.hardware?.powerUsage || 0), 0);
      
      const totalShares = minerStats.reduce((sum, m) => sum + m.shares.accepted + m.shares.rejected, 0);
      const rejectedShares = minerStats.reduce((sum, m) => sum + m.shares.rejected, 0);
      const rejectionRate = totalShares > 0 ? (rejectedShares / totalShares) * 100 : 0;
      
      const dbRecord: StatsRecord = {
        timestamp: getLiveStats().timestamp,
        totalHashrate: getLiveStats().totalHashrate,
        averageHashrate24h: getLiveStats().averageHashrate24h,
        activeMiners: getLiveStats().activeMiners,
        totalMiners: minerStats.length, // Use merged count
        totalMined: getLiveStats().totalMined,
        avgTemperature,
        avgPower,
        rejectionRate,
      };
      db.insertStats(dbRecord);
    } catch (error) {
      logger.error('Error saving stats to database:', error);
    }
    
    // Broadcast to WebSocket clients
    broadcast({ type: 'mining-stats', data: getLiveStats() });
    
    logger.info(`✓ Metrics updated: ${activeMiners}/${miners.length} miners active, ${totalHashrate.toFixed(2)} TH/s`);
  } catch (error) {
    logger.error('Error updating metrics from scheduler:', error);
    throw error;
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
