# Fix: Duplicate Metrics in Grafana Dashboard

## Problem

Grafana dashboard shows **duplicate entries** for each miner:
```
EN-S19-114 (192.168.1.114)  - appears twice
EN-S19KPro-115 (192.168.1.115) - appears twice  
EN-S19Pro-064 (192.168.1.64) - appears twice
```

## Root Cause

**Two collectors** are running simultaneously and both export the same metrics:

1. **universal_miner_collector.py** → `/metrics/universal_metrics.prom`
   - Exports: `miner_pool_rejected_total{ip="...",name="...",model="..."}`
   
2. **pyasic_textfile.py** → `/metrics/pyasic_metrics.prom`
   - Exports: `miner_pool_rejected_total{ip="...",name="...",model="..."}`

Both metrics have **identical labels**, so Prometheus imports them as separate time series, causing duplicates in Grafana.

---

## Solution Options

### Option 1: Disable PyASIC Collector (Recommended)

The universal collector is more reliable and works for all miner types.

**Steps:**

1. **Stop pyasic collector:**
```bash
cd /opt/mining-stack
docker compose -f docker-compose.prod.yml exec python-scheduler supervisorctl stop pyasic_collector
```

2. **Remove pyasic metrics file:**
```bash
docker compose -f docker-compose.prod.yml exec python-scheduler rm -f /metrics/pyasic_metrics.prom
```

3. **Restart Prometheus** (to clear cached metrics):
```bash
docker compose -f docker-compose.prod.yml restart prometheus
```

4. **Wait 2 minutes** for metrics to refresh

5. **Check Grafana** - duplicates should be gone

**To make permanent:**

Edit `docker/python-scheduler/supervisord.conf`:
```ini
# Comment out or remove pyasic_collector
#[program:pyasic_collector]
#command=python3 /app/bin/pyasic_textfile.py
#...
```

---

### Option 2: Disable Universal Collector

Keep only pyasic collector (not recommended - less reliable).

**Steps:**

1. **Stop universal collector:**
```bash
docker compose -f docker-compose.prod.yml exec python-scheduler supervisorctl stop universal_collector
```

2. **Remove universal metrics file:**
```bash
docker compose -f docker-compose.prod.yml exec python-scheduler rm -f /metrics/universal_metrics.prom
```

3. **Restart Prometheus:**
```bash
docker compose -f docker-compose.prod.yml restart prometheus
```

---

### Option 3: Use Different Label Names

Modify one collector to use different label names.

**Edit `bin/pyasic_textfile.py`:**
```python
# Change labels to avoid conflict
labels_str = f'ip="{ip}",miner_name="{name}",miner_model="{model}",source="pyasic"'
```

**Then update Grafana queries** to handle both label sets.

**Not recommended** - adds complexity.

---

### Option 4: Use Prometheus Relabeling

Configure Prometheus to drop one set of metrics.

**Edit `docker/prometheus/prometheus.yml`:**
```yaml
scrape_configs:
  - job_name: 'node-exporter'
    static_configs:
      - targets: ['node-exporter:9100']
    metric_relabel_configs:
      # Drop pyasic metrics if universal metrics exist
      - source_labels: [__name__, job]
        regex: 'miner_pool_(accepted|rejected)_total;node-exporter'
        action: drop
        # Only if we can distinguish between sources
```

**Complex** - requires careful configuration.

---

## Recommended Solution

**Disable PyASIC Collector** (Option 1)

### Why?

✅ **Universal collector is more reliable:**
- Works with all miner types (Whatsminer, Antminer, etc.)
- Direct cgminer API access
- Better error handling
- No external dependencies

✅ **PyASIC advantages are minimal:**
- Per-board metrics (rarely needed)
- Chip counts (diagnostic only)
- Fault light (not critical)

✅ **Simpler architecture:**
- One collector = one source of truth
- No duplicate data
- Easier to troubleshoot

---

## Implementation Steps

### 1. Backup Current Configuration

```bash
cd /opt/mining-stack
docker compose -f docker-compose.prod.yml exec python-scheduler supervisorctl status > /tmp/supervisor_status_backup.txt
```

### 2. Stop PyASIC Collector

