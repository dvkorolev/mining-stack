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
import * as prometheusService from './prometheus.service';

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
  totalHashrate: number;
  averageHashrate24h: number;
  activeMiners: number;
  totalMiners: number;
  totalMined: number;
  miners: MinerStats[];
  timestamp: number;
  statsHistory: {
    timestamp: number;
    hashrate: number;
  }[];
  // Aggregate statistics (calculated once in backend)
  aggregates?: {
    avgEfficiency: number; // GH/W
    totalPower: number; // W
    avgTemperature: number; // °C
    rejectionRate: number; // %
    maxHashrate: number; // TH/s (from last 24h)
    minHashrate: number; // TH/s (from last 24h)
    uptimePercent: number; // %
  };
}

// In-memory storage for mining stats
let miningStats: MiningStats = {
  totalHashrate: 0,
  averageHashrate24h: 0,
  activeMiners: 0,
  totalMiners: 0,
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

// Share history for time-windowed rejection rate calculation
interface ShareSnapshot {
  timestamp: number;
  accepted: number;
  rejected: number;
}

const minerShareHistory = new Map<string, ShareSnapshot[]>();
const SHARE_HISTORY_WINDOW = 5 * 60 * 1000; // 5 minutes (matching Prometheus)
const MAX_SHARE_SNAPSHOTS = 10; // Keep last 10 snapshots

// Minimum time between status changes (5 minutes)
const MIN_STATUS_CHANGE_INTERVAL = 5 * 60 * 1000;

/**
 * Error code definitions with descriptions
 */
const ERROR_CODES = {
  HIGH_TEMP: {
    code: 'HIGH_TEMP',
    message: 'High Temperature',
    description: 'Miner temperature exceeds safe operating threshold (>85°C)',
    severity: 'critical' as const,
  },
  FAN_FAILURE: {
    code: 'FAN_FAILURE',
    message: 'Fan Failure',
    description: 'One or more cooling fans are not operating correctly',
    severity: 'critical' as const,
  },
  LOW_HASHRATE: {
    code: 'LOW_HASHRATE',
    message: 'Low Hashrate',
    description: 'Hashrate is significantly below expected performance',
    severity: 'warning' as const,
  },
  HIGH_REJECTION: {
    code: 'HIGH_REJECTION',
    message: 'High Share Rejection',
    description: 'Share rejection rate exceeds 5%',
    severity: 'warning' as const,
  },
  POWER_ISSUE: {
    code: 'POWER_ISSUE',
    message: 'Power Fluctuation',
    description: 'Unstable power supply detected',
    severity: 'warning' as const,
  },
  NETWORK_ERROR: {
    code: 'NETWORK_ERROR',
    message: 'Network Connection Issue',
    description: 'Unable to maintain stable connection to mining pool',
    severity: 'critical' as const,
  },
  CHIP_ERROR: {
    code: 'CHIP_ERROR',
    message: 'ASIC Chip Error',
    description: 'One or more ASIC chips are not responding',
    severity: 'critical' as const,
  },
  MISSING_CHIPS: {
    code: 'MISSING_CHIPS',
    message: 'Missing Chips on Hashboard',
    description: 'One or more hashboards are reporting fewer chips than expected',
    severity: 'warning' as const,
  },
};

/**
 * Generate random error for simulation
 */
const generateRandomError = (temperature: number, rejectionRate: number): MinerError | null => {
  const errors: MinerError[] = [];
  
  // High temperature error
  if (temperature > 85) {
    errors.push({
      ...ERROR_CODES.HIGH_TEMP,
      timestamp: Date.now(),
      details: { temperature: temperature.toFixed(1) },
    });
  }
  
  // High rejection rate
  if (rejectionRate > 5) {
    errors.push({
      ...ERROR_CODES.HIGH_REJECTION,
      timestamp: Date.now(),
      details: { rejectionRate: rejectionRate.toFixed(2) },
    });
  }
  
  // Random errors (simulate various issues)
  const randomValue = Math.random();
  if (randomValue < 0.3) {
    errors.push({
      ...ERROR_CODES.FAN_FAILURE,
      timestamp: Date.now(),
    });
  } else if (randomValue < 0.5) {
    errors.push({
      ...ERROR_CODES.CHIP_ERROR,
      timestamp: Date.now(),
      details: { affectedChips: Math.floor(Math.random() * 3) + 1 },
    });
  } else if (randomValue < 0.7) {
    errors.push({
      ...ERROR_CODES.NETWORK_ERROR,
      timestamp: Date.now(),
    });
  } else {
    errors.push({
      ...ERROR_CODES.POWER_ISSUE,
      timestamp: Date.now(),
    });
  }
  
  return errors.length > 0 ? errors[0] : null;
};

/**
 * Calculate time-windowed rejection rate (similar to Prometheus rate())
 * Uses share deltas over the last 5 minutes
 */
const calculateRejectionRate = (minerId: string, currentAccepted: number, currentRejected: number): number => {
  const now = Date.now();
  const history = minerShareHistory.get(minerId) || [];
  
  // Add current snapshot
  const currentSnapshot: ShareSnapshot = {
    timestamp: now,
    accepted: currentAccepted,
    rejected: currentRejected,
  };
  
  // Remove snapshots older than the window
  const validHistory = history.filter(s => now - s.timestamp < SHARE_HISTORY_WINDOW);
  
  // Add current snapshot and limit size
  validHistory.push(currentSnapshot);
  if (validHistory.length > MAX_SHARE_SNAPSHOTS) {
    validHistory.shift();
  }
  
  // Update history
  minerShareHistory.set(minerId, validHistory);
  
  // Need at least 2 snapshots to calculate rate
  if (validHistory.length < 2) {
    // Fallback to simple calculation for first snapshot
    const total = currentAccepted + currentRejected;
    return total > 0 ? (currentRejected / total) * 100 : 0;
  }
  
  // Calculate deltas from oldest to newest snapshot
  const oldest = validHistory[0];
  const newest = validHistory[validHistory.length - 1];
  
  const acceptedDelta = newest.accepted - oldest.accepted;
  const rejectedDelta = newest.rejected - oldest.rejected;
  const totalDelta = acceptedDelta + rejectedDelta;
  
  // Calculate rejection rate from deltas (rate over time window)
  if (totalDelta > 0) {
    return (rejectedDelta / totalDelta) * 100;
  }
  
  // No new shares in window, return 0
  return 0;
};

/**
 * Get real miner stats from Prometheus
 * Uses actual data from pyasic metrics
 */
const getRealMinerStats = async (
  miner: any,
  metrics: {
    hashrates: Map<string, number>;
    temperatures: Map<string, number>;
    power: Map<string, number>;
    status: Map<string, boolean>;
    uptime: Map<string, number>;
    fanSpeeds: Map<string, number[]>;
    algorithms: Map<string, 'sha256' | 'scrypt'>;
  }
): Promise<MinerStats> => {
  const minerId = miner.name || miner.ip;
  const ip = miner.ip;
  
  // Get real metrics from Prometheus
  const isOnline = metrics.status.get(ip) ?? false;
  const currentHashrate = metrics.hashrates.get(ip) ?? 0;
  const temperature = metrics.temperatures.get(ip) ?? 0;
  const powerUsage = metrics.power.get(ip) ?? 0;
  const uptime = metrics.uptime.get(ip) ?? 0;
  const fans = metrics.fanSpeeds.get(ip) ?? [];
  const avgFanSpeed = fans.length > 0 ? fans.reduce((a, b) => a + b, 0) / fans.length : 0;
  const algorithm = metrics.algorithms.get(ip) ?? 'sha256';
  
  // Determine status
  let status: 'online' | 'offline' | 'error' = isOnline ? 'online' : 'offline';
  let statusMessage = status.toUpperCase();
  const errors: MinerError[] = [];
  
  // Check for error conditions
  if (isOnline) {
    // Use configured temperature threshold (default 95°C for critical)
    const tempThreshold = config.thresholds.temperature.critical;
    if (temperature > tempThreshold) {
      status = 'error';
      const error: MinerError = {
        ...ERROR_CODES.HIGH_TEMP,
        timestamp: Date.now(),
        details: { temperature: temperature.toFixed(1) },
      };
      errors.push(error);
      statusMessage = error.message;
      
      logger.warn(`Miner ${minerId} error: ${error.message}`, {
        miner: minerId,
        errorCode: error.code,
        severity: error.severity,
        details: error.details,
      });
    } else if (currentHashrate < 10 && currentHashrate > 0 && algorithm === 'sha256') {
      // Very low hashrate might indicate an issue (only for SHA-256)
      // SCRYPT miners have much lower TH/s values (0.025 TH/s = 25 GH/s)
      status = 'error';
      const error: MinerError = {
        ...ERROR_CODES.LOW_HASHRATE,
        timestamp: Date.now(),
        details: { hashrate: currentHashrate.toFixed(2) },
      };
      errors.push(error);
      statusMessage = error.message;
    }
  }
  
  // Update miner status in config
  if (miner.name) {
    updateMinerStatus(miner.name, status);
  }
  
  const lastError = errors.length > 0 ? errors[errors.length - 1] : undefined;
  
  // Get share data from Prometheus if available
  // Note: These would need to be added to the metrics parameter if available
  const accepted = 0; // TODO: Add pool_accepted to Prometheus metrics
  const rejected = 0; // TODO: Add pool_rejected to Prometheus metrics
  const rejectionRate = calculateRejectionRate(minerId, accepted, rejected);
  
  return {
    minerId,
    name: miner.alias || miner.name || miner.ip,
    model: miner.model,
    ip: miner.ip,
    alias: miner.alias,
    owner: miner.owner,
    algorithm,
    status,
    statusMessage,
    lastSeen: new Date(),
    currentHashrate,
    averageHashrate: currentHashrate * 0.98, // Slightly lower average
    shares: {
      accepted,
      rejected,
      rejectionRate,
    },
    hardware: {
      temperature,
      fanSpeed: avgFanSpeed,
      powerUsage,
    },
    uptime,
    errors,
    errorCount: errors.length,
    lastError,
  };
};

/**
 * Calculate aggregate statistics from miner data
 */
const calculateAggregates = (minerStats: MinerStats[], statsHistory: { timestamp: number; hashrate: number }[]): MiningStats['aggregates'] => {
  if (minerStats.length === 0) {
    return {
      avgEfficiency: 0,
      totalPower: 0,
      avgTemperature: 0,
      rejectionRate: 0,
      maxHashrate: 0,
      minHashrate: 0,
      uptimePercent: 0,
    };
  }

  // Calculate average efficiency (GH/W)
  const avgEfficiency = minerStats.reduce((sum, m) => {
    const power = m.hardware?.powerUsage || 1;
    return sum + (m.currentHashrate / power);
  }, 0) / minerStats.length * 1000; // Convert TH/W to GH/W

  // Calculate total power (W)
  const totalPower = minerStats.reduce((sum, m) => sum + (m.hardware?.powerUsage || 0), 0);

  // Calculate average temperature (°C)
  const avgTemperature = minerStats.reduce((sum, m) => sum + (m.hardware?.temperature || 0), 0) / minerStats.length;

  // Calculate overall rejection rate (%)
  const totalAccepted = minerStats.reduce((sum, m) => sum + m.shares.accepted, 0);
  const totalRejected = minerStats.reduce((sum, m) => sum + m.shares.rejected, 0);
  const rejectionRate = totalAccepted + totalRejected > 0 
    ? (totalRejected / (totalAccepted + totalRejected)) * 100 
    : 0;

  // Calculate max/min hashrate from last 24 hours
  // Filter out unrealistic values (> 5000 TH/s is impossible for a single farm)
  const MAX_REALISTIC_HASHRATE = 5000; // TH/s
  const twentyFourHoursAgo = Date.now() - (24 * 60 * 60 * 1000);
  const recentHistory = statsHistory.filter(h => 
    h.timestamp >= twentyFourHoursAgo && 
    h.hashrate > 0 && 
    h.hashrate <= MAX_REALISTIC_HASHRATE
  );
  const hashrates = recentHistory.map(h => h.hashrate);
  const maxHashrate = hashrates.length > 0 ? Math.max(...hashrates) : 0;
  const minHashrate = hashrates.length > 0 ? Math.min(...hashrates) : 0;

  // Calculate uptime percentage
  const onlineMiners = minerStats.filter(m => m.status === 'online').length;
  const uptimePercent = (onlineMiners / minerStats.length) * 100;

  return {
    avgEfficiency,
    totalPower,
    avgTemperature,
    rejectionRate,
    maxHashrate,
    minHashrate,
    uptimePercent,
  };
};

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
  
  // Generate hardware stats
  const temperature = config.simulation.tempMin + Math.random() * (config.simulation.tempMax - config.simulation.tempMin);
  
  // Generate cumulative share counts (increasing over time)
  const baseAccepted = 1000000; // Start with high base
  const baseRejected = 10000;
  const acceptedShares = baseAccepted + Math.floor(Math.random() * 1000);
  const rejectedShares = baseRejected + Math.floor(Math.random() * 50);
  
  // Calculate rejection rate from lifetime totals (aligned with Grafana)
  const total = acceptedShares + rejectedShares;
  const rejectionRate = total > 0 ? (rejectedShares / total) * 100 : 0;
  
  // Generate errors if status is error
  const errors: MinerError[] = [];
  let statusMessage = status.toUpperCase();
  
  if (status === 'error') {
    const error = generateRandomError(temperature, rejectionRate);
    if (error) {
      errors.push(error);
      statusMessage = error.message;
      
      // Log error to console and file
      logger.warn(`Miner ${minerId} error: ${error.message} - ${error.description}`, {
        miner: minerId,
        errorCode: error.code,
        severity: error.severity,
        details: error.details,
      });
    }
  }
  
  const lastError = errors.length > 0 ? errors[errors.length - 1] : undefined;

  return {
    minerId,
    name: miner.alias || miner.name || miner.ip,
    model: miner.model,
    ip: miner.ip,
    alias: miner.alias,
    owner: miner.owner,
    status,
    statusMessage,
    lastSeen,
    currentHashrate,
    averageHashrate: currentHashrate * 0.98, // Slightly lower average
    shares: {
      accepted: acceptedShares,
      rejected: rejectedShares
    },
    hardware: {
      temperature,
      fanSpeed: config.simulation.fanMin + Math.random() * (config.simulation.fanMax - config.simulation.fanMin),
      powerUsage: config.simulation.powerMin + Math.random() * (config.simulation.powerMax - config.simulation.powerMin)
    },
    uptime: status === 'online' ? 3600 + Math.floor(Math.random() * 86400) : 0,
    errors,
    errorCount: errors.length,
    lastError,
  };
};

