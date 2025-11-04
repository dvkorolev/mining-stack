# Logging Stack Troubleshooting Guide

## Issue: No Logs Visible in Grafana

### Quick Diagnosis

```bash
# 1. Check if Loki is running
curl http://192.168.1.66:3100/ready

# 2. Check if Loki has any labels (means logs are being received)
curl http://192.168.1.66:3100/loki/api/v1/labels

# 3. Check Promtail status
curl http://192.168.1.66:9080/metrics | grep promtail

# 4. Check container labels
docker inspect mining-stack-backend-1 | grep -A5 Labels
```

### Common Problems and Solutions

#### Problem 1: Docker Compose Override Error

**Error:**
```
service "python-scheduler" has neither an image nor a build context specified: invalid compose project
```

**Cause:** The `docker-compose.logging.yml` file was overriding the `networks` section from `docker-compose.prod.yml`, which caused services to lose their base configuration.

**Solution:** Removed the `networks` section from `docker-compose.logging.yml` (already fixed in this commit).

#### Problem 2: Containers Missing Logging Labels

**Symptom:** Promtail isn't collecting logs from containers.

**Check:**
```bash
# Check if containers have the logging label
docker inspect backend | grep -A10 Labels | grep logging
docker inspect python-scheduler | grep -A10 Labels | grep logging
docker inspect frontend | grep -A10 Labels | grep logging
```

**Solution:** The labels are defined in `docker-compose.logging.yml` but only apply when using both compose files together.

#### Problem 3: Loki Not Receiving Logs

**Check Loki logs:**
```bash
docker logs loki
```

**Check Promtail logs:**
```bash
docker logs promtail
```

**Common issues:**
- Promtail can't reach Loki (network issue)
- Promtail can't read Docker socket (permission issue)
- No containers match the label filter

#### Problem 4: Grafana Can't Connect to Loki

**Check from inside Grafana container:**
```bash
docker exec grafana wget -O- http://loki:3100/ready
```

**If it fails:**
- Loki isn't running
- Network connectivity issue
- Loki isn't healthy yet

### Step-by-Step Fix

#### Quick Fix (Recommended)

Use the existing update script which handles everything:

```bash
cd /opt/mining-stack
./update-from-registry.sh
```

This will:
1. Pull latest configuration from GitHub
2. Pull latest Docker images
3. Restart all services including logging stack
4. Run health checks automatically

#### Manual Fix (If Needed)

If you need to fix without updating:

```bash
cd /opt/mining-stack

# Stop everything
docker compose -f docker-compose.prod.yml -f docker-compose.logging.yml down

# Start with logging stack
docker compose -f docker-compose.prod.yml -f docker-compose.logging.yml up -d

# Run health check
./health-check.sh
```

#### Step 4: Verify Loki
```bash
# Check Loki is ready
curl http://localhost:3100/ready

# Check Loki API
curl http://localhost:3100/loki/api/v1/labels
```

#### Step 5: Verify Promtail
```bash
# Check Promtail is running
docker ps | grep promtail

# Check Promtail logs
docker logs promtail --tail 50

# Check Promtail metrics
curl http://localhost:9080/metrics | grep promtail_targets_active_total
```

#### Step 6: Verify Container Labels
```bash
# Check backend has logging label
docker inspect backend | grep -A5 '"logging"'

# Should show: "logging": "promtail"
```

#### Step 7: Access Grafana
```bash
# Open in browser
http://192.168.1.66:3001

# Login: admin / mining123
```

#### Step 8: Configure Loki in Grafana

1. Go to **Configuration** → **Data Sources**
2. Click **Add data source**
3. Select **Loki**
4. Set URL: `http://loki:3100`
5. Click **Save & Test**

Or check if it's already provisioned:
1. Go to **Configuration** → **Data Sources**
2. Look for **Loki** in the list
3. Click on it and verify URL is `http://loki:3100`
4. Click **Save & Test**

#### Step 9: View Logs in Grafana

1. Go to **Explore** (compass icon in left sidebar)
2. Select **Loki** as data source (top dropdown)
3. Use Log browser or enter query:
   ```
   {container_name="backend"}
   ```
4. Click **Run query**

### Useful LogQL Queries

```logql
# All logs from backend
{container_name="backend"}

# All logs from python-scheduler
{container_name="python-scheduler"}

# All logs from frontend
{container_name="frontend"}

# Error logs only
{container_name="backend"} |= "error"

# JSON logs with specific level
{container_name="backend"} | json | level="error"

# Logs from all mining-stack services
{compose_service=~"backend|frontend|python-scheduler"}

# Logs in last 5 minutes
{container_name="backend"} [5m]
```

### Grafana Dashboard for Logs

Create a new dashboard with these panels:

#### Panel 1: Log Volume
- **Query:** `sum(count_over_time({compose_service=~"backend|frontend|python-scheduler"}[1m]))`
- **Visualization:** Graph
- **Title:** "Log Volume (logs/min)"

