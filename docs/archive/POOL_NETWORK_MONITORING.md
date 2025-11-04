# Pool Network Quality Monitoring

## Overview

Automatic monitoring of network quality to mining pools:
- ✅ Discovers pools from miners automatically
- ✅ Tests latency (ping)
- ✅ Tests connectivity (TCP connection)
- ✅ Measures packet loss
- ✅ Exports metrics to Prometheus
- ✅ Grafana dashboard for visualization
- ✅ Alerts for network issues

---

## Features

### Automatic Pool Discovery

The monitor automatically discovers pools by:
1. Reading miner IPs from `miners.yaml`
2. Querying each miner's cgminer API (`pools` command)
3. Extracting pool URLs
4. Testing each unique pool

**No manual configuration needed!**

### Metrics Collected

| Metric | Description | Unit |
|--------|-------------|------|
| `pool_network_reachable` | Pool is reachable via TCP | 0/1 |
| `pool_network_dns_resolved` | DNS resolves successfully | 0/1 |
| `pool_network_connect_time_ms` | TCP connection time | milliseconds |
| `pool_network_ping_avg_ms` | Average ping latency | milliseconds |
| `pool_network_ping_min_ms` | Minimum ping latency | milliseconds |
| `pool_network_ping_max_ms` | Maximum ping latency | milliseconds |
| `pool_network_packet_loss_percent` | Packet loss percentage | percent |

### Alerts Configured

| Alert | Threshold | Severity | Duration |
|-------|-----------|----------|----------|
| PoolUnreachable | Pool not reachable | Critical | 5 min |
| PoolHighPacketLoss | >10% packet loss | Critical | 5 min |
| PoolHighLatency | >100ms latency | Warning | 10 min |
| PoolPacketLoss | 1-10% packet loss | Warning | 10 min |
| PoolSlowConnection | >1000ms connect time | Warning | 5 min |
| PoolDNSFailure | DNS resolution fails | Warning | 5 min |

---

## Installation

### 1. Install Dependencies

```bash
# Install mtr for network diagnostics (optional but recommended)
sudo apt-get update
sudo apt-get install -y mtr iputils-ping

# Verify ping works
ping -c 3 8.8.8.8
```

### 2. Make Script Executable

```bash
chmod +x /opt/mining-stack/bin/pool_network_monitor.py
```

### 3. Add to Supervisor

Edit `docker/python-scheduler/supervisord.conf`:

```ini
[program:pool_network_monitor]
command=python3 /app/bin/pool_network_monitor.py
directory=/app
autostart=true
autorestart=true
stderr_logfile=/var/log/pool_network_monitor.err.log
stdout_logfile=/var/log/pool_network_monitor.out.log
environment=METRICS_DIR="/metrics"
```

### 4. Add Alert Rules to Prometheus

Edit `docker/prometheus/prometheus.yml`:

```yaml
rule_files:
  - "/etc/prometheus/rules/mining_alerts.yml"
  - "/etc/prometheus/rules/pool_network_alerts.yml"  # Add this line
```

### 5. Restart Services

```bash
cd /opt/mining-stack
docker compose -f docker-compose.prod.yml up -d --build python-scheduler
docker compose -f docker-compose.prod.yml restart prometheus
docker compose -f docker-compose.prod.yml restart grafana
```

### 6. Verify

```bash
# Check monitor is running
docker compose -f docker-compose.prod.yml exec python-scheduler supervisorctl status pool_network_monitor

# Check metrics file
docker compose -f docker-compose.prod.yml exec python-scheduler cat /metrics/pool_network_metrics.prom

# Check Prometheus is scraping
curl -s http://localhost:9090/api/v1/query?query=pool_network_reachable
```

---

## Usage

### Grafana Dashboard

**URL:** `http://192.168.1.66:3001/d/pool-network-quality`

**Panels:**
1. **Pool Latency** - Average ping time to each pool
2. **Pool Packet Loss** - Packet loss percentage
3. **Pool Connection Time** - TCP connection establishment time
4. **Pool Reachability** - Current status (reachable/unreachable)
5. **Pool Network Statistics** - Detailed table with all metrics

**Color Coding:**
- 🟢 Green: Good (<50ms latency, <1% loss)
- 🟡 Yellow: Warning (50-100ms, 1-5% loss)
- 🟠 Orange: High (100-200ms, 5-10% loss)
- 🔴 Red: Critical (>200ms, >10% loss)

