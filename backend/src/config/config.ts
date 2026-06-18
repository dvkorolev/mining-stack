import dotenv from 'dotenv';
import path from 'path';

// Load environment variables from .env file
dotenv.config();

const config = {
  env: process.env.NODE_ENV || 'development',
  port: process.env.PORT ? parseInt(process.env.PORT, 10) : 5000,
  corsOrigin: process.env.CORS_ORIGIN || '*',
  logLevel: process.env.LOG_LEVEL || 'info',
  auth: {
    jwtAccessSecret: process.env.JWT_ACCESS_SECRET || 'dev-access-secret',
    jwtRefreshSecret: process.env.JWT_REFRESH_SECRET || 'dev-refresh-secret',
    accessTokenTtl: process.env.JWT_ACCESS_EXPIRES_IN || '15m',
    refreshTokenTtl: process.env.JWT_REFRESH_EXPIRES_IN || '30d',
    cookieDomain: process.env.AUTH_COOKIE_DOMAIN,
    secureCookies: process.env.NODE_ENV === 'production',
    accessCookieName: process.env.AUTH_ACCESS_COOKIE_NAME || 'ms_access_token',
    refreshCookieName: process.env.AUTH_REFRESH_COOKIE_NAME || 'ms_refresh_token',
    internalMetricsToken: process.env.INTERNAL_METRICS_TOKEN,
    allowLegacyHeaderAuth: process.env.ALLOW_LEGACY_HEADER_AUTH === 'true',
  },
  
  // WebSocket configuration
  websocket: {
    path: process.env.WS_PATH || '/ws',
    pingInterval: parseInt(process.env.WS_PING_INTERVAL || '30000', 10), // 30 seconds
  },
  
  // Mining configuration
  mining: {
    updateInterval: parseInt(process.env.MINING_UPDATE_INTERVAL || '30000', 10), // 30 seconds
    maxHistoryPoints: parseInt(process.env.MINING_MAX_HISTORY || '60', 10), // 60 data points
    useRealData: process.env.USE_REAL_DATA !== 'false', // Use real Prometheus data by default
  },
  
  // Prometheus configuration
  prometheus: {
    url: process.env.PROMETHEUS_URL || 'http://prometheus:9090',
    enabled: process.env.PROMETHEUS_ENABLED !== 'false',
  },
  
  // Global default thresholds for all miners (aligned with Prometheus alert rules)
  thresholds: {
    temperature: {
      warning: parseInt(process.env.THRESHOLD_TEMP_WARNING || '75', 10), // 75°C (aligned with Prometheus)
      critical: parseInt(process.env.THRESHOLD_TEMP_CRITICAL || '85', 10), // 85°C (aligned with Prometheus)
      shutdown: parseInt(process.env.THRESHOLD_TEMP_SHUTDOWN || '95', 10), // 95°C
    },
    hashrate: {
      warningPercent: parseInt(process.env.THRESHOLD_HASHRATE_WARNING_PCT || '20', 10), // 20% below expected
      criticalPercent: parseInt(process.env.THRESHOLD_HASHRATE_CRITICAL_PCT || '50', 10), // 50% below expected
    },
    power: {
      warningPercent: parseInt(process.env.THRESHOLD_POWER_WARNING_PCT || '15', 10), // 15% deviation
    },
    rejectionRate: {
      warning: parseFloat(process.env.THRESHOLD_REJECTION_WARNING || '2.0'), // 2% (aligned with Prometheus)
      critical: parseFloat(process.env.THRESHOLD_REJECTION_CRITICAL || '5.0'), // 5% (aligned with Prometheus)
    },
    fanSpeed: {
      warning: parseInt(process.env.THRESHOLD_FAN_WARNING || '3000', 10), // 3000 RPM (aligned with Prometheus)
      critical: parseInt(process.env.THRESHOLD_FAN_CRITICAL || '2000', 10), // 2000 RPM (aligned with Prometheus)
    },
  },
  
  // Simulation configuration (for demo/testing)
  simulation: {
    onlineProbability: parseFloat(process.env.SIM_ONLINE_PROBABILITY || '0.9'), // 90% online
    errorProbability: parseFloat(process.env.SIM_ERROR_PROBABILITY || '0.2'), // 20% error when online
    hashrateVariance: parseFloat(process.env.SIM_HASHRATE_VARIANCE || '0.1'), // ±10%
    tempMin: parseInt(process.env.SIM_TEMP_MIN || '60', 10), // 60°C
    tempMax: parseInt(process.env.SIM_TEMP_MAX || '90', 10), // 90°C
    fanMin: parseInt(process.env.SIM_FAN_MIN || '3000', 10), // 3000 RPM
    fanMax: parseInt(process.env.SIM_FAN_MAX || '5000', 10), // 5000 RPM
    powerMin: parseInt(process.env.SIM_POWER_MIN || '2000', 10), // 2000W
    powerMax: parseInt(process.env.SIM_POWER_MAX || '3000', 10), // 3000W
  },
  
  // Paths
  paths: {
    logs: process.env.LOGS_DIR || path.join(__dirname, '../../logs'),
    data: process.env.DATA_DIR || path.join(__dirname, '../../data'),
    minerConfig: process.env.MINER_CONFIG_PATH || '/opt/mining-stack/etc/miners.yaml',
    minerConfigFallback: path.join(process.cwd(), 'etc', 'miners.yaml'),
  }
};

export { config };
