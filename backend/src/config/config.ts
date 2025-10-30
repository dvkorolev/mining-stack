import dotenv from 'dotenv';
import path from 'path';

// Load environment variables from .env file
dotenv.config();

const config = {
  env: process.env.NODE_ENV || 'development',
  port: process.env.PORT ? parseInt(process.env.PORT, 10) : 5000,
  corsOrigin: process.env.CORS_ORIGIN || '*',
  logLevel: process.env.LOG_LEVEL || 'info',
  
  // Mining configuration
  mining: {
    updateInterval: parseInt(process.env.MINING_UPDATE_INTERVAL || '5000', 10), // 5 seconds
    maxHistoryPoints: parseInt(process.env.MINING_MAX_HISTORY || '60', 10), // 60 data points
  },
  
  // Paths
  paths: {
    logs: process.env.LOGS_DIR || path.join(__dirname, '../../logs')
  }
};

export { config };
