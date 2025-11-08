import express from 'express';
import http from 'http';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import compression from 'compression';
import rateLimit from 'express-rate-limit';
import miningRoutes from './routes/mining.routes';
import poolsRoutes from './routes/pools.routes';
import logsRoutes from './routes/logs.routes';
import telegramRoutes from './routes/telegram.routes';
import authRoutes from './routes/auth.routes';
import { setupWebSocket } from './services/websocket.service';
import { startMining } from './services/mining.service';
import { errorHandler } from './middleware/error.middleware';
import { authenticate, optionalAuth } from './middleware/auth.middleware';
import { config } from './config/config';
import { logger } from './utils/logger';

// Initialize express app
const app = express();
const server = http.createServer(app);

// Setup WebSocket Server
setupWebSocket(server);

// Rate limiting
const apiLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 100, // Limit each IP to 100 requests per windowMs
  message: 'Too many requests from this IP, please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
});

const strictLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 10, // Limit each IP to 10 requests per windowMs for sensitive endpoints
  message: 'Too many requests, please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
});

// Middleware
app.use(helmet());
app.use(cors());
app.use(compression()); // Compress responses
app.use(express.json());
app.use(morgan('dev'));

// Apply rate limiting to API routes
app.use('/api', apiLimiter);

// Apply optional authentication to all API routes
// This allows both authenticated and unauthenticated access
// Individual routes can require authentication using requireAdmin middleware
app.use('/api', optionalAuth);

// API Routes
app.use('/api', authRoutes); // Auth routes (no authentication required)
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
  const { getAlertPersistenceMetrics } = require('./services/alert.service');

  const stats = getMiningStats();
  const alertMetrics = getAlertPersistenceMetrics();

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
    ``,
    `# HELP alert_queue_pending Number of alert writes currently pending in the queue`,
    `# TYPE alert_queue_pending gauge`,
    `alert_queue_pending ${alertMetrics.pendingWrites}`,
    ``,
    `# HELP alert_queue_max_pending Maximum observed pending alert writes`,
    `# TYPE alert_queue_max_pending gauge`,
    `alert_queue_max_pending ${alertMetrics.maxPendingWrites}`,
    ``,
    `# HELP alert_queue_enqueued_total Total alert writes enqueued`,
    `# TYPE alert_queue_enqueued_total counter`,
    `alert_queue_enqueued_total ${alertMetrics.enqueuedWrites}`,
    ``,
    `# HELP alert_queue_completed_total Total alert writes completed`,
    `# TYPE alert_queue_completed_total counter`,
    `alert_queue_completed_total ${alertMetrics.completedWrites}`,
    ``,
    `# HELP alert_queue_failed_total Total alert writes that failed`,
    `# TYPE alert_queue_failed_total counter`,
    `alert_queue_failed_total ${alertMetrics.failedWrites}`,
    ``,
    `# HELP alert_queue_last_latency_ms Most recent queue wait time in milliseconds`,
    `# TYPE alert_queue_last_latency_ms gauge`,
    `alert_queue_last_latency_ms ${alertMetrics.lastQueueLatencyMs}`,
    ``,
    `# HELP alert_queue_average_latency_ms Average queue wait time in milliseconds`,
    `# TYPE alert_queue_average_latency_ms gauge`,
    `alert_queue_average_latency_ms ${alertMetrics.averageQueueLatencyMs}`,
    ``,
    `# HELP alert_queue_last_duration_ms Most recent alert write duration in milliseconds`,
    `# TYPE alert_queue_last_duration_ms gauge`,
    `alert_queue_last_duration_ms ${alertMetrics.lastWriteDurationMs}`,
    ``,
    `# HELP alert_queue_average_duration_ms Average alert write duration in milliseconds`,
    `# TYPE alert_queue_average_duration_ms gauge`,
    `alert_queue_average_duration_ms ${alertMetrics.averageWriteDurationMs}`,
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

  // Auto-initialize Telegram bot if credentials are available in database
  try {
    const { getDatabase } = require('./services/database.service');
    const { initTelegramBot } = require('./services/telegram.service');
    const db = getDatabase();
    
    // Load credentials from database only
    const token = db.getSetting('telegram_bot_token');
    const chatId = db.getSetting('telegram_chat_id');
    
    if (token && chatId) {
      initTelegramBot(token, chatId);
      logger.info('Telegram bot initialized from database');
    } else {
      logger.info('Telegram bot not configured. Use Settings page to configure.');
    }
  } catch (error) {
    logger.warn('Failed to auto-initialize Telegram bot:', error);
  }
});

// Graceful shutdown handler
const gracefulShutdown = async (signal: string) => {
  logger.info(`${signal} received. Starting graceful shutdown...`);
  
  // Stop accepting new connections
  server.close(async () => {
    logger.info('HTTP server closed');
    
    try {
      // Stop mining service
      const { stopMining } = require('./services/mining.service');
      await stopMining();
      logger.info('Mining service stopped');
      
      // Close database connections
      const { getDatabase } = require('./services/database.service');
      const db = getDatabase();
      db.close();
      logger.info('Database connections closed');
      
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
  });
  
  // Force shutdown after 30 seconds
  setTimeout(() => {
    logger.error('Forced shutdown after timeout');
    process.exit(1);
  }, 30000);
};

// Register shutdown handlers
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  logger.error('Uncaught exception:', error);
  gracefulShutdown('uncaughtException');
});

// Handle unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled rejection at:', promise, 'reason:', reason);
  gracefulShutdown('unhandledRejection');
});

export { app, server };
