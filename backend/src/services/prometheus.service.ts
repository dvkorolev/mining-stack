/**
 * Prometheus Service
 * 
 * Queries Prometheus for real miner metrics from pyasic
 * Replaces simulation with actual data from miners
 */

import axios from 'axios';
import { logger } from '../utils/logger';
import { config } from '../config/config';

// Prometheus configuration
const PROMETHEUS_URL = process.env.PROMETHEUS_URL || 'http://prometheus:9090';

interface PrometheusResult {
  metric: Record<string, string>;
  value: [number, string];
}

interface PrometheusResponse {
  status: string;
  data: {
    resultType: string;
    result: PrometheusResult[];
  };
}

/**
 * Query Prometheus for a specific metric
 */
async function queryPrometheus(query: string): Promise<PrometheusResult[]> {
  try {
    const response = await axios.get<PrometheusResponse>(`${PROMETHEUS_URL}/api/v1/query`, {
      params: { query },
      timeout: 5000,
    });

    if (response.data.status === 'success') {
      return response.data.data.result;
    }

    logger.warn(`Prometheus query failed: ${response.data.status}`);
    return [];
  } catch (error) {
    if (axios.isAxiosError(error)) {
      logger.error(`Prometheus query error: ${error.message}`);
    } else {
      logger.error('Prometheus query error:', error);
    }
    return [];
  }
}

/**
 * Get all miner hashrates from Prometheus
 * Uses max by (ip) to handle duplicate metrics from multiple collectors
 */
export async function getMinerHashrates(): Promise<Map<string, number>> {
  const results = await queryPrometheus('max by (ip) (miner_hashrate_ths)');
  const hashrates = new Map<string, number>();

  for (const result of results) {
    const ip = result.metric.ip;
    const hashrate = parseFloat(result.value[1]);
    if (ip && !isNaN(hashrate)) {
      hashrates.set(ip, hashrate);
    }
  }

  return hashrates;
}

/**
 * Get all miner temperatures from Prometheus
 * Uses max by (ip) to handle duplicate metrics from multiple collectors
 */
export async function getMinerTemperatures(): Promise<Map<string, number>> {
  const results = await queryPrometheus('max by (ip) (miner_temp_max_c)');
  const temperatures = new Map<string, number>();

  for (const result of results) {
    const ip = result.metric.ip;
    const temp = parseFloat(result.value[1]);
    if (ip && !isNaN(temp)) {
      temperatures.set(ip, temp);
    }
  }

  return temperatures;
}

/**
 * Get all miner power consumption from Prometheus
 * Uses max by (ip) to handle duplicate metrics from multiple collectors
 */
export async function getMinerPower(): Promise<Map<string, number>> {
  const results = await queryPrometheus('max by (ip) (miner_power_watts)');
  const power = new Map<string, number>();

  for (const result of results) {
    const ip = result.metric.ip;
    const watts = parseFloat(result.value[1]);
    if (ip && !isNaN(watts)) {
      power.set(ip, watts);
    }
  }

  return power;
}

/**
 * Get miner scrape success status from Prometheus
 */
export async function getMinerStatus(): Promise<Map<string, boolean>> {
  const results = await queryPrometheus('miner_scrape_success');
  const status = new Map<string, boolean>();

  for (const result of results) {
    const ip = result.metric.ip;
    const success = parseFloat(result.value[1]) === 1;
    
    // Only set if we don't have a status yet, or if this is a success
    // This handles cases where there are multiple entries (success and failure)
    if (!status.has(ip) || success) {
      status.set(ip, success);
    }
  }

  return status;
}

/**
 * Get miner uptime from Prometheus
 */
export async function getMinerUptime(): Promise<Map<string, number>> {
  const results = await queryPrometheus('miner_uptime_seconds');
  const uptime = new Map<string, number>();

  for (const result of results) {
    const ip = result.metric.ip;
    const seconds = parseFloat(result.value[1]);
    if (ip && !isNaN(seconds)) {
      uptime.set(ip, seconds);
    }
  }

  return uptime;
}

/**
 * Get miner fan speeds from Prometheus
 */
export async function getMinerFanSpeeds(): Promise<Map<string, number[]>> {
  const results = await queryPrometheus('miner_fan_speed_rpm');
  const fanSpeeds = new Map<string, number[]>();

  for (const result of results) {
    const ip = result.metric.ip;
    const rpm = parseFloat(result.value[1]);
    
    if (ip && !isNaN(rpm)) {
      if (!fanSpeeds.has(ip)) {
        fanSpeeds.set(ip, []);
      }
      fanSpeeds.get(ip)!.push(rpm);
    }
  }

  return fanSpeeds;
}

/**
 * Get all real miner metrics from Prometheus
 */
export async function getAllMinerMetrics() {
  try {
    logger.info('Fetching real miner metrics from Prometheus...');

    const [hashrates, temperatures, power, status, uptime, fanSpeeds] = await Promise.all([
      getMinerHashrates(),
      getMinerTemperatures(),
      getMinerPower(),
      getMinerStatus(),
      getMinerUptime(),
      getMinerFanSpeeds(),
    ]);

    logger.info(`Retrieved metrics for ${hashrates.size} miners from Prometheus`);

    return {
      hashrates,
      temperatures,
      power,
      status,
      uptime,
      fanSpeeds,
    };
  } catch (error) {
    logger.error('Error fetching miner metrics from Prometheus:', error);
    throw error;
  }
}

/**
 * Check if Prometheus is available
 */
export async function checkPrometheusHealth(): Promise<boolean> {
  try {
    const response = await axios.get(`${PROMETHEUS_URL}/-/healthy`, { timeout: 3000 });
    return response.status === 200;
  } catch (error) {
    logger.warn('Prometheus health check failed');
    return false;
  }
}
