# Cross-Service Structured Logging

## Overview

All services in the mining-stack now use **consistent structured logging** with the same JSON format, making it easy to aggregate, search, and correlate logs across the entire stack.

## Services

### 1. Python Scheduler
- **Language**: Python
- **Framework**: Custom `logging_config.py`
- **Service Name**: `python-scheduler`

### 2. Backend API
- **Language**: TypeScript/Node.js
- **Framework**: Winston
- **Service Name**: `backend`

### 3. Frontend
- **Language**: TypeScript/React
- **Framework**: Custom `logger.ts`
- **Service Name**: `frontend`

## Unified Log Format

All services output logs in the same JSON structure:

```json
{
  "timestamp": "2025-11-04T14:00:00.000Z",
  "level": "INFO",
  "service": "python-scheduler",
  "logger": "main",
  "message": "Collection complete",
  "hostname": "scheduler-pod-abc123",
  "extra": {
    "duration_seconds": 5.2,
    "miners_total": 10
  }
}
```

### Field Descriptions

| Field | Type | Description |
|-------|------|-------------|
| `timestamp` | string | ISO 8601 UTC timestamp |
| `level` | string | Log level: DEBUG, INFO, WARNING, ERROR, CRITICAL |
| `service` | string | Service name (python-scheduler, backend, frontend) |
| `logger` | string | Logger/module name |
| `message` | string | Log message |
| `hostname` | string | Container/pod hostname |
| `extra` | object | Additional context fields (optional) |
| `exception` | object | Exception details (optional, for errors) |

## Configuration

### Environment Variables

All services use the same environment variables:

```bash
# Log format: 'json' or 'human'
LOG_FORMAT=json

# Log level: DEBUG, INFO, WARNING, ERROR, CRITICAL
LOG_LEVEL=INFO
```

### Python Scheduler

```yaml
# docker-compose.yml
services:
  python-scheduler:
    environment:
      - LOG_FORMAT=json
      - LOG_LEVEL=INFO
    labels:
      logging: "promtail"  # For Loki collection
```

### Backend

```yaml
# docker-compose.yml
services:
  backend:
    environment:
      - LOG_FORMAT=json
      - LOG_LEVEL=info  # Winston uses lowercase
    labels:
      logging: "promtail"
```

### Frontend

```yaml
# docker-compose.yml
services:
  frontend:
    environment:
      - REACT_APP_LOG_LEVEL=INFO
      - REACT_APP_SEND_LOGS_TO_BACKEND=false
```

## Usage Examples

### Python Scheduler

```python
from logging_config import log_event, LogContext

# Simple structured log
log_event(logger, 'info', 'Collection complete',
         duration_seconds=5.2,
         miners_total=10)

# With context manager
with LogContext(collection_id=12345):
    logger.info("Starting collection")  # Includes collection_id
    logger.info("Collection complete")  # Also includes collection_id
```

### Backend (Node.js)

```typescript
import { logger, logEvent } from './utils/logger';

// Simple log
logger.info('Mining service started');

// With context
logEvent('info', 'Miner data updated', {
  miner_id: 'miner-01',
  hashrate: 120.5,
  temperature: 65
});

// Error with exception
try {
  // ... code ...
} catch (error) {
  logger.error('Failed to fetch miner data', error);
}
```

### Frontend (React)

```typescript
import { logger, logEvent } from './utils/logger';

// Simple log
logger.info('Dashboard loaded');

// With context
logEvent('INFO', 'Miner action performed', {
  action: 'restart',
  miner_id: 'miner-01',
  user_id: 'user-123'
});

// Error handling
try {
  await fetchMiningStats();
} catch (error) {
  logger.error('Failed to fetch stats', {
    endpoint: '/api/mining/stats'
  }, error as Error);
}
```

## Log Aggregation with Loki

### Architecture

```
┌─────────────────┐
│ Python Scheduler│──┐
│   (JSON logs)   │  │
└─────────────────┘  │
                     │
┌─────────────────┐  │    ┌──────────┐    ┌──────┐    ┌─────────┐
│   Backend API   │──┼───▶│ Promtail │───▶│ Loki │───▶│ Grafana │
│   (JSON logs)   │  │    └──────────┘    └──────┘    └─────────┘
└─────────────────┘  │
                     │
┌─────────────────┐  │
│    Frontend     │──┘
│ (Browser logs)  │
└─────────────────┘
```

### Deployment

```bash
# Deploy full logging stack
docker-compose -f docker-compose.yml -f docker-compose.logging.yml up -d
```

### Querying Logs

#### All logs from a service
```logql
{service="python-scheduler"}
{service="backend"}
{service="frontend"}
```

#### Errors across all services
```logql
{level="ERROR"}
```

#### Logs from specific service with context
```logql
{service="backend"} | json | miner_id="miner-01"
```

#### Cross-service correlation
```logql
{service=~"python-scheduler|backend"} |= "miner-01"
```

#### Error rate by service
```logql
sum by (service) (rate({level="ERROR"}[5m]))
```

## Health Checks

All services now have smart health checks that return consistent format:

### Python Scheduler
```bash
curl http://localhost:8000/health
```

### Backend
```bash
curl http://localhost:5000/health
```

### Response Format
```json
{
  "status": "healthy",
  "timestamp": "2025-11-04T14:00:00.000Z",
  "checks": {
    "component_1": {
      "status": "healthy",
      "message": "Component operational",
      "details": {}
    }
  }
}
```

**HTTP Status Codes**:
- `200` - Healthy or degraded (operational)
- `503` - Unhealthy (orchestrator should restart)

## Grafana Dashboards

### Panel 1: Log Volume by Service
```logql
sum by (service) (rate({job="docker"}[1m]))
```

### Panel 2: Error Rate by Service
```logql
sum by (service) (rate({level="ERROR"}[5m]))
```

### Panel 3: Recent Errors (Table)
```logql
{level="ERROR"} | json
```

### Panel 4: Service Health
Query each service's `/health` endpoint and display status

### Panel 5: Log Levels Distribution
```logql
sum by (level) (rate({job="docker"}[5m]))
```

## Best Practices

### 1. Use Structured Context
```python
# Good
log_event(logger, 'info', 'Miner collected',
         miner_ip='192.168.1.100',
         hashrate=120.5)

# Bad
logger.info(f"Collected miner 192.168.1.100 with hashrate 120.5")
```

### 2. Consistent Field Names
Use snake_case for field names across all services:
- `miner_id` (not `minerId` or `MinerID`)
- `duration_seconds` (not `duration` or `durationMs`)
- `error_message` (not `errorMsg` or `error`)

### 3. Log Levels
- **DEBUG**: Detailed diagnostic information
- **INFO**: General informational messages
- **WARNING**: Warning messages (degraded but operational)
- **ERROR**: Error messages (operation failed)
- **CRITICAL**: Critical errors (service may be unusable)

### 4. Add Context, Not Noise
```python
# Good - actionable context
logger.info("Collection complete", extra={
    'duration_seconds': 5.2,
    'miners_successful': 10,
    'miners_failed': 2
})

# Bad - too verbose
logger.debug("Starting loop iteration 1")
logger.debug("Starting loop iteration 2")
# ...
```

### 5. Error Handling
Always include exception details:
```typescript
try {
  await operation();
} catch (error) {
  logger.error('Operation failed', { operation: 'fetch_data' }, error);
}
```

## Troubleshooting

### Logs Not Appearing in Loki?

1. **Check Promtail is running**:
```bash
docker ps | grep promtail
docker logs promtail
```

2. **Verify container labels**:
```bash
docker inspect python-scheduler | grep -A5 Labels
# Should see: "logging": "promtail"
```

3. **Check log format**:
```bash
docker logs python-scheduler --tail 5
# Should be valid JSON if LOG_FORMAT=json
```

4. **Test Loki directly**:
```bash
curl -G -s "http://localhost:3100/loki/api/v1/query_range" \
  --data-urlencode 'query={service="python-scheduler"}' \
  --data-urlencode 'limit=10' | jq
```

### Logs in Wrong Format?

Check environment variables:
```bash
# Python Scheduler
docker exec python-scheduler env | grep LOG_FORMAT

# Backend
docker exec backend env | grep LOG_FORMAT
```

### Can't Correlate Logs?

Ensure you're using consistent field names:
```python
# Python
log_event(logger, 'info', 'Processing miner', miner_id='miner-01')

# Backend
logEvent('info', 'Processing miner', { miner_id: 'miner-01' })

# Frontend
logEvent('INFO', 'Processing miner', { miner_id: 'miner-01' })
```

Then query:
```logql
{} | json | miner_id="miner-01"
```

## Migration Checklist

- [ ] Python Scheduler: LOG_FORMAT=json set
- [ ] Backend: LOG_FORMAT=json set
- [ ] Frontend: Logger imported and used
- [ ] All services have logging label
- [ ] Loki and Promtail deployed
- [ ] Grafana datasource configured
- [ ] Health checks return consistent format
- [ ] Logs visible in Grafana Explore
- [ ] Can search by service
- [ ] Can filter by level
- [ ] Can correlate across services

## Performance Impact

- **Python Scheduler**: <1ms per log (JSON serialization)
- **Backend**: <1ms per log (Winston formatting)
- **Frontend**: <1ms per log (console output only)
- **Loki**: Minimal resource usage (~50MB RAM, <1% CPU)
- **Promtail**: Minimal resource usage (~30MB RAM, <1% CPU)

## Next Steps

1. **Deploy to staging** - Test full logging stack
2. **Create dashboards** - Build Grafana dashboards for monitoring
3. **Set up alerts** - Alert on error rates and service health
4. **Train team** - Educate team on structured logging best practices
5. **Document patterns** - Document common query patterns for your use cases

## Resources

- **Python Scheduler Docs**: `python-scheduler/PHASE1_STABILITY_HEALTH.md`
- **Loki Documentation**: https://grafana.com/docs/loki/
- **LogQL Cheat Sheet**: https://grafana.com/docs/loki/latest/logql/
- **Winston Documentation**: https://github.com/winstonjs/winston