// Simulate mining stats for all miners
const simulateMiningStats = (): MiningStats => {
  const miners = getMiners();
  const minerStats = miners.map(simulateMinerStats);
  
  const totalHashrate = minerStats.reduce((sum, miner) => sum + miner.currentHashrate, 0);
  const activeMiners = minerStats.filter(m => m.status === 'online').length;
  
  // Calculate 24h average hashrate from history
  // Filter out corrupted values (> 5000 TH/s) from existing history
  const MAX_REALISTIC_HASHRATE = 5000;
  const cleanHistory = miningStats.statsHistory.filter(h => 
    h.hashrate > 0 && h.hashrate <= MAX_REALISTIC_HASHRATE
  );
  const statsHistory = [
    ...cleanHistory,
    { timestamp: Date.now(), hashrate: totalHashrate }
  ].slice(-config.mining.maxHistoryPoints);
  
  // Calculate 24h average using only data from last 24 hours
  const twentyFourHoursAgo = Date.now() - (24 * 60 * 60 * 1000);
  const recentStats = statsHistory.filter(stat => stat.timestamp >= twentyFourHoursAgo);
  const averageHashrate24h = recentStats.length > 0
    ? recentStats.reduce((sum, stat) => sum + stat.hashrate, 0) / recentStats.length
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

  // Calculate aggregates
  const aggregates = calculateAggregates(minerStats, statsHistory);
  
  // Update global stats
  const stats: MiningStats = {
    totalHashrate,
    averageHashrate24h,
    activeMiners,
    totalMiners: miners.length,
    totalMined: miningStats.totalMined + btcMined,
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

/**
 * Get real mining stats from Prometheus
 * Uses actual data from pyasic metrics
 */
const getRealMiningStats = async (): Promise<MiningStats> => {
  try {
    // Fetch real metrics from Prometheus
    const metrics = await prometheusService.getAllMinerMetrics();
    const miners = getMiners();
    
    // Get stats for each miner using real data
    const minerStatsPromises = miners.map(miner => getRealMinerStats(miner, metrics));
    const minerStats = await Promise.all(minerStatsPromises);
    
    const totalHashrate = minerStats.reduce((sum, miner) => sum + miner.currentHashrate, 0);
    // Count miners that are online OR have errors (they're still mining, just with issues)
    const activeMiners = minerStats.filter(m => m.status === 'online' || m.status === 'error').length;
    
    // Calculate 24h average hashrate from history
    // Filter out corrupted values (> 5000 TH/s) from existing history
    const MAX_REALISTIC_HASHRATE = 5000;
    const cleanHistory = miningStats.statsHistory.filter(h => 
      h.hashrate > 0 && h.hashrate <= MAX_REALISTIC_HASHRATE
    );
    const statsHistory = [
      ...cleanHistory,
      { timestamp: Date.now(), hashrate: totalHashrate }
    ].slice(-config.mining.maxHistoryPoints);
    
    // Calculate 24h average using only data from last 24 hours
    const twentyFourHoursAgo = Date.now() - (24 * 60 * 60 * 1000);
    const recentStats = statsHistory.filter(stat => stat.timestamp >= twentyFourHoursAgo);
    const averageHashrate24h = recentStats.length > 0
      ? recentStats.reduce((sum, stat) => sum + stat.hashrate, 0) / recentStats.length
      : totalHashrate;
    
    // BTC calculation removed - not useful for monitoring
    const btcMined = 0;
    
    // Calculate additional metrics
    const avgTemperature = minerStats.length > 0
      ? minerStats.reduce((sum, m) => sum + (m.hardware?.temperature || 0), 0) / minerStats.length
      : 0;
    
    const avgPower = minerStats.reduce((sum, m) => sum + (m.hardware?.powerUsage || 0), 0);
    
    // Calculate aggregates
    const aggregates = calculateAggregates(minerStats, statsHistory);
    
    const stats: MiningStats = {
      totalHashrate,
      averageHashrate24h,
      activeMiners,
      totalMiners: miners.length,
      totalMined: miningStats.totalMined + btcMined,
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
        rejectionRate: 0, // Would need pool data
      };
      db.insertStats(dbRecord);
    } catch (error) {
      logger.error('Error saving stats to database:', error);
    }

    return stats;
  } catch (error) {
    logger.error('Error fetching real mining stats:', error);
    // Fall back to simulation if Prometheus is unavailable
    return simulateMiningStats();
  }
};

// Get current mining stats (optionally filtered by owner)
const getMiningStats = (owner?: string): MiningStats => {
  // If no owner specified, return global stats
  if (!owner) {
    return miningStats;
  }
  
  // Filter miners by owner and recalculate stats
  const ownerMiners = miningStats.miners.filter(m => m.owner === owner);
  
  if (ownerMiners.length === 0) {
    return {
      ...miningStats,
      totalHashrate: 0,
      activeMiners: 0,
      totalMiners: 0,
      miners: [],
    };
  }
  
  const activeMiners = ownerMiners.filter(m => m.status === 'online').length;
  const totalHashrate = ownerMiners
    .filter(m => m.status === 'online')
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
    ...miningStats,
    totalHashrate,
    activeMiners,
    totalMiners: ownerMiners.length,
    miners: ownerMiners,
  };
};