### Prometheus Queries

```promql
# Check pool reachability
pool_network_reachable

# Average latency to all pools
avg(pool_network_ping_avg_ms)

# Pools with packet loss
pool_network_packet_loss_percent > 0

# Pools with high latency
pool_network_ping_avg_ms > 100

# Connection time to specific pool
pool_network_connect_time_ms{pool="pool.example.com"}
```

### Telegram Alerts

When network issues occur, you'll receive Telegram notifications:

```
⚠️ High latency to pool pool.example.com

Pool pool.example.com:3333 latency is 150ms (threshold: 100ms)

Time: Nov 2, 2025 11:50 PM
```

---

## How It Works

### Discovery Process

```
1. Load miners.yaml
   ↓
2. Connect to each miner (port 4028)
   ↓
3. Send {"command": "pools"}
   ↓
4. Parse pool URLs
   ↓
5. Extract unique pools
   ↓
6. Test each pool
```

### Testing Process

For each pool:

**1. DNS Resolution**
```bash
# Resolve hostname to IP
socket.gethostbyname("pool.example.com")
```

**2. Ping Test**
```bash
# Send 5 ICMP packets
ping -c 5 -W 2 pool.example.com

# Parse statistics:
# - Min/Avg/Max latency
# - Packet loss percentage
```

**3. TCP Connection Test**
```bash
# Try to establish TCP connection
asyncio.open_connection("pool.example.com", 3333)

# Measure connection time
```

**4. Export Metrics**
```
# Write to /metrics/pool_network_metrics.prom
pool_network_reachable{pool="pool.example.com",port="3333"} 1
pool_network_ping_avg_ms{pool="pool.example.com",port="3333"} 45.2
pool_network_packet_loss_percent{pool="pool.example.com",port="3333"} 0
```

### Monitoring Cycle

```
Every 60 seconds:
1. Discover pools from miners
2. Test each pool (ping + TCP)
3. Export metrics to Prometheus
4. Prometheus scrapes metrics
5. Grafana displays data
6. Alerts fire if thresholds exceeded
```

---

## Troubleshooting

### No Pools Discovered

**Problem:** Monitor can't find any pools

**Check:**
```bash
# Verify miners.yaml exists
cat /opt/mining-stack/etc/miners.yaml

# Test miner API manually
echo '{"command":"pools"}' | nc 192.168.1.64 4028

# Check monitor logs
docker compose -f docker-compose.prod.yml logs python-scheduler | grep pool_network
```

**Solution:**
- Ensure miners are online
- Verify miner IPs in miners.yaml
- Check cgminer API is accessible (port 4028)

### Metrics Not Showing

**Problem:** Grafana dashboard is empty

**Check:**
```bash
# Verify metrics file exists
docker compose -f docker-compose.prod.yml exec python-scheduler ls -la /metrics/pool_network_metrics.prom

# Check file contents
docker compose -f docker-compose.prod.yml exec python-scheduler cat /metrics/pool_network_metrics.prom

# Verify Prometheus is scraping
curl http://localhost:9090/api/v1/query?query=pool_network_reachable
```

**Solution:**
- Restart python-scheduler
- Restart prometheus
- Wait 2 minutes for metrics to populate

### High Latency Reported

**Problem:** Dashboard shows high latency

**Investigate:**
```bash
# Test manually from Raspberry Pi
ping -c 10 pool.example.com

# Check route
traceroute pool.example.com

# Check if ISP issue
ping -c 10 8.8.8.8

# Check local network
ping -c 10 192.168.1.1
```

**Possible causes:**
- ISP network congestion
- Pool server overloaded
- Local network issues
- Router problems

### Packet Loss Detected

**Problem:** Dashboard shows packet loss

**Investigate:**
```bash
# Extended ping test
ping -c 100 pool.example.com | grep loss

# Check if consistent
mtr -r -c 100 pool.example.com

# Test different pool
ping -c 100 backup-pool.example.com
```

**Actions:**
- If all pools affected → local network issue
- If one pool affected → pool issue, switch to backup
- If intermittent → network congestion

---

## Configuration

### Monitoring Interval

Default: 60 seconds

To change:

Edit `bin/pool_network_monitor.py`:
```python
await monitor.run_continuous(interval=120)  # 2 minutes
```

