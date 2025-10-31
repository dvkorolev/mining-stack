# Quick Fix for WebSocket Connection Issue

## Problem
Backend container cannot find `miners.yaml` because it's not mounted as a volume.

## Solution
Run these commands on your Raspberry Pi:

```bash
# Navigate to project directory
cd /opt/mining-stack

# Pull the updated docker-compose.prod.yml
git pull origin main

# Verify miners.yaml exists on the host
cat etc/miners.yaml

# Restart backend with the new volume mount
docker compose -f docker-compose.prod.yml down backend
docker compose -f docker-compose.prod.yml up -d backend

# Watch the logs - you should see "Loaded configuration for 9 miners"
docker compose -f docker-compose.prod.yml logs -f backend
```

## Expected Output

You should see in the logs:
```
Loaded configuration for 9 miners
Starting mining simulation
Mining simulation started automatically
WebSocket client connected: <id>
Sent initial stats to client <id>
```

## Verify It's Working

1. **Check backend logs:**
   ```bash
   docker compose -f docker-compose.prod.yml logs backend | grep -i "miner"
   ```
   Should show: `Loaded configuration for 9 miners`

2. **Check WebSocket inside container:**
   ```bash
   docker compose -f docker-compose.prod.yml exec backend cat /opt/mining-stack/etc/miners.yaml
   ```
   Should display your 9 miners

3. **Open dashboard in browser:**
   - Navigate to `http://raspberrypi:3000`
   - Should show real mining data instead of "Reconnecting..."

## What Changed

The `docker-compose.prod.yml` now includes:

```yaml
backend:
  environment:
    - MINER_CONFIG_PATH=/opt/mining-stack/etc/miners.yaml
  volumes:
    - ./logs:/app/logs
    - ./etc/miners.yaml:/opt/mining-stack/etc/miners.yaml:ro  # ← NEW
```

This mounts your host's `miners.yaml` into the container as read-only.
