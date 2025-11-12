# Alert Trigger Analysis: "Miner workerS19 stopped mining"

**Date:** November 12, 2025  
**Alert:** MinerNotMining  
**Miner:** workerS19 (192.168.1.114)  
**Status:** FIRING since 6:49 PM UTC+3

---

## Alert Details

### Alert Rule
```yaml
- alert: MinerNotMining
  expr: miner_is_mining == 0 and miner_scrape_status >= 1
  for: 5m
  labels:
    severity: critical
    component: miner
  annotations:
    summary: "Miner {{ $labels.name }} stopped mining"
    description: "Miner {{ $labels.name }} is online but not mining for 5 minutes."
```

### Trigger Conditions
The alert fires when **BOTH** conditions are true for more than 5 minutes:

1. ✅ `miner_is_mining == 0` - Miner is **NOT mining**
2. ✅ `miner_scrape_status >= 1` - Miner **IS online** (reachable)

---

## Current Miner Metrics

```prometheus
# Hashrate (TH/s)
miner_hashrate_ths{name="workerS19", ip="192.168.1.114"} = 97.59

# Mining Status
miner_is_mining{name="workerS19", ip="192.168.1.114"} = 0.0  ← PROBLEM!

# Scrape Status (2=success, 1=partial, 0=timeout, -1=refused, -2=error)
miner_scrape_status{name="workerS19", ip="192.168.1.114"} = 2.0  ← Online
```

---

## The Paradox: Hashrate but Not Mining?

### Observation
The miner shows:
- **Hashrate:** 97.59 TH/s (actively hashing!)
- **Is Mining:** 0.0 (flagged as NOT mining)
- **Scrape Status:** 2.0 (online and reachable)

### Why This Happens

The `miner_is_mining` metric is **NOT** simply derived from hashrate. It comes from the **PyASIC library** which queries the miner's internal status.

#### How `is_mining` is Determined

```python
# python-scheduler/collectors/pyasic_collector.py

# PyASIC returns a data object with is_mining attribute
data = await get_miner(ip)  # PyASIC library call

# Extract is_mining from PyASIC data
is_mining = data.get('is_mining', True)  # Defaults to True if not present

# Set the metric
miner_is_mining.labels(...).set(1 if is_mining else 0)
```

#### PyASIC's `is_mining` Logic

PyASIC determines `is_mining` by checking the miner's **internal state**, which includes:

1. **Pool Connection Status**
   - Is the miner connected to a mining pool?
   - Are shares being submitted?

2. **Mining Software Status**
   - Is cgminer/bmminer/btminer running?
   - Is the mining process active?

3. **Hardware State**
   - Are hashboards initialized?
   - Are ASICs responding?

**Key Point:** A miner can have hashrate (from cached/stale data) but `is_mining=False` if:
- Pool connection is lost
- Mining software crashed but hardware still reports stats
- Miner is in "zombie state" after power outage
- Shares are not being accepted by pool

---

## Possible Root Causes

### 1. Pool Connection Lost ⚠️
**Most Likely**

The miner lost connection to the mining pool but is still hashing locally (shares not being submitted).

**Check:**
```bash
# Check pool status on miner
curl -u root:root http://192.168.1.114/cgi-bin/pools.cgi

# Expected: Pool status should be "Alive"
# If "Dead" or "Rejecting": Pool connection issue
```

**Fix:**
- Check pool URL is correct
- Verify pool is reachable from miner
- Check worker credentials
- Restart miner to reconnect

### 2. Mining Software Crashed 🔧
The mining software (bmminer/cgminer) stopped but hardware still reports metrics.

**Check:**
```bash
# SSH to miner (if accessible)
ssh root@192.168.1.114
ps aux | grep miner

# Or via API
curl http://192.168.1.114:4028 -d '{"command":"summary"}'
```

**Fix:**
- Restart mining software via web interface
- Or use backend API: `POST /api/mining/miners/192.168.1.114/reboot`

### 3. Zombie State After Power Outage 💀
Miner is reporting stale data after power was restored.

