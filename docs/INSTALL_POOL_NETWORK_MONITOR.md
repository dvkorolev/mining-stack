# Installing Pool Network Monitor on Raspberry Pi

## Overview

This guide shows you how to install and run the pool network quality monitor on your Raspberry Pi. The monitor will automatically:
- Discover pools from your miners
- Test network quality every 60 seconds
- Export metrics to Prometheus
- Display in Grafana dashboard
- Send alerts via Telegram

---

## Prerequisites

- Raspberry Pi with mining-stack installed
- Python 3.7+ with venv
- Miners configured in `/opt/mining-stack/etc/miners.yaml`
- Prometheus and Grafana running

---

## Installation Steps

### 1. Install System Dependencies

```bash
# Update package list
sudo apt-get update

# Install network tools
sudo apt-get install -y iputils-ping mtr-tiny

# Verify ping works
ping -c 3 8.8.8.8
```

### 2. Make Script Executable

```bash
cd /opt/mining-stack
chmod +x bin/pool_network_monitor.py
```

### 3. Test the Monitor Manually

```bash
# Run once to test
cd /opt/mining-stack
./venv/bin/python3 bin/pool_network_monitor.py

# Check output (Ctrl+C to stop after first cycle)
cat textfile/pool_network_metrics.prom
```

**Expected output:**
```
# HELP pool_network_reachable Pool is reachable via TCP (1=yes, 0=no)
# TYPE pool_network_reachable gauge
pool_network_reachable{pool="pool.example.com",port="3333"} 1

# HELP pool_network_ping_avg_ms Average ping latency in milliseconds
# TYPE pool_network_ping_avg_ms gauge
pool_network_ping_avg_ms{pool="pool.example.com",port="3333"} 45.2
...
```

---

## Scheduling Options

You have **two options** for running the monitor:

### Option A: Cron Job (Recommended for Raspberry Pi)

**Advantages:**
- Simple setup
- Built into Linux
- Reliable
- Easy to debug

**Setup:**

1. **Edit crontab:**
```bash
crontab -e
```

2. **Add this line** (runs every 2 minutes):
```bash
*/2 * * * * cd /opt/mining-stack && ./venv/bin/python3 bin/collect_all_metrics.sh >> logs/metrics_collection.log 2>&1
```

This will run:
- Universal miner collector
- PyASIC collector  
- Pool network monitor

All in parallel every 2 minutes.

3. **Save and exit** (Ctrl+X, Y, Enter in nano)

4. **Verify cron job:**
```bash
crontab -l
```

5. **Check it's running:**
```bash
# Wait 2 minutes, then check logs
tail -f /opt/mining-stack/logs/metrics_collection.log
```

---

### Option B: Systemd Service (Alternative)

**Advantages:**
- Runs continuously
- Auto-restart on failure
- Better for long-running processes

**Setup:**

1. **Create service file:**
```bash
sudo nano /etc/systemd/system/pool-network-monitor.service
```

2. **Add this content:**
```ini
[Unit]
Description=Mining Pool Network Quality Monitor
After=network.target

[Service]
Type=simple
User=admin
WorkingDirectory=/opt/mining-stack
Environment="METRICS_DIR=/opt/mining-stack/textfile"
ExecStart=/opt/mining-stack/venv/bin/python3 /opt/mining-stack/bin/pool_network_monitor.py
Restart=always
RestartSec=10
StandardOutput=append:/opt/mining-stack/logs/pool_network_monitor.log
StandardError=append:/opt/mining-stack/logs/pool_network_monitor.err.log

[Install]
WantedBy=multi-user.target
```

3. **Enable and start:**
```bash
sudo systemctl daemon-reload
sudo systemctl enable pool-network-monitor
sudo systemctl start pool-network-monitor
```

4. **Check status:**
```bash
sudo systemctl status pool-network-monitor
```

5. **View logs:**
```bash
tail -f /opt/mining-stack/logs/pool_network_monitor.log
```

---

## Configure Prometheus

