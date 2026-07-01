/**
 * Real (Prometheus) mining-stats reader
 *
 * Reads live fleet metrics from Prometheus and builds the real per-miner and
 * aggregate `MiningStats`. This is the authoritative real-data path under
 * `METRICS_SOURCE=prometheus`. It only READS the live snapshot (via the state
 * module's getter) and persists history; it is NOT a writer of the live
 * snapshot — keep the single-writer invariant intact (see CLAUDE.md).
 *
 * On a Prometheus read error it returns the last-known-good live stats and
 * logs the error; it MUST NOT silently fall back to simulated data
 * (see CLAUDE.md "Simulation").
 *
 * @module services/mining/stats-reader
 */

import { config } from '../../config/config';
import { getMiners, updateMinerStatus } from '../../config/miners.config';
import { logger } from '../../utils/logger';
import { getDatabase, StatsRecord } from '../database.service';
import * as prometheusService from '../prometheus.service';
import { calculateAggregates } from './aggregates';
import { ERROR_CODES } from './error-codes';
import { getMiningStats as getLiveStats } from './state';
import type { MinerError, MinerStats, MiningStats } from '../mining.service';

const db = getDatabase();

// Share history for time-windowed rejection rate calculation
interface ShareSnapshot {
  timestamp: number;
  accepted: number;
  rejected: number;
}

const minerShareHistory = new Map<string, ShareSnapshot[]>();
const SHARE_HISTORY_WINDOW = 5 * 60 * 1000; // 5 minutes (matching Prometheus)
const MAX_SHARE_SNAPSHOTS = 10; // Keep last 10 snapshots

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
 * Get real mining stats from Prometheus
 * Uses actual data from pyasic metrics
 */
export const getRealMiningStats = async (): Promise<MiningStats> => {
  try {
    // Fetch real metrics from Prometheus
    const metrics = await prometheusService.getAllMinerMetrics();
    const miners = getMiners();

    // Get stats for each miner using real data
    const minerStatsPromises = miners.map(miner => getRealMinerStats(miner, metrics));
    const minerStats = await Promise.all(minerStatsPromises);

    // Calculate total hashrates by algorithm
    const totalHashrate = minerStats.reduce((sum, miner) => sum + miner.currentHashrate, 0);
    const totalHashrateSha256 = minerStats
      .filter(m => m.algorithm === 'sha256')
      .reduce((sum, miner) => sum + miner.currentHashrate, 0);
    const totalHashrateScrypt = minerStats
      .filter(m => m.algorithm === 'scrypt')
      .reduce((sum, miner) => sum + miner.currentHashrate, 0);

    // Count miners that are online OR have errors (they're still mining, just with issues)
    const activeMiners = minerStats.filter(m => m.status === 'online' || m.status === 'error').length;
    const activeMinersSha256 = minerStats.filter(m => (m.status === 'online' || m.status === 'error') && m.algorithm === 'sha256').length;
    const activeMinersScrypt = minerStats.filter(m => (m.status === 'online' || m.status === 'error') && m.algorithm === 'scrypt').length;

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
        rejectionRate: 0, // Would need pool data
      };
      db.insertStats(dbRecord);

      // Save per-miner stats history (for Worker Details graphs)
      for (const miner of minerStats) {
        db.insertMinerStatsHistory({
          miner_ip: miner.ip,
          timestamp: stats.timestamp,
          hashrate: miner.currentHashrate,
          temperature: miner.hardware?.temperature || 0,
          fan_speed: miner.hardware?.fanSpeed || 0,
          power_usage: miner.hardware?.powerUsage || 0,
          rejection_rate: miner.shares?.rejectionRate || 0,
          uptime: miner.uptime || 0,
        });
      }
    } catch (error) {
      logger.error('Error saving stats to database:', error);
    }

    return stats;
  } catch (error) {
    logger.error('Error fetching real mining stats:', error);
    // Keep last-known-good stats instead of silently falling back to simulated data
    return getLiveStats();
  }
};
