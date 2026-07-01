/**
 * Fleet aggregate calculations
 *
 * Pure helpers shared by every MiningStats producer (Prometheus reader,
 * scheduler-push receiver, simulation). No I/O and no module-level state —
 * keep it that way so any producer can import it without side effects.
 *
 * @module services/mining/aggregates
 */

import type { MinerStats, MiningStats } from '../mining.service';

/**
 * Calculate aggregate statistics from miner data
 */
export const calculateAggregates = (minerStats: MinerStats[], statsHistory: { timestamp: number; hashrate: number; hashrateSha256: number; hashrateScrypt: number }[]): MiningStats['aggregates'] => {
  if (minerStats.length === 0) {
    return {
      avgEfficiency: 0,
      totalPower: 0,
      avgTemperature: 0,
      rejectionRate: 0,
      maxHashrate: 0,
      minHashrate: 0,
      maxHashrateScrypt: 0,
      minHashrateScrypt: 0,
      uptimePercent: 0,
    };
  }

  // Calculate average efficiency (GH/W) - SHA256 miners only
  const sha256Miners = minerStats.filter(m => m.algorithm === 'sha256');
  const avgEfficiency = sha256Miners.length > 0
    ? sha256Miners.reduce((sum, m) => {
        const power = m.hardware?.powerUsage || 1;
        return sum + (m.currentHashrate / power);
      }, 0) / sha256Miners.length * 1000 // Convert TH/W to GH/W
    : 0;

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

  // Calculate max/min hashrate from last 24 hours (SHA256 only)
  const MAX_REALISTIC_HASHRATE = 5000; // TH/s
  const twentyFourHoursAgo = Date.now() - (24 * 60 * 60 * 1000);
  const recentHistory = statsHistory.filter(h =>
    h.timestamp >= twentyFourHoursAgo &&
    h.hashrateSha256 > 0 &&
    h.hashrateSha256 <= MAX_REALISTIC_HASHRATE
  );
  const hashratesSha256 = recentHistory.map(h => h.hashrateSha256);
  const maxHashrate = hashratesSha256.length > 0 ? Math.max(...hashratesSha256) : 0;
  const minHashrate = hashratesSha256.length > 0 ? Math.min(...hashratesSha256) : 0;

  // Calculate max/min hashrate for SCRYPT from last 24 hours
  const recentHistoryScrypt = statsHistory.filter(h =>
    h.timestamp >= twentyFourHoursAgo &&
    h.hashrateScrypt > 0
  );
  const hashratesScrypt = recentHistoryScrypt.map(h => h.hashrateScrypt);
  const maxHashrateScrypt = hashratesScrypt.length > 0 ? Math.max(...hashratesScrypt) : 0;
  const minHashrateScrypt = hashratesScrypt.length > 0 ? Math.min(...hashratesScrypt) : 0;

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
    maxHashrateScrypt,
    minHashrateScrypt,
    uptimePercent,
  };
};