### 1. Add Alert Rules

**Edit Prometheus config:**
```bash
sudo nano /opt/mining-stack/docker/prometheus/prometheus.yml
```

**Add to `rule_files` section:**
```yaml
rule_files:
  - "/etc/prometheus/rules/mining_alerts.yml"
  - "/etc/prometheus/rules/pool_network_alerts.yml"  # Add this line
```

### 2. Restart Prometheus

```bash
cd /opt/mining-stack
docker compose -f docker-compose.prod.yml restart prometheus
```

### 3. Verify Alert Rules

```bash
# Check Prometheus loaded the rules
curl -s http://localhost:9090/api/v1/rules | jq '.data.groups[] | select(.name=="pool_network")'
```

---

## Configure Grafana

### 1. Import Dashboard

The dashboard JSON is already in:
```
/opt/mining-stack/docker/grafana/dashboards/pool-network-quality.json
```

Grafana will auto-load it on restart.

### 2. Restart Grafana

```bash
docker compose -f docker-compose.prod.yml restart grafana
```

### 3. Access Dashboard

Open in browser:
```
http://192.168.1.66:3001/d/pool-network-quality
```

---

## Verification

### 1. Check Metrics File

```bash
cat /opt/mining-stack/textfile/pool_network_metrics.prom
```

**Should show:**
- pool_network_reachable
- pool_network_ping_avg_ms
- pool_network_packet_loss_percent
- pool_network_connect_time_ms

### 2. Check Prometheus

```bash
# Query metrics
curl -s 'http://localhost:9090/api/v1/query?query=pool_network_reachable' | jq .

# Should return data for each pool
```

### 3. Check Grafana

1. Open: `http://192.168.1.66:3001/d/pool-network-quality`
2. Should see:
   - Pool latency chart
   - Packet loss chart
   - Connection time chart
   - Reachability status
   - Statistics table

### 4. Check Logs

```bash
# If using cron
tail -f /opt/mining-stack/logs/metrics_collection.log

# If using systemd
sudo journalctl -u pool-network-monitor -f
```

**Expected log output:**
```
2025-11-02 23:58:00 - INFO - Starting continuous pool network monitoring (interval: 60s)
2025-11-02 23:58:00 - INFO - Discovering pools from 22 miners...
2025-11-02 23:58:05 - INFO - Discovered 3 unique pools
2025-11-02 23:58:05 - INFO -   - pool.example.com:3333
2025-11-02 23:58:05 - INFO -   - backup-pool.example.com:3333
2025-11-02 23:58:05 - INFO -   - pool2.example.com:3333
2025-11-02 23:58:05 - INFO - Monitoring pool.example.com:3333
2025-11-02 23:58:10 - INFO - Monitoring backup-pool.example.com:3333
2025-11-02 23:58:15 - INFO - Monitoring pool2.example.com:3333
2025-11-02 23:58:20 - INFO - Exported metrics to /opt/mining-stack/textfile/pool_network_metrics.prom
2025-11-02 23:58:20 - INFO - Monitoring complete: 3/3 pools reachable
2025-11-02 23:58:20 - INFO - Waiting 60 seconds until next cycle...
```

---

## Troubleshooting

### Issue: No pools discovered

**Symptoms:**
```
INFO - Discovered 0 unique pools
WARNING - No pools discovered, using default pools
```

**Solutions:**

1. **Check miners are online:**
```bash
# Test miner API
echo '{"command":"pools"}' | nc 192.168.1.64 4028
```

2. **Verify miners.yaml:**
```bash
cat /opt/mining-stack/etc/miners.yaml
```

3. **Check miner IPs are correct:**
```bash
# Ping miners
ping -c 3 192.168.1.64
```

---

### Issue: Ping command not found

**Symptoms:**
```
ERROR - Error pinging pool.example.com: [Errno 2] No such file or directory: 'ping'
```

**Solution:**
```bash
sudo apt-get install -y iputils-ping
```

---

### Issue: Permission denied

