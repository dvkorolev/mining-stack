import express from 'express';
import http from 'http';
import { Server } from 'ws';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import { createLogger, format, transports } from 'winston';
import miningRoutes from './routes/mining.routes';
import { setupWebSocket } from './services/websocket.service';
import { errorHandler } from './middleware/error.middleware';
import { config } from './config/config';

// Initialize express app
const app = express();
const server = http.createServer(app);

// WebSocket Server
const wss = new Server({ server, path: '/ws' });
setupWebSocket(wss);

// Configure Winston logger
const logger = createLogger({
  level: 'info',
  format: format.combine(
    format.timestamp({
      format: 'YYYY-MM-DD HH:mm:ss'
    }),
    format.errors({ stack: true }),
    format.splat(),
    format.json()
  ),
  defaultMeta: { service: 'mining-dashboard' },
  transports: [
    new transports.File({ filename: 'logs/error.log', level: 'error' }),
    new transports.File({ filename: 'logs/combined.log' })
  ]
});

if (process.env.NODE_ENV !== 'production') {
  logger.add(new transports.Console({
    format: format.combine(
      format.colorize(),
      format.simple()
    )
  }));
}

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
server.listen(PORT, () => {
  logger.info(`Server is running on port ${PORT}`);
  console.log(`Server is running on http://localhost:${PORT}`);
});

export { app, server };
