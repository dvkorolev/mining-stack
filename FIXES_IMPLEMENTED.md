# Fixes Implemented - November 14, 2025

## Summary
Fixed critical bugs in metrics collection, status determination, and frontend validation.

---

## 1. Miner Status Logic Fixes

### Issue: Miners Showing Offline Incorrectly

#### Problem 1: Backend Status Determination Bug
**File:** `backend/src/services/mining.service.ts`
**Lines:** 1187-1211

**Root Cause:**
- Status logic didn't handle all `state` values properly
- When `scrape_status > 0` (data collected) but `state === 0` (faulty), it fell through to `status = 'error'`
- Missing explicit handling for `state === 0` case

**Fix:**
```typescript
// BEFORE: Incomplete state handling
if (m.scrape_status > 0 && m.state === 2) {
  status = 'online';
} else if (m.scrape_status > 0 && m.state === 1) {
  status = 'offline';
} else {
  status = 'error';  // ❌ Wrong for state === 0
}

// AFTER: Complete state handling
if (m.scrape_status > 0) {
  if (m.state === 2) {
    status = 'online';   // Mining with hashrate
  } else if (m.state === 1) {
    status = 'offline';  // Idle (not mining intentionally)
  } else if (m.state === 0) {
    status = 'offline';  // Faulty but reachable
  } else {
    status = 'offline';  // Unknown state, default to offline
  }
}
```

**State Values:**
- `state === 2` → Mining (hashrate > 0)
- `state === 1` → Idle (hashrate = 0, not mining intentionally)
- `state === 0` → Faulty (hashrate = 0, should be mining)

---

#### Problem 2: Fallback State Calculation Inconsistency
**File:** `python-scheduler/main.py`
**Lines:** 507-510

**Root Cause:**
- Fallback state calculation didn't match primary collection logic
- Simplified to `state = 2 if hashrate > 0 else 0`
- Didn't consider `is_mining` flag, causing miners to be marked faulty instead of idle

**Fix:**
```python
# BEFORE: Simplified logic (incorrect)
miner_data['state'] = 2 if hashrate_val > 0 else 0

# AFTER: Consistent with primary collection
is_mining = fallback_data.get('is_mining', True)
miner_data['is_mining'] = 1 if is_mining else 0
# state: 2=mining (hashrate>0), 1=idle (hashrate=0, not mining), 0=faulty (hashrate=0, should be mining)
miner_data['state'] = 2 if hashrate_val > 0 else (1 if not is_mining else 0)
```

---

## 2. Algorithm Label Consistency Fixes

### Issue: Metrics with Inconsistent Algorithm Labels

#### Problem 1: Missing Algorithm Parameter in Fallback
**File:** `python-scheduler/main.py`
**Lines:** 493-500

**Root Cause:**
- `_update_metrics()` call in fallback logic didn't pass algorithm parameter
- Caused auto-detection instead of using config's explicit algorithm
- Could create duplicate metrics with different algorithm labels

**Fix:**
```python
# BEFORE: Missing algorithm parameter
_update_metrics(
    fallback_data,
    miner['ip'],
    miner['name'],
    miner['model'],
    new_scrape_status
)  # ❌ Algorithm not passed

# AFTER: Algorithm from config
_update_metrics(
    fallback_data,
    miner['ip'],
    miner['name'],
    miner['model'],
    new_scrape_status,
    miner.get('algorithm')  # ✅ Pass algorithm from config
)
```

---

#### Problem 2: Explicit State Metric Wrong Algorithm Detection
**File:** `python-scheduler/main.py`
**Lines:** 513-519

**Root Cause:**
- Used hardcoded default `algorithm = miner.get('algorithm', 'sha256')`
- Didn't use same detection logic as `_update_metrics()`
- Could create label mismatch between metrics

**Fix:**
```python
# BEFORE: Simple default (inconsistent)
algorithm = miner.get('algorithm', 'sha256')

# AFTER: Use same detection as _update_metrics
is_scrypt = _is_scrypt_miner(miner['model'], miner.get('algorithm'))
algorithm = 'scrypt' if is_scrypt else 'sha256'
```

**Algorithm Detection Priority:**
1. Explicit config override (`miner.get('algorithm')`)
2. Profile library lookup
3. Legacy pattern matching (dg1, l3, l7, etc.)

---

## 3. TypeScript Compilation Fix

### Issue: Build Failure - Implicit 'any' Type

