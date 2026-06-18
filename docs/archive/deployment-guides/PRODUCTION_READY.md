# ✅ Production-Ready Mining Stack

Your mining monitoring system is now **production-ready** with all best practices implemented.

## 🎯 What's Configured

### Core Services
- ✅ **Backend API** - Node.js/TypeScript with real Prometheus data
- ✅ **Frontend Dashboard** - React with real-time updates
- ✅ **Python Scheduler** - Automated metrics collection (2 min interval)
- ✅ **Prometheus** - Metrics storage and alerting
- ✅ **Grafana** - Visualization dashboards
- ✅ **Node Exporter** - System metrics

### Metrics Collection
- ✅ **Universal Collector** - Works with all miner types (Antminer, Whatsminer, DG1+)
- ✅ **Pyasic Collector** - Detailed per-board metrics
- ✅ **Automatic Collection** - Every 2 minutes via scheduler
- ✅ **22 Miners Configured** - All your miners in `etc/miners.yaml`

### Monitoring & Alerts
- ✅ **Temperature Monitoring** - Warning at 75°C, Critical at 85°C
- ✅ **Hashrate Monitoring** - Per-miner expected values
- ✅ **Power Monitoring** - Actual vs expected
- ✅ **Status Detection** - Online/Offline/Error states
- ✅ **Telegram Bot** - Optional notifications

## 📁 Key Files

### Configuration
```
.env                    # Environment variables (copy from .env.example)
etc/miners.yaml         # Your 22 miners configuration
docker-compose.prod.yml # Production services
```

### Documentation
```
docs/PRODUCTION_SETUP.md  # Complete setup guide
docs/TELEGRAM.md          # Telegram bot setup
docs/CONFIGURATION.md     # Configuration reference
bin/README.md             # Scripts documentation
```

### Scripts
```
deploy-from-registry.sh   # Initial deployment
update-from-registry.sh   # Update system
health-check.sh           # System health check
```

## 🚀 Quick Start

### On Raspberry Pi:

```bash
cd /opt/mining-stack

# 1. Copy environment template
cp .env.example .env

# 2. Edit configuration (optional)
nano .env

# 3. Deploy
./deploy-from-registry.sh

# 4. Check health
./health-check.sh
```

### Access Services:
- Dashboard: http://raspberrypi:3000
- Grafana: http://raspberrypi:3001 (admin/<GF_SECURITY_ADMIN_PASSWORD>)
- Prometheus: http://raspberrypi:9090

## ✨ Production Features

### 1. Automated Metrics Collection
- Runs every 2 minutes
- Both collectors (pyasic + universal)
- Writes to `/metrics/*.prom`
- Node Exporter exposes to Prometheus

### 2. Real-Time Dashboard
- Live miner status
- Current hashrate per miner
- Temperature monitoring
- Power consumption
- Error detection

### 3. Historical Data
- Prometheus stores metrics
- Grafana dashboards
- Trend analysis
- Alert history

### 4. Smart Alerting
- Per-miner thresholds
- Global defaults
- Temperature alerts
- Hashrate alerts
- Status changes

### 5. Easy Updates
```bash
./update-from-registry.sh
```
- Pulls latest code
- Pulls latest images
- Restarts services
- Preserves configuration

## 🔧 Configuration Management

### Adding a Miner
1. Edit `etc/miners.yaml`:
   ```yaml
   - ip: 192.168.1.150
     model: S19 Pro
     alias: EN-S19Pro-150
     owner: EN
     status: active
   ```
2. Restart backend:
   ```bash
   docker compose -f docker-compose.prod.yml restart backend
   ```

### Updating Thresholds

**Global (all miners):**
Edit `.env`:
```bash
THRESHOLD_TEMP_WARNING=75
THRESHOLD_TEMP_CRITICAL=85
```

**Per-miner:**
Edit `etc/miners.yaml`:
```yaml
thresholds:
  hashrate:
    expected: 106.1
  power:
    expected: 3408.0
```

### Telegram Bot Setup
1. Go to http://raspberrypi:3000/settings
2. Enter bot token and chat ID
3. Click "Test Connection"

## 📊 Monitoring

### Check System Health
```bash
./health-check.sh
```

Expected output:
- ✓ Docker running
- ✓ All containers up
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

### Check Metrics Collection
```bash
# Scheduler status
curl http://localhost:8000/status | jq

# Metrics files
docker exec mining-stack-python-scheduler-1 ls -lh /metrics/

# Prometheus query
curl 'http://localhost:9090/api/v1/query?query=miner_hashrate_ths'
```

## 🛡️ Security