**Symptoms:**
```
PermissionError: [Errno 13] Permission denied: '/opt/mining-stack/textfile/pool_network_metrics.prom'
```

**Solution:**
```bash
# Fix permissions
sudo chown -R admin:admin /opt/mining-stack/textfile
chmod 755 /opt/mining-stack/textfile
```

---

### Issue: Metrics not showing in Grafana

**Check:**

1. **Metrics file exists:**
```bash
ls -la /opt/mining-stack/textfile/pool_network_metrics.prom
```

2. **Prometheus is scraping:**
```bash
curl -s http://localhost:9090/api/v1/query?query=pool_network_reachable
```

3. **Grafana datasource configured:**
- Go to Grafana → Configuration → Data Sources
- Check Prometheus is connected

4. **Restart services:**
```bash
docker compose -f docker-compose.prod.yml restart prometheus grafana
```

---

## Monitoring the Monitor

### Check if Running (Cron)

```bash
# Check recent runs
grep "pool_network" /opt/mining-stack/logs/metrics_collection.log | tail -20

# Check metrics file timestamp
ls -lh /opt/mining-stack/textfile/pool_network_metrics.prom
```

### Check if Running (Systemd)

```bash
# Check service status
sudo systemctl status pool-network-monitor

# View recent logs
sudo journalctl -u pool-network-monitor --since "10 minutes ago"
```

### Manual Test

```bash
# Run once manually
cd /opt/mining-stack
./venv/bin/python3 bin/pool_network_monitor.py

# Press Ctrl+C after first cycle completes
```

---

## Performance Impact

**Resource Usage:**
- CPU: <1% (during ping tests)
- Memory: ~50MB
- Network: ~5KB per pool per minute
- Disk: ~10KB metrics file

**Impact on Mining:**
- None - tests run on Raspberry Pi, not miners
- Ping uses ICMP (different from mining traffic)
- TCP connection test is brief (<1 second)

---

## Configuration

### Change Monitoring Interval

**Edit the script:**
```bash
nano /opt/mining-stack/bin/pool_network_monitor.py
```

**Find and change:**
```python
# Line ~460
await monitor.run_continuous(interval=120)  # Change to 120 seconds (2 minutes)
```

### Change Ping Count

**Edit the script:**
```python
# Line ~140
ping_stats = await self.ping_host(hostname, count=10)  # Change to 10 packets
```

### Add Static Pools

If pool discovery fails, you can add static pools:

**Edit the script:**
```python
# Line ~270
if not self.pools:
    logger.warning("No pools discovered, using default pools")
    self.pools = {
        ('your-pool.com', 3333),
        ('backup-pool.com', 3333),
    }
```

---

## Summary

### Installation Checklist

- [ ] Install system dependencies (ping, mtr)
- [ ] Make script executable
- [ ] Test manually
- [ ] Set up cron job OR systemd service
- [ ] Configure Prometheus alert rules
- [ ] Restart Prometheus
- [ ] Restart Grafana
- [ ] Verify metrics in Prometheus
- [ ] Check Grafana dashboard
- [ ] Monitor logs

### What You Get

✅ **Automatic pool discovery** from miners
✅ **Network quality metrics** every 60 seconds
✅ **Grafana dashboard** for visualization
✅ **Prometheus alerts** for issues
✅ **Telegram notifications** when problems occur
✅ **Historical data** for trend analysis

### Quick Start

```bash
# Install dependencies
sudo apt-get install -y iputils-ping mtr-tiny

# Make executable
chmod +x /opt/mining-stack/bin/pool_network_monitor.py

# Add to cron
crontab -e
# Add: */2 * * * * cd /opt/mining-stack && ./venv/bin/python3 bin/collect_all_metrics.sh >> logs/metrics_collection.log 2>&1

# Restart services
docker compose -f docker-compose.prod.yml restart prometheus grafana

# Check dashboard
# http://192.168.1.66:3001/d/pool-network-quality
```

**Your pool network quality monitoring is now running on Raspberry Pi!** 🥧📊✅
