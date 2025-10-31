# Health Check Guide

Comprehensive health monitoring for your Mining Stack deployment.

---

## 🏥 Quick Start

```bash
# On Raspberry Pi
cd /opt/mining-stack
./health-check.sh
```

---

## 📊 What It Checks

### 1. **Docker Environment** ✓
- Docker installation & version
- Docker Compose installation & version

### 2. **Project Structure** ✓
- Project directory exists
- docker-compose.prod.yml present

### 3. **Container Status** ✓
- Backend (API server)
- Frontend (Dashboard)
- Prometheus (Metrics)
- Grafana (Visualization)
- Node Exporter (System metrics)

### 4. **Network Connectivity** ✓
- Port 3000 (Frontend)
- Port 5000 (Backend API)
- Port 9090 (Prometheus)
- Port 3001 (Grafana)
- Port 9100 (Node Exporter)

### 5. **Backend API Health** ✓
- `/health` endpoint
- `/api/mining/stats` endpoint
- Total hashrate
- Active miners count

### 6. **WebSocket Connection** ✓
- WebSocket port accessibility
- Real-time communication

### 7. **Frontend Accessibility** ✓
- HTTP response
- React application serving

### 8. **Prometheus Monitoring** ✓
- Health endpoint
- API responding
- Active targets count

### 9. **Grafana Dashboard** ✓
- Health check
- Database connection
- Login page accessible

### 10. **Configuration Files** ✓
- `.env` file
- `etc/miners.yaml`
- Logs directory

---

## 📋 Output Example

```bash
╔════════════════════════════════════════╗
║   Mining Stack Health Check           ║
╔════════════════════════════════════════╗

[1/10] Checking Docker...
✓ Docker installed (version 24.0.7)
✓ Docker Compose installed (version 2.23.0)

[2/10] Checking project directory...
✓ Project directory exists: /opt/mining-stack
✓ docker-compose.prod.yml found

[3/10] Checking Docker containers...
✓ backend is running (12 seconds)
✓ frontend is running (10 seconds)
✓ prometheus is running (12 seconds)
✓ grafana is running (10 seconds)
✓ node-exporter is running (12 seconds)

[4/10] Checking network connectivity...
ℹ Host IP: 192.168.1.66
✓ Frontend port 3000 is listening
✓ Backend port 5000 is listening
✓ Prometheus port 9090 is listening
✓ Grafana port 3001 is listening
✓ Node-Exporter port 9100 is listening

[5/10] Checking Backend API health...
✓ Backend health endpoint responding
✓ Backend API /mining/stats responding
ℹ Total Hashrate: 250.5 TH/s
ℹ Active Miners: 3

[6/10] Checking WebSocket connection...
✓ WebSocket port accessible

[7/10] Checking Frontend...
✓ Frontend is accessible
✓ Frontend serving React application

[8/10] Checking Prometheus...
✓ Prometheus health check passed
✓ Prometheus API responding
ℹ Prometheus monitoring 2 targets

[9/10] Checking Grafana...
✓ Grafana health check passed
✓ Grafana login page accessible

[10/10] Checking configuration...
✓ .env file exists
ℹ Repository: dvkorolev/mining-stack
✓ Miners configuration file exists
ℹ Configured miners: 3
✓ Logs directory exists (size: 2.1M)

╔════════════════════════════════════════╗
║   Health Check Summary                ║
╚════════════════════════════════════════╝

Passed:   25
Warnings: 0
Failed:   0

Service URLs:
  Dashboard:  http://192.168.1.66:3000
  API:        http://192.168.1.66:5000
  Prometheus: http://192.168.1.66:9090
  Grafana:    http://192.168.1.66:3001 (admin/mining123)

✓ All checks passed!
  Your mining stack is healthy and ready to use
```

---

## 🎨 Status Indicators

| Symbol | Meaning | Color |
|--------|---------|-------|
| ✓ | Check passed | Green |
| ✗ | Check failed | Red |
| ⚠ | Warning | Yellow |
| ℹ | Information | Blue |

---

## 🔧 Usage

### Basic Usage

```bash
./health-check.sh
```

### Custom Path

```bash
./health-check.sh /custom/path/to/mining-stack
```

### After Deployment

Health check runs automatically after:
- `deploy-from-registry.sh`
- `update-from-registry.sh`

### Manual Check

```bash
ssh admin@raspberrypi.local
cd /opt/mining-stack
./health-check.sh
```

### Scheduled Checks

Add to crontab for regular monitoring:

```bash
crontab -e

# Check health every hour
0 * * * * cd /opt/mining-stack && ./health-check.sh >> /var/log/mining-health.log 2>&1
```

---

## 🚨 Exit Codes

