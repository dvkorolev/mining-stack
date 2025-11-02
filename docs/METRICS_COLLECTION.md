# Metrics Collection

## Overview

The mining stack collects metrics from miners using two complementary collectors:

1. **Universal Miner Collector** (`universal_miner_collector.py`) - Primary collector
2. **PyASIC Collector** (`pyasic_textfile.py`) - Enhanced collector with additional details

## Universal Miner Collector

### What It Collects

The universal collector uses the **cgminer API (port 4028)** which is supported by:
- ✅ **Whatsminer** (M30S++, M50, M50S++, etc.)
- ✅ **Antminer** (S19, S19 Pro, S19K Pro, etc.)
- ✅ **Any cgminer-compatible miner**

### Metrics Collected via cgminer API

**Without pyasic, directly from miner API:**

```
✅ Hashrate (TH/s)
✅ Power consumption (W) - Whatsminer only
✅ Temperature (°C)
✅ Fan speeds (RPM)
✅ Uptime (seconds)
✅ Accepted shares (total)
✅ Rejected shares (total)
✅ Hardware errors (total)
✅ Online status
```

### How It Works

**1. Connect to cgminer API:**
```python
# Port 4028 - standard cgminer API
reader, writer = await asyncio.open_connection(ip, 4028)
```

**2. Send commands:**
```python
# Get detailed stats
{"command": "stats"}

# Get summary (includes shares)
{"command": "summary"}
```

**3. Parse response:**
```python
# Whatsminer summary response includes:
{
  "SUMMARY": [{
    "MHS av": 106200.5,        # Hashrate in MH/s
    "Power": 3408.0,           # Power in watts
    "Accepted": 12543,         # ✅ Accepted shares
    "Rejected": 102,           # ✅ Rejected shares
    "Temperature": 68.5,
    "Elapsed": 86400
  }]
}
```

**4. Calculate rejection rate:**
```promql
# In Grafana
100 * (rejected / (accepted + rejected))
```

## PyASIC Collector

### What It Adds

PyASIC provides additional details:
- Per-board hashrate
- Per-board temperature
- Chip counts (active vs expected)
- Fault light status
- Detailed error messages
- PSU fan speed

### When to Use Each

| Metric | Universal | PyASIC | Notes |
|--------|-----------|--------|-------|
| Hashrate | ✅ | ✅ | Both work |
| Power | ✅ | ✅ | Both work |
| Temperature | ✅ | ✅ | Both work |
| **Accepted shares** | ✅ | ✅ | **Both work** |
| **Rejected shares** | ✅ | ✅ | **Both work** |
| Per-board stats | ❌ | ✅ | PyASIC only |
| Chip counts | ❌ | ✅ | PyASIC only |
| Fault light | ❌ | ✅ | PyASIC only |

## Rejection Rate Collection

### Whatsminer (M30S++, M50)

**Method 1: Universal Collector (cgminer API)**
```bash
# Connect to port 4028
echo '{"command":"summary"}' | nc 192.168.1.40 4028

# Response includes:
{
  "SUMMARY": [{
    "Accepted": 12543,
    "Rejected": 102
  }]
}
```

**Method 2: PyASIC**
```python
miner = await get_miner("192.168.1.40")
data = await miner.get_data()
accepted = sum(p.accepted for p in data.pools)
rejected = sum(p.rejected for p in data.pools)
```

### Antminer (S19, S19 Pro)

**Method 1: Universal Collector (cgminer API)**
```bash
# Same as Whatsminer - uses cgminer API
echo '{"command":"summary"}' | nc 192.168.1.64 4028
```

**Method 2: PyASIC**
```python
# Same as Whatsminer
```

## Current Configuration

### Active Collectors

Both collectors run simultaneously:

**1. Universal Collector:**
- Schedule: Every 2 minutes
- Output: `/metrics/universal_metrics.prom`
- Covers: All miners (Whatsminer, Antminer, etc.)
- **Includes rejection rate** ✅

**2. PyASIC Collector:**
- Schedule: Every 2 minutes
- Output: `/metrics/pyasic_metrics.prom`
- Covers: Miners supported by pyasic
- **Includes rejection rate** ✅

### Prometheus Deduplication

When both collectors provide the same metric, Prometheus uses:
```promql
max by (ip) (miner_pool_rejected_total)
```

This takes the maximum value from both sources, ensuring no data loss.

## Verification

### Check if rejection rate is collected:

**1. Check metrics file:**
```bash
# Universal collector
cat /opt/mining-stack/metrics/universal_metrics.prom | grep rejected

# Should show:
miner_pool_rejected_total{ip="192.168.1.40",name="EN-M30SppVH90-040",model="M30S++_VH90"} 102
```

**2. Check Prometheus:**
```bash
# Query Prometheus
curl 'http://localhost:9090/api/v1/query?query=miner_pool_rejected_total'
```

**3. Check Grafana:**
- Open: http://192.168.1.66:3001/d/per-miner-details
- See: "Rejection Rate by Miner" chart
- Should show data for all miners

## Troubleshooting

### No rejection rate data

**Check 1: Metrics collection**
```bash
# View collector logs
docker logs python-scheduler

# Should see:
# Exported metrics to /metrics/universal_metrics.prom
```

**Check 2: Metrics file**
```bash
# Check if rejection metrics exist
grep -A 5 "miner_pool_rejected_total" /opt/mining-stack/metrics/universal_metrics.prom
```

**Check 3: Prometheus scrape**
```bash
# Check if Prometheus is scraping
curl http://localhost:9090/api/v1/targets

# Look for node-exporter target
```

**Check 4: Miner API**
```bash
# Test cgminer API directly
echo '{"command":"summary"}' | nc 192.168.1.40 4028 | jq .

# Should include Accepted and Rejected fields
```

## Summary

✅ **Rejection rate IS collected without pyasic**
✅ **Universal collector uses cgminer API (port 4028)**
✅ **Works for Whatsminer, Antminer, and all cgminer-compatible miners**
✅ **Both collectors provide rejection rate**
✅ **Prometheus deduplicates using max by (ip)**
✅ **Grafana dashboards show rejection rate per miner**

**No dependency on pyasic for rejection rate!** The universal collector gets it directly from the miner's cgminer API.
