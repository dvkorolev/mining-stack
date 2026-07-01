/**
 * Mining lifecycle (interval orchestration)
 *
 * Owns the start/stop of the recurring jobs: the live-stats tick, hourly
 * aggregation, and 6-hourly data cleanup. The stats tick is the single
 * writer of the live snapshot for the simulation and Prometheus paths;
 * under `METRICS_SOURCE=push` it deliberately writes nothing so the push
 * receiver stays the only writer (see CLAUDE.md "Live-stats source of
 * truth").
 *
 * @module services/mining/lifecycle
 */

import { config } from '../../config/config';
import { getMiners, updateMinerStatus } from '../../config/miners.config';
import { logger } from '../../utils/logger';
import { getDatabase } from '../database.service';
import { broadcast } from '../websocket.service';
import { simulateMiningStats } from './simulation';
import { getMiningStats as getLiveStats, setMiningStats as setLiveStats } from './state';
import { getRealMiningStats } from './stats-reader';

// Track mining simulation intervals
let simulationInterval: NodeJS.Timeout | null = null;
let aggregationInterval: NodeJS.Timeout | null = null;
let cleanupInterval: NodeJS.Timeout | null = null;

const db = getDatabase();

// Start the mining process
export const startMining = async (minerConfig: any = {}) => {
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
export const stopMining = async () => {
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
