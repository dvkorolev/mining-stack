/**
 * Mining simulation
 *
 * Generates fake per-miner stats for SIMULATION_MODE. This path is only
 * reached when `config.mining.simulationMode` is true; it must never be a
 * silent fallback for the real metrics path (see CLAUDE.md "Simulation").
 *
 * The facade (mining.service.ts) owns the fleet-level aggregator
 * (`simulateMiningStats`); this module owns the per-miner generators and
 * their private persistent state.
 *
 * @module services/mining/simulation
 */

import { config } from '../../config/config';
import { updateMinerStatus } from '../../config/miners.config';
import { logger } from '../../utils/logger';
import { ERROR_CODES } from './error-codes';
import type { MinerError, MinerStats } from '../mining.service';

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
