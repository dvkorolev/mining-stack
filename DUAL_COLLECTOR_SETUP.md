# 🔄 Dual Collector Setup Guide

## Overview

Run **both pyasic and universal collectors** in parallel for comprehensive monitoring with synchronized timestamps.

---

## 📊 Architecture

### **Two Collectors, Two Output Files:**

```
┌─────────────────────────────────────────┐
│  Unified Collection Script              │
│  (collect_all_metrics.sh)               │
└─────────────┬───────────────────────────┘
              │
              ├─────────────┬─────────────┐
              ▼             ▼             ▼
        ┌─────────┐   ┌──────────┐   Same
        │ pyasic  │   │universal │   Timestamp
        │collector│   │collector │
        └────┬────┘   └────┬─────┘
             │             │
             ▼             ▼
    ┌────────────┐  ┌─────────────┐
    │ pyasic_    │  │ universal_  │
    │ metrics.   │  │ metrics.    │
    │ prom       │  │ prom        │
    └────────────┘  └─────────────┘
             │             │
             └──────┬──────┘
                    ▼
            ┌──────────────┐
            │  Prometheus  │
            │  (scrapes    │
            │   both)      │
            └──────────────┘
```

---

## 🎯 Benefits

### **Why Run Both?**

1. **Comprehensive Coverage**
   - pyasic: Detailed metrics (board-level, chips, efficiency)
   - universal: DG1+ support, API quirk handling

2. **Synchronized Timestamps**
   - Both run at the same time
   - Metrics from same moment
   - Accurate comparisons

3. **Redundancy**
   - If one fails, other still works
   - Cross-validation of data
   - Backup metrics

4. **Best of Both Worlds**
   - Detailed diagnostics (pyasic)
   - Universal compatibility (universal)

---

## 🚀 Setup

### **1. Make Script Executable**

```bash
cd /opt/mining-stack
chmod +x bin/collect_all_metrics.sh
```

### **2. Test Manual Run**

```bash
# Run both collectors
./bin/collect_all_metrics.sh

# Expected output:
# [2025-11-01 17:45:00] Starting metrics collection (timestamp: 1730476800)
# [2025-11-01 17:45:00] Starting parallel collection...
# [2025-11-01 17:45:00] Running pyasic collector...
# [2025-11-01 17:45:00] Running universal collector...
# [2025-11-01 17:45:15] ✓ pyasic completed successfully
# [2025-11-01 17:45:18] ✓ universal completed successfully
#
# === Collection Summary ===
# Timestamp: 1730476800
# pyasic collector: ✓ SUCCESS
# universal collector: ✓ SUCCESS
# pyasic metrics: 450 lines
# universal metrics: 150 lines
# ==========================
```

### **3. Check Output Files**

```bash
# Check pyasic metrics
ls -lh textfile/pyasic_metrics.prom

# Check universal metrics
ls -lh textfile/universal_metrics.prom

# View sample metrics
head -20 textfile/pyasic_metrics.prom
head -20 textfile/universal_metrics.prom
```

### **4. Setup Cron Job**

```bash
# Edit crontab
crontab -e

# Add this line (runs every 2 minutes):
*/2 * * * * cd /opt/mining-stack && ./bin/collect_all_metrics.sh >> logs/collection.log 2>&1
```

---

## 📁 Output Files

### **pyasic_metrics.prom** (Detailed)

```prometheus
# Detailed metrics with board-level data
miner_hashrate_ths{ip="192.168.1.40",name="EN-M30SppVH90-040",model="M30S++_VH90"} 106.2
miner_power_watts{ip="192.168.1.40",name="EN-M30SppVH90-040",model="M30S++_VH90"} 3413
miner_temp_max_c{ip="192.168.1.40",name="EN-M30SppVH90-040",model="M30S++_VH90"} 78.5

# Per-board metrics
miner_board_hashrate_ths{ip="192.168.1.40",name="EN-M30SppVH90-040",model="M30S++_VH90",slot="0"} 35.4
miner_board_hashrate_ths{ip="192.168.1.40",name="EN-M30SppVH90-040",model="M30S++_VH90",slot="1"} 35.2
miner_board_hashrate_ths{ip="192.168.1.40",name="EN-M30SppVH90-040",model="M30S++_VH90",slot="2"} 35.6

# Chip counts
miner_board_chips_count{ip="192.168.1.40",name="EN-M30SppVH90-040",model="M30S++_VH90",slot="0"} 126
miner_board_chips_expected{ip="192.168.1.40",name="EN-M30SppVH90-040",model="M30S++_VH90",slot="0"} 126
```

### **universal_metrics.prom** (Basic + DG1+)

```prometheus
# Basic metrics for all miners including DG1+
miner_hashrate_ths{ip="192.168.1.40",name="EN-M30SppVH90-040",model="M30S++_VH90_Stock"} 106.2
miner_power_watts{ip="192.168.1.40",name="EN-M30SppVH90-040",model="M30S++_VH90_Stock"} 3413
miner_temp_max_c{ip="192.168.1.40",name="EN-M30SppVH90-040",model="M30S++_VH90_Stock"} 78.5

# DG1+ metrics (not in pyasic)
miner_hashrate_ths{ip="192.168.1.78",name="EN-DG1p-078",model="DG1+_Stock"} 0.38
miner_temp_max_c{ip="192.168.1.78",name="EN-DG1p-078",model="DG1+_Stock"} 64.2
```

---

## ⚙️ Prometheus Configuration

### **Update prometheus.yml**

```yaml
scrape_configs:
  # Scrape both textfiles
  - job_name: 'miner-metrics'
    honor_labels: true
    static_configs:
      - targets: ['localhost:9100']
    metric_relabel_configs:
      # Keep all metrics from both collectors
      - source_labels: [__name__]
        regex: 'miner_.*'
        action: keep
```

