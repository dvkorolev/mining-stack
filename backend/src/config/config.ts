import dotenv from 'dotenv';
import path from 'path';

// Load environment variables from .env file
dotenv.config();

const config = {
  env: process.env.NODE_ENV || 'development',
  port: process.env.PORT ? parseInt(process.env.PORT, 10) : 5000,
  corsOrigin: process.env.CORS_ORIGIN || '*',
  logLevel: process.env.LOG_LEVEL || 'info',
  
  // WebSocket configuration
  websocket: {
    path: process.env.WS_PATH || '/ws',
    pingInterval: parseInt(process.env.WS_PING_INTERVAL || '30000', 10), // 30 seconds
  },
  
  // Mining configuration
  mining: {
    updateInterval: parseInt(process.env.MINING_UPDATE_INTERVAL || '5000', 10), // 5 seconds
    maxHistoryPoints: parseInt(process.env.MINING_MAX_HISTORY || '60', 10), // 60 data points
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
