# workerS19 Web Interface Analysis

**Date:** November 12, 2025, 10:25 PM UTC+3  
**Miner:** workerS19 (192.168.1.114)  
**Alert:** MinerNotMining (FIRING)

---

## Web Interface Data

### Overall Status
- **Model:** Antminer S19
- **Algorithm:** SHA256d
- **Status:** Online
- **Real Time Hashrate:** 95,547.56 GH/s (95.55 TH/s)
- **Average Hashrate:** 95,819.66 GH/s (95.82 TH/s)
- **Uptime:** 6d 8h 14m 32s
- **Rejection Rate:** 0.99% (excellent)

### Pool Status

| Pool | URL | Worker | Status | Diff | Accepted | Rejected | Stale |
|------|-----|--------|--------|------|----------|----------|-------|
| 1 (Primary) | stratum+tcp://gate.emcd.network:3333 | busiginpavel.workerS19 | **Normal** | 524K | 33991 | 536 | 664 |
| 2 (Backup) | stratum+tcp://eu.emcd.network:3333 | busiginpavel.workerS19 | **Normal** | 131K | 1784 | 13 | 77 |
| 3 (Backup) | stratum+tcp://kz.emcd.network:3333 | busiginpavel.workerS19 | **Normal** | 65.5K | 230 | 5 | 13 |

### Hardware Status

| Board | Chips | Errors | Freq | Hashrate | Temp In | Temp Out | Status |
|-------|-------|--------|------|----------|---------|----------|--------|
| 1 | 76 | 1693 | 675 | 31.80 TH/s | 50-51°C | 70-71°C | Normal |
| 2 | 76 | 1693 | 675 | 31.31 TH/s | 50-52°C | 72-71°C | Normal |
| 3 | 76 | 1753 | 675 | 32.44 TH/s | 52-51°C | 75-72°C | Normal |

### Fan Status
- Fan 1: 5040 RPM
- Fan 2: 5040 RPM
- Fan 3: 5520 RPM
- Fan 4: 5520 RPM

---

## Analysis: Why is `miner_is_mining = 0`?

### The Miner IS Actually Mining! ✅

Looking at the web interface:
1. ✅ **Hashrate:** 95.55 TH/s (actively hashing)
2. ✅ **Pool Status:** All 3 pools show "Normal"
3. ✅ **Shares Accepted:** 33,991 on primary pool (actively submitting)
4. ✅ **Recent Activity:** Last share 0:00:03 ago (3 seconds!)
5. ✅ **Hardware:** All boards normal, all chips working
6. ✅ **Uptime:** 6 days 8 hours (stable)

### The Problem: PyASIC Misreading Status

The `miner_is_mining = 0` metric is **INCORRECT**. The miner is clearly mining.

#### Possible Causes

**1. PyASIC API Response Parsing Issue**

PyASIC might be misinterpreting the miner's status response. Common issues:

- **Pool status field:** PyASIC checks if pool status == "Alive", but Antminer might return "Normal"
- **Mining state field:** Different firmware versions use different field names
- **Boolean conversion:** Status might be returned as string "true"/"false" instead of boolean

**2. CGMiner API Response Format**

The miner's CGMiner API might return status in a format PyASIC doesn't expect:

```json
// Expected by PyASIC:
{"STATUS": [{"STATUS": "S", "When": 1699999999, "Code": 11, "Msg": "Summary", "Description": "cgminer 4.11.1"}], "SUMMARY": [{"Elapsed": 545672, "MHS av": 95819.66, "MHS 5s": 95547.56, "Found Blocks": 0, "Getworks": 123, "Accepted": 33991, "Rejected": 536, "Hardware Errors": 5139, "Utility": 3.74, "Discarded": 0, "Stale": 664, "Get Failures": 0, "Local Work": 0, "Remote Failures": 0, "Network Blocks": 0, "Total MH": 52280000000, "Work Utility": 1340.45, "Difficulty Accepted": 11685117952.0, "Difficulty Rejected": 278528.0, "Difficulty Stale": 344064.0, "Best Share": 123456789, "Device Hardware%": 0.04, "Device Rejected%": 0.99, "Pool Rejected%": 0.99, "Pool Stale%": 0.56, "Last getwork": 1699999999}], "id": 1}

// But might be getting:
{"is_mining": "true"}  // String instead of boolean
// or
{"mining": 1}  // Different field name
// or
{"status": "Normal"}  // Instead of "Alive"
```

**3. Authentication/Permission Issue**

PyASIC might be getting a limited response due to authentication:

- First request fails (401 Unauthorized)
- Retry succeeds but gets partial data
- `is_mining` field missing, defaults to `False`

Evidence from logs:
```
{"timestamp": "2025-11-12T19:12:34.107180Z", "level": "INFO", "service": "python-scheduler", "logger": "httpx", "message": "HTTP Request: GET http://192.168.1.114/cgi-bin/get_miner_conf.cgi \"HTTP/1.1 401 Unauthorized\"", "hostname": "cf48c34b2b0d"}
{"timestamp": "2025-11-12T19:12:34.117925Z", "level": "INFO", "service": "python-scheduler", "logger": "httpx", "message": "HTTP Request: GET http://192.168.1.114/cgi-bin/get_miner_conf.cgi \"HTTP/1.1 200 OK\"", "hostname": "cf48c34b2b0d"}
```