### **Textfile Collector Path**

Ensure Prometheus node_exporter is configured:

```bash
# Check node_exporter config
docker exec mining-stack-node-exporter-1 cat /etc/node_exporter/config.yml

# Should include:
# --collector.textfile.directory=/textfile
```

---

## 🔍 Querying Metrics

### **Use pyasic for Detailed Analysis**

```promql
# Per-board hashrate
miner_board_hashrate_ths{name="EN-M30SppVH90-040"}

# Chip failures
miner_board_chips_count{name="EN-M30SppVH90-040"} 
  < 
miner_board_chips_expected{name="EN-M30SppVH90-040"}

# Efficiency
miner_efficiency_j_th{name="EN-M30SppVH90-040"}
```

### **Use universal for DG1+ and Totals**

```promql
# DG1+ hashrate (only in universal)
miner_hashrate_ths{name="EN-DG1p-078"}

# Total farm hashrate (includes DG1+)
sum(miner_hashrate_ths)
```

### **Cross-Validation**

```promql
# Compare pyasic vs universal (should be same)
miner_hashrate_ths{name="EN-M30SppVH90-040"} 
  - 
miner_hashrate_ths{name="EN-M30SppVH90-040"}
```

---

## 🎯 Collection Timing

### **Parallel Execution**

Both collectors run **simultaneously**:

```
Time: 00:00:00
├─ Start pyasic collector
├─ Start universal collector
│
Time: 00:00:15
├─ pyasic finishes (15s)
│
Time: 00:00:18
└─ universal finishes (18s)

Total time: 18 seconds (not 33!)
```

### **Why Parallel?**

- ✅ **Faster**: 18s instead of 33s
- ✅ **Synchronized**: Same timestamp
- ✅ **Efficient**: Uses multiple CPU cores

---

## 📊 Monitoring

### **Check Collection Status**

```bash
# View collection log
tail -f logs/collection.log

# Check last run
tail -20 logs/collection.log | grep "Collection Summary"

# Check individual collector logs
tail -50 logs/pyasic_$(date +%Y%m%d).log
tail -50 logs/universal_$(date +%Y%m%d).log
```

### **Grafana Dashboard**

Create panels using both sources:

```
Panel 1: Total Hashrate (universal - includes DG1+)
Query: sum(miner_hashrate_ths)

Panel 2: Per-Board Temps (pyasic - detailed)
Query: miner_board_temp_c

Panel 3: Chip Failures (pyasic - diagnostic)
Query: miner_board_chips_count < miner_board_chips_expected

Panel 4: DG1+ Status (universal - only source)
Query: miner_hashrate_ths{name="EN-DG1p-078"}
```

---

## 🐛 Troubleshooting

### **One Collector Fails**

```bash
# Check which failed
./bin/collect_all_metrics.sh

# Output shows:
# pyasic collector: ✓ SUCCESS
# universal collector: ✗ FAILED

# Check specific log
tail -50 logs/universal_$(date +%Y%m%d).log
```

### **Timeout Issues**

If collectors timeout (>60s):

```bash
# Edit timeout in collect_all_metrics.sh
# Change: timeout 60 -> timeout 90

# Or run individually to debug
./venv/bin/python3 bin/pyasic_textfile.py
./venv/bin/python3 bin/universal_miner_collector.py
```

### **Metrics Not Updating**

```bash
# Check cron is running
crontab -l

# Check recent runs
grep "Collection Summary" logs/collection.log | tail -5

# Check file timestamps
ls -lh textfile/*.prom
```

---

## 📈 Performance

### **Resource Usage**

```
CPU: ~20% for 18 seconds (both collectors)
Memory: ~100 MB total
Network: ~2 KB per miner
Disk: ~500 KB total (both files)
```

### **Collection Time**

```
22 miners:
- pyasic: ~15 seconds
- universal: ~18 seconds
- Total (parallel): ~18 seconds
- Total (sequential): ~33 seconds

Savings: 45% faster with parallel execution!
```

---

## ✅ Verification

### **Test Complete Setup**

```bash
# 1. Run collection
./bin/collect_all_metrics.sh

# 2. Check both files exist
ls -lh textfile/pyasic_metrics.prom textfile/universal_metrics.prom

# 3. Verify metrics count
echo "pyasic: $(grep -c "^miner_" textfile/pyasic_metrics.prom) metrics"
echo "universal: $(grep -c "^miner_" textfile/universal_metrics.prom) metrics"

# 4. Check Prometheus scrapes both
curl -s http://localhost:9090/api/v1/targets | jq '.data.activeTargets[] | select(.labels.job=="miner-metrics")'

# 5. Query both sources
curl -s 'http://localhost:9090/api/v1/query?query=miner_hashrate_ths' | jq '.data.result | length'
```

---

## 🎯 Summary

### **Dual Collector Benefits:**

✅ **Comprehensive**: pyasic (detailed) + universal (DG1+)  
✅ **Synchronized**: Same timestamp for both  
✅ **Fast**: Parallel execution (18s not 33s)  
✅ **Reliable**: Redundancy if one fails  
✅ **Flexible**: Use best source for each metric  

### **Recommended Usage:**

- **Primary**: pyasic for detailed diagnostics
- **Secondary**: universal for DG1+ and backup
- **Dashboards**: Mix both sources as needed
- **Alerts**: Use pyasic for critical alerts

### **Your 2.4 PH/s farm now has:**
- ✅ Detailed board-level monitoring (pyasic)
- ✅ DG1+ Scrypt miner support (universal)
- ✅ Synchronized metrics collection
- ✅ Professional-grade redundancy

**Perfect setup for production monitoring!** 🚀