### ✅ Implemented
- Resource limits on all containers
- Non-root users in containers
- Read-only volume mounts where possible
- No hardcoded secrets (use .env)

### 🔒 Recommended
1. Change Grafana password:
   ```bash
   # Edit .env
   GF_SECURITY_ADMIN_PASSWORD=your_secure_password
   ```

2. Restrict network access:
   - Use firewall (ufw)
   - VPN for remote access
   - HTTPS reverse proxy (nginx)

3. Regular updates:
   ```bash
   ./update-from-registry.sh
   ```

## 📈 Performance

### Current Setup (22 Miners)
- Collection interval: 2 minutes
- Concurrent requests: 100
- Timeout: 30 seconds
- Resource limits optimized

### Resource Usage
- Backend: ~200MB RAM, 0.3 CPU
- Frontend: ~100MB RAM, 0.2 CPU
- Python Scheduler: ~150MB RAM, 0.2 CPU
- Prometheus: ~500MB RAM, 0.5 CPU
- Grafana: ~200MB RAM, 0.3 CPU

**Total: ~1.2GB RAM, 1.5 CPU cores**

Raspberry Pi 4 (4GB) is perfect for this setup.

## 🔄 Maintenance

### Daily
- Check dashboard for alerts
- Monitor temperatures
- Verify all miners online

### Weekly
- Run health check: `./health-check.sh`
- Check logs for errors
- Verify metrics collection

### Monthly
- Update system: `./update-from-registry.sh`
- Backup configuration
- Review alert thresholds

### Backup
```bash
# Backup configuration
cp etc/miners.yaml etc/miners.yaml.backup
cp .env .env.backup

# Backup Grafana
docker compose -f docker-compose.prod.yml exec grafana \
  tar czf /tmp/grafana-backup.tar.gz /var/lib/grafana
docker cp mining-stack-grafana-1:/tmp/grafana-backup.tar.gz ./
```

## 🆘 Troubleshooting

### Miners Show Offline
1. Check metrics collection:
   ```bash
   docker logs mining-stack-python-scheduler-1 --tail 50
   ```
2. Verify metrics files exist:
   ```bash
   docker exec mining-stack-python-scheduler-1 ls -lh /metrics/
   ```
3. Check Prometheus:
   ```bash
   curl 'http://localhost:9090/api/v1/query?query=miner_scrape_success'
   ```

### High Temperature Alerts
This is **correct behavior** - miners above 85°C show as "error".

**Solutions:**
- Improve cooling
- Adjust thresholds in `.env` or `miners.yaml`

### Services Not Starting
```bash
# Check status
docker compose -f docker-compose.prod.yml ps

# Restart
docker compose -f docker-compose.prod.yml restart

# View logs
docker compose -f docker-compose.prod.yml logs
```

## 📚 Documentation

- **Setup Guide**: `docs/PRODUCTION_SETUP.md`
- **Configuration**: `docs/CONFIGURATION.md`
- **Telegram Bot**: `docs/TELEGRAM.md`
- **Scripts**: `bin/README.md`
- **Architecture**: `ARCHITECTURE.md`

## ✅ What's Fixed

### Session Fixes
1. ✅ Metrics collectors use `METRICS_DIR` environment variable
2. ✅ Pyasic collector label conflicts resolved
3. ✅ Both collectors enabled for maximum detail
4. ✅ Discovery timeout reduced to 30 seconds
5. ✅ Autodiscover disabled (not suitable for production)
6. ✅ Python-scheduler integrated in CI/CD
7. ✅ Dockerfile fixed for CI/CD builds
8. ✅ All deployment scripts updated
9. ✅ Health check includes python-scheduler
10. ✅ Comprehensive .env.example created

### Production Ready
- ✅ All services use GHCR images
- ✅ No local building needed
- ✅ CI/CD builds and pushes automatically
- ✅ Update script pulls latest images
- ✅ Configuration preserved on updates
- ✅ Resource limits set
- ✅ Health checks configured
- ✅ Logging configured

## 🎉 You're All Set!

Your mining monitoring stack is production-ready with:
- ✅ 22 miners configured
- ✅ Automated metrics collection
- ✅ Real-time monitoring
- ✅ Historical data
- ✅ Smart alerting
- ✅ Easy updates
- ✅ Comprehensive documentation

**Next Steps:**
1. Deploy to Raspberry Pi: `./deploy-from-registry.sh`
2. Access dashboard: http://raspberrypi:3000
3. Configure Telegram bot (optional)
4. Set up regular backups
5. Monitor and enjoy! 🚀

---

**Questions?** Check `docs/PRODUCTION_SETUP.md` for detailed guides.
