# WebSocket Connection Troubleshooting

## Issue: Dashboard Shows "Reconnecting (0)" with N/A Values

### Root Causes Identified

1. **Missing Initial Data Send** - Backend wasn't sending mining stats immediately when clients connected
2. **Missing Miners Configuration** - No `miners.yaml` file existed, only the example template

### Fixes Applied

#### 1. Backend WebSocket Service (✅ Fixed)
**File**: `backend/src/services/websocket.service.ts`

Added immediate data send when clients connect:
```typescript
// Send current mining stats immediately upon connection
try {
  const currentStats = getMiningStats();
  const message = JSON.stringify({ type: 'mining-stats', data: currentStats });
  ws.send(message);
  logger.info(`Sent initial stats to client ${ws.id}`);
} catch (error) {
  logger.error(`Error sending initial stats to client ${ws.id}:`, error);
}
```

#### 2. Miners Configuration (✅ Created)
**File**: `etc/miners.yaml`

Created from the example template with 3 sample miners.

### Deployment Steps (Run on Raspberry Pi)

```bash
# Navigate to the project directory
cd /opt/mining-stack

# Pull the latest changes (if using git)
git pull

# Rebuild and restart the backend container
docker compose down backend
docker compose up -d --build backend

# Verify backend is running
docker compose logs -f backend

# Check that miners are loaded
docker compose exec backend cat /app/etc/miners.yaml
```

### Verification

After restarting, you should see:

1. **Backend logs**:
   ```
   Loaded configuration for 3 miners
   Starting mining simulation
   Mining simulation started automatically
   WebSocket client connected: <id>
   Sent initial stats to client <id>
   ```

2. **Frontend dashboard**:
   - Connection status: "Connected" (green)
   - Current Hashrate: Shows value in TH/s
   - Active Miners: Shows number (0-3)
   - Total Mined: Shows BTC value
   - Chart: Shows hashrate over time

### Additional Debugging

If issues persist:

```bash
# Check backend logs
docker compose logs backend --tail=100

# Check frontend logs
docker compose logs frontend --tail=100

# Verify WebSocket endpoint
curl -i -N -H "Connection: Upgrade" -H "Upgrade: websocket" \
  -H "Sec-WebSocket-Version: 13" -H "Sec-WebSocket-Key: test" \
  http://localhost:5000/ws

# Check if backend is broadcasting
docker compose exec backend grep "broadcast" /app/logs/*.log
```

### Configuration Options

Edit `etc/miners.yaml` to customize your setup:

```yaml
miners:
  - ip: "192.168.1.100"
    name: "miner-01"
    model: "Antminer S19j Pro"
    alias: "Main Mining Rig 1"
```

### Environment Variables

Adjust in `docker-compose.yml` if needed:

- `WS_PING_INTERVAL`: WebSocket ping interval (default: 30000ms)
- `MINING_UPDATE_INTERVAL`: Stats broadcast interval (default: 5000ms)
- `SIM_ONLINE_PROBABILITY`: Probability of miners being online (default: 0.9)

## Summary

The issue was caused by:
1. Backend not sending initial data when WebSocket connects
2. No miners configured in the system

Both issues have been fixed. The backend now sends data immediately upon connection, and a miners configuration file has been created with 3 sample miners.
