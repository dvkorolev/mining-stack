/**
 * Hashrate formatting utilities
 */

export type Algorithm = 'sha256' | 'scrypt';

/**
 * Format hashrate with appropriate unit based on algorithm
 * Backend always sends hashrate in TH/s for consistency
 * 
 * @param hashrateThs - Hashrate in TH/s
 * @param algorithm - Mining algorithm (sha256 or scrypt)
 * @param decimals - Number of decimal places (default: 2)
 * @returns Formatted string with unit (e.g., "100.50 TH/s" or "20.47 GH/s")
 */
export function formatHashrate(
  hashrateThs: number,
  algorithm?: Algorithm,
  decimals: number = 2
): string {
  if (!hashrateThs || hashrateThs === 0) {
    return '0 TH/s';
  }

  // For SCRYPT, display in GH/s (multiply by 1000)
  if (algorithm === 'scrypt') {
    const hashrateGhs = hashrateThs * 1000;
    return `${hashrateGhs.toFixed(decimals)} GH/s`;
  }

  // For SHA-256 or unknown, display in TH/s
  return `${hashrateThs.toFixed(decimals)} TH/s`;
}

/**
 * Get the appropriate unit for the algorithm
 */
export function getHashrateUnit(algorithm?: Algorithm): string {
  return algorithm === 'scrypt' ? 'GH/s' : 'TH/s';
}

/**
 * Convert hashrate to the display value for the algorithm
 */
export function getHashrateValue(hashrateThs: number, algorithm?: Algorithm): number {
  if (algorithm === 'scrypt') {
    return hashrateThs * 1000; // TH/s to GH/s
  }
  return hashrateThs;
}
