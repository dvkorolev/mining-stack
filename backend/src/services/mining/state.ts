/**
 * Live mining-stats state
 *
 * Owns the single in-memory `MiningStats` snapshot that the rest of the
 * backend reads as the live fleet state. Exposes exactly one reader
 * (`getMiningStats`) and one writer (`setMiningStats`).
 *
 * This enforces the `METRICS_SOURCE` single-writer invariant (see CLAUDE.md
 * "Live-stats source of truth"): whichever path is authoritative — the
 * Prometheus interval (`METRICS_SOURCE=prometheus`) or the scheduler push
 * (`METRICS_SOURCE=push`, via `updateMetricsFromScheduler`) — is the only one
 * that calls `setMiningStats`. Funnelling every write through this one setter
 * makes that invariant a property of the code, not just a convention.
 *
 * @module services/mining/state
 */

import type { MiningStats } from '../mining.service';

// In-memory storage for mining stats (the live snapshot)
let miningStats: MiningStats = {
  totalHashrate: 0,
  totalHashrateSha256: 0,
  totalHashrateScrypt: 0,
  averageHashrate24h: 0,
  averageHashrate24hSha256: 0,
  averageHashrate24hScrypt: 0,
  activeMiners: 0,
  activeMinersSha256: 0,
  activeMinersScrypt: 0,
  totalMiners: 0,
  totalMined: 0,
  miners: [],
  timestamp: Date.now(),
  statsHistory: []
};

/**
 * Return the current live mining stats (the canonical in-memory snapshot).
 * Returns the live reference, matching the previous direct-variable access.
 */
export const getMiningStats = (): MiningStats => miningStats;

/**
 * Replace the live mining stats. This is the single writer for the snapshot;
 * keep it that way to preserve the METRICS_SOURCE single-writer invariant.
 */
export const setMiningStats = (stats: MiningStats): void => {
  miningStats = stats;
};
