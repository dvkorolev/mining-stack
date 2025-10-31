# Mining Farm Monitoring Setup

Complete guide for Prometheus metrics and Grafana dashboards for your mining operation.

---

## 📊 **Available Metrics**

### **Backend API Metrics** (`backend:5000/metrics`)

| Metric | Type | Description |
|--------|------|-------------|
| `mining_hashrate_total` | gauge | Total farm hashrate (TH/s) |
| `mining_active_miners` | gauge | Number of active miners |
| `mining_total_mined` | counter | Total amount mined |

### **PyASIC Miner Metrics** (via textfile collector)

#### **General Metrics**
| Metric | Type | Description |
|--------|------|-------------|
| `miner_hashrate_ths` | gauge | Per-miner hashrate (TH/s) |
| `miner_power_watts` | gauge | Power consumption (W) |
| `miner_temp_max_c` | gauge | Maximum temperature (°C) |
| `miner_is_mining` | gauge | Mining status (1=mining, 0=stopped) |
| `miner_uptime_seconds` | counter | Uptime since last reboot |
| `miner_efficiency_j_th` | gauge | Efficiency (J/TH) |
| `miner_fault_light_on` | gauge | Fault indicator (1=on, 0=off) |
| `miner_errors_count` | gauge | Number of errors |
| `miner_scrape_success` | gauge | Scrape status (1=success, 0=failed) |

#### **Board Metrics**
| Metric | Type | Description |
|--------|------|-------------|
| `miner_board_hashrate_ths` | gauge | Per-board hashrate (TH/s) |
| `miner_board_temp_c` | gauge | Per-board temperature (°C) |
| `miner_board_chips_count` | gauge | Active chips per board |
| `miner_board_chips_expected` | gauge | Expected chips per board |

#### **Fan Metrics**
| Metric | Type | Description |
|--------|------|-------------|
| `miner_fan_speed_rpm` | gauge | Fan speed (RPM) |

#### **Pool Metrics**
| Metric | Type | Description |
|--------|------|-------------|
| `miner_pool_accepted_total` | counter | Lifetime accepted shares |
| `miner_pool_rejected_total` | counter | Lifetime rejected shares |

---

## 🚀 **Quick Setup**

### **1. Setup Python Virtual Environment**

```bash
# On Raspberry Pi
cd /opt/mining-stack

# Create venv and install pyasic
./bin/setup-pyasic-venv.sh
```

This will:
- Install system dependencies (python3-full, python3-venv)
- Create virtual environment in `venv/`
- Install pyasic and pyyaml

### **2. Setup Metrics Collection**

```bash
# Setup cron job for automatic collection
./bin/setup-metrics-cron.sh
```

This will:
- Create `textfile/` directory
- Add cron job (runs every 2 minutes)
- Collect initial metrics

### **3. Deploy with Monitoring**

```bash
# Update to latest code (includes dashboards & alerts)
./update-from-registry.sh latest
```

---

## 📈 **Grafana Dashboards**

### **Mining Farm Overview** (Auto-provisioned)

Access: http://192.168.1.66:3001

**Panels:**
1. **Total Hashrate** - Real-time farm hashrate
2. **Active Miners** - Number of online miners
3. **Total Power** - Power consumption (kW)
4. **Avg Efficiency** - Average efficiency (J/TH)
5. **Hashrate Over Time** - Historical hashrate chart
6. **Power Over Time** - Historical power chart
7. **Miner Status Table** - All miners with status

**Features:**
- ✅ Auto-refresh every 30 seconds
- ✅ Color-coded thresholds
- ✅ Drill-down capabilities
- ✅ Export to PDF/PNG

### **Creating Custom Dashboards**

1. Open Grafana: http://192.168.1.66:3001
2. Login: `admin` / `mining123`
3. Click **+** → **Dashboard**
4. Add panels with PromQL queries

**Example Queries:**

```promql
# Total hashrate
sum(miner_hashrate_ths)

# Miners by status
count by(status) (miner_is_mining)

# Top 5 hottest miners
topk(5, miner_temp_max_c)

# Rejection rate
sum(rate(miner_pool_rejected_total[5m])) / 
sum(rate(miner_pool_accepted_total[5m]) + rate(miner_pool_rejected_total[5m]))

# Power efficiency
sum(miner_power_watts) / sum(miner_hashrate_ths)
```

---

## 🚨 **Prometheus Alerts**

### **Critical Alerts**

| Alert | Threshold | Duration | Description |
|-------|-----------|----------|-------------|
| `MinerOffline` | scrape_success == 0 | 5m | Miner unreachable |
| `MinerHighTemperature` | temp > 85°C | 2m | Critical temperature |
| `MinerNotMining` | is_mining == 0 | 5m | Stopped mining |
| `MinerHashrateDrop` | hashrate < 50 TH/s | 10m | Low hashrate |
| `FarmMultipleMinersOffline` | count > 3 | 5m | Multiple failures |
| `FarmHashrateDrop` | total < 1500 TH/s | 10m | Farm-wide issue |

### **Warning Alerts**

