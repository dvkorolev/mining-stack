# Phase 1: Bulletproof Stability & Health

## Overview

Phase 1 implements foundational improvements for service reliability and observability:
1. **Smart Health Checks** - Comprehensive health verification with dependency checking
2. **Structured Logging** - JSON-formatted logs for aggregation and analysis

## 1. Smart Health Checks

### What Changed

The `/health` endpoint is now intelligent and checks actual service health, not just "is the process running?"

#### Before
```json
{
  "status": "healthy"
}
```

#### After
```json
{
  "status": "healthy",
  "timestamp": "2025-11-04T13:56:00.123456",
  "checks": {
    "collection_lock": {
      "status": "healthy",
      "message": "Collection lock is free",
      "details": {}
    },
    "last_collection": {
      "status": "healthy",
      "message": "Last collection successful (45s ago)",
      "details": {
        "last_collection_age_seconds": 45.2,
        "last_collection_at": "2025-11-04T13:55:15"
      }
    },
    "config_file": {
      "status": "healthy",
      "message": "Config file is readable",
      "details": {
        "config_path": "/app/etc/miners.yaml",
        "file_size_bytes": 2048
      }
    },
    "profile_library": {
      "status": "healthy",
      "message": "Profile library loaded (6 profiles)",
      "details": {
        "total_profiles": 6,
        "algorithms": {"sha256": 4, "scrypt": 2}
      }
    }
  }
}
```

### Health Check Logic

The health check performs 4 critical verifications:

#### 1. Collection Lock Check
- **Healthy**: Lock is free or held for < 5 minutes
- **Unhealthy**: Lock held for > 5 minutes (collection stuck)
- **Why**: Detects hung collections that would otherwise go unnoticed

#### 2. Last Collection Check
- **Healthy**: Last collection succeeded and ran < 10 minutes ago
- **Degraded**: Last collection failed
- **Unhealthy**: Last collection is > 10 minutes old (scheduler stuck)
- **Why**: Ensures the scheduler is actually running collections

#### 3. Config File Check
- **Healthy**: `miners.yaml` exists and is readable
- **Unhealthy**: File missing or unreadable
- **Why**: Catches configuration issues before they cause collection failures

#### 4. Profile Library Check
- **Healthy**: Profile library loaded with profiles
- **Degraded**: Profile library failed to load (will use legacy fallback)
- **Why**: Verifies the profile system is working

### HTTP Status Codes

- **200 OK**: Service is healthy or degraded (still operational)
- **503 Service Unavailable**: Service is unhealthy (orchestrator should restart)

### Container Orchestration Integration

#### Docker Compose
```yaml
services:
  python-scheduler:
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:8000/health"]
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 40s
```

#### Kubernetes
```yaml
livenessProbe:
  httpGet:
    path: /health
    port: 8000
  initialDelaySeconds: 30
  periodSeconds: 30
  timeoutSeconds: 10
  failureThreshold: 3

readinessProbe:
  httpGet:
    path: /health
    port: 8000
  initialDelaySeconds: 10
  periodSeconds: 10
  timeoutSeconds: 5
  failureThreshold: 2
```

### Testing Health Checks

```bash
# Check health
curl http://localhost:8000/health

# Check with status code
curl -w "\nHTTP Status: %{http_code}\n" http://localhost:8000/health

# Simulate stuck collection (for testing)
# The health check will return 503 after 5 minutes if lock is held
```

## 2. Structured Logging

### What Changed

Logs are now output as JSON for easy parsing and aggregation.

#### Before (Human-readable)
```
2025-11-04 13:56:00 [INFO] Starting metrics collection
2025-11-04 13:56:05 [INFO] Collection complete: 10 miners in 5.2s
```

#### After (JSON - when LOG_FORMAT=json)
```json
{"timestamp": "2025-11-04T13:56:00.000Z", "level": "INFO", "service": "python-scheduler", "logger": "main", "message": "Starting metrics collection", "hostname": "scheduler-pod-abc123", "extra": {"collection_id": 1730730960}}
{"timestamp": "2025-11-04T13:56:05.200Z", "level": "INFO", "service": "python-scheduler", "logger": "main", "message": "Collection complete", "hostname": "scheduler-pod-abc123", "extra": {"duration_seconds": 5.2, "miners_total": 10, "miners_successful": 10, "fallback_attempts": 0, "fallback_successes": 0}}
```