**Indicators:**
- Hashrate present but `is_mining=0`
- Power consumption very low
- Uptime doesn't increase

**Fix:**
- Power cycle the miner
- Full reboot via web interface

### 4. Share Rejection Issues 📊
Miner is hashing but all shares are being rejected by pool.

**Check:**
```bash
# Check rejection rate
curl -s "http://192.168.1.66:8000/metrics" | grep "workerS19" | grep rejected
```

**Fix:**
- Check pool difficulty settings
- Verify miner time is synchronized
- Check for network latency issues

---

## How to Diagnose

### Step 1: Check Miner Web Interface
```
http://192.168.1.114
```

Look for:
- Pool status (should be "Alive")
- Mining software status
- Recent errors or warnings

### Step 2: Check Pool Connection
```bash
# Via backend API
curl http://192.168.1.66:5000/api/mining/miners/192.168.1.114/pools
```

Expected response:
```json
{
  "success": true,
  "pools": [
    {
      "url": "pool.example.com:3333",
      "status": "Alive",  ← Should be "Alive"
      "accepted": 12345,
      "rejected": 123
    }
  ]
}
```

### Step 3: Check Detailed Metrics
```bash
# Get all metrics for this miner
curl -s "http://192.168.1.66:8000/metrics" | grep "192.168.1.114"
```

Look for:
- `miner_pool_accepted` - Should be increasing
- `miner_pool_rejected` - Should be low
- `miner_uptime_seconds` - Should be increasing
- `miner_power_watts` - Should be ~3250W for S19

### Step 4: Check Python Scheduler Logs
```bash
ssh admin@192.168.1.66
docker logs --tail 200 mining-stack-python-scheduler-1 | grep "workerS19"
```

Look for:
- Connection errors
- PyASIC errors
- Pool status messages

---

## How to Fix

### Option 1: Restart Mining Software (Recommended)
```bash
# Via backend API
curl -X POST http://192.168.1.66:5000/api/mining/miners/192.168.1.114/reboot
```

This sends a restart command to the mining software without power cycling.

### Option 2: Restart via Web Interface
1. Go to `http://192.168.1.114`
2. Login (root/root or admin/admin)
3. Navigate to "Miner Configuration" or "System"
4. Click "Restart" or "Reboot CGMiner"

### Option 3: Power Cycle (Last Resort)
If software restart doesn't work:
1. Physically power off the miner
2. Wait 30 seconds
3. Power back on
4. Wait 2-3 minutes for full boot

---

## Expected Behavior After Fix

After restarting, within 5 minutes:

1. **`miner_is_mining` should change to 1.0**
   ```prometheus
   miner_is_mining{name="workerS19"} = 1.0  ← Fixed!
   ```

2. **Alert should resolve**
   - State changes from "firing" to "resolved"
   - Telegram notification: "Resolved: Miner workerS19 stopped mining"

3. **Pool status should be "Alive"**
   ```json
   {"status": "Alive", "accepted": 12345}
   ```

---

## Prevention

### Monitor Pool Connection
Enable the `PoolUnreachable` alert (already enabled):
```yaml
- alert: PoolUnreachable
  expr: pool_network_reachable == 0
  for: 5m
```

### Regular Health Checks
The Python scheduler checks miners every 30 seconds and will detect:
- Pool disconnections
- Mining software crashes
- Hardware failures

### Automatic Recovery
Consider implementing automatic restart on `MinerNotMining` alert:
- After alert fires for 10 minutes
- Automatically send restart command
- Log the action for review

---

## Summary

| Aspect | Value |
|--------|-------|
| **Alert** | MinerNotMining |
| **Trigger** | `is_mining=0` AND `scrape_status>=1` for 5min |
| **Root Cause** | Likely pool connection lost or mining software crashed |
| **Current State** | Hashrate present (97.59 TH/s) but not mining |
| **Recommended Fix** | Restart mining software via API or web interface |
| **Expected Resolution** | Within 5 minutes after restart |

**Action Required:** Restart workerS19 to restore pool connection and resume mining.
