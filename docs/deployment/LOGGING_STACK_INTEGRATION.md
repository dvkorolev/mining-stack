# Logging Stack Integration

## Overview

The update script now automatically starts and monitors the complete logging stack (Loki + Promtail) alongside all other services.

## What Changed

### 1. Update Script (`update-from-registry.sh`)

**Image Pulling:**
```bash
# Now pulls both production and logging images
docker compose -f docker-compose.prod.yml pull
docker compose -f docker-compose.logging.yml pull
```

**Container Management:**
```bash
# Stops all containers including logging stack
docker compose -f docker-compose.prod.yml -f docker-compose.logging.yml down --rmi local

# Starts all containers including logging stack
docker compose -f docker-compose.prod.yml -f docker-compose.logging.yml up -d

# Shows status of all containers
docker compose -f docker-compose.prod.yml -f docker-compose.logging.yml ps
```

**Service URLs Displayed:**
- Dashboard: http://[IP]:3000
- Grafana: http://[IP]:3001
- Loki Logs: http://[IP]:3100

### 2. Health Check Script (`health-check.sh`)

**New Checks Added:**

#### Loki (Log Aggregation) - Step 11/12
- ✅ Ready endpoint check (`/ready`)
- ✅ API endpoint check (`/loki/api/v1/labels`)
- ✅ Label count (indicates logs are being collected)
- ✅ Port 3100 listening check

#### Promtail (Log Collector) - Step 12/12
- ✅ Container running check
- ✅ Metrics endpoint check (`/metrics`)
- ✅ Port 9080 listening check

**Updated Service List:**
Now monitors 9 services (was 6):
1. python-scheduler
2. backend
3. frontend
4. prometheus
5. grafana
6. blackbox-exporter
7. alertmanager
8. **loki** (new)
9. **promtail** (new)

**Updated Port Checks:**
Added monitoring for:
- Port 3100 (Loki)
- Port 9115 (Blackbox Exporter)
- Port 9093 (Alertmanager)

**Updated Service URLs Output:**
```
Dashboard:    http://[IP]:3000
API:          http://[IP]:5000
Prometheus:   http://[IP]:9090
Grafana:      http://[IP]:3001 (admin/<GF_SECURITY_ADMIN_PASSWORD>)
Loki:         http://[IP]:3100
Alertmanager: http://[IP]:9093
```

## Architecture

### Logging Flow

```
Application Containers
  ├── python-scheduler (JSON logs)
  ├── backend (JSON logs)
  └── frontend (JSON logs)
         ↓
    Docker Socket
         ↓
     Promtail (collects logs)
         ↓
      Loki (stores logs)
         ↓
     Grafana (visualizes logs)
```

### Log Collection

Promtail automatically collects logs from containers with the label:
```yaml
labels:
  logging: "promtail"
```

All application containers in `docker-compose.logging.yml` have this label.

## Benefits

### 1. Centralized Logging
- All container logs in one place
- Queryable through Loki API
- Visualizable in Grafana

### 2. Structured Logs
- JSON format for easy parsing
- Automatic field extraction
- Rich metadata (service, level, timestamp)

### 3. Log Retention
- Configurable retention policies
- Compressed storage
- Efficient querying

### 4. Integration with Grafana
- Pre-configured Loki data source
- Log exploration UI
- Correlation with metrics

## Usage

### Starting All Services

```bash
cd /opt/mining-stack
./update-from-registry.sh
```

This will:
1. Pull latest images (including Loki/Promtail)
2. Stop old containers
3. Start all services including logging stack
4. Run health checks on all 9 services

### Viewing Logs

**Via Docker Compose:**
```bash
# All services
docker compose -f docker-compose.prod.yml -f docker-compose.logging.yml logs -f

# Specific service
docker compose -f docker-compose.prod.yml -f docker-compose.logging.yml logs -f backend

# Logging stack only
docker compose -f docker-compose.logging.yml logs -f
```

**Via Loki API:**
```bash
# Query logs from backend service
curl -G -s "http://localhost:3100/loki/api/v1/query_range" \
  --data-urlencode 'query={compose_service="backend"}' \
  | jq .

# Query error logs
curl -G -s "http://localhost:3100/loki/api/v1/query_range" \
  --data-urlencode 'query={level="error"}' \
  | jq .
```

**Via Grafana:**
1. Open http://[IP]:3001
2. Login: admin/<GF_SECURITY_ADMIN_PASSWORD>
3. Go to Explore
4. Select Loki data source
5. Use LogQL queries

### Health Check

```bash
cd /opt/mining-stack
./health-check.sh
```

Output includes:
- Loki ready status
- Loki API status
- Number of labels (log sources)
- Promtail container status
- Promtail metrics endpoint status

## Configuration Files

### Loki Configuration
Location: `docker/loki/loki-config.yaml`
- Retention period
- Storage settings
- API configuration

### Promtail Configuration
Location: `docker/promtail/promtail-config.yml`
- Docker socket connection
- Label extraction rules
- Log parsing pipeline
- JSON field extraction

### Grafana Data Source
Location: `docker/grafana/provisioning/datasources/loki.yml`
- Auto-provisioned Loki connection
- Default data source settings

## Troubleshooting

### Loki Not Ready
```bash
# Check Loki logs
docker compose -f docker-compose.logging.yml logs loki

# Restart Loki
docker compose -f docker-compose.logging.yml restart loki
```

### Promtail Not Collecting Logs
```bash
# Check Promtail logs
docker compose -f docker-compose.logging.yml logs promtail

# Verify Docker socket access
docker compose -f docker-compose.logging.yml exec promtail ls -la /var/run/docker.sock

# Check container labels
docker inspect [container_name] | jq '.[0].Config.Labels'
```

### No Logs in Loki
```bash
# Check if labels exist
curl -s http://localhost:3100/loki/api/v1/labels | jq .

# Check Promtail targets
curl -s http://localhost:9080/targets | jq .

# Verify containers have logging label
docker compose -f docker-compose.logging.yml config | grep -A2 "labels:"
```

## Performance Impact

### Resource Usage
- **Loki**: ~100-200MB RAM, minimal CPU
- **Promtail**: ~50-100MB RAM, minimal CPU
- **Storage**: ~1-5GB per week (depends on log volume)

### Network Impact
- Minimal: logs sent over Docker network
- No external traffic required

## Future Enhancements

Potential additions:
- [ ] Log alerting rules in Loki
- [ ] Log-based metrics
- [ ] Long-term log archival to S3
- [ ] Log sampling for high-volume services
- [ ] Custom Grafana dashboards for logs
