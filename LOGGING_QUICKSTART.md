# Cross-Service Logging Quick Start

## 🚀 Enable Structured Logging in 5 Minutes

### Step 1: Deploy Logging Stack (2 minutes)

```bash
cd mining-stack

# Start all services with logging enabled
docker-compose -f docker-compose.yml -f python-scheduler/docker-compose.logging.yml up -d

# Verify all services are running
docker ps | grep -E "loki|promtail|python-scheduler|backend|frontend"
```

### Step 2: Verify JSON Logging (1 minute)

```bash
# Check Python Scheduler logs (should be JSON)
docker logs python-scheduler --tail 5

# Check Backend logs (should be JSON)
docker logs backend --tail 5

# Verify Loki is ready
curl http://localhost:3100/ready
# Should return: ready
```

### Step 3: View Logs in Grafana (2 minutes)

1. Open Grafana: http://localhost:3000
2. Go to **Explore** (compass icon)
3. Select **Loki** data source
4. Run query: `{service="python-scheduler"}`
5. Click **Run Query**

You should see all logs from python-scheduler!

## 🎯 Common Queries

### View All Services
```logql
{job="docker"}
```

### Filter by Service
```logql
{service="python-scheduler"}
{service="backend"}
{service="frontend"}
```

### View Errors Only
```logql
{level="ERROR"}
```

### Search for Specific Miner
```logql
{} | json | miner_id="miner-01"
```

### Error Rate by Service
```logql
sum by (service) (rate({level="ERROR"}[5m]))
```

## 🔍 Test Logging

### Python Scheduler
```bash
# Trigger a collection
curl -X POST http://localhost:8000/collect

# View logs
docker logs python-scheduler --tail 20
```

### Backend
```bash
# Check health
curl http://localhost:5000/health

# View logs
docker logs backend --tail 20
```

### Frontend
Open browser console (F12) and navigate to the dashboard. You'll see structured logs in the console.

## 📊 Create Your First Dashboard

1. In Grafana, go to **Dashboards** → **New Dashboard**
2. Add Panel → **Logs**
3. Query: `{service=~"python-scheduler|backend"}`
4. Save Dashboard

### Recommended Panels

**Panel 1: Log Volume**
- Type: Graph
- Query: `sum by (service) (rate({job="docker"}[1m]))`

**Panel 2: Error Rate**
- Type: Graph
- Query: `sum by (service) (rate({level="ERROR"}[5m]))`

**Panel 3: Recent Errors**
- Type: Logs
- Query: `{level="ERROR"}`

**Panel 4: Service Health**
- Type: Stat
- Query: Use Prometheus or HTTP endpoint

## 🔧 Troubleshooting

### No Logs in Loki?

```bash
# 1. Check Promtail is running
docker logs promtail

# 2. Check container labels
docker inspect python-scheduler | grep -A5 Labels
# Should see: "logging": "promtail"

# 3. Test Loki API
curl -G -s "http://localhost:3100/loki/api/v1/query_range" \
  --data-urlencode 'query={service="python-scheduler"}' \
  --data-urlencode 'limit=5' | jq
```

### Logs Not JSON?

```bash
# Check environment variables
docker exec python-scheduler env | grep LOG_FORMAT
docker exec backend env | grep LOG_FORMAT

# Should show: LOG_FORMAT=json
```

### Grafana Can't Connect to Loki?

```bash
# 1. Check Loki is accessible
curl http://localhost:3100/ready

# 2. Check Grafana datasource config
docker exec grafana cat /etc/grafana/provisioning/datasources/loki.yml

# 3. Restart Grafana
docker-compose restart grafana
```

## ✅ Verification Checklist

- [ ] Loki is running (`docker ps | grep loki`)
- [ ] Promtail is running (`docker ps | grep promtail`)
- [ ] Python Scheduler outputs JSON logs
- [ ] Backend outputs JSON logs
- [ ] Logs visible in Grafana Explore
- [ ] Can filter by service
- [ ] Can filter by level
- [ ] Health checks return 200

## 🎓 Next Steps

1. **Read Full Documentation**: `CROSS_SERVICE_LOGGING.md`
2. **Create Dashboards**: Build monitoring dashboards
3. **Set Up Alerts**: Alert on error rates
4. **Train Team**: Share logging best practices

## 📚 Quick Reference

### Log Levels
- `DEBUG` - Detailed diagnostic info
- `INFO` - General informational messages
- `WARNING` - Warning messages
- `ERROR` - Error messages
- `CRITICAL` - Critical errors

### Environment Variables
```bash
# All services
LOG_FORMAT=json        # or 'human' for development
LOG_LEVEL=INFO         # DEBUG, INFO, WARNING, ERROR, CRITICAL

# Frontend specific
REACT_APP_LOG_LEVEL=INFO
REACT_APP_SEND_LOGS_TO_BACKEND=false
```

### Health Check Endpoints
```bash
# Python Scheduler
curl http://localhost:8000/health | jq

# Backend
curl http://localhost:5000/health | jq
```

### Useful LogQL Patterns
```logql
# All logs
{job="docker"}

# Specific service
{service="python-scheduler"}

# Errors only
{level="ERROR"}

# Text search
{service="backend"} |= "miner"

# JSON field filter
{service="backend"} | json | miner_id="miner-01"

# Rate calculation
rate({level="ERROR"}[5m])

# Aggregation
sum by (service) (rate({job="docker"}[1m]))
```

## 🎉 Success!

You now have:
- ✅ Structured logging across all services
- ✅ Centralized log aggregation with Loki
- ✅ Log visualization in Grafana
- ✅ Ability to search and correlate logs
- ✅ Smart health checks on all services

**Time to Complete**: ~5 minutes  
**Services Configured**: 3 (python-scheduler, backend, frontend)  
**Log Format**: Unified JSON  
**Aggregation**: Loki + Promtail  
**Visualization**: Grafana  

Happy logging! 🚀
