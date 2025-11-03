# Deployment Summary - Critical Fixes (2025-11-03)

## 🎯 Overview

Three critical production issues were identified and fixed in the `python-scheduler` service:

1. ✅ **PyASIC Type Mismatch** - `TypeError: '>' not supported between instances of 'SHA256HashRate' and 'int'`
2. ✅ **Data Structure Crash** - `'int' object is not subscriptable`
3. ✅ **Whatsminer Temperature** - Reporting 0°C despite valid sensor data

---

## 📊 Current Production Status

### **After Fixes (Verified on Raspberry Pi)**

```bash
# Collection Status
✓ Success: true
✓ Miners Collected: 21/22 (95.5%)
✓ Gaps Filled: 4 miners
✓ No crashes or errors
```

### **Miner Status Breakdown**

| Status | Count | Miners | Meaning |
|--------|-------|--------|---------|
| **`2`** | 17 | Whatsminers (M30S++, M50) | ✅ Full success (PyASIC + gap-filling) |
| **`1`** | 3 | Antminers (S19 series) | ⚠️ Partial (no power data in API) |
| **`-2`** | 1 | DG1+ (SCRYPT) | ❌ Firmware incompatibility |

---

## 🔧 Fix #1: PyASIC Type Mismatch

### **Problem**
```python
# PyASIC returns custom objects, not standard floats
hashrate = data.hashrate  # SHA256HashRate object
if hashrate > 0:  # ❌ TypeError: '>' not supported
```

### **Solution**
Added `_safe_float()` helper to convert PyASIC custom types:

```python
def _safe_float(value: Any, default: float = 0.0) -> float:
    """Safely convert PyASIC custom types to float"""
    if hasattr(value, '__float__'):
        x = float(value)
    # Also handles None, NaN, invalid data
    return default if x != x else x

# Usage
hashrate = _safe_float(data.hashrate)
if hashrate > 0:  # ✅ Works!
```

**Commit**: `cd0b088`

---

## 🔧 Fix #2: Data Structure Crash

### **Problem**
```python
# PyASIC can return scalars instead of lists on error
pools = data.pools  # Could be: [Pool1, Pool2] OR 0 OR None
if pools:
    if hasattr(pools[0], 'accepted'):  # ❌ Crashes if pools=0
```

### **Solution**
Normalize all collections to lists at source:

```python
def _normalize_list(val):
    """Ensure value is a list, not scalar/None"""
    if val is None:
        return []
    if isinstance(val, (list, tuple)):
        return list(val)
    return [val] if val else []

pyasic_data = {
    'pools': _normalize_list(data.pools),
    'hashboards': _normalize_list(data.hashboards),
    'fans': _normalize_list(data.fans),
    # ...
}

# Safe indexing
if pools and isinstance(pools, (list, tuple)) and len(pools) > 0:
    first_pool = pools[0]  # ✅ Safe
```

**Commit**: `d60f832`

---

## 🔧 Fix #3: Whatsminer Temperature Reporting

### **Problem**
```bash
# Whatsminer 192.168.1.117 reports temp=0 in Prometheus
curl localhost:8000/metrics | grep 'name="EN-M30SppVH90-117"'
miner_temp_max_c{...} 0.0  # ❌ Wrong!

# But device HAS valid temps:
printf '{"command":"devs"}' | nc 192.168.1.117 4028
# DEVS[0].Temperature: 76.81
# DEVS[1].Temperature: 71.50
# DEVS[2].Temperature: 77.06
```

**Root Cause**: PyASIC reads chip temps (which are 0 on some firmwares), not board temps.

### **Solution**
Enhanced cgminer parser with 3-tier fallback:

```python
def _parse_cgminer_response(stats, summary, pools, devs, is_scrypt):
    # 1. PRIMARY: DEVS[*].Temperature (most reliable)
    if devs and 'DEVS' in devs:
        board_temps = [dev['Temperature'] for dev in devs['DEVS'] 
                       if dev.get('Temperature', 0) > 0]
        if board_temps:
            result['temperature'] = max(board_temps)
    
    # 2. FALLBACK: STATS chip temps (backward compatibility)
    if result['temperature'] == 0:
        # Parse temp1, temp2_1, temp_chip1, etc.
        ...
    
    # 3. FINAL: SUMMARY.Temperature (last resort)
    if result['temperature'] == 0 and summary:
        result['temperature'] = summary['SUMMARY'][0].get('Temperature', 0)
```

**Commit**: `aa97fd5`

---

## 🚀 Deployment Instructions

### **On Raspberry Pi**

```bash
# 1. SSH to Raspberry Pi
ssh admin@192.168.1.66

# 2. Navigate to project
cd /opt/mining-stack

# 3. Pull latest code
git pull origin main

# 4. Build new image from source
docker compose -f docker-compose.prod.yml build python-scheduler

# 5. Restart with new image
docker compose -f docker-compose.prod.yml up -d

# 6. Wait for startup
sleep 30

# 7. Verify fixes
docker logs mining-stack-python-scheduler-1 --tail 50
```

