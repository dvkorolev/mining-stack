/**
 * Scheduler-push metrics receiver
 *
 * Ingests the miner metrics the python-scheduler POSTs to
 * `/api/internal/metrics` and rebuilds the live `MiningStats` snapshot.
 * This path is the authoritative writer ONLY under `METRICS_SOURCE=push`;
 * under any other source it acknowledges the push but MUST NOT touch the
 * live snapshot — keep the single-writer invariant intact (see CLAUDE.md
 * "Live-stats source of truth").
 *
 * @module services/mining/push-receiver
 */

import { config } from '../../config/config';
import { broadcast } from '../websocket.service';
import { getMiners } from '../../config/miners.config';
import { logger } from '../../utils/logger';
import { getDatabase, StatsRecord } from '../database.service';
import { calculateAggregates } from './aggregates';
import { getMiningStats as getLiveStats, setMiningStats as setLiveStats } from './state';
import type { MinerError, MinerStats } from '../mining.service';

/**
 * Convert one miner record from the scheduler push payload into our
 * MinerStats shape: status from scrape_status/state, algorithm detection,
 * hashrate normalization to TH/s, and corrupted-value capping.
 */
export const normalizeSchedulerMiner = (
  m: any,
  ownershipMap: Map<string, string | null | undefined>
): MinerStats => {
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
};

/**
 * Update metrics from python-scheduler push
 * This replaces polling Prometheus - scheduler pushes metrics directly
 */
export const updateMetricsFromScheduler = async (
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
    const ownershipMap = new Map<string, string | null | undefined>(
      allMinersFromDb.map(m => [m.ip, m.owner])
    );

    // Get all configured miners (to include those not yet scraped after restart)
    const configuredMiners = getMiners();
    const pushedMinerIps = new Set(miners.map(m => m.ip));

    // Convert scheduler format to our MinerStats format
    const minerStats: MinerStats[] = miners.map(m => normalizeSchedulerMiner(m, ownershipMap));

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
