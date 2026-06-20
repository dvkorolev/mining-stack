# SCRYPT Miner Telegram Display Fix

## Problem
The DG1+ SCRYPT miner was showing `0 TH/s` in Telegram bot messages instead of the correct hashrate in GH/s.

### Root Causes:
1. **Low Hashrate Error Check**: Backend was flagging SCRYPT miners as "error" because their TH/s values (0.025 TH/s = 25 GH/s) were below the 10 TH/s threshold meant for SHA-256 miners.
2. **Algorithm Field Not Populated**: The `algorithm` field wasn't being passed through the full data pipeline, causing the `formatHashrate()` function to default to TH/s display.

## Solution

### 1. Fixed Low Hashrate Check
**File**: `backend/src/services/mining.service.ts`

Changed the low hashrate error check to only apply to SHA-256 miners:

```typescript
// Before:
} else if (currentHashrate < 10 && currentHashrate > 0) {
  // Very low hashrate might indicate an issue
  status = 'error';
  ...
}

// After:
} else if (currentHashrate < 10 && currentHashrate > 0 && algorithm === 'sha256') {
  // Very low hashrate might indicate an issue (only for SHA-256)
  // SCRYPT miners have much lower TH/s values (0.025 TH/s = 25 GH/s)
  status = 'error';
  ...
}
```

### 2. Added Algorithm to Backend Pipeline
**Files**: 
- `backend/src/services/prometheus.service.ts`
- `backend/src/services/mining.service.ts`

Added `getMinerAlgorithms()` function and included algorithm in the metrics pipeline:

```typescript
// prometheus.service.ts
export async function getMinerAlgorithms(): Promise<Map<string, 'sha256' | 'scrypt'>> {
  const query = 'miner_hashrate_ths{algorithm="sha256"} or miner_hashrate_mhs{algorithm="scrypt"}';
  // ... returns Map<ip, algorithm>
}

// mining.service.ts
const getRealMinerStats = async (
  miner: any,
  metrics: {
    // ... other metrics
    algorithms: Map<string, 'sha256' | 'scrypt'>;
  }
): Promise<MinerStats> => {
  const algorithm = metrics.algorithms.get(ip) ?? 'sha256';
  // ... includes algorithm in return value
}
```

### 3. Telegram Bot Already Had Support
**File**: `backend/src/services/telegram.service.ts`

The `formatHashrate()` function was already implemented correctly:

```typescript
const formatHashrate = (hashrateThs: number, algorithm?: 'sha256' | 'scrypt'): string => {
  if (!hashrateThs || hashrateThs === 0) return '0 TH/s';
  
  // For SCRYPT, display in GH/s (multiply by 1000)
  if (algorithm === 'scrypt') {
    const hashrateGhs = hashrateThs * 1000;
    return `${hashrateGhs.toFixed(2)} GH/s`;
  }
  
  // For SHA-256 or unknown, display in TH/s
  return `${hashrateThs.toFixed(2)} TH/s`;
};
```

It just needed the `algorithm` field to be populated!

## Result

### Before:
```
🔴 Мой доге дг1
📊 Status: ERROR
⚡ Performance:
Current: 0 TH/s
Average: 0 TH/s
```

### After:
```
🟢 Мой доге дг1
📊 Status: ONLINE
⚡ Performance:
Current: 25.48 GH/s
Average: 25.48 GH/s
```

## Technical Details

### Hashrate Storage:
- **SHA-256**: Stored as TH/s in Prometheus (`miner_hashrate_ths`)
- **SCRYPT**: Stored as MH/s in Prometheus (`miner_hashrate_mhs`)
- **Backend**: Converts SCRYPT to TH/s for consistency (÷ 1,000,000)
- **Display**: Telegram converts back to GH/s for SCRYPT (× 1,000)

### Data Flow:
```
Prometheus
  ├─→ SHA-256: 100 TH/s
  └─→ SCRYPT: 25,000 MH/s
        ↓
Backend (Prometheus Service)
  ├─→ SHA-256: 100 TH/s
  └─→ SCRYPT: 0.025 TH/s (converted)
        ↓
Backend (Mining Service)
  ├─→ Includes algorithm field
  └─→ No error for SCRYPT < 10 TH/s
        ↓
Telegram Bot
  ├─→ SHA-256: "100.00 TH/s"
  └─→ SCRYPT: "25.00 GH/s" (× 1000)
```

## Commits
1. `59fc414` - Complete algorithm separation implementation
2. `555d7ab` - Fix SCRYPT low hashrate error check

## Testing
- ✅ DG1+ miner (192.168.1.78) shows correct hashrate in Telegram
- ✅ Status changed from ERROR to ONLINE
- ✅ Hashrate displays as GH/s for SCRYPT
- ✅ SHA-256 miners still show TH/s correctly
- ✅ Low hashrate alerts only trigger for SHA-256 miners

## Files Modified
- `backend/src/services/prometheus.service.ts` - Added `getMinerAlgorithms()`
- `backend/src/services/mining.service.ts` - Fixed low hashrate check, added algorithm field
- `backend/src/services/telegram.service.ts` - Already had correct formatting

## Related Documentation
- `ALGORITHM_SEPARATION.md` - Usage guide
- `ALGORITHM_SEPARATION_IMPLEMENTATION.md` - Implementation details
- `COMPLETE_ALGORITHM_SEPARATION.md` - Full implementation summary
