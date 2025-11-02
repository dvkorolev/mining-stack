# Pool Network Monitor Integration - Gap Fixed

## Overview

Fixed the integration gap where the pool network monitor was not exposed via the python-scheduler API. The monitor now runs as part of the scheduled metrics collection and can be triggered independently via the API.

## Changes Made

### 1. Python Scheduler (`python-scheduler/scheduler.py`)

#### Added to JOB_ALLOWLIST
```python
'collect_metrics': {
    'scripts': [
        '/app/bin/pyasic_textfile.py',
        '/app/bin/universal_miner_collector.py',
        '/app/bin/pool_network_monitor.py'  # ✅ ADDED
    ],
    'description': 'Collect metrics from all miners and monitor pool network quality',
    'timeout': 120
},
'monitor_pool_network': {  # ✅ NEW JOB
    'scripts': ['/app/bin/pool_network_monitor.py'],
    'description': 'Monitor network quality to mining pools (latency, packet loss, connectivity)',
    'timeout': 90
}
```

#### Updated collect_metrics()
```python
def collect_metrics():
    # ... existing collectors ...
    
    # ✅ ADDED: Run pool network monitor
    pool_network_result = run_script(
        '/app/bin/pool_network_monitor.py', 
        'pool_network_monitor',
        env_vars={'RUN_ONCE': 'true'}
    )
    results.append(pool_network_result)
```

#### Enhanced run_script()
```python
def run_script(script_path: str, script_name: str, env_vars: Optional[Dict[str, str]] = None):
    # ✅ ADDED: Support for environment variables
    script_env = os.environ.copy()
    if env_vars:
        script_env.update(env_vars)
    
    result = subprocess.run(
        ['python3', script_path],
        env=script_env,  # ✅ Pass environment
        # ... other params ...
    )
```

### 2. Pool Network Monitor (`bin/pool_network_monitor.py`)

#### Added One-Time Execution Mode
```python
async def main():
    monitor = PoolNetworkMonitor(config_path, output_path)
    
    # ✅ ADDED: Check for one-time mode
    run_once = os.getenv('RUN_ONCE', 'false').lower() == 'true'
    
    if run_once:
        # Run once and exit (for scheduler)
        logger.info("Running in one-time mode")
        await monitor.run_once()
    else:
        # Run continuously (for standalone service)
        await monitor.run_continuous(interval=60)
```

## Benefits

### 1. **Unified API Access**
- Pool network monitoring now accessible via `/run` endpoint
- Can trigger manually: `POST /run {"job": "monitor_pool_network"}`
- Included in scheduled `collect_metrics` job

### 2. **Flexible Execution Modes**
- **One-time mode**: For scheduler integration (RUN_ONCE=true)
- **Continuous mode**: For standalone service deployment

### 3. **Complete Metrics Collection**
The scheduler now collects all three metric types:
1. **PyASIC metrics** - Detailed per-board data
2. **Universal metrics** - Fallback for all miner types
3. **Pool network metrics** - Network quality monitoring ✅

## API Usage

### Trigger All Metrics Collection
```bash
POST http://localhost:8000/run
{
  "job": "collect_metrics"
}
```
Runs all three collectors including pool network monitor.

### Trigger Pool Network Monitor Only
```bash
POST http://localhost:8000/run
{
  "job": "monitor_pool_network"
}
```
Runs only the pool network quality monitor.

### List Available Jobs
```bash
GET http://localhost:8000/jobs
```
Returns all available jobs including the new `monitor_pool_network`.

## Deployment

### Docker Compose
The changes are automatically included when rebuilding the python-scheduler container:

```bash
cd /opt/mining-stack
docker compose -f docker-compose.prod.yml up -d --build python-scheduler
```

### Verification
```bash
# Check scheduler logs
docker compose -f docker-compose.prod.yml logs -f python-scheduler

# Verify pool network metrics are being collected
docker compose -f docker-compose.prod.yml exec python-scheduler cat /metrics/pool_network_metrics.prom

# Test API endpoint
curl -X POST http://localhost:8000/run \
  -H "Content-Type: application/json" \
  -d '{"job": "monitor_pool_network"}'
```

## Metrics Collected

The pool network monitor now exports these metrics every collection cycle:

| Metric | Description |
|--------|-------------|
| `pool_network_reachable` | Pool TCP reachability (0/1) |
| `pool_network_dns_resolved` | DNS resolution success (0/1) |
| `pool_network_connect_time_ms` | TCP connection time (ms) |
| `pool_network_ping_avg_ms` | Average ping latency (ms) |
| `pool_network_ping_min_ms` | Minimum ping latency (ms) |
| `pool_network_ping_max_ms` | Maximum ping latency (ms) |
| `pool_network_packet_loss_percent` | Packet loss (%) |

## Scheduled Execution

The scheduler runs `collect_metrics` every 2 minutes (configurable via `COLLECTION_INTERVAL`), which now includes:

```
Every 2 minutes:
├── PyASIC collector (60s timeout)
├── Universal collector (60s timeout)
└── Pool network monitor (60s timeout) ✅ NEW
```

## Summary

✅ **Gap Fixed**: Pool network monitor is now fully integrated into the python-scheduler  
✅ **API Accessible**: Can be triggered via `/run` endpoint  
✅ **Scheduled**: Runs automatically every collection cycle  
✅ **Flexible**: Supports both one-time and continuous modes  
✅ **Complete**: All three metric types now collected together  

The integration is complete and ready for deployment.
