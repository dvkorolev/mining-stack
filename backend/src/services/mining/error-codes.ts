/**
 * Miner error code definitions
 *
 * Shared by both the real metrics path (mining.service.ts) and the
 * simulation path (mining/simulation.ts). Each entry is a partial
 * MinerError (code/message/description/severity); callers add a
 * `timestamp` and optional `details` when raising the error.
 *
 * @module services/mining/error-codes
 */

export const ERROR_CODES = {
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