#### Panel 2: Error Rate
- **Query:** `sum(count_over_time({compose_service=~"backend|frontend|python-scheduler"} |= "error" [1m]))`
- **Visualization:** Graph
- **Title:** "Error Rate"

#### Panel 3: Recent Logs
- **Query:** `{compose_service=~"backend|frontend|python-scheduler"}`
- **Visualization:** Logs
- **Title:** "Recent Logs"

### Verification Checklist

- [ ] Loki container is running: `docker ps | grep loki`
- [ ] Promtail container is running: `docker ps | grep promtail`
- [ ] Loki is ready: `curl http://localhost:3100/ready`
- [ ] Loki has labels: `curl http://localhost:3100/loki/api/v1/labels`
- [ ] Containers have logging labels: `docker inspect backend | grep logging`
- [ ] Promtail is collecting: `docker logs promtail | grep "Starting Promtail"`
- [ ] Grafana can reach Loki: `docker exec grafana wget -O- http://loki:3100/ready`
- [ ] Loki datasource configured in Grafana
- [ ] Logs visible in Grafana Explore

### Advanced Debugging

#### Check Promtail Targets
```bash
curl http://localhost:9080/targets
```

This shows which containers Promtail is monitoring.

#### Check Loki Ingester
```bash
curl http://localhost:3100/loki/api/v1/label/container_name/values
```

This shows which containers have sent logs to Loki.

#### Test Log Injection
```bash
# Generate a test log
docker exec backend echo "TEST LOG FROM BACKEND"

# Check if it appears in Loki
curl -G -s "http://localhost:3100/loki/api/v1/query" \
  --data-urlencode 'query={container_name="backend"}' \
  --data-urlencode 'limit=10' | jq
```

#### Check Promtail Configuration
```bash
docker exec promtail cat /etc/promtail/config.yml
```

### Network Diagram

```
┌─────────────┐
│   Grafana   │ :3001
│ (UI/Query)  │
└──────┬──────┘
       │ http://loki:3100
       ▼
┌─────────────┐
│    Loki     │ :3100
│ (Storage)   │
└──────▲──────┘
       │ http://loki:3100/loki/api/v1/push
       │
┌──────┴──────┐
│  Promtail   │ :9080
│ (Collector) │
└──────▲──────┘
       │ /var/run/docker.sock
       │
┌──────┴──────────────────────┐
│  Docker Containers          │
│  - backend (label: logging) │
│  - frontend (label: logging)│
│  - python-scheduler         │
└─────────────────────────────┘
```

### Configuration Files

#### Loki Config
Location: `./docker/loki/loki-config.yaml`
- Port: 3100
- Storage: `/loki` (volume)
- Retention: 7 days (configurable)

#### Promtail Config
Location: `./docker/promtail/promtail-config.yml`
- Port: 9080
- Filters: `logging=promtail` label
- Parses: JSON logs automatically

#### Grafana Datasource
Location: `./docker/grafana/provisioning/datasources/loki.yml`
- Auto-provisioned on startup
- URL: `http://loki:3100`

### Performance Tuning

If Raspberry Pi is slow:

1. **Reduce log retention:**
   Edit `docker/loki/loki-config.yaml`:
   ```yaml
   limits_config:
     retention_period: 168h  # 7 days → 3 days
   ```

2. **Reduce Promtail scrape frequency:**
   Edit `docker/promtail/promtail-config.yml`:
   ```yaml
   docker_sd_configs:
     - refresh_interval: 10s  # 5s → 10s
   ```

3. **Limit log volume:**
   In `docker-compose.logging.yml`, add to each service:
   ```yaml
   logging:
     driver: "json-file"
     options:
       max-size: "5m"
       max-file: "2"
   ```

### Getting Help

If logs still don't appear:

1. **Collect diagnostics:**
   ```bash
   ./health-check.sh > health-check-output.txt
   docker logs loki > loki.log
   docker logs promtail > promtail.log
   docker logs grafana > grafana.log
   ```

2. **Check Loki status:**
   ```bash
   curl http://localhost:3100/metrics | grep loki_ingester_streams_created_total
   ```

3. **Verify JSON logging:**
   ```bash
   docker logs backend --tail 10
   # Should see JSON format like: {"timestamp":"...","level":"info",...}
   ```

## Quick Commands

### Update Everything (Recommended)
```bash
cd /opt/mining-stack
./update-from-registry.sh
```

### Run Health Check
```bash
cd /opt/mining-stack
./health-check.sh
```

The health check script already includes:
- Loki ready check
- Loki API check
- Promtail metrics check
- Container status verification
- Service URLs and troubleshooting commands

### Restart Only Logging Stack
```bash
cd /opt/mining-stack
docker compose -f docker-compose.prod.yml -f docker-compose.logging.yml restart loki promtail
```

### View Logs
```bash
# Loki logs
docker logs loki --tail 50

# Promtail logs
docker logs promtail --tail 50

# All services
docker compose -f docker-compose.prod.yml -f docker-compose.logging.yml logs --tail 50
```