```bash
docker compose -f docker-compose.prod.yml exec python-scheduler supervisorctl stop pyasic_collector
```

**Expected output:**
```
pyasic_collector: stopped
```

### 3. Remove PyASIC Metrics

```bash
docker compose -f docker-compose.prod.yml exec python-scheduler rm -f /metrics/pyasic_metrics.prom
```

### 4. Restart Prometheus

```bash
docker compose -f docker-compose.prod.yml restart prometheus
```

**Wait for restart:**
```bash
docker compose -f docker-compose.prod.yml logs -f prometheus | grep "Server is ready"
```

### 5. Verify Metrics

**Check Prometheus targets:**
```bash
curl -s http://localhost:9090/api/v1/targets | jq '.data.activeTargets[] | select(.labels.job=="node-exporter") | {health: .health, lastScrape: .lastScrape}'
```

**Query for duplicates:**
```bash
curl -s 'http://localhost:9090/api/v1/query?query=count(miner_pool_rejected_total)by(ip,name)' | jq '.data.result[] | select(.value[1]|tonumber > 1)'
```

**Expected:** No results (no duplicates)

### 6. Check Grafana

Open dashboard:
```
http://192.168.1.66:3001/d/per-miner-details
```

**Verify:**
- ✅ Each miner appears only once
- ✅ Rejection rate data still showing
- ✅ No gaps in data
- ✅ Legend shows correct values

### 7. Make Permanent

**Edit `docker/python-scheduler/supervisord.conf`:**
```ini
# Disable pyasic_collector permanently
[program:pyasic_collector]
command=python3 /app/bin/pyasic_textfile.py
autostart=false  # Changed from true
autorestart=false  # Changed from true
```

**Rebuild and restart:**
```bash
docker compose -f docker-compose.prod.yml up -d --build python-scheduler
```

---

## Verification Checklist

After implementing the fix:

- [ ] PyASIC collector stopped
- [ ] PyASIC metrics file removed
- [ ] Prometheus restarted
- [ ] No duplicate metrics in Prometheus
- [ ] Grafana dashboard shows single entries
- [ ] All miner data still visible
- [ ] Rejection rate data accurate
- [ ] No errors in logs

---

## Rollback Procedure

If something goes wrong:

```bash
# Restart pyasic collector
docker compose -f docker-compose.prod.yml exec python-scheduler supervisorctl start pyasic_collector

# Restart prometheus
docker compose -f docker-compose.prod.yml restart prometheus

# Wait 2 minutes for metrics to populate
```

---

## Alternative: Keep Both Collectors

If you want to keep both collectors for redundancy:

### Update Grafana Query

Change the query to explicitly choose one source:

```promql
# Use only universal collector metrics
100 * (
  max by (ip, name) (miner_pool_rejected_total{job="node-exporter"})
  /
  (max by (ip, name) (miner_pool_accepted_total{job="node-exporter"}) + 
   max by (ip, name) (miner_pool_rejected_total{job="node-exporter"}))
)
```

**But this doesn't solve the root issue** - you're still collecting duplicate data.

---

## Summary

**Problem:** Duplicate metrics from two collectors

**Root Cause:** Both `universal_miner_collector.py` and `pyasic_textfile.py` export the same metrics

**Recommended Solution:** Disable PyASIC collector

**Steps:**
1. Stop pyasic_collector
2. Remove pyasic_metrics.prom
3. Restart Prometheus
4. Verify in Grafana
5. Make permanent in supervisord.conf

**Result:** Clean dashboard with no duplicates, single source of truth

**Time Required:** 5 minutes

**Risk:** Low (easy rollback)

---

## Quick Fix Commands

```bash
# Stop pyasic collector
docker compose -f docker-compose.prod.yml exec python-scheduler supervisorctl stop pyasic_collector

# Remove metrics file
docker compose -f docker-compose.prod.yml exec python-scheduler rm -f /metrics/pyasic_metrics.prom

# Restart Prometheus
docker compose -f docker-compose.prod.yml restart prometheus

# Wait 2 minutes, then check Grafana
# http://192.168.1.66:3001/d/per-miner-details
```

**Duplicates should be gone!** ✅
