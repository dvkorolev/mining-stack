import express from 'express';
import http from 'http';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import miningRoutes from './routes/mining.routes';
import poolsRoutes from './routes/pools.routes';
import logsRoutes from './routes/logs.routes';
import telegramRoutes from './routes/telegram.routes';
import { setupWebSocket } from './services/websocket.service';
import { startMining } from './services/mining.service';
import { errorHandler } from './middleware/error.middleware';
import { config } from './config/config';
import { logger } from './utils/logger';

// Initialize express app
const app = express();
const server = http.createServer(app);

// Setup WebSocket Server
setupWebSocket(server);

// Middleware
app.use(helmet());
app.use(cors());
app.use(express.json());
app.use(morgan('dev'));

// API Routes
app.use('/api', miningRoutes);
app.use('/api/pools', poolsRoutes);
app.use('/api/logs', logsRoutes);
app.use('/api/telegram', telegramRoutes);

// Smart health check endpoint
app.get('/health', (req, res) => {
  const checks: any = {
    server: {
      status: 'healthy',
      message: 'Server is running',
      details: { uptime: process.uptime() }
    },
    memory: {
      status: 'healthy',
      message: 'Memory usage normal',
      details: process.memoryUsage()
    }
  };
  
  // Check if mining service is responsive
  try {
    const { getMiningStats } = require('./services/mining.service');
    const stats = getMiningStats();
    checks.mining_service = {
      status: 'healthy',
      message: 'Mining service operational',
      details: {
        active_miners: stats.activeMiners || 0,
        total_hashrate: stats.totalHashrate || 0
      }
    };
  } catch (error) {
    checks.mining_service = {
      status: 'degraded',
      message: 'Mining service unavailable',
      details: { error: String(error) }
    };
  }
  
  // Determine overall status
  const statuses = Object.values(checks).map((c: any) => c.status);
  const overallStatus = statuses.includes('unhealthy') ? 'unhealthy' 
    : statuses.includes('degraded') ? 'degraded' 
    : 'healthy';
  
  const statusCode = overallStatus === 'unhealthy' ? 503 : 200;
  
  res.status(statusCode).json({
    status: overallStatus,
    timestamp: new Date().toISOString(),
    checks
  });
});

// Basic Prometheus metrics endpoint
app.get('/metrics', (req, res) => {
  const { getMiningStats } = require('./services/mining.service');
  const stats = getMiningStats();
  
  // Simple Prometheus text format
  const metrics = [
    `# HELP mining_hashrate_total Total hashrate in TH/s`,
    `# TYPE mining_hashrate_total gauge`,
    `mining_hashrate_total ${stats.totalHashrate || 0}`,
    ``,
    `# HELP mining_active_miners Number of active miners`,
    `# TYPE mining_active_miners gauge`,
    `mining_active_miners ${stats.activeMiners || 0}`,
    ``,
    `# HELP mining_total_mined Total amount mined`,
    `# TYPE mining_total_mined counter`,
    `mining_total_mined ${stats.totalMined || 0}`,
  ].join('\n');
  
  res.set('Content-Type', 'text/plain');
  res.send(metrics);
});

// Error handling middleware
app.use(errorHandler);

// Start server
const PORT = config.port || 5000;
server.listen(PORT, async () => {
  logger.info(`Server is running on port ${PORT}`);
  console.log(`Server is running on http://localhost:${PORT}`);
  
  // Auto-start mining simulation
  try {
    await startMining();
    logger.info('Mining simulation started automatically');
  } catch (error) {
    logger.error('Failed to start mining simulation:', error);
  }

  // Auto-initialize Telegram bot if credentials are stored
  try {
    const { getDatabase } = require('./services/database.service');
    const { initTelegramBot } = require('./services/telegram.service');
    const db = getDatabase();
    
    const token = db.getSetting('telegram_bot_token');
    const chatId = db.getSetting('telegram_chat_id');
    
    if (token && chatId) {
      initTelegramBot(token, chatId);
      logger.info('Telegram bot initialized from stored credentials');
    }
  } catch (error) {
    logger.warn('Failed to auto-initialize Telegram bot:', error);
  }
});

// Graceful shutdown handler
const gracefulShutdown = async (signal: string) => {
  logger.info(`Received ${signal} signal, shutting down gracefully...`);
  
  try {
    // Stop accepting new connections
    server.close(() => {
      logger.info('HTTP server closed');
    });
    
    // Stop mining simulation
    const { stopMining } = require('./services/mining.service');
    await stopMining();
    logger.info('Mining simulation stopped');
    
    // Close WebSocket connections
    const { closeWebSocket } = require('./services/websocket.service');
    closeWebSocket();
    logger.info('WebSocket connections closed');
    
    logger.info('Graceful shutdown completed');
    process.exit(0);
  } catch (error) {
    logger.error('Error during graceful shutdown:', error);
    process.exit(1);
  }
  
  // Force shutdown after 10 seconds
  setTimeout(() => {
    logger.error('Forced shutdown after timeout');
    process.exit(1);
  }, 10000);
};

// Handle shutdown signals
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// Handle uncaught errors
process.on('uncaughtException', (error) => {
  logger.error('Uncaught exception:', error);
  gracefulShutdown('uncaughtException');
});

process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled rejection at:', promise, 'reason:', reason);
  gracefulShutdown('unhandledRejection');
});

export { app, server };