### Configuration

Logging is configured via environment variables:

```bash
# Format: 'json' or 'human' (default: human)
LOG_FORMAT=json

# Level: DEBUG, INFO, WARNING, ERROR, CRITICAL (default: INFO)
LOG_LEVEL=INFO
```

### Structured Logging Features

#### 1. Automatic Context
Every log includes:
- `timestamp`: ISO 8601 UTC timestamp
- `level`: Log level
- `service`: Service name (python-scheduler)
- `logger`: Logger name (module)
- `message`: Log message
- `hostname`: Container/pod hostname

#### 2. Extra Fields
Add context to any log:
```python
log_event(logger, 'info', 'Collection complete',
         duration_seconds=5.2,
         miners_total=10,
         miners_successful=10)
```

#### 3. Exception Tracking
Errors automatically include exception details:
```json
{
  "level": "ERROR",
  "message": "Collection failed",
  "exception": {
    "type": "ConnectionError",
    "message": "Failed to connect to miner",
    "traceback": "..."
  },
  "source": {
    "file": "/app/main.py",
    "line": 245,
    "function": "collect_all_metrics"
  }
}
```

#### 4. Context Manager
Add context to all logs in a block:
```python
from logging_config import LogContext

with LogContext(miner_ip='192.168.1.100', miner_name='Miner-01'):
    logger.info("Starting collection")  # Includes miner_ip and miner_name
    logger.info("Collection complete")  # Also includes context
```

### Log Aggregation with Loki

#### Why Loki?
- **Lightweight**: Minimal resource usage
- **Grafana Integration**: Native support in Grafana
- **Label-based**: Efficient querying by service, level, etc.
- **Cost-effective**: Doesn't index full text like Elasticsearch

#### Setup with Docker Compose

1. **Add Loki and Promtail to docker-compose.yml**:

```yaml
services:
  loki:
    image: grafana/loki:2.9.0
    ports:
      - "3100:3100"
    command: -config.file=/etc/loki/local-config.yaml
    volumes:
      - loki-data:/loki
    networks:
      - mining-network

  promtail:
    image: grafana/promtail:2.9.0
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock
      - ./promtail-config.yml:/etc/promtail/config.yml
    command: -config.file=/etc/promtail/config.yml
    networks:
      - mining-network
    depends_on:
      - loki

  python-scheduler:
    environment:
      - LOG_FORMAT=json  # Enable JSON logging
      - LOG_LEVEL=INFO
    labels:
      logging: "promtail"  # Promtail will collect these logs

volumes:
  loki-data:
```

2. **Create promtail-config.yml**:

```yaml
server:
  http_listen_port: 9080
  grpc_listen_port: 0

positions:
  filename: /tmp/positions.yaml

clients:
  - url: http://loki:3100/loki/api/v1/push

scrape_configs:
  - job_name: docker
    docker_sd_configs:
      - host: unix:///var/run/docker.sock
        refresh_interval: 5s
        filters:
          - name: label
            values: ["logging=promtail"]
    
    relabel_configs:
      - source_labels: ['__meta_docker_container_name']
        regex: '/(.*)'
        target_label: 'container'
      - source_labels: ['__meta_docker_container_log_stream']
        target_label: 'stream'
    
    pipeline_stages:
      # Parse JSON logs
      - json:
          expressions:
            timestamp: timestamp
            level: level
            service: service
            logger: logger
            message: message
            hostname: hostname
      
      # Set timestamp
      - timestamp:
          source: timestamp
          format: RFC3339Nano
      
      # Extract labels
      - labels:
          level:
          service:
          logger:
          hostname:
      
      # Output message
      - output:
          source: message
```

3. **Configure Grafana Data Source**:

In Grafana:
- Add Data Source → Loki
- URL: `http://loki:3100`
- Save & Test

#### Querying Logs in Grafana

