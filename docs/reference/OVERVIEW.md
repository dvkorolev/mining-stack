# Mining Stack - Centralized Monitoring & Control

## Vision: One Place for Everything

**Problem**: Managing 22+ miners across your network is chaotic
- Multiple web interfaces (http://192.168.1.40, .64, .78, etc.)
- No unified view of farm performance
- Manual checking of each miner
- No alerts when issues occur
- Difficult to track trends over time

**Solution**: Mining Stack - Your single control center
- ✅ **One dashboard** for all miners
- ✅ **Real-time monitoring** of hashrate, temperature, power
- ✅ **Centralized control** - reboot, configure from one place
- ✅ **Automated alerts** via Telegram
- ✅ **Historical data** and trend analysis
- ✅ **Mobile access** from anywhere

---

## System Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     YOUR MINING FARM                        │
│  22 Miners: M30S++, M50, S19, DG1+ (192.168.1.x)           │
└────────────┬────────────────────────────────────────────────┘
             │
             │ Metrics Collection (every 2 minutes)
             │
┌────────────▼────────────────────────────────────────────────┐
│              RASPBERRY PI (192.168.1.66)                    │
│                                                              │
│  ┌──────────────────────────────────────────────────────┐  │
│  │ Python Scheduler (Port 8000)                         │  │
│  │ • Runs pyasic_textfile.py (detailed metrics)         │  │
│  │ • Runs universal_collector.py (fallback)             │  │
│  │ • Writes to /metrics/*.prom files                    │  │
│  └──────────────────────────────────────────────────────┘  │
│                          │                                   │
│                          ▼                                   │
│  ┌──────────────────────────────────────────────────────┐  │
│  │ Node Exporter (Port 9100)                            │  │
│  │ • Reads /metrics/*.prom files                        │  │
│  │ • Exposes metrics to Prometheus                      │  │
│  └──────────────────────────────────────────────────────┘  │
│                          │                                   │
│                          ▼                                   │
│  ┌──────────────────────────────────────────────────────┐  │
│  │ Prometheus (Port 9090)                               │  │
│  │ • Scrapes Node Exporter every 30s                    │  │
│  │ • Stores time-series data                            │  │
│  │ • Provides query API (PromQL)                        │  │
│  └──────────────────────────────────────────────────────┘  │
│                          │                                   │
│         ┌────────────────┴────────────────┐                 │
│         ▼                                  ▼                 │
│  ┌─────────────────┐            ┌─────────────────────┐    │
│  │ Backend (5000)  │            │ Grafana (3001)      │    │
│  │ • Node.js API   │            │ • Advanced charts   │    │
│  │ • Miner control │            │ • Custom dashboards │    │
│  │ • Alerts        │            │ • Data export       │    │
│  └────────┬────────┘            └─────────────────────┘    │
│           │                                                  │
│           ▼                                                  │
│  ┌─────────────────┐                                        │
│  │ Frontend (3000) │                                        │
│  │ • React UI      │                                        │
│  │ • Real-time     │                                        │
│  └─────────────────┘                                        │
│           │                                                  │
│           ▼                                                  │
│  ┌─────────────────┐                                        │
│  │ Telegram Bot    │                                        │
│  │ • Alerts        │                                        │
│  │ • Commands      │                                        │
│  └─────────────────┘                                        │
└─────────────────────────────────────────────────────────────┘
             │
             ▼
     ┌───────────────┐
     │  YOUR PHONE   │
     │  YOUR LAPTOP  │
     └───────────────┘
```

---

## Access Points - One Place, Multiple Interfaces

### 🖥️ Web Dashboard (Primary Interface)
**URL**: http://raspberrypi:3000 or http://192.168.1.66:3000

**Features**:
- **Main Dashboard**
  - Total hashrate (real-time)
  - Active miners count (22/22)
  - Power consumption
  - Temperature overview
  - Hashrate trends (6h/24h/7d)
  
- **Miners Management**
  - List all 22 miners
  - Status (Online/Offline/High Temp)
  - Individual stats (hashrate, temp, power)
  - Actions: Reboot, View Details
  - Bulk operations
  
- **Alerts**
  - Active alerts
  - Alert history
  - Configure thresholds
  
- **Settings**
  - Telegram bot setup
  - Alert preferences
  - System configuration

### 📊 Grafana (Advanced Analytics)
**URL**: http://raspberrypi:3001 or http://192.168.1.66:3001
**Login**: admin / <GF_SECURITY_ADMIN_PASSWORD>

**Features**:
- Mining Farm Overview dashboard
- Custom dashboards
- Advanced PromQL queries
- Data export (PDF/PNG/CSV)
- Long-term trend analysis

### 📱 Telegram Bot (Mobile Control)
**Setup**: Settings → Telegram Bot

**Commands**:
```
/status          - Farm overview
/miners          - List all miners
/miner <name>    - Specific miner stats
/reboot <name>   - Reboot a miner
/alerts          - Active alerts
/help            - Command list
```

**Automatic Alerts**:
- 🔥 High temperature (>95°C)
- ⚡ Low hashrate (<80% expected)
- 🔴 Miner offline
- ⚠️ High rejection rate

### 🔧 Prometheus (Raw Data)
**URL**: http://raspberrypi:9090 or http://192.168.1.66:9090

**Use cases**:
- Custom queries
- API integration
- Debugging
- Advanced monitoring

---

## What You Can Monitor (All in One Place)

### Per-Miner Metrics
- ✅ **Hashrate** (TH/s) - Current and average
- ✅ **Temperature** (°C) - Max across all boards
- ✅ **Power consumption** (Watts)
- ✅ **Fan speeds** (RPM) - All fans
- ✅ **Efficiency** (J/TH)
- ✅ **Uptime** (hours)
- ✅ **Status** (Online/Offline/Error)
- ✅ **Model** and IP address
- ✅ **Pool configuration**

### Farm-Wide Metrics
- ✅ **Total hashrate** - Sum of all miners
- ✅ **Active miners** - How many are mining
- ✅ **Total power** - Farm consumption (kW)
- ✅ **Average efficiency** - Farm-wide J/TH
- ✅ **Average temperature** - Across all miners
- ✅ **Hashrate trends** - Historical charts
- ✅ **Performance comparison** - Miner vs miner

### Alerts & Notifications
- ✅ **Temperature alerts** - Before damage occurs
- ✅ **Hashrate alerts** - Detect underperformance
- ✅ **Offline alerts** - Know immediately
- ✅ **Telegram notifications** - Get alerts on phone
- ✅ **Alert history** - Track issues over time

---

## What You Can Control (All in One Place)

### Miner Operations
- ✅ **Reboot miners** - Single or bulk
- ✅ **View pool config** - Check current pools
- ✅ **Update pools** - Change mining pools (planned)
- ✅ **Monitor status** - Real-time updates

### System Configuration
- ✅ **Alert thresholds** - Customize per your needs
- ✅ **Collection interval** - How often to check miners
- ✅ **Telegram bot** - Enable/disable, set chat ID
- ✅ **Miner aliases** - Friendly names

### Data Management
- ✅ **Export data** - CSV, PDF, PNG
- ✅ **Historical data** - Up to 90 days
- ✅ **Custom dashboards** - Create your own views

---

## Typical Workflows

### Morning Check (2 minutes)
1. Open http://raspberrypi:3000
2. Check main dashboard:
   - Total hashrate: ~2200 TH/s ✅
   - Active miners: 22/22 ✅
   - No red alerts ✅
3. Done! Everything running smoothly.

### Issue Detection (Automatic)
1. Miner temperature spikes to 105°C
2. **Telegram alert** arrives on your phone: 🔥 High temperature on EN-M30SppVH90-063
3. Open dashboard on phone
4. Click on miner → View details
5. See temperature trend (rising last hour)
6. Click **Reboot** to restart miner
7. Monitor temperature after reboot
8. If still high → Check cooling (see COOLING_EMERGENCY.md)

### Performance Analysis (Weekly)
1. Open Grafana: http://raspberrypi:3001
2. View "Mining Farm Overview" dashboard
3. Check 7-day hashrate trend
4. Identify underperforming miners
5. Compare efficiency across miners
6. Export report as PDF
7. Plan maintenance for low performers

### Bulk Operations
1. Select multiple miners with high temperature
2. Click "Bulk Actions" → "Reboot Selected"
3. Confirm
4. Monitor all miners return to normal

---

## Mobile Access

### On Your Phone
1. **Connect to same WiFi** (192.168.1.x network)
2. **Open browser**: http://192.168.1.66:3000
3. **Dashboard works on mobile** - Responsive design
4. **Telegram bot** - Get alerts anywhere

### From Outside Your Network (Advanced)
**Option 1: VPN** (Recommended)
- Set up WireGuard/OpenVPN on Raspberry Pi
- Connect to VPN from anywhere
- Access dashboard securely

**Option 2: Reverse Proxy** (Advanced)
- Use Cloudflare Tunnel or ngrok
- Expose dashboard to internet
- ⚠️ Security risk - use authentication!

**Option 3: Telegram Bot Only**
- No VPN needed
- Get alerts and basic stats
- Limited control

---

## Data Flow Example

**Scenario**: You want to know total farm hashrate right now

```
1. You open http://raspberrypi:3000
   ↓
2. Frontend requests: GET /api/mining/stats
   ↓
3. Backend queries Prometheus:
   sum(max by (ip) (miner_hashrate_ths))
   ↓
4. Prometheus returns: 2247.3 TH/s
   ↓
5. Backend sends to frontend
   ↓
6. Dashboard displays: "2,247 TH/s"
```

**Behind the scenes** (automatic):
```
Every 2 minutes:
1. Python scheduler runs collectors
2. Collectors connect to all 22 miners
3. Retrieve metrics via cgminer API
4. Write to /metrics/universal_metrics.prom
5. Node Exporter reads the file
6. Prometheus scrapes Node Exporter
7. Data stored in time-series database
8. Available for queries
```

---

## Benefits of Centralized System

### Before Mining Stack
- ❌ Open 22 browser tabs to check miners
- ❌ Manually calculate total hashrate
- ❌ No alerts - discover issues hours later
- ❌ No historical data
- ❌ Can't compare miner performance
- ❌ Reboot = walk to miner or SSH individually
- ❌ No mobile access

### After Mining Stack
- ✅ **One dashboard** - See everything at a glance
- ✅ **Automatic calculations** - Total hashrate, power, efficiency
- ✅ **Instant alerts** - Know about issues immediately
- ✅ **90 days history** - Track trends and patterns
- ✅ **Performance comparison** - Identify weak miners
- ✅ **Remote control** - Reboot from anywhere
- ✅ **Mobile friendly** - Check from phone

### Time Savings
- **Daily monitoring**: 30 minutes → 2 minutes (93% reduction)
- **Issue detection**: Hours → Seconds (instant alerts)
- **Performance analysis**: Manual spreadsheets → Automated charts
- **Troubleshooting**: SSH to each miner → One dashboard

### Cost Savings
- **Early problem detection** - Fix issues before hardware damage
- **Optimize efficiency** - Identify power-hungry miners
- **Reduce downtime** - Faster issue resolution
- **Prevent failures** - Temperature alerts prevent burnout

---

## System Requirements

### Raspberry Pi 4
- **RAM**: 4GB minimum (8GB recommended)
- **Storage**: 32GB SD card minimum
- **Network**: Ethernet (same network as miners)
- **Power**: Official 15W USB-C adapter

### Network
- **Miners and Pi on same subnet** (192.168.1.x)
- **Stable network** - No frequent disconnections
- **Sufficient bandwidth** - Minimal (few KB/s per miner)

### Miners
- **cgminer API enabled** (port 4028) - Usually default
- **HTTP access** (port 80) - For web interface
- **Network accessible** - Ping-able from Pi

---

## Maintenance

### Daily
- ✅ Check dashboard (2 minutes)
- ✅ Review any alerts

### Weekly
- ✅ Review performance trends (5 minutes)
- ✅ Check for software updates
- ✅ Verify all miners reporting

### Monthly
- ✅ Clean miner dust (physical)
- ✅ Review alert thresholds
- ✅ Export performance report
- ✅ Check disk space on Pi

### Quarterly
- ✅ Update system (`./update-from-registry.sh`)
- ✅ Review and optimize configuration
- ✅ Backup configuration files

---

## Quick Reference

### URLs
```
Main Dashboard:  http://192.168.1.66:3000
Grafana:         http://192.168.1.66:3001
Prometheus:      http://192.168.1.66:9090
Backend API:     http://192.168.1.66:5000
```

### Key Files
```
Miner config:    /opt/mining-stack/etc/miners.yaml
Environment:     /opt/mining-stack/.env
Metrics:         /opt/mining-stack/metrics/*.prom
Logs:            docker logs <container-name>
```

### Common Commands
```bash
# Check system health
cd /opt/mining-stack
./health-check.sh

# Update system
./update-from-registry.sh

# Restart services
docker compose -f docker-compose.prod.yml restart

# View logs
docker compose -f docker-compose.prod.yml logs -f backend

# Check metrics collection
docker logs mining-stack-python-scheduler-1 --tail 50
```

---

## Documentation Index

- **[OVERVIEW.md](OVERVIEW.md)** - This file (system overview)
- **[SETUP.md](SETUP.md)** - Initial setup and installation
- **[MONITORING.md](MONITORING.md)** - Metrics and monitoring guide
- **[MINER_DISCOVERY.md](MINER_DISCOVERY.md)** - How to discover miners
- **[MINER_REBOOT.md](MINER_REBOOT.md)** - Reboot functionality
- **[COOLING_EMERGENCY.md](COOLING_EMERGENCY.md)** - Temperature issues
- **[PRODUCTION.md](PRODUCTION.md)** - Production best practices
- **[TROUBLESHOOTING.md](TROUBLESHOOTING.md)** - Common issues (planned)

---

## Support & Troubleshooting

### Check System Health
```bash
cd /opt/mining-stack
./health-check.sh
```

### Common Issues

**Dashboard not loading**
1. Check if services running: `docker ps`
2. Check logs: `docker logs mining-stack-frontend-1`
3. Restart: `docker compose -f docker-compose.prod.yml restart`

**No metrics showing**
1. Check collectors: `docker logs mining-stack-python-scheduler-1`
2. Check Prometheus: http://192.168.1.66:9090/targets
3. Verify miners accessible: `ping 192.168.1.40`

**Alerts not working**
1. Check Telegram bot configured in Settings
2. Verify chat ID correct
3. Check backend logs: `docker logs mining-stack-backend-1`

---

## Future Enhancements

### Planned Features
- ✅ Pool management (change pools from dashboard)
- ✅ Firmware update notifications
- ✅ Profitability calculator
- ✅ Power cost tracking
- ✅ Automated reboot on errors (optional)
- ✅ Multi-farm support
- ✅ Mobile app (native)
- ✅ Advanced analytics (ML-based predictions)

### Community Requests
- Integration with mining pools (API)
- Electricity cost optimization
- Predictive maintenance
- Custom alert rules
- Export to external monitoring

---

## Summary

**Mining Stack = Your Mission Control Center**

Instead of:
- 22 web interfaces
- Manual calculations
- Spreadsheet tracking
- Reactive problem solving

You get:
- **One dashboard** for everything
- **Automatic monitoring** 24/7
- **Instant alerts** when issues occur
- **Historical analysis** for optimization
- **Remote control** from anywhere
- **Mobile access** on the go

**Result**: Spend less time managing, more time optimizing. Know about issues before they become problems. Make data-driven decisions. Sleep better knowing your farm is monitored.

**Your mining operation, simplified.** 🚀
