/**
 * Mining simulation
 *
 * Generates fake per-miner stats for SIMULATION_MODE. This path is only
 * reached when `config.mining.simulationMode` is true; it must never be a
 * silent fallback for the real metrics path (see CLAUDE.md "Simulation").
 *
 * Owns both the per-miner generators (with their private persistent state)
 * and the fleet-level aggregator `simulateMiningStats`. The DB handle is
 * fetched lazily inside the aggregator so importing this module stays free
 * of side effects.
 *
 * @module services/mining/simulation
 */

import { config } from '../../config/config';
import { getMiners, updateMinerStatus } from '../../config/miners.config';
import { logger } from '../../utils/logger';
import { getDatabase, StatsRecord } from '../database.service';
import { calculateAggregates } from './aggregates';
import { ERROR_CODES } from './error-codes';
import { getMiningStats as getLiveStats } from './state';
import type { MinerError, MinerStats, MiningStats } from '../mining.service';

// Persistent miner state to avoid constant status changes between ticks
const minerPersistentState = new Map<string, {
  status: 'online' | 'offline' | 'error';
  lastHashrate: number;
  lastStatusChange: number;
}>();

// Minimum time between status changes (5 minutes)
const MIN_STATUS_CHANGE_INTERVAL = 5 * 60 * 1000;

/**
 * Generate a random error for simulation
 */
export const generateRandomError = (temperature: number, rejectionRate: number): MinerError | null => {
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
 * Simulate miner stats for a single miner
 * Uses configuration values for realistic simulation
 * Maintains persistent state to avoid constant status changes
 */
export const simulateMinerStats = (miner: any): MinerStats => {
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

/**
 * Simulate mining stats for all miners (fleet-level aggregate).
 * Reads the live snapshot for history/totalMined continuity but does NOT
 * write it — the lifecycle interval is the single writer in simulation mode.
 */
export const simulateMiningStats = (): MiningStats => {
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
    getDatabase().insertStats(dbRecord);
  } catch (error) {
    logger.error('Error saving stats to database:', error);
  }

  return stats;
};
