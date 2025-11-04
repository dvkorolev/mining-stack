# Production Setup Guide

## Prerequisites

- Raspberry Pi 4 (4GB+ RAM recommended)
- Raspberry Pi OS (64-bit)
- Docker and Docker Compose installed
- Git installed
- Network access to miners

## Quick Start

### 1. Clone Repository

```bash
cd /opt
sudo git clone https://github.com/dvkorolev/mining-stack.git
cd mining-stack
```

### 2. Configure Environment

```bash
# Copy environment template
cp .env.example .env

# Edit configuration
nano .env
```

**Required settings:**
- `GITHUB_REPOSITORY` - Your GitHub repository
- `GF_SECURITY_ADMIN_PASSWORD` - Change default Grafana password

### 3. Configure Miners

Edit `etc/miners.yaml` with your miner details:

```yaml
miners:
  - ip: 192.168.1.40
    model: M30S++ VH90 (Stock)
    alias: EN-M30SppVH90-040
    owner: EN
    status: active
    thresholds:
      hashrate:
        expected: 106.1
      power:
        expected: 3408.0
```

**Fields:**
- `ip` - Miner IP address (required)
- `model` - Miner model name (required)
- `alias` - Display name (optional)
- `owner` - Owner identifier (optional)
- `status` - `active` or `inactive` (optional)
- `thresholds` - Per-miner alert thresholds (optional)

### 4. Deploy

```bash
# Make scripts executable
chmod +x *.sh

# Deploy from registry
./deploy-from-registry.sh
```

## Post-Deployment

### Access Services

- **Dashboard**: http://raspberrypi:3000
- **Grafana**: http://raspberrypi:3001 (admin/mining123)
- **Prometheus**: http://raspberrypi:9090
- **Backend API**: http://raspberrypi:5000

### Health Check

```bash
./health-check.sh
```

Expected output:
- ✓ All containers running
- ✓ Python Scheduler healthy
- ✓ Metrics being collected
- ✓ Miners showing online

### View Logs

```bash
# All services
docker compose -f docker-compose.prod.yml logs -f

# Specific service
docker logs -f mining-stack-backend-1
docker logs -f mining-stack-python-scheduler-1
```

## Updating

### Update from Registry

```bash
cd /opt/mining-stack
./update-from-registry.sh
```

This will:
1. Pull latest code from GitHub
2. Pull latest Docker images
3. Restart services
4. Preserve your configuration

### Manual Update

```bash
# Pull latest code
git pull

# Pull latest images
docker compose -f docker-compose.prod.yml pull

# Restart services
docker compose -f docker-compose.prod.yml up -d
```

## Configuration Management

### Adding Miners

1. Edit `etc/miners.yaml`
2. Add new miner entry
3. Restart backend:
   ```bash
   docker compose -f docker-compose.prod.yml restart backend
   ```

### Removing Miners

1. Edit `etc/miners.yaml`
2. Remove miner entry
3. Restart backend

### Updating Thresholds

Edit `etc/miners.yaml` or `.env` for global thresholds:

```bash
# Global thresholds in .env
THRESHOLD_TEMP_WARNING=75
THRESHOLD_TEMP_CRITICAL=85
THRESHOLD_TEMP_SHUTDOWN=90
```

Per-miner thresholds in `miners.yaml`:

```yaml
thresholds:
  temperature:
    warning: 70
    critical: 80
  hashrate:
    expected: 100.0
    warningPercent: 20
```

## Telegram Bot Setup (Optional)

1. Create bot with @BotFather
2. Get bot token
3. Add bot to your group
4. Get chat ID
5. Configure via Web UI:
   - Go to http://raspberrypi:3000/settings
   - Enter bot token and chat ID
   - Click "Test Connection"

## Monitoring

### Metrics Collection

Metrics are collected every 2 minutes by default.

**Check collection status:**
```bash
curl http://localhost:8000/status | jq
```

**Manually trigger collection:**
```bash
curl -X POST http://localhost:8000/collect
```

### Prometheus Queries

Access Prometheus at http://raspberrypi:9090

**Useful queries:**
- `miner_hashrate_ths` - Current hashrate
- `miner_temp_max_c` - Maximum temperature
- `miner_power_watts` - Power consumption
- `miner_scrape_success` - Miner online status

### Grafana Dashboards

1. Login to Grafana (http://raspberrypi:3001)
2. Default credentials: admin/mining123
3. Navigate to Dashboards
4. Pre-configured dashboard shows:
   - Total hashrate
   - Individual miner stats
   - Temperature trends
   - Power consumption
   - Alerts

## Troubleshooting

### Miners Show Offline

1. Check metrics collection:
   ```bash
   docker logs mining-stack-python-scheduler-1 --tail 50
   ```

2. Verify metrics files:
   ```bash
   docker exec mining-stack-python-scheduler-1 ls -lh /metrics/
   ```

3. Check Prometheus:
   ```bash
   curl 'http://localhost:9090/api/v1/query?query=miner_scrape_success'
   ```

### High Temperature Alerts

Miners showing as "error" with high temp is **correct behavior**.

**Solutions:**
- Improve cooling
- Adjust global thresholds in `.env`
- Set per-miner thresholds in `miners.yaml`

### Services Not Starting

```bash
# Check container status
docker compose -f docker-compose.prod.yml ps

# Check logs
docker compose -f docker-compose.prod.yml logs

# Restart all services
docker compose -f docker-compose.prod.yml restart
```

### Metrics Not Updating

```bash
# Restart python-scheduler
docker compose -f docker-compose.prod.yml restart python-scheduler

# Check scheduler logs
docker logs mining-stack-python-scheduler-1 --tail 100
```

## Backup and Restore

### Backup Configuration

```bash
# Backup miners config
cp etc/miners.yaml etc/miners.yaml.backup

# Backup environment
cp .env .env.backup

# Backup Grafana data
docker compose -f docker-compose.prod.yml exec grafana tar czf /tmp/grafana-backup.tar.gz /var/lib/grafana
docker cp mining-stack-grafana-1:/tmp/grafana-backup.tar.gz ./grafana-backup.tar.gz
```

### Restore Configuration

```bash
# Restore miners config
cp etc/miners.yaml.backup etc/miners.yaml

# Restart services
docker compose -f docker-compose.prod.yml restart
```

## Security Best Practices

1. **Change default passwords**
   - Grafana: Edit `GF_SECURITY_ADMIN_PASSWORD` in `.env`

2. **Restrict network access**
   - Use firewall to limit access to dashboard
   - Consider VPN for remote access

3. **Keep system updated**
   ```bash
   sudo apt update && sudo apt upgrade -y
   ```

4. **Regular backups**
   - Backup `etc/miners.yaml` regularly
   - Backup `.env` file (contains secrets)

5. **Monitor logs**
   ```bash
   docker compose -f docker-compose.prod.yml logs --tail 100
   ```

## Performance Tuning

### For 22+ Miners

Current configuration is optimized for your setup:
- Collection interval: 2 minutes
- Concurrent requests: 100
- Timeout: 30 seconds

### Resource Limits

Docker Compose sets resource limits:
- Backend: 512MB RAM, 0.5 CPU
- Frontend: 256MB RAM, 0.3 CPU
- Python Scheduler: 256MB RAM, 0.3 CPU

Adjust in `docker-compose.prod.yml` if needed.

## Support

- Documentation: `/opt/mining-stack/docs/`
- Health Check: `./health-check.sh`
- Logs: `docker compose -f docker-compose.prod.yml logs`
