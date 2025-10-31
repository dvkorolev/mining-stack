import express from 'express';
import http from 'http';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import miningRoutes from './routes/mining.routes';
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

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok' });
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