| Alert | Threshold | Duration | Description |
|-------|-----------|----------|-------------|
| `MinerTemperatureHigh` | 75°C < temp ≤ 85°C | 5m | Elevated temperature |
| `MinerHighRejectionRate` | rejection > 5% | 10m | High rejects |
| `MinerFaultLight` | fault_light == 1 | 2m | Fault indicator |
| `MinerErrors` | errors > 0 | 5m | Errors detected |
| `MinerMissingChips` | chips < expected | 10m | Hardware issue |
| `MinerFanSpeedLow` | fan < 2000 RPM | 5m | Cooling issue |
| `MinerPoorEfficiency` | efficiency > 35 J/TH | 15m | Poor performance |

### **System Alerts**

| Alert | Threshold | Duration | Description |
|-------|-----------|----------|-------------|
| `HighCPUUsage` | CPU > 80% | 5m | System overload |
| `HighMemoryUsage` | Memory > 85% | 5m | Memory pressure |
| `LowDiskSpace` | Disk < 15% | 5m | Storage low |

### **Viewing Alerts**

1. **Prometheus**: http://192.168.1.66:9090/alerts
2. **Grafana**: Create alert panels

---

## 🔧 **Configuration**

### **Prometheus Config**

Location: `docker/prometheus/prometheus.yml`

```yaml
scrape_configs:
  - job_name: "backend"
    static_configs:
      - targets: ["backend:5000"]
    scrape_interval: 30s
    
  - job_name: "node-textfile"
    static_configs:
      - targets: ["node-exporter:9100"]
    params:
      collect[]: ["textfile"]
```

### **Alert Rules**

Location: `docker/prometheus/rules/mining_alerts.yml`

To modify alerts:
```bash
nano docker/prometheus/rules/mining_alerts.yml
docker compose -f docker-compose.prod.yml restart prometheus
```

### **Metrics Collection Frequency**

Edit cron job:
```bash
crontab -e

# Change from every 2 minutes to every 1 minute
*/1 * * * * cd /opt/mining-stack && python3 bin/pyasic_textfile.py
```

---

## 📊 **Monitoring Best Practices**

### **1. Regular Checks**

- ✅ Check dashboards daily
- ✅ Review alerts weekly
- ✅ Analyze trends monthly

### **2. Alert Tuning**

- Adjust thresholds based on your hardware
- Add silence rules for maintenance
- Create alert routing (email, Slack, etc.)

### **3. Data Retention**

Default: 15 days

To change:
```yaml
# docker/prometheus/prometheus.yml
global:
  storage.tsdb.retention.time: 30d
```

### **4. Backup**

```bash
# Backup Prometheus data
docker run --rm -v mining-stack_prometheus_data:/data \
  -v $(pwd)/backups:/backup alpine \
  tar czf /backup/prometheus-$(date +%Y%m%d).tar.gz /data

# Backup Grafana dashboards
docker run --rm -v mining-stack_grafana-storage:/data \
  -v $(pwd)/backups:/backup alpine \
  tar czf /backup/grafana-$(date +%Y%m%d).tar.gz /data
```

---

## 🔍 **Troubleshooting**

### **No Metrics from Miners**

```bash
# Check if pyasic is collecting
cat textfile/pyasic_metrics.prom

# Check cron job
crontab -l | grep pyasic

# Check logs
tail -f logs/pyasic_metrics.log

# Run manually
python3 bin/pyasic_textfile.py
```

### **Grafana Dashboard Not Loading**

```bash
# Check Grafana logs
docker logs grafana

# Verify provisioning
docker exec grafana ls -la /etc/grafana/dashboards

# Restart Grafana
docker compose -f docker-compose.prod.yml restart grafana
```

### **Prometheus Not Scraping**

```bash
# Check targets
curl http://localhost:9090/api/v1/targets | jq

# Check Prometheus logs
docker logs prometheus

# Verify config
docker exec prometheus promtool check config /etc/prometheus/prometheus.yml
```

---

## 📚 **Useful PromQL Queries**

### **Performance**

```promql
# Average hashrate per miner model
avg by(model) (miner_hashrate_ths)

# Total power by location
sum by(location) (miner_power_watts)

# Efficiency distribution
histogram_quantile(0.95, miner_efficiency_j_th)
```

### **Health**

```promql
# Miners with errors
miner_errors_count > 0

# Temperature outliers
miner_temp_max_c > avg(miner_temp_max_c) + 10

# Offline miners
miner_scrape_success == 0
```

### **Trends**

```promql
# Hashrate change over 1 hour
rate(miner_hashrate_ths[1h])

# Share acceptance rate
rate(miner_pool_accepted_total[5m]) / 
(rate(miner_pool_accepted_total[5m]) + rate(miner_pool_rejected_total[5m]))

# Power consumption trend
deriv(sum(miner_power_watts)[1h])
```

---

## 🎯 **Quick Commands**

```bash
# View current metrics
curl http://localhost:5000/metrics
curl http://localhost:9100/metrics

# Test alert rules
docker exec prometheus promtool check rules /etc/prometheus/rules/*.yml

# Query Prometheus
curl 'http://localhost:9090/api/v1/query?query=sum(miner_hashrate_ths)'

# Export dashboard
curl -u admin:mining123 http://localhost:3001/api/dashboards/uid/mining-overview

# View active alerts
curl http://localhost:9090/api/v1/alerts | jq '.data.alerts[] | select(.state=="firing")'
```

---

## 📞 **Support**

- **Prometheus Docs**: https://prometheus.io/docs/
- **Grafana Docs**: https://grafana.com/docs/
- **PyASIC Docs**: https://github.com/UpstreamData/pyasic

---

**Happy Monitoring! 📊⛏️**
