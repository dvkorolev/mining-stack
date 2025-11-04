# Backend Service

Node.js/Express backend service for the Mining Stack monitoring system.

## Overview

The backend service provides:
- RESTful API for miner management and monitoring
- WebSocket server for real-time updates
- Telegram bot integration for remote control
- Alert management and webhook handling
- Pool configuration management
- Health check endpoints

## Architecture

```
backend/
├── src/
│   ├── config/          # Configuration files
│   ├── middleware/      # Express middleware
│   ├── routes/          # API routes
│   │   ├── mining.routes.ts      # Miner management endpoints
│   │   └── pools.routes.ts       # Pool management endpoints
│   ├── services/        # Business logic
│   │   ├── mining.service.ts     # Miner operations
│   │   ├── websocket.service.ts  # WebSocket handling
│   │   ├── telegram.service.ts   # Telegram bot
│   │   └── pools-config.service.ts # Pool configuration
│   ├── utils/           # Utilities
│   │   └── logger.ts             # Winston logger
│   └── server.ts        # Main entry point
├── dist/                # Compiled JavaScript
├── package.json         # Dependencies
└── tsconfig.json        # TypeScript config
```

## API Endpoints

### Miner Management
- `GET /api/miners` - List all miners
- `GET /api/miners/:ip` - Get miner details
- `POST /api/miners/:ip/restart` - Restart miner
- `POST /api/miners/:ip/reboot` - Reboot miner
- `GET /api/stats` - Get mining statistics

### Pool Management
- `GET /api/pools/config` - Get pools configuration
- `POST /api/pools/config` - Update pools configuration
- `GET /api/pools` - List all pools
- `POST /api/pools` - Add new pool
- `PUT /api/pools/:url` - Update pool
- `DELETE /api/pools/:url` - Delete pool
- `POST /api/pools/test/:url` - Test pool connection
- `POST /api/pools/collect` - Trigger pool collection

### Alerts
- `POST /api/alerts/webhook` - Alertmanager webhook
- `GET /api/alerts` - Get active alerts

### Health
- `GET /health` - Health check endpoint

## WebSocket Events

### Client → Server
- `subscribe` - Subscribe to updates
- `unsubscribe` - Unsubscribe from updates

### Server → Client
- `miners_update` - Miner data update
- `stats_update` - Statistics update
- `alert` - New alert notification

## Configuration

### Environment Variables

```bash
# Server
PORT=5000                          # API server port
NODE_ENV=production                # Environment

# Logging
LOG_LEVEL=info                     # Log level (debug, info, warn, error)
LOG_FORMAT=json                    # Log format (json, human)

# Python Scheduler
JOB_RUNNER_URL=http://python-scheduler:8000

# Telegram Bot
TELEGRAM_BOT_TOKEN=your_token      # Bot token from @BotFather
TELEGRAM_CHAT_ID=your_chat_id      # Your chat ID

# Pools Configuration
POOLS_CONFIG_PATH=/app/etc/pools.yaml
```

## Development

### Install Dependencies
```bash
npm install
```

### Run Development Server
```bash
npm run dev
```

### Build for Production
```bash
npm run build
```

### Run Production Server
```bash
npm start
```

## Logging

The backend uses Winston for structured logging.

### Log Formats

**JSON Format** (production):
```json
{
  "timestamp": "2025-11-04T12:00:00.000Z",
  "level": "INFO",
  "service": "backend",
  "logger": "backend",
  "message": "Server started on port 5000",
  "hostname": "mining-stack-backend"
}
```

**Human Format** (development):
```
2025-11-04 12:00:00 [INFO] Server started on port 5000
```

### Log Levels
- `error` - Critical errors
- `warn` - Warnings
- `info` - General information
- `http` - HTTP requests
- `debug` - Debug information

### Usage
```typescript
import { logger } from './utils/logger';

logger.info('Operation completed');
logger.error('Operation failed:', error);
logger.debug('Debug information', { extra: 'data' });
```

## Services

### Mining Service
Handles miner discovery, status monitoring, and control operations.

### WebSocket Service
Manages real-time connections and broadcasts updates to connected clients.

### Telegram Service
Integrates with Telegram Bot API for remote control and notifications.

### Pools Config Service
Manages pool configuration YAML file with validation and error handling.

## Error Handling

All routes use try-catch blocks with proper error logging:

```typescript
try {
  const result = await operation();
  res.json({ success: true, data: result });
} catch (error) {
  logger.error('Operation failed:', error);
  res.status(500).json({
    success: false,
    message: 'Operation failed',
    error: error instanceof Error ? error.message : 'Unknown error'
  });
}
```

## Docker

### Build Image
```bash
docker build -t mining-stack-backend .
```

### Run Container
```bash
docker run -p 5000:5000 \
  -e LOG_FORMAT=json \
  -e LOG_LEVEL=info \
  mining-stack-backend
```

## Dependencies

### Production
- `express` - Web framework
- `ws` - WebSocket server
- `winston` - Logging
- `js-yaml` - YAML parsing
- `axios` - HTTP client
- `helmet` - Security headers
- `cors` - CORS middleware
- `morgan` - HTTP logging

### Development
- `typescript` - TypeScript compiler
- `ts-node-dev` - Development server
- `@types/*` - TypeScript type definitions

## Health Checks

The `/health` endpoint provides comprehensive health information:

```json
{
  "server": {
    "status": "healthy",
    "message": "Server is running",
    "details": { "uptime": 3600 }
  },
  "memory": {
    "status": "healthy",
    "message": "Memory usage normal",
    "details": { "heapUsed": 50000000 }
  },
  "jobRunner": {
    "status": "healthy",
    "message": "Job runner is accessible",
    "details": { "url": "http://python-scheduler:8000" }
  }
}
```

## Troubleshooting

### Server Won't Start
- Check port 5000 is not in use
- Verify environment variables are set
- Check logs for errors

### WebSocket Connection Failed
- Verify WebSocket port is accessible
- Check CORS configuration
- Review browser console for errors

### Telegram Bot Not Working
- Verify `TELEGRAM_BOT_TOKEN` is correct
- Check `TELEGRAM_CHAT_ID` is set
- Test bot with `/start` command

### Pool Configuration Errors
- Verify `pools.yaml` file exists
- Check YAML syntax
- Review validation errors in logs

## See Also

- [API Documentation](../docs/API.md)
- [Deployment Guide](../docs/DEPLOYMENT.md)
- [Troubleshooting](../docs/TROUBLESHOOTING.md)