// Start the mining process
const startMining = async (minerConfig: any = {}) => {
  try {
    const useRealData = config.mining.useRealData && config.prometheus.enabled;
    logger.info(`Starting mining ${useRealData ? 'with real Prometheus data' : 'simulation'}`);
    
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
        const stats = useRealData ? await getRealMiningStats() : simulateMiningStats();
        miningStats = stats; // Update in-memory stats
        broadcast({ type: 'mining-stats', data: stats });
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
    
    // Get miner ownership from database
    const db = getDatabase();
    const allMinersFromDb = db.getAllMiners();
    const ownershipMap = new Map(allMinersFromDb.map(m => [m.ip, m.owner]));
    
    // Convert scheduler format to our MinerStats format
    const minerStats: MinerStats[] = miners.map(m => {
      // Log temperature values for debugging
      if (m.hashrate > 0 && (!m.temp_max || m.temp_max === 0)) {
        logger.warn(`⚠️  Received temp_max=0 for ${m.name} (${m.ip}) despite hashrate=${m.hashrate}`);
      }
      
      // Determine status from scheduler data using new scrape_status field
      // Status codes: 2=success, 1=partial, 0=timeout, -1=refused, -2=error
      let status: 'online' | 'offline' | 'error' = 'offline';
      if (m.scrape_status !== undefined && m.scrape_status >= 0) {
        // Positive status means data was collected
        if (m.scrape_status > 0 && m.state === 2) {
          status = 'online';  // Mining
        } else if (m.scrape_status > 0 && m.state === 1) {
          status = 'offline'; // Idle
        } else {
          status = 'error';   // Timeout or other issue
        }
      } else if (m.scrape_status < 0) {
        // Negative status means connection/API error
        status = 'error';
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
      
      // Detect algorithm (SCRYPT miners have hashrate_mhs field)
      const isScrypt = m.hashrate_mhs !== undefined && m.hashrate_mhs > 0;
      const algorithm = isScrypt ? 'scrypt' : 'sha256';
      
      // Normalize hashrate to TH/s for consistency
      // For SCRYPT: hashrate is in GH/s, convert to TH/s
      // For SHA-256: hashrate is already in TH/s
      let hashrateInThs = isScrypt ? (m.hashrate || 0) / 1000 : (m.hashrate || 0);
      
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
    
    // Calculate aggregates
    let totalHashrate = minerStats.reduce((sum, m) => sum + m.currentHashrate, 0);
    
    // Safety check: Cap total hashrate to realistic farm value
    const MAX_FARM_HASHRATE = 5000; // TH/s
    if (totalHashrate > MAX_FARM_HASHRATE) {
      logger.error(`🚨 CORRUPTED TOTAL HASHRATE DETECTED: ${totalHashrate.toFixed(2)} TH/s > ${MAX_FARM_HASHRATE} TH/s`);
      logger.error(`Miners contributing to total:`, minerStats.map(m => ({ name: m.name, hashrate: m.currentHashrate })));
      // Cap to max realistic value
      totalHashrate = MAX_FARM_HASHRATE;
    }
    
    const activeMiners = minerStats.filter(m => m.status === 'online' || m.status === 'error').length;
    
    // Update stats history
    // Filter out corrupted values (> 5000 TH/s) from existing history
    const MAX_REALISTIC_HASHRATE = 5000;
    const cleanHistory = miningStats.statsHistory.filter(h => 
      h.hashrate > 0 && h.hashrate <= MAX_REALISTIC_HASHRATE
    );
    const statsHistory = [
      ...cleanHistory,
      { timestamp: timestamp || Date.now(), hashrate: totalHashrate }
    ].slice(-config.mining.maxHistoryPoints);
    
    // Calculate 24h average using only data from last 24 hours
    const twentyFourHoursAgo = Date.now() - (24 * 60 * 60 * 1000);
    const recentStats = statsHistory.filter(stat => stat.timestamp >= twentyFourHoursAgo);
    const averageHashrate24h = recentStats.length > 0
      ? recentStats.reduce((sum, stat) => sum + stat.hashrate, 0) / recentStats.length
      : totalHashrate;
    
    // Calculate aggregates
    const aggregates = calculateAggregates(minerStats, statsHistory);
    
    // Update global stats
    miningStats = {
      totalHashrate,
      averageHashrate24h,
      activeMiners,
      totalMiners: miners.length,
      totalMined: miningStats.totalMined, // Keep existing total
      miners: minerStats,
      timestamp: timestamp || Date.now(),
      statsHistory,
      aggregates
    };
    
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
        timestamp: miningStats.timestamp,
        totalHashrate: miningStats.totalHashrate,
        averageHashrate24h: miningStats.averageHashrate24h,
        activeMiners: miningStats.activeMiners,
        totalMiners: miners.length,
        totalMined: miningStats.totalMined,
        avgTemperature,
        avgPower,
        rejectionRate,
      };
      db.insertStats(dbRecord);
    } catch (error) {
      logger.error('Error saving stats to database:', error);
    }
    
    // Broadcast to WebSocket clients
    broadcast({ type: 'mining-stats', data: miningStats });
    
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
