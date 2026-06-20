# Miner Renaming - Automatic Metric Cleanup

## Overview

The system now automatically handles miner name changes without creating duplicate metrics. When you rename a miner, the old metrics are automatically removed and new ones are created with the updated name.

## The Problem (Before)

When you renamed a miner in the database:
1. Python scheduler would start reporting metrics with the new name
2. Old metrics with the old name would persist in Prometheus
3. Result: **Duplicate metrics** (one for old name, one for new name)
4. Grafana dashboards would show incorrect counts
5. **Solution required**: Restart Python scheduler to clear cache

### Example of the Problem:
```
# Before renaming (1 miner)
miner_hashrate_ths{ip="192.168.1.70", name="EN-M30SppVH40-070"} 113.6

# After renaming to "30n" (2 metrics for same miner!)
miner_hashrate_ths{ip="192.168.1.70", name="EN-M30SppVH40-070"} 113.6  ← OLD (stale)
miner_hashrate_ths{ip="192.168.1.70", name="30n"} 113.6                ← NEW

# Result: 22 miners showing as 44 metrics!
```

## The Solution (Now)

### Automatic Cleanup Mechanism

The Python scheduler now:
1. **Tracks miner labels** by IP address (IP is stable, names can change)
2. **Detects label changes** (name, model, or algorithm)
3. **Removes old metrics** automatically before setting new ones
4. **No duplicates** - clean transition from old to new labels

### How It Works

```python
# metrics.py
_miner_label_cache = {}  # Track labels by IP

def update_miner_label_cache(ip, name, model, algorithm):
    if ip in cache and labels_changed:
        # Remove old metrics with old labels
        remove_old_miner_labels(ip, old_name, old_model, old_algorithm)
    
    # Update cache with new labels
    cache[ip] = {name, model, algorithm}
```

### Integration

```python
# pyasic_collector.py - _update_metrics()
def _update_metrics(data, ip, name, model, ...):
    # Clean up old metrics if labels changed
    update_miner_label_cache(ip, name, model, algo)
    
    # Set new metrics with updated labels
    miner_hashrate.labels(ip=ip, name=name, ...).set(hashrate)
```

## Usage

### Renaming a Miner

**No special steps required!** Just rename the miner normally:

#### Via Web Dashboard:
1. Go to Miners page
2. Click Edit on the miner
3. Change the name
4. Save

#### Via Database:
```sql
UPDATE miners SET name = 'new-name' WHERE ip = '192.168.1.70';
```

#### Via API:
```bash
curl -X PUT http://192.168.1.66:5000/api/miners/192.168.1.70 \
  -H "Content-Type: application/json" \
  -d '{"name": "new-name"}'
```

### What Happens Automatically:

1. **Next collection cycle** (every 2 minutes):
   - Scheduler loads updated miner config from database
   - Detects name change for IP 192.168.1.70
   - Removes old metric: `name="old-name"`
   - Creates new metric: `name="new-name"`

2. **In Prometheus**:
   - Old metric disappears immediately
   - New metric appears with same IP
   - No duplicates

3. **In Grafana**:
   - Dashboards show correct count
   - Historical data preserved (by IP)
   - No restart needed

## Supported Changes

The automatic cleanup handles changes to:

### ✅ Name Changes
```
"EN-M30SppVH40-070" → "30n"
"miner-01" → "5"
"long-descriptive-name" → "001"
```

### ✅ Model Changes
```
"M30S++ VH40" → "M30S++ VH40 (Stock)"
"Antminer S19" → "Antminer S19 Pro"
```

### ✅ Algorithm Changes
```
"sha256" → "scrypt" (if miner type changes)
```

## Benefits

### 1. No Service Restarts
- Rename miners anytime
- No need to restart Python scheduler
- No need to restart Prometheus
- Changes apply within 2 minutes

### 2. No Duplicate Metrics
- Old metrics automatically removed
- Clean transition to new labels
- Correct counts in Grafana

### 3. Works with Any Name
- Short names: `"5"`, `"001"`, `"30n"` ✓
- Long names: `"EN-M30SppVH40-070"` ✓
- Special characters: `"miner-01"`, `"worker_123"` ✓

### 4. Historical Data Preserved
- Prometheus stores data by IP
- Historical queries still work
- No data loss

## Technical Details

### Metric Labels

All miner metrics use these labels:
```
ip: "192.168.1.70"      ← Stable (never changes)
name: "30n"             ← Can change
model: "M30S++_VH40"    ← Can change
algorithm: "sha256"     ← Can change
```

