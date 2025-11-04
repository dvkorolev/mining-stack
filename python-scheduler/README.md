# Python Scheduler Service

Dedicated microservice for collecting ASIC miner metrics with Prometheus integration and advanced scheduling.

## Overview

The Python Scheduler is a FastAPI-based service that handles all mining hardware communication and metrics collection. It uses APScheduler for reliable job scheduling and exposes metrics via Prometheus for monitoring.

**Version**: 3.0  
**Python**: 3.11+  
**Framework**: FastAPI + APScheduler

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

## Directory Structure

```
python-scheduler/
├── main.py                      # FastAPI app, endpoints, orchestration
├── config.py                    # Configuration loading & caching
├── metrics.py                   # Prometheus metric definitions
├── models.py                    # Pydantic validation models
├── file_lock.py                 # File locking for config safety
├── logging_config.py            # Structured logging configuration
├── health_check.py              # Health check utilities
├── state_manager.py             # State management
├── asic_profile_loader.py       # ASIC profile loading
├── asic_profiles.yaml           # ASIC model profiles
├── requirements.txt             # Python dependencies
├── Dockerfile                   # Container build
├── collectors/
│   ├── __init__.py
│   ├── pyasic_collector.py      # Primary: PyASIC + CGMiner
│   ├── antminer_cgi_collector.py # Fallback: Antminer CGI
│   └── dg1_tcp_collector.py     # Fallback: DG1 TCP
├── parsers/
│   ├── __init__.py
│   └── cgminer_parser.py        # CGMiner response parser
├── docs/
│   ├── architecture/            # Architecture documentation
│   ├── guides/                  # User guides
│   └── changelog/               # Change history
└── README.md                    # This file
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

- **Python 3.11** - Runtime
- **FastAPI** - REST API framework
- **uvicorn** - ASGI server
- **APScheduler** - Advanced job scheduling
- **pyasic** - ASIC miner communication
- **pyyaml** - YAML configuration
- **netifaces** - Network interface info
- **aiohttp** - Async HTTP client
- **pydantic** - Data validation
- **prometheus-client** - Metrics export

## New Features (V3.0)

### Input Validation
- **Pydantic models** for all API requests
- Automatic validation with 422 responses
- Type-safe configuration loading
- See: `models.py`

### File Locking
- **Atomic file operations** for config files
- Prevents race conditions
- Guaranteed lock release
- See: `file_lock.py`

### Structured Logging
- **JSON and human-readable** formats
- Contextual logging with metadata
- Log levels: DEBUG, INFO, WARNING, ERROR
- See: `logging_config.py`

### ASIC Profiles
- **Profile library** for known ASIC models
- Auto-detection and configuration
- Extensible profile system
- See: `asic_profiles.yaml`, `asic_profile_loader.py`

### Advanced Scheduling
- **APScheduler** for reliable job execution
- Async job support
- Job status monitoring
- Configurable intervals

## Documentation

### Architecture
- [ARM64 Build Fix](docs/architecture/ARM64_BUILD_FIX.md)
- [ARM64 Compatibility](docs/architecture/ARM64_COMPATIBILITY_NOTES.md)
- [Driver Implementation](docs/architecture/DRIVERS_IMPLEMENTATION.md)
- [Scheduler Improvements](docs/architecture/SCHEDULER_IMPROVEMENTS.md)

### Guides
- [ASIC Profile Library](docs/guides/ASIC_PROFILE_LIBRARY.md)
- [Profile Integration](docs/guides/PROFILE_LIBRARY_INTEGRATION.md)
- [Quick Config Reference](docs/guides/QUICK_CONFIG_REFERENCE.md)
- [Phase 1 Quickstart](docs/guides/PHASE1_QUICKSTART.md)
- [Stability & Health](docs/guides/PHASE1_STABILITY_HEALTH.md)

### Changelog
- [Cleanup Summary](docs/changelog/CLEANUP_SUMMARY.md)
- [Config Alignment](docs/changelog/CONFIG_ALIGNMENT.md)
- [Hashrate Unit Check](docs/changelog/HASHRATE_UNIT_SANITY_CHECK.md)
- [HTTPX Migration](docs/changelog/HTTPX_MIGRATION.md)
- [Implementation Complete](docs/changelog/IMPLEMENTATION_COMPLETE.md)
- [Improvements](docs/changelog/IMPROVEMENTS.md)
- [Integration Summary](docs/changelog/INTEGRATION_SUMMARY.md)
- [Refactoring Summary](docs/changelog/REFACTORING_SUMMARY.md)

## Related Documentation

- [Main Project README](../README.md)
- [Backend Service](../backend/README.md)
- [Frontend Service](../frontend/README.md)
- [Docker Configuration](../docker/README.md)
- [Prometheus Configuration](../docker/prometheus/README.md)

## License

Part of the Mining Stack project.