#### Problem: Missing Type Annotation
**File:** `backend/src/services/pools-config.service.ts`
**Line:** 454

**Root Cause:**
- Parameter `miner` implicitly had `any` type
- TypeScript strict mode requires explicit types

**Fix:**
```typescript
// BEFORE: Implicit any type
miners.map(async (miner) => {

// AFTER: Explicit type
import type { MinerConfig } from '../config/miners.config';
...
miners.map(async (miner: MinerConfig) => {
```

---

## 4. Frontend Pool Form Validation Fixes

### Issue: URL Validation Edge Cases

#### Problem 1: URL Split Logic
**File:** `frontend/src/components/pools/PoolForm.tsx`
**Lines:** 68-71

**Root Cause:**
- Used `split(':')` which fails for:
  - URLs with protocols: `stratum+tcp://pool.com:3333`
  - IPv6 addresses
  - Multiple colons

**Fix:**
```typescript
// BEFORE: Simple split (fails for protocols)
const [hostname, portStr] = formData.url.split(':');

// AFTER: Right-split and protocol stripping
const parts = formData.url.split(':');
const portStr = parts[parts.length - 1];
const hostname = parts.slice(0, -1).join(':');
const cleanHostname = hostname.replace(/^(stratum\+tcp|stratum\+ssl|stratum):\/\//, '');
```

---

#### Problem 2: Port Validation
**File:** `frontend/src/components/pools/PoolForm.tsx`
**Lines:** 81-88

**Root Cause:**
- Didn't validate empty port strings
- `pool.com:` → port becomes empty string, parseInt returns NaN, but no check for empty string

**Fix:**
```typescript
// BEFORE: No empty check
const port = parseInt(portStr, 10);
if (isNaN(port) || port < 1 || port > 65535) {
  newErrors.url = 'Port must be between 1 and 65535';
}

// AFTER: Explicit empty check
if (!portStr || portStr.trim().length === 0) {
  newErrors.url = 'Port is required';
} else {
  const port = parseInt(portStr, 10);
  if (isNaN(port) || port < 1 || port > 65535) {
    newErrors.url = 'Port must be a number between 1 and 65535';
  }
}
```

---

## Testing Recommendations

### 1. Miner Status Testing
- [ ] Test miners with `state === 0` (faulty) show as offline, not error
- [ ] Test fallback drivers correctly set state based on `is_mining` flag
- [ ] Verify miners with zero hashrate but idle show state=1

### 2. Algorithm Label Testing
- [ ] Verify fallback metrics use same algorithm as primary
- [ ] Check Prometheus for duplicate metrics with different algorithms
- [ ] Test explicit algorithm override in miner config

### 3. Frontend Validation Testing
- [ ] Test URL: `stratum+tcp://pool.com:3333` → validates correctly
- [ ] Test URL: `pool.com:` → shows "Port is required" error
- [ ] Test URL: `pool.com:abc` → shows "Port must be a number" error
- [ ] Test URL: `pool.com:99999` → shows port range error

---

## Validation Results

### State Calculation Truth Table
| Hashrate | is_mining | State | Meaning |
|----------|-----------|-------|---------|
| > 0 | True | 2 | Mining ✅ |
| > 0 | False | 2 | Mining ✅ |
| 0 | True | 0 | Faulty ✅ |
| 0 | False | 1 | Idle ✅ |

### Backend Status Mapping
| scrape_status | state | Backend status | Correct |
|---------------|-------|----------------|---------|
| > 0 | 2 | online | ✅ |
| > 0 | 1 | offline | ✅ |
| > 0 | 0 | offline | ✅ |
| === 0 | any | error | ✅ |
| < 0 | any | error | ✅ |

---

## Files Modified

1. `backend/src/services/mining.service.ts` - Status determination logic
2. `python-scheduler/main.py` - Fallback state calculation, algorithm passing
3. `backend/src/services/pools-config.service.ts` - TypeScript type annotation
4. `frontend/src/components/pools/PoolForm.tsx` - URL validation

---

## Impact Assessment

**Critical:** Miner status bugs - Fixes miners showing incorrectly as offline
**High:** Algorithm label consistency - Prevents metric duplication
**Medium:** TypeScript error - Unblocks build process
**Low:** Frontend validation - Improves edge case handling

---

## Notes

- All fixes maintain backward compatibility
- No database migrations required
- No configuration changes needed
- Changes are backward compatible with existing data
