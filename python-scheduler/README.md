# Python Scheduler Service

Dedicated microservice for running Python-based metric collection and miner discovery scripts.

## Purpose

This service maintains **clean separation of concerns** by handling all Python/hardware-related operations separately from the Node.js backend.

### What It Does
- ✅ Runs metric collection scripts on schedule (every 2 minutes)
- ✅ Executes miner discovery on demand
- ✅ Writes Prometheus metrics to shared volume
- ✅ Provides REST API for manual triggers

### What It Doesn't Do
- ❌ Serve web UI
- ❌ Query Prometheus
- ❌ Manage user sessions

## Architecture

```
┌─────────────────────────────────────┐
│  Python Scheduler Service           │
│  - FastAPI REST API (:8000)         │
│  - Schedule library for cron        │
│  - Runs pyasic scripts              │
│  - Writes to /metrics/*.prom        │
└─────────────────────────────────────┘
           ↓ (shared volume)
┌─────────────────────────────────────┐
│  Node Exporter                      │
│  - Reads /metrics/*.prom            │
│  - Exposes :9100/metrics            │
└─────────────────────────────────────┘
```

## API Endpoints

### GET /
Health check and service info

```bash
curl http://localhost:8000/
```

### GET /health
Simple health check

```bash
curl http://localhost:8000/health
```

### GET /status
Get scheduler status and last collection info

```bash
curl http://localhost:8000/status
```

### POST /collect
Manually trigger metrics collection

```bash
curl -X POST http://localhost:8000/collect
```

### POST /discover
Manually trigger miner discovery

```bash
curl -X POST http://localhost:8000/discover
```

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `METRICS_DIR` | `/metrics` | Directory for .prom files |
| `MINERS_CONFIG` | `/app/etc/miners.yaml` | Miners configuration file |
| `COLLECTION_INTERVAL` | `2` | Collection interval in minutes |

## Volumes

- `/metrics` - Shared with Node Exporter (write)
- `/app/etc` - Miners configuration (read/write)
- `/app/bin` - Python scripts (read-only)

## Scripts Executed

### Metrics Collection (Scheduled)
- `bin/pyasic_textfile.py` - Collect ASIC miner metrics
- `bin/universal_miner_collector.py` - Collect generic miner metrics

### Miner Discovery (On-Demand)
- `bin/farm_init.py` - Scan network and discover miners

## Logs

View logs:
```bash
docker logs python-scheduler -f
```

Expected output:
```
2025-11-01 18:00:00 [INFO] Mining Metrics Scheduler Service Starting
2025-11-01 18:00:00 [INFO] Metrics directory: /metrics
2025-11-01 18:00:00 [INFO] Collection interval: 2 minutes
2025-11-01 18:00:00 [INFO] Running initial metrics collection...
2025-11-01 18:00:05 [INFO] ✓ pyasic_collector completed in 4.2s
2025-11-01 18:00:08 [INFO] ✓ universal_collector completed in 2.8s
2025-11-01 18:00:08 [INFO] Collection complete: 2/2 successful
2025-11-01 18:00:08 [INFO] Starting API server on port 8000...
```

## Development

### Build
```bash
docker build -t python-scheduler ./python-scheduler
```

### Run Standalone
```bash
docker run -p 8000:8000 \
  -v $(pwd)/metrics:/metrics \
  -v $(pwd)/etc:/app/etc \
  -v $(pwd)/bin:/app/bin:ro \
  python-scheduler
```

### Test API
```bash
# Health check
curl http://localhost:8000/health

# Trigger collection
curl -X POST http://localhost:8000/collect

# Check status
curl http://localhost:8000/status
```

## Integration with Backend

The Node.js backend calls this service for discovery:

```typescript
// backend/src/services/mining.service.ts
const discoverMiners = async () => {
  const response = await fetch('http://python-scheduler:8000/discover', {
    method: 'POST'
  });
  const result = await response.json();
  return result;
};
```

## Benefits

### Clean Separation
- Python code isolated from Node.js
- Single responsibility per service
- Clear API boundaries

### Maintainability
- One language per container
- Single dependency manager (pip)
- Easy to debug

### Scalability
- Can run multiple instances if needed
- Independent scaling from backend
- Shared volume for data exchange

## Troubleshooting

### Service won't start
```bash
# Check logs
docker logs python-scheduler

# Verify volumes
docker inspect python-scheduler | grep Mounts -A 20
```

### Metrics not appearing
```bash
# Check metrics directory
docker exec python-scheduler ls -la /metrics

# Verify Node Exporter can read
docker exec node-exporter ls -la /textfile
```

### Scripts failing
```bash
# Check script permissions
docker exec python-scheduler ls -la /app/bin

# Run script manually
docker exec python-scheduler python3 /app/bin/pyasic_textfile.py
```

### API not responding
```bash
# Test health endpoint
curl http://localhost:8000/health

# Check if port is exposed
docker port python-scheduler
```

## Dependencies

- Python 3.11
- FastAPI - REST API framework
- uvicorn - ASGI server
- schedule - Job scheduling
- pyasic - ASIC miner communication
- pyyaml - YAML configuration
- netifaces - Network interface info
- aiohttp - Async HTTP client