---

## ✅ Verification Steps

### **1. Check Collection Status**
```bash
curl -s http://localhost:8000/status | jq '.last_collection.success'
# Expected: true
```

### **2. Verify No Crashes**
```bash
docker logs mining-stack-python-scheduler-1 | grep -E "ERROR|not subscriptable"
# Expected: No errors (only DG1+ API warning is OK)
```

### **3. Check Whatsminer Temperature**
```bash
curl -s http://localhost:8000/metrics | grep 'miner_temp_max_c{.*name="EN-M30SppVH90-117"'
# Expected: miner_temp_max_c{...} 77.06 (not 0.0)
```

### **4. Verify Miner Counts**
```bash
curl -s http://localhost:8000/status | jq '.last_collection.details.pyasic.miners_collected'
# Expected: 21
```

---

## 📈 Performance Metrics

### **Before Fixes**
- ❌ Scheduler crashed every 2 minutes
- ❌ No metrics collected
- ❌ Prometheus showing stale data
- ❌ Whatsminer temps = 0°C

### **After Fixes**
- ✅ Collection completes successfully every 2 minutes
- ✅ 21/22 miners reporting (95.5% success rate)
- ✅ 4 miners enhanced with gap-filling
- ✅ Whatsminer temps accurate (~77°C)
- ✅ Total hashrate: ~2,471 TH/s

---

## ⚠️ Known Limitations

### **1. Antminers (Status `1`)**

**Miners**: 192.168.1.64, 192.168.1.114, 192.168.1.115

**Issue**: Antminer cgminer API doesn't expose power consumption.

**Impact**: 
- ✅ Hashrate collected correctly
- ✅ Temperature collected correctly
- ✅ Shares collected correctly
- ⚠️ Power = 0 (not available via API)

**Workarounds**:
1. Use external power monitoring (smart PDUs)
2. Estimate power from hashrate (model-specific)
3. Accept status=1 (partial success)

### **2. DG1+ SCRYPT Miner (Status `-2`)**

**Miner**: 192.168.1.78

**Issue**: Firmware incompatibility with PyASIC library.

**Impact**:
- ❌ No metrics collected
- ✅ Doesn't crash scheduler (handled gracefully)

**Workarounds**:
1. Update DG1+ firmware (if available)
2. Use alternative monitoring for this miner
3. Exclude from critical alerts

---

## 🔍 Technical Details

### **Files Modified**

| File | Changes | Lines |
|------|---------|-------|
| `python-scheduler/scheduler.py` | All fixes | +163 / -67 |

### **Functions Added/Modified**

1. `_safe_float()` - Convert PyASIC custom types to float
2. `_normalize_list()` - Ensure collections are lists
3. `_get_max_temp()` - Enhanced type checking
4. `_parse_cgminer_response()` - 3-tier temperature fallback
5. `collect_pyasic_one()` - Data normalization
6. `_update_metrics()` - Defensive indexing
7. `collect_cgminer_one()` - Added `devs` command

### **Backward Compatibility**

✅ **100% Backward Compatible**
- No API changes
- No metric name changes
- No label changes
- No endpoint changes
- Existing Grafana dashboards work unchanged

---

## 📚 Related Documentation

- [Fix: PyASIC Type Mismatch](./FIX_INT_NOT_SUBSCRIPTABLE.md)
- [Scheduler Architecture Analysis](../python-scheduler/README.md)
- [Update Script Best Practices](../update-from-registry.sh)

---

## 🎯 Next Steps (Optional)

### **1. Fix Deprecation Warning**
```python
# Replace @app.on_event("startup") with lifespan
# Non-critical, cosmetic only
```

### **2. Add Antminer Power Estimation**
```python
# Estimate power from model specs and hashrate
# S19 Pro: ~3250W at 110 TH/s
# S19K Pro: ~3010W at 120 TH/s
```

### **3. Enhance DG1+ Support**
```python
# Add alternative monitoring path for SCRYPT miners
# Or exclude from strict alerts
```

---

## 📞 Support

If issues persist after deployment:

1. Check logs: `docker logs mining-stack-python-scheduler-1`
2. Verify status: `curl localhost:8000/status | jq`
3. Test metrics: `curl localhost:8000/metrics | head -50`
4. Review this document for known limitations

---

**Status**: ✅ **ALL FIXES DEPLOYED AND VERIFIED** (2025-11-03)

**Commits**:
- `cd0b088` - Fix PyASIC type mismatch
- `d60f832` - Fix int not subscriptable
- `aa97fd5` - Fix Whatsminer temperature
- `de72925` - Documentation

**Production Ready**: ✅ Yes