| Code | Status | Description |
|------|--------|-------------|
| 0 | Success | All checks passed or only warnings |
| 1 | Failure | One or more critical checks failed |

### Use in Scripts

```bash
#!/bin/bash
if ./health-check.sh; then
    echo "System healthy, proceeding..."
else
    echo "System unhealthy, aborting!"
    exit 1
fi
```

---

## 🛠️ Troubleshooting

### All Services Down

**Symptoms:**
```
✗ backend is not running
✗ frontend is not running
```

**Solution:**
```bash
cd /opt/mining-stack
docker compose -f docker-compose.prod.yml up -d
```

### Backend API Not Responding

**Symptoms:**
```
✗ Backend health endpoint not responding
```

**Solutions:**
1. Check backend logs:
   ```bash
   docker compose -f docker-compose.prod.yml logs backend
   ```

2. Restart backend:
   ```bash
   docker compose -f docker-compose.prod.yml restart backend
   ```

3. Check configuration:
   ```bash
   cat etc/miners.yaml
   ```

### Port Not Listening

**Symptoms:**
```
✗ Backend port 5000 is not listening
```

**Solutions:**
1. Check if container is running:
   ```bash
   docker compose -f docker-compose.prod.yml ps
   ```

2. Check port conflicts:
   ```bash
   sudo netstat -tulpn | grep 5000
   ```

3. Restart services:
   ```bash
   docker compose -f docker-compose.prod.yml restart
   ```

### WebSocket Issues

**Symptoms:**
```
⚠ WebSocket port check inconclusive
```

**Solutions:**
1. Check backend logs for WebSocket errors
2. Verify firewall isn't blocking port 5000
3. Test from browser console:
   ```javascript
   const ws = new WebSocket('ws://192.168.1.66:5000/ws');
   ws.onopen = () => console.log('Connected!');
   ```

### Configuration Missing

**Symptoms:**
```
⚠ No miners.yaml found (using simulation mode)
```

**Solutions:**
1. Create configuration:
   ```bash
   nano /opt/mining-stack/etc/miners.yaml
   ```

2. Or run auto-discovery:
   ```bash
   python3 bin/farm_init.py
   ```

3. Restart backend:
   ```bash
   docker compose -f docker-compose.prod.yml restart backend
   ```

---

## 📈 Monitoring Integration

### Prometheus Alerts

Create alert rules based on health check results:

```yaml
# /opt/mining-stack/docker/prometheus/alerts.yml
groups:
  - name: mining_stack
    rules:
      - alert: ServiceDown
        expr: up == 0
        for: 5m
        annotations:
          summary: "Service {{ $labels.job }} is down"
```

### Grafana Dashboard

Import health metrics into Grafana:
1. Open http://raspberrypi.local:3001
2. Create dashboard
3. Add panels for:
   - Container status
   - API response times
   - Active miners
   - Total hashrate

### External Monitoring

Use health check in external monitoring:

```bash
# Uptime monitoring
curl -f http://192.168.1.66:5000/health || alert_team

# Scheduled check
*/5 * * * * /opt/mining-stack/health-check.sh || send_alert
```

---

## 🔍 Advanced Usage

### JSON Output (Future)

For programmatic use:

```bash
# TODO: Add JSON output flag
./health-check.sh --json > health-status.json
```

### Specific Checks Only

```bash
# TODO: Add selective checking
./health-check.sh --check backend,frontend
```

### Verbose Mode

```bash
# TODO: Add verbose flag
./health-check.sh --verbose
```

---

## 📚 Related Documentation

- [Mining Farm Setup](MINING_FARM_SETUP.md) - Initial setup guide
- [Troubleshooting](docs/TROUBLESHOOTING.md) - Common issues
- [Configuration](docs/CONFIGURATION.md) - Configuration options
- [CI/CD Setup](CI_CD_SETUP.md) - Deployment pipeline

---

## 🎯 Quick Commands

```bash
# Run health check
./health-check.sh

# Check specific service logs
docker compose -f docker-compose.prod.yml logs backend

# Restart all services
docker compose -f docker-compose.prod.yml restart

# Check container status
docker compose -f docker-compose.prod.yml ps

# View resource usage
docker stats

# Check disk space
df -h

# Check memory usage
free -h
```

---

## ✅ Best Practices

1. **Run after every deployment** - Automatic with deploy scripts
2. **Schedule regular checks** - Hourly or daily via cron
3. **Monitor exit codes** - Integrate with alerting
4. **Review warnings** - Address non-critical issues
5. **Keep logs** - Track health over time
6. **Test after changes** - Verify configuration updates
7. **Document issues** - Help improve the script

---

**Stay healthy! 🏥⛏️**
