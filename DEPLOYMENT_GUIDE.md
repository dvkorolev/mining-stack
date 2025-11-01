# Deployment Guide - Python Scheduler Service

## Overview

The new Python Scheduler Service replaces host-based cron jobs with a containerized microservice.

## Architecture Changes

### Before (Host-based)
```
Host System
├─ Python venv
├─ Cron jobs
└─ Writes to /var/lib/node_exporter/textfile/
```

### After (Containerized)
```
Docker Container: python-scheduler
├─ Python 3.11
├─ FastAPI scheduler
├─ Writes to shared volume
└─ Provides REST API
```

## Deployment Steps

### 1. Pull Latest Code

```bash
cd /opt/mining-stack
git pull origin main
```

### 2. Build Python Scheduler

```bash
docker compose -f docker-compose.prod.yml build python-scheduler
```

### 3. Start All Services

```bash
docker compose -f docker-compose.prod.yml up -d
```

### 4. Verify Services

```bash
# Check all containers running
docker compose -f docker-compose.prod.yml ps

# Should see:
# - python-scheduler (port 8000)
# - backend (port 5000)
# - frontend (port 3000)
# - prometheus (port 9090)
# - node-exporter (port 9100)
# - grafana (port 3001)
# - alertmanager (port 9093)
```

### 5. Test Python Scheduler

```bash
# Health check
curl http://localhost:8000/health

# Check status
curl http://localhost:8000/status

# Trigger collection manually
curl -X POST http://localhost:8000/collect

# View logs
docker logs python-scheduler -f
```

### 6. Test Autodiscover (Web UI)

1. Open web UI: http://raspberrypi:3000
2. Go to Miners page
3. Click "Auto Discover" button
4. Should trigger discovery via Python Scheduler
5. New miners appear in list

### 7. Verify Metrics Collection

```bash
# Check metrics are being written
docker exec python-scheduler ls -la /metrics

# Should see .prom files:
# - pyasic_metrics.prom
# - universal_metrics.prom

# Check Node Exporter can read them
curl http://localhost:9100/metrics | grep miner_

# Should see miner metrics
```

## Migration from Host Cron

If you were using host-based cron jobs:

### 1. Disable Old Cron Jobs

```bash
# Edit crontab
crontab -e

# Comment out or remove mining-stack lines:
# */2 * * * * /opt/mining-stack/bin/collect_all_metrics.sh

# Save and exit
```

### 2. Remove Old Textfile Directory (Optional)

```bash
# Backup first
sudo cp -r /var/lib/node_exporter/textfile /var/lib/node_exporter/textfile.backup

# Remove (metrics now in Docker volume)
sudo rm -rf /var/lib/node_exporter/textfile
```

### 3. Verify New System Works

```bash
# Wait 2 minutes for first collection
sleep 120

# Check Prometheus has data
curl 'http://localhost:9090/api/v1/query?query=miner_hashrate_current'

# Should return miner data
```

## Configuration

### Environment Variables

Edit `docker-compose.prod.yml`:

```yaml
python-scheduler:
  environment:
    - COLLECTION_INTERVAL=2  # Change collection interval (minutes)
    - METRICS_DIR=/metrics
    - MINERS_CONFIG=/app/etc/miners.yaml
```

### Restart After Changes

```bash
docker compose -f docker-compose.prod.yml restart python-scheduler
```

## Monitoring

### View Logs

```bash
# Python Scheduler
docker logs python-scheduler -f

# Expected output every 2 minutes:
# [INFO] Starting metrics collection
# [INFO] ✓ pyasic_collector completed in 4.2s
# [INFO] ✓ universal_collector completed in 2.8s
# [INFO] Collection complete: 2/2 successful
```

### Check Scheduler Status

```bash
curl http://localhost:8000/status
```

Response:
```json
{
  "last_collection": {
    "timestamp": "2025-11-01T18:30:00",
    "success": true,
    "message": "2/2 collectors successful"
  },
  "next_run": "2025-11-01T18:32:00",
  "collection_interval": 2
}
```

## Troubleshooting

### Python Scheduler Won't Start

```bash
# Check logs
docker logs python-scheduler

# Common issues:
# - Port 8000 already in use
# - Volume mount permissions
# - Missing bin/ scripts
```

### Metrics Not Appearing

```bash
# Check metrics directory
docker exec python-scheduler ls -la /metrics

# Check Node Exporter volume
docker exec node-exporter ls -la /textfile

# Verify volume is shared
docker volume inspect mining-stack_metrics-data
```

### Autodiscover Not Working

```bash
# Test API directly
curl -X POST http://localhost:8000/discover

# Check backend can reach scheduler
docker exec mining-stack-backend-1 curl http://python-scheduler:8000/health

# View backend logs
docker logs mining-stack-backend-1 | grep discover
```

### Scripts Failing

```bash
# Run script manually
docker exec python-scheduler python3 /app/bin/pyasic_textfile.py

# Check script permissions
docker exec python-scheduler ls -la /app/bin

# Verify pyasic installed
docker exec python-scheduler pip list | grep pyasic
```

## Rollback

If you need to rollback to host-based cron:

```bash
# Stop Python Scheduler
docker compose -f docker-compose.prod.yml stop python-scheduler

# Re-enable host cron
crontab -e
# Uncomment: */2 * * * * /opt/mining-stack/bin/collect_all_metrics.sh

# Update node-exporter volume in docker-compose.prod.yml
# Change: - metrics-data:/textfile:ro
# To:     - /var/lib/node_exporter/textfile:/textfile:ro

# Restart node-exporter
docker compose -f docker-compose.prod.yml restart node-exporter
```

## Benefits Summary

### Before (Host Cron)
- ❌ Requires Python venv on host
- ❌ Manual cron setup
- ❌ No API for triggers
- ❌ Not containerized

### After (Python Scheduler)
- ✅ Fully containerized
- ✅ REST API for control
- ✅ Automatic scheduling
- ✅ Clean architecture
- ✅ Easy to monitor
- ✅ Scalable

## Next Steps

1. **Monitor for 24 hours** - Ensure metrics collection is stable
2. **Test autodiscover** - Verify discovery works via web UI
3. **Remove host cron** - Once confident new system works
4. **Update documentation** - Note new architecture in your docs

## Support

If issues persist:

1. Check all logs: `docker compose -f docker-compose.prod.yml logs`
2. Verify volumes: `docker volume ls`
3. Test API: `curl http://localhost:8000/status`
4. Review ARCHITECTURE.md for design details

## Summary

The Python Scheduler Service provides:
- ✅ Clean separation of concerns
- ✅ Containerized Python operations
- ✅ REST API for control
- ✅ Automatic metric collection
- ✅ On-demand miner discovery
- ✅ Proper logging and monitoring

**Deployment time:** ~5 minutes  
**Downtime:** None (rolling update)  
**Rollback:** Easy (stop container, re-enable cron)
