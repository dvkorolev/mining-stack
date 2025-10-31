# API Documentation

## Base URL

All API endpoints are prefixed with `/api`

## REST API Endpoints

### Mining Operations

#### Get Mining Statistics
```http
GET /api/mining/stats
```

**Response:**
```json
{
  "totalHashrate": 125.5,
  "activeMiners": 3,
  "totalMined": 0.0045,
  "miners": [
    {
      "minerId": "miner-01",
      "name": "Main Mining Rig",
      "model": "Antminer S19j Pro",
      "ip": "192.168.1.100",
      "status": "online",
      "lastSeen": "2023-10-31T10:30:00Z",
      "currentHashrate": 100.5,
      "averageHashrate": 98.2,
      "shares": {
        "accepted": 1234,
        "rejected": 5
      },
      "hardware": {
        "temperature": 65.5,
        "fanSpeed": 4200,
        "powerUsage": 2500
      },
      "uptime": 86400,
      "errors": []
    }
  ],
  "timestamp": 1698750600000,
  "statsHistory": [
    {
      "timestamp": 1698750000000,
      "hashrate": 120.3
    }
  ]
}
```

#### Start Mining
```http
POST /api/mining/start
```

**Request Body:**
```json
{
  "config": {
    "updateInterval": 5000
  }
}
```

**Response:**
```json
{
  "success": true,
  "message": "Mining simulation started successfully",
  "stats": { ... }
}
```

#### Stop Mining
```http
POST /api/mining/stop
```

**Response:**
```json
{
  "success": true,
  "message": "Mining simulation stopped successfully"
}
```

#### Restart Miner
```http
POST /api/mining/restart/:minerId
```

**Parameters:**
- `minerId` (string) - The ID of the miner to restart

**Response:**
```json
{
  "success": true,
  "message": "Miner miner-01 restart initiated",
  "miner": { ... }
}
```

#### Update Miner Configuration
```http
PUT /api/mining/config/:minerId
```

**Parameters:**
- `minerId` (string) - The ID of the miner to update

**Request Body:**
```json
{
  "alias": "New Miner Name",
  "model": "Antminer S19"
}
```

**Response:**
```json
{
  "success": true,
  "message": "Configuration updated for miner miner-01",
  "miner": { ... }
}
```

### System

#### Health Check
```http
GET /health
```

**Response:**
```json
{
  "status": "ok"
}
```

## WebSocket API

### Connection

Connect to the WebSocket server at:
```
ws://your-host/ws
```

### Events

#### mining-stats

Emitted when mining statistics are updated (every 5 seconds by default).

**Payload:**
```json
{
  "type": "mining-stats",
  "data": {
    "totalHashrate": 125.5,
    "activeMiners": 3,
    "totalMined": 0.0045,
    "miners": [...],
    "timestamp": 1698750600000,
    "statsHistory": [...]
  }
}
```

## Error Responses

All endpoints may return the following error responses:

### 400 Bad Request
```json
{
  "error": "Invalid request parameters"
}
```

### 404 Not Found
```json
{
  "error": "Miner not found"
}
```

### 500 Internal Server Error
```json
{
  "error": "Internal server error"
}
```

## Rate Limiting

Currently, there are no rate limits implemented. This may change in future versions.

## Authentication

Authentication is not currently required for API endpoints. Consider implementing authentication for production deployments.
