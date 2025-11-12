/**
 * Prometheus Service
 * 
 * Queries Prometheus for real miner metrics from pyasic
 * Replaces simulation with actual data from miners
 */

import axios from 'axios';
import { logger } from '../utils/logger';
import { config } from '../config/config';
import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';

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
 * Handles both SHA-256 (TH/s) and SCRYPT (MH/s) miners
 * Returns hashrates in TH/s for consistency (SCRYPT converted from MH/s)
 */
export async function getMinerHashrates(): Promise<Map<string, number>> {
  // Get SHA-256 hashrates (already in TH/s)
  const sha256Results = await queryPrometheus('max by (ip, algorithm) (miner_hashrate_ths{algorithm="sha256"})');
  
  // Get SCRYPT hashrates (in MH/s, need to convert to TH/s)
  const scryptResults = await queryPrometheus('max by (ip, algorithm) (miner_hashrate_mhs{algorithm="scrypt"})');
  
  const hashrates = new Map<string, number>();

  // Process SHA-256 miners
  for (const result of sha256Results) {
    const ip = result.metric.ip;
    const hashrate = parseFloat(result.value[1]);
    if (ip && !isNaN(hashrate)) {
      hashrates.set(ip, hashrate);
    }
  }

  // Process SCRYPT miners (convert MH/s to TH/s)
  for (const result of scryptResults) {
    const ip = result.metric.ip;
    const hashrateMhs = parseFloat(result.value[1]);
    if (ip && !isNaN(hashrateMhs)) {
      // Convert MH/s to TH/s for consistency (divide by 1,000,000)
      hashrates.set(ip, hashrateMhs / 1000000);
    }
  }

  return hashrates;
}

/**
 * Get miner algorithms from Prometheus
 * Returns a map of IP -> algorithm ('sha256' or 'scrypt')
 */
export async function getMinerAlgorithms(): Promise<Map<string, 'sha256' | 'scrypt'>> {
  // Query both metrics to get algorithm labels
  const sha256Results = await queryPrometheus('max by (ip, algorithm) (miner_hashrate_ths{algorithm="sha256"})');
  const scryptResults = await queryPrometheus('max by (ip, algorithm) (miner_hashrate_mhs{algorithm="scrypt"})');
  
  const algorithms = new Map<string, 'sha256' | 'scrypt'>();

  for (const result of sha256Results) {
    const ip = result.metric.ip;
    if (ip) {
      algorithms.set(ip, 'sha256');
    }
  }

  for (const result of scryptResults) {
    const ip = result.metric.ip;
    if (ip) {
      algorithms.set(ip, 'scrypt');
    }
  }

  return algorithms;
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
 * Get miner status from Prometheus
 * Uses miner_state metric: 0=faulty, 1=idle, 2=mining
 */
export async function getMinerStatus(): Promise<Map<string, boolean>> {
  const results = await queryPrometheus('miner_state');
  const status = new Map<string, boolean>();

  for (const result of results) {
    const ip = result.metric.ip;
    const state = parseFloat(result.value[1]);
    
    // state === 2 means mining (online)
    // state === 1 means idle (offline but reachable)
    // state === 0 means faulty (offline)
    const isOnline = state === 2;
    status.set(ip, isOnline);
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

    const [hashrates, temperatures, power, status, uptime, fanSpeeds, algorithms] = await Promise.all([
      getMinerHashrates(),
      getMinerTemperatures(),
      getMinerPower(),
      getMinerStatus(),
      getMinerUptime(),
      getMinerFanSpeeds(),
      getMinerAlgorithms(),
    ]);

    logger.info(`Retrieved metrics for ${hashrates.size} miners from Prometheus (SHA-256: ${Array.from(algorithms.values()).filter(a => a === 'sha256').length}, SCRYPT: ${Array.from(algorithms.values()).filter(a => a === 'scrypt').length})`);

    return {
      hashrates,
      temperatures,
      power,
      status,
      uptime,
      fanSpeeds,
      algorithms,
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

/**
 * Alert Rule Interface
 */
export interface AlertRule {
  alert: string;
  expr: string;
  for: string;
  labels: {
    severity: string;
    component: string;
    [key: string]: string;
  };
  annotations: {
    summary: string;
    description: string;
  };
}

export interface AlertRuleGroup {
  name: string;
  interval: string;
  rules: AlertRule[];
}

export interface AlertRulesFile {
  groups: AlertRuleGroup[];
}

/**
 * Get Prometheus alert rules from YAML files
 */
export async function getPrometheusAlertRules(): Promise<{
  mining: AlertRulesFile | null;
  poolNetwork: AlertRulesFile | null;
  error?: string;
}> {
  try {
    const rulesDir = process.env.NODE_ENV === 'production'
      ? '/opt/mining-stack/docker/prometheus/rules'
      : path.join(process.cwd(), '../docker/prometheus/rules');

    const miningRulesPath = path.join(rulesDir, 'mining_alerts.yml');
    const poolNetworkRulesPath = path.join(rulesDir, 'pool_network_alerts.yml');

    let mining: AlertRulesFile | null = null;
    let poolNetwork: AlertRulesFile | null = null;

    // Read mining alerts
    if (fs.existsSync(miningRulesPath)) {
      const miningContent = fs.readFileSync(miningRulesPath, 'utf8');
      mining = yaml.load(miningContent) as AlertRulesFile;
    }

    // Read pool/network alerts
    if (fs.existsSync(poolNetworkRulesPath)) {
      const poolContent = fs.readFileSync(poolNetworkRulesPath, 'utf8');
      poolNetwork = yaml.load(poolContent) as AlertRulesFile;
    }

    return { mining, poolNetwork };
  } catch (error) {
    logger.error('Error reading Prometheus alert rules:', error);
    return {
      mining: null,
      poolNetwork: null,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Reload Prometheus configuration
 */
export async function reloadPrometheusConfig(): Promise<{ success: boolean; message: string }> {
  try {
    if (process.env.NODE_ENV !== 'production') {
      return {
        success: false,
        message: 'Prometheus reload is only available in production',
      };
    }

    // Use Prometheus HTTP API to reload configuration
    const prometheusUrl = process.env.PROMETHEUS_URL || 'http://prometheus:9090';
    const reloadUrl = `${prometheusUrl}/-/reload`;

    const response = await axios.post(reloadUrl, {}, {
      timeout: 5000,
      validateStatus: (status) => status === 200,
    });

    logger.info('Prometheus configuration reloaded successfully via HTTP API');
    return {
      success: true,
      message: 'Prometheus configuration reloaded successfully',
    };
  } catch (error: any) {
    logger.error('Error reloading Prometheus:', error.message);
    return {
      success: false,
      message: error.message || 'Failed to reload Prometheus',
    };
  }
}