### Ping Count

Default: 5 packets

To change:

Edit `bin/pool_network_monitor.py`:
```python
ping_stats = await self.ping_host(hostname, count=10)  # 10 packets
```

### Alert Thresholds

Edit `docker/prometheus/rules/pool_network_alerts.yml`:

```yaml
# Change latency threshold
- alert: PoolHighLatency
  expr: pool_network_ping_avg_ms > 150  # Changed from 100
  for: 10m

# Change packet loss threshold
- alert: PoolHighPacketLoss
  expr: pool_network_packet_loss_percent > 5  # Changed from 10
  for: 5m
```

Then restart Prometheus:
```bash
docker compose -f docker-compose.prod.yml restart prometheus
```

---

## Example Scenarios

### Scenario 1: Pool Under DDoS Attack

**Symptoms:**
- High latency (>200ms)
- High packet loss (>10%)
- Intermittent unreachability

**Dashboard shows:**
```
Pool: pool.example.com:3333
Reachable: ✅ Yes (intermittent)
Ping Avg: 250ms (red)
Packet Loss: 15% (red)
```

**Action:**
1. Switch miners to backup pool
2. Contact pool operator
3. Monitor backup pool performance

### Scenario 2: ISP Network Issues

**Symptoms:**
- All pools show high latency
- Packet loss to all destinations
- Local network OK

**Dashboard shows:**
```
All pools:
Ping Avg: 150-200ms (orange/red)
Packet Loss: 5-10% (yellow/red)
```

**Action:**
1. Test with `ping 8.8.8.8`
2. Contact ISP
3. Consider temporary 4G/5G backup

### Scenario 3: DNS Resolution Failure

**Symptoms:**
- Pool unreachable
- DNS resolved: ❌ No
- Can ping IP directly

**Dashboard shows:**
```
Pool: pool.example.com:3333
Reachable: ❌ No
DNS Resolved: ❌ No
```

**Action:**
1. Check DNS server: `cat /etc/resolv.conf`
2. Try different DNS (8.8.8.8, 1.1.1.1)
3. Use pool IP directly if available

---

## Benefits

### Early Problem Detection

Detect network issues **before** they affect mining:
- Pool goes down → Alert fires → Switch to backup
- Latency increases → Investigate before rejection rate rises
- Packet loss → Identify network problems early

### Root Cause Analysis

When rejection rate increases, check pool network dashboard:
- High latency → Network issue
- Packet loss → Connection quality issue
- Pool unreachable → Pool down

### Performance Optimization

- Compare pools → Choose lowest latency
- Identify best times → Avoid congestion periods
- Optimize routing → Work with ISP

### Historical Data

- Track pool reliability over time
- Identify patterns (time of day, day of week)
- Make informed decisions about pool selection

---

## Metrics Reference

### pool_network_reachable
**Type:** Gauge  
**Values:** 0 (unreachable), 1 (reachable)  
**Description:** Whether pool is reachable via TCP connection

### pool_network_dns_resolved
**Type:** Gauge  
**Values:** 0 (failed), 1 (success)  
**Description:** Whether DNS resolution succeeded

### pool_network_connect_time_ms
**Type:** Gauge  
**Unit:** Milliseconds  
**Description:** Time to establish TCP connection  
**Good:** <100ms  
**Warning:** 100-500ms  
**Critical:** >1000ms

### pool_network_ping_avg_ms
**Type:** Gauge  
**Unit:** Milliseconds  
**Description:** Average ping latency (5 packets)  
**Good:** <50ms  
**Warning:** 50-100ms  
**Critical:** >100ms

### pool_network_packet_loss_percent
**Type:** Gauge  
**Unit:** Percent  
**Description:** Percentage of lost packets  
**Good:** 0%  
**Warning:** 1-5%  
**Critical:** >10%

---

## Summary

✅ **Automatic pool discovery** - No manual configuration
✅ **Comprehensive metrics** - Latency, packet loss, connectivity
✅ **Grafana dashboard** - Visual monitoring
✅ **Prometheus alerts** - Automatic notifications
✅ **Telegram integration** - Mobile alerts
✅ **Historical data** - Track trends over time
✅ **Root cause analysis** - Identify network issues
✅ **Early detection** - Catch problems before they affect mining

**Monitor your pool network quality automatically and catch issues before they impact your hashrate!** 📊🌐✅
