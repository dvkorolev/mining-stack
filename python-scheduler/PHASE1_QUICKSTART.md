# Phase 1 Quick Start Guide

## 🚀 Getting Started in 5 Minutes

### Prerequisites
- Docker and Docker Compose installed
- Existing mining-stack deployment

### Step 1: Enable Structured Logging (2 minutes)

Update your python-scheduler environment variables:

```bash
# In your docker-compose.yml or .env file
LOG_FORMAT=json
LOG_LEVEL=INFO
```

Restart the service:
```bash
docker-compose restart python-scheduler
```

Verify JSON logging:
```bash
docker logs python-scheduler --tail 10
```

You should see JSON output like:
```json
{"timestamp":"2025-11-04T13:56:00Z","level":"INFO","service":"python-scheduler",...}
```

### Step 2: Test Smart Health Checks (1 minute)

```bash
# Check health endpoint
curl http://localhost:8000/health | jq

# Should return detailed health status
```

Example healthy response:
```json
{
  "status": "healthy",
  "timestamp": "2025-11-04T13:56:00",
  "checks": {
    "collection_lock": {"status": "healthy", ...},
    "last_collection": {"status": "healthy", ...},
    "config_file": {"status": "healthy", ...},
    "profile_library": {"status": "healthy", ...}
  }
}
```

### Step 3: Deploy Loki Stack (2 minutes)

```bash
# Download the logging stack configuration
cd mining-stack/python-scheduler

# Start Loki and Promtail
docker-compose -f docker-compose.yml -f docker-compose.logging.yml up -d loki promtail

# Verify Loki is running
curl http://localhost:3100/ready

# Should return "ready"
```

### Step 4: Configure Grafana (Optional)

If you already have Grafana:

1. Open Grafana (http://localhost:3000)
2. Go to Configuration → Data Sources
3. Add Data Source → Loki
4. URL: `http://loki:3100`
5. Save & Test

Or use auto-provisioning:
```bash
# Copy the Loki datasource config
mkdir -p grafana/provisioning/datasources
cp grafana/provisioning/datasources/loki.yml grafana/provisioning/datasources/

# Restart Grafana
docker-compose restart grafana
```

### Step 5: View Logs in Grafana

1. Open Grafana → Explore
2. Select "Loki" data source
3. Query: `{service="python-scheduler"}`
4. Click "Run Query"

You should see all logs from python-scheduler!

## 🎯 Quick Wins

### 1. Search for Errors
```logql
{service="python-scheduler", level="ERROR"}
```

### 2. Track Collection Duration
```logql
{service="python-scheduler"} |= "Collection complete" | json | line_format "{{.extra.duration_seconds}}s"
```

### 3. Monitor Error Rate
```logql
rate({service="python-scheduler", level="ERROR"}[5m])
```

### 4. View Health Check Status
```bash
watch -n 5 'curl -s http://localhost:8000/health | jq .status'
```

## 🔧 Troubleshooting

### Logs Not Appearing in Loki?

1. Check Promtail is running:
```bash
docker ps | grep promtail
```

2. Check Promtail logs:
```bash
docker logs promtail
```

3. Verify container has logging label:
```bash
docker inspect python-scheduler | grep -A5 Labels
# Should see: "logging": "promtail"
```

4. Test Loki directly:
```bash
curl -G -s "http://localhost:3100/loki/api/v1/query_range" \
  --data-urlencode 'query={service="python-scheduler"}' \
  --data-urlencode 'limit=10' | jq
```

### Health Check Returning 503?

Check which check is failing:
```bash
curl http://localhost:8000/health | jq '.checks | to_entries[] | select(.value.status != "healthy")'
```

Common issues:
- **collection_lock**: Collection stuck (restart service)
- **last_collection**: Scheduler not running (check logs)
- **config_file**: miners.yaml missing or unreadable
- **profile_library**: Profile loading failed (check asic_profiles.yaml)

### JSON Logs Not Formatted?

Make sure LOG_FORMAT is set:
```bash
docker exec python-scheduler env | grep LOG_FORMAT
# Should show: LOG_FORMAT=json
```

If not set, update docker-compose.yml and restart.

## 📊 Example Grafana Dashboard

Create a simple dashboard with these panels:

### Panel 1: Service Health
- **Type**: Stat
- **Query**: `{service="python-scheduler"} |= "status" | json`
- **Visualization**: Show "healthy" or "unhealthy"

### Panel 2: Log Volume
- **Type**: Graph
- **Query**: `sum by (level) (rate({service="python-scheduler"}[1m]))`
- **Legend**: {{level}}

### Panel 3: Collection Duration
- **Type**: Graph
- **Query**: `{service="python-scheduler"} |= "Collection complete" | json | unwrap extra_duration_seconds`

### Panel 4: Recent Errors
- **Type**: Logs
- **Query**: `{service="python-scheduler", level="ERROR"}`
- **Options**: Show time, level, message

## 🎓 Learning Resources

### LogQL (Loki Query Language)
```logql
# Basic filter
{service="python-scheduler"}

# Filter by level
{service="python-scheduler", level="ERROR"}

# Text search
{service="python-scheduler"} |= "Collection"

# Regex search
{service="python-scheduler"} |~ "Collection (complete|failed)"

# JSON parsing
{service="python-scheduler"} | json

# Extract field
{service="python-scheduler"} | json | line_format "{{.extra.duration_seconds}}"

# Rate calculation
rate({service="python-scheduler"}[5m])

# Aggregation
sum by (level) (rate({service="python-scheduler"}[5m]))
```

### Health Check API
```bash
# Full health check
curl http://localhost:8000/health | jq

# Just the status
curl -s http://localhost:8000/health | jq -r .status

# Check specific component
curl -s http://localhost:8000/health | jq '.checks.collection_lock'

# HTTP status code
curl -w "%{http_code}" -o /dev/null -s http://localhost:8000/health
```

## ✅ Verification Checklist

- [ ] JSON logs visible in `docker logs python-scheduler`
- [ ] Health endpoint returns detailed status
- [ ] Health check returns 200 when healthy
- [ ] Loki is running and ready
- [ ] Promtail is collecting logs
- [ ] Logs visible in Grafana Explore
- [ ] Can search logs by level
- [ ] Can filter logs by service
- [ ] Error rate query works
- [ ] Collection duration visible

## 🎉 Success!

You now have:
- ✅ Structured logging for easy analysis
- ✅ Smart health checks for self-healing
- ✅ Centralized log aggregation
- ✅ Grafana integration for visualization

**Next**: Explore the full documentation in `PHASE1_STABILITY_HEALTH.md`