### Label Cache

```python
_miner_label_cache = {
    "192.168.1.70": {
        "name": "30n",
        "model": "M30S++_VH40_(Stock)",
        "algorithm": "sha256"
    },
    "192.168.1.53": {
        "name": "5",
        "model": "M50_VH70_(Stock)",
        "algorithm": "sha256"
    }
}
```

### Cleanup Process

1. **Before setting metrics**:
   ```python
   update_miner_label_cache(ip, name, model, algo)
   ```

2. **Check for changes**:
   ```python
   if ip in cache and labels_changed:
       remove_old_miner_labels(ip, old_name, old_model, old_algo)
   ```

3. **Remove old metrics**:
   ```python
   for metric in all_miner_metrics:
       metric.remove(ip, old_name, old_model, old_algo)
   ```

4. **Set new metrics**:
   ```python
   miner_hashrate.labels(ip=ip, name=new_name, ...).set(value)
   ```

### Affected Metrics

All these metrics are automatically cleaned up:
- `miner_hashrate_ths`
- `miner_hashrate_mhs`
- `miner_power_watts`
- `miner_temp_max_c`
- `miner_is_mining`
- `miner_uptime_seconds`
- `miner_efficiency_j_th`
- `miner_fault_light_on`
- `miner_errors_count`
- `miner_scrape_status`
- `miner_state`
- `miner_pool_accepted_total`
- `miner_pool_rejected_total`

## Verification

### Check for Duplicates

```bash
# Should show 1 per IP (no duplicates)
curl -s 'http://192.168.1.66:8000/metrics' | \
  grep 'miner_hashrate_ths' | \
  grep -o 'ip="[^"]*"' | \
  sort | uniq -c
```

Expected output:
```
   1 ip="192.168.1.40"
   1 ip="192.168.1.53"
   1 ip="192.168.1.63"
   ...
```

### Check Total Count

```bash
# Should match number of online miners
curl -s 'http://192.168.1.66:8000/metrics' | \
  grep 'miner_hashrate_ths{' | \
  wc -l
```

### Test Renaming

1. Rename a miner in the database
2. Wait 2 minutes (next collection cycle)
3. Check metrics:
   ```bash
   curl -s 'http://192.168.1.66:8000/metrics' | \
     grep 'miner_hashrate_ths' | \
     grep 'ip="192.168.1.70"'
   ```
4. Should show only the new name, not the old one

## Troubleshooting

### Issue: Still seeing duplicates after renaming

**Cause**: Prometheus may have cached the old metrics

**Solution**:
```bash
# Restart Prometheus to clear cache
docker compose restart prometheus
```

### Issue: Metrics not updating after rename

**Cause**: Python scheduler hasn't run collection yet

**Solution**: Wait 2 minutes for next collection cycle, or restart:
```bash
docker compose restart python-scheduler
```

### Issue: Old metrics persist

**Cause**: Miner might be offline during rename

**Solution**: 
- Old metrics will be cleaned up when miner comes back online
- Or restart Python scheduler to force cleanup

## Best Practices

### 1. Use Consistent Naming
```
# Good
EN-M30SppVH40-070
EN-M30SppVH40-089
EN-M30SppVH90-040

# Also fine (your choice!)
001
002
30n
5
```

### 2. Avoid Frequent Renaming
- Rename when needed, but not constantly
- Each rename triggers metric cleanup
- Historical queries may be affected

### 3. Keep IP Stable
- IP is the stable identifier
- Don't change miner IPs frequently
- If IP changes, it's treated as a new miner

### 4. Monitor After Renaming
- Check Grafana dashboards
- Verify correct counts
- Ensure no duplicates

## Migration from Old System

If you have existing duplicate metrics from before this feature:

1. **Restart Python scheduler**:
   ```bash
   docker compose restart python-scheduler
   ```

2. **Wait 2 minutes** for collection cycle

3. **Verify cleanup**:
   ```bash
   curl -s 'http://192.168.1.66:8000/metrics' | \
     grep 'miner_hashrate_ths{' | \
     wc -l
   ```

4. **If duplicates persist, restart Prometheus**:
   ```bash
   docker compose restart prometheus
   ```

## Summary

✅ **Automatic cleanup** when renaming miners  
✅ **No service restarts** required  
✅ **No duplicate metrics**  
✅ **Works with any name length**  
✅ **Historical data preserved**  
✅ **Changes apply within 2 minutes**  

**You can now rename miners freely without worrying about duplicate metrics or "going crazy" dashboards!** 🎉