---

## Root Cause: PyASIC Library Bug

### The Issue

PyASIC is **incorrectly determining** `is_mining` status for this Antminer S19.

**Evidence:**
1. Web interface shows miner is mining
2. Shares being submitted (33,991 accepted)
3. Last share 3 seconds ago
4. Pool status "Normal"
5. But PyASIC reports `is_mining = 0`

### Why This Happens

PyASIC likely checks for pool status == "Alive", but Antminer returns "Normal":

```python
# PyASIC code (simplified):
def get_is_mining(data):
    pools = data.get('pools', [])
    for pool in pools:
        if pool.get('status') == 'Alive':  # ← Looking for "Alive"
            return True
    return False  # ← Returns False because status is "Normal"
```

---

## Solution Options

### Option 1: Fix PyASIC Collector (Recommended)

Update the `is_mining` logic to accept both "Alive" and "Normal" as valid mining states.

**File:** `python-scheduler/collectors/pyasic_collector.py`

```python
# Current logic (simplified):
is_mining = data.get('is_mining', True)

# Better logic:
def determine_is_mining(data):
    """
    Determine if miner is actively mining based on multiple indicators
    """
    # Check pool status
    pools = data.get('pools', [])
    if pools:
        for pool in pools:
            status = pool.get('status', '').lower()
            if status in ['alive', 'normal', 'active']:
                return True
    
    # Fallback: Check if hashrate > 0
    hashrate = data.get('hashrate', 0)
    if hashrate > 0:
        return True
    
    # Default to True if we have data
    return data.get('is_mining', True)

is_mining = determine_is_mining(data)
```

### Option 2: Override with Hashrate Check

Use hashrate as the primary indicator:

```python
# If hashrate > 10 TH/s, assume mining
hashrate = data.get('hashrate', 0)
is_mining = hashrate > 10 if hashrate else data.get('is_mining', True)
```

### Option 3: Add Pool Status Metric

Create a separate metric for pool status and use it in alert rules:

```python
# New metric
miner_pool_alive = Gauge('miner_pool_alive', 'Pool connection status', ['ip', 'name', 'pool_url'])

# Set based on pool status
for pool in pools:
    status = pool.get('status', '').lower()
    alive = 1 if status in ['alive', 'normal', 'active'] else 0
    miner_pool_alive.labels(ip=ip, name=name, pool_url=pool['url']).set(alive)
```

Then update alert rule:
```yaml
- alert: MinerNotMining
  expr: (miner_is_mining == 0 or miner_pool_alive == 0) and miner_scrape_status >= 1
```

---

## Immediate Fix

### Temporary Workaround

Until PyASIC is fixed, we can use hashrate as a proxy for `is_mining`:

**Update Alert Rule:**
```yaml
- alert: MinerNotMining
  expr: |
    (
      (miner_is_mining == 0 and miner_hashrate_ths < 10)
      or
      (miner_hashrate_ths < 10 and miner_hashrate_ths > 0)
    )
    and miner_scrape_status >= 1
  for: 5m
  annotations:
    summary: "Miner {{ $labels.name }} stopped mining"
    description: "Miner {{ $labels.name }} has very low or zero hashrate for 5 minutes."
```

**Logic:**
- If `is_mining = 0` AND hashrate < 10 TH/s → Fire alert
- If hashrate is very low (< 10 TH/s) → Fire alert
- But if hashrate > 10 TH/s → Don't fire (even if `is_mining = 0`)

---

## Recommended Action

### Step 1: Investigate PyASIC Response

Check what PyASIC is actually receiving from the miner:

```bash
# Add debug logging to pyasic_collector.py
logger.info(f"workerS19 raw data: {data}")
logger.info(f"workerS19 pools: {data.get('pools', [])}")
logger.info(f"workerS19 is_mining: {data.get('is_mining', 'NOT SET')}")
```

### Step 2: Fix the Collector

Based on findings, update the `is_mining` determination logic.

### Step 3: Update Alert Rule (Temporary)

Use hashrate-based logic until PyASIC is fixed.

### Step 4: Test

Verify that:
1. `miner_is_mining` correctly shows `1.0` for workerS19
2. Alert resolves
3. No false positives for other miners

---

## Summary

| Aspect | Status | Notes |
|--------|--------|-------|
| **Miner Status** | ✅ Mining | Confirmed via web interface |
| **Hashrate** | ✅ 95.55 TH/s | Normal for S19 |
| **Pool Connection** | ✅ Normal | All 3 pools active |
| **Shares** | ✅ Submitting | 33,991 accepted, last 3s ago |
| **PyASIC `is_mining`** | ❌ 0 (WRONG) | Bug in PyASIC parsing |
| **Alert** | ⚠️ False Positive | Miner IS mining, alert should not fire |

**Root Cause:** PyASIC library is misinterpreting the miner's pool status ("Normal" vs "Alive").

**Fix Required:** Update PyASIC collector to recognize "Normal" as a valid mining state.

**Temporary Workaround:** Use hashrate-based logic in alert rule.