```logql
# All logs from python-scheduler
{service="python-scheduler"}

# Only errors
{service="python-scheduler", level="ERROR"}

# Collection events
{service="python-scheduler"} |= "Collection complete"

# Logs with specific context
{service="python-scheduler"} | json | miners_total > 0

# Rate of errors
rate({service="python-scheduler", level="ERROR"}[5m])
```

#### Example Grafana Dashboard Queries

**Panel 1: Log Volume by Level**
```logql
sum by (level) (rate({service="python-scheduler"}[5m]))
```

**Panel 2: Collection Duration**
```logql
{service="python-scheduler"} |= "Collection complete" | json | line_format "{{.duration_seconds}}"
```

**Panel 3: Error Rate**
```logql
sum(rate({service="python-scheduler", level="ERROR"}[5m]))
```

**Panel 4: Recent Errors (Table)**
```logql
{service="python-scheduler", level="ERROR"} | json
```

### Local Development

For local development, use human-readable format:

```bash
# .env file
LOG_FORMAT=human
LOG_LEVEL=DEBUG
```

Output:
```
2025-11-04 13:56:00 INFO     Starting metrics collection
2025-11-04 13:56:05 INFO     Collection complete
2025-11-04 13:56:05 ERROR    Failed to collect from miner [main.py:245]
```

### Migration Guide

#### Existing Deployments

1. **Update environment variables**:
```bash
# For production (with Loki)
LOG_FORMAT=json

# For development
LOG_FORMAT=human
```

2. **No code changes required** - logging is automatically configured

3. **Optional**: Deploy Loki stack for log aggregation

#### Adding Structured Logging to Your Code

```python
from logging_config import log_event, LogContext

# Simple structured log
log_event(logger, 'info', 'Miner collected',
         miner_ip='192.168.1.100',
         hashrate_ths=120.5,
         temperature_c=65)

# With context manager
with LogContext(collection_id=12345):
    logger.info("Starting collection")  # Includes collection_id
    # ... do work ...
    logger.info("Collection complete")  # Also includes collection_id
```

## Benefits

### Self-Healing Infrastructure
- Container orchestrators can detect and restart unhealthy services
- No more "zombie" processes that appear running but aren't working

### Faster Debugging
- Jump from metric spike to exact logs in Grafana
- Search across all services in one place
- Filter by service, level, or custom fields

### Proactive Monitoring
- Alert on error rate increases
- Track collection duration trends
- Detect configuration issues before they cause outages

### Operational Visibility
- See exactly what's happening across all services
- Correlate events between python-scheduler and backend
- Historical log analysis for troubleshooting

## Testing

### Test Health Checks

```bash
# 1. Start service
python3 main.py

# 2. Check health (should be healthy)
curl http://localhost:8000/health | jq

# 3. Check health returns 200
curl -w "\nHTTP %{http_code}\n" http://localhost:8000/health

# 4. Verify all checks pass
curl http://localhost:8000/health | jq '.checks | to_entries[] | {name: .key, status: .value.status}'
```

### Test Structured Logging

```bash
# 1. Run with JSON logging
LOG_FORMAT=json python3 main.py

# 2. Verify JSON output
# Each line should be valid JSON

# 3. Run with human logging
LOG_FORMAT=human python3 main.py

# 4. Verify readable output
```

### Test Loki Integration

```bash
# 1. Start full stack
docker-compose up -d

# 2. Check Loki is receiving logs
curl http://localhost:3100/ready

# 3. Query logs via Loki API
curl -G -s "http://localhost:3100/loki/api/v1/query_range" \
  --data-urlencode 'query={service="python-scheduler"}' \
  | jq

# 4. View in Grafana
# Open http://localhost:3000
# Explore → Loki → {service="python-scheduler"}
```

## Next Steps

With Phase 1 complete, you have:
- ✅ Self-healing infrastructure via smart health checks
- ✅ Centralized logging for all services
- ✅ Foundation for advanced monitoring and alerting

**Phase 2** will build on this foundation with:
- Retry logic and circuit breakers
- Rate limiting and backpressure
- Advanced error recovery
