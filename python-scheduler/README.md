# Python Scheduler Service (Modular Architecture)

Dedicated microservice for collecting ASIC miner metrics with Prometheus integration.

## Purpose

This service maintains **clean separation of concerns** by handling all Python/hardware-related operations separately from the Node.js backend.

### What It Does
- ✅ Collects metrics from ASIC miners using PyASIC + CGMiner fallback
- ✅ Exposes Prometheus metrics endpoint (in-memory)
- ✅ Scheduled collection every 2 minutes (configurable)
- ✅ Provides REST API for manual triggers and status
- ✅ Tracks pool network quality metrics
- ✅ Implements failure streak tracking

### What It Doesn't Do
- ❌ Serve web UI
- ❌ Query Prometheus
- ❌ Manage user sessions

## Modular Architecture

```
python-scheduler/
├── main.py                      # FastAPI app, endpoints, orchestration
├── config.py                    # Configuration loading & caching
├── metrics.py                   # Prometheus metric definitions
├── collectors/
│   ├── __init__.py
│   ├── pyasic_collector.py      # Primary: PyASIC + CGMiner
│   ├── antminer_cgi_collector.py # Fallback: Antminer CGI
│   └── dg1_tcp_collector.py     # Fallback: DG1 TCP
└── parsers/
    ├── __init__.py
    └── cgminer_parser.py        # CGMiner response parser
```

### Service Flow

```
┌─────────────────────────────────────┐
│  Python Scheduler Service           │
│  - FastAPI REST API (:8000)         │
│  - Async scheduler loop             │
│  - PyASIC + CGMiner collectors      │
│  - In-memory Prometheus metrics     │
└─────────────────────────────────────┘
           ↓ (HTTP scrape)
┌─────────────────────────────────────┐
│  Prometheus                         │
│  - Scrapes /metrics endpoint        │
│  - Stores time-series data          │
└─────────────────────────────────────┘
```

## API Endpoints

### GET /
Service info and available endpoints

```bash
curl http://localhost:8000/
```

### GET /health
Simple health check

```bash
curl http://localhost:8000/health
```

### GET /status
Get collector status and last collection info

```bash
curl http://localhost:8000/status
```

### GET /jobs
Get scheduler status (minimal)

```bash
curl http://localhost:8000/jobs
```

### GET /metrics
Prometheus metrics endpoint (scraped by Prometheus)

```bash
curl http://localhost:8000/metrics
```

### POST /collect
Manually trigger metrics collection (runs in background)

```bash
curl -X POST http://localhost:8000/collect
```

### POST /reload
Force configuration reload and immediate collection

```bash
curl -X POST http://localhost:8000/reload
```

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `MINERS_CONFIG` | `/app/etc/miners.yaml` | Miners configuration file |
| `COLLECTION_INTERVAL` | `2` | Collection interval in minutes |
| `ENABLE_ICMP_PING` | `false` | Enable ICMP ping tests for pools |
| `MAX_CONCURRENT_REQUESTS` | `5` | Max concurrent miner requests |
| `BACKEND_URL` | `http://backend:5000` | Backend service URL |
| `PUSH_TO_BACKEND` | `true` | Push metrics to backend |

## Volumes

- `/app/etc` - Miners configuration (read-only)

## Collection Features

### Multi-Layered Probing (Hierarchical Fallback)
1. **Primary**: PyASIC library for modern ASIC miners
2. **Gap Filling**: Direct CGMiner API (port 4028) for missing data
3. **Fallback Drivers** (when primary fails):
   - **Antminer CGI**: HTTP digest auth to `/cgi-bin/stats.cgi`
   - **DG1 TCP**: Custom TCP protocol for ElphaPex DG1 miners

### Gap Filling
- Automatically detects missing metrics (power, temperature, rejected shares)
- Falls back to CGMiner API to fill gaps
- Tracks gap-filling with observability counter

### Specialized Drivers
- **Antminer CGI**: For Antminers when port 4028 API fails
  - Uses web-based CGI endpoints
  - Digest authentication support
  - Parses active chains and chip temperatures
- **DG1 TCP**: For ElphaPex DG1 SCRYPT miners
  - Reverse-engineered TCP protocol
  - Handles custom response formats
  - SCRYPT hashrate in MH/s

### Failure Streak Tracking
- Tracks consecutive failures per miner
- Removes stale metrics after 5 consecutive failures
- Prevents metric accumulation for offline miners

## Logs

View logs:
```bash
docker logs python-scheduler -f
```

Expected output:
```
2025-11-03 15:00:00 [INFO] ============================================================
2025-11-03 15:00:00 [INFO] Mining Metrics Collector Service V2 Starting
2025-11-03 15:00:00 [INFO] ============================================================
2025-11-03 15:00:00 [INFO] Miners config: /app/etc/miners.yaml
2025-11-03 15:00:00 [INFO] Collection interval: 2 minutes
2025-11-03 15:00:00 [INFO] ICMP ping enabled: False
2025-11-03 15:00:00 [INFO] Architecture: Direct Prometheus scraping (async scheduler + lock)
2025-11-03 15:00:00 [INFO] Starting API server on port 8000...
2025-11-03 15:00:00 [INFO] Prometheus metrics available at: http://0.0.0.0:8000/metrics
2025-11-03 15:00:01 [INFO] Starting batch collection with gap filling...
2025-11-03 15:00:05 [INFO] Filling gaps for 3 miners...
2025-11-03 15:00:06 [INFO] ✓ Batch collection: 10/10 miners in 5.2s
2025-11-03 15:00:06 [INFO] ✓ Pool network collection complete: 2 pools in 1.1s
```

## Development

### Build
```bash
docker build -t python-scheduler ./python-scheduler
```

### Run Standalone
```bash
docker run -p 8000:8000 \
  -v $(pwd)/etc:/app/etc \
  -e COLLECTION_INTERVAL=2 \
  -e ENABLE_ICMP_PING=false \
  python-scheduler
```

### Test API
```bash
# Health check
curl http://localhost:8000/health

# Get status
curl http://localhost:8000/status

# View Prometheus metrics
curl http://localhost:8000/metrics

# Trigger collection
curl -X POST http://localhost:8000/collect

# Reload config
curl -X POST http://localhost:8000/reload
```

## Integration with Backend

The service pushes metrics to the backend for real-time UI updates:

```python
# Automatic push after each collection
await push_metrics_to_backend(miners_data, collection_info)
```

Backend receives:
```json
{
  "miners": [...],
  "timestamp": 1699027200000,
  "collection_info": {...}
}
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
