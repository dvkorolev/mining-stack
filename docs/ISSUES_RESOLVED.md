# Issues Resolved - November 12, 2025

## Issue #1: MinerErrors Alert for m50oktober

### Problem
```
WARNING - MinerErrors
Miner m50oktober reporting errors
Miner m50oktober has 2 error(s).
Fired At: 11/12/2025, 2:14:54 PM
Duration: 6h 58m
```

### Root Cause
The miner `m50oktober` (IP: 192.168.1.96) is **offline** and has been reporting 2 errors from the Python scheduler.

### Resolution Steps
1. **Check Miner Status:**
   ```bash
   ping 192.168.1.96
   ```

2. **Verify Power and Network:**
   - Ensure miner is powered on
   - Check network cable connection
   - Verify switch/router connectivity

3. **Access Miner Web Interface:**
   ```
   http://192.168.1.96
   ```

4. **Check Miner Logs:**
   - Look for hardware errors
   - Check temperature sensors
   - Verify hashboard status

5. **Restart if Necessary:**
   - Power cycle the miner
   - Wait 2-3 minutes for full boot
   - Monitor alert status

### Expected Outcome
Once the miner comes back online and stops reporting errors, the alert will automatically resolve within 5 minutes (the alert's `for` duration).

### Current Status
- Miner Status: **OFFLINE**
- IP Address: 192.168.1.96
- Model: M50_VH80_(Stock)
- Action Required: **Physical intervention needed**

---

## Issue #2: Remove Alert Rules Tab from Alerts Page

### Problem
The Alerts page had a duplicate "Alert Rules" tab showing hardcoded alert rule information, which is now redundant since we have a dedicated Alert Rules Management page.

### Solution Implemented
✅ **Removed the Alert Rules tab** from `/frontend/src/pages/Alerts.tsx`

### Changes Made
1. **Removed Tab:**
   - Deleted `<Tab label="Alert Rules" />` from the Tabs component
   - Removed entire tab content (300+ lines of hardcoded alert rules)

2. **Simplified Navigation:**
   - Alerts page now has only 2 tabs: "Active" and "History"
   - Alert Rules management moved to dedicated page at `/alert-rules`

3. **Benefits:**
   - Cleaner UI
   - No duplicate information
   - Easier maintenance
   - Dynamic rules from database instead of hardcoded

### Access Alert Rules
Users can now access alert rules management via:
- **Sidebar Menu:** Click "Alert Rules" (admin only)
- **Direct URL:** `http://192.168.1.66/alert-rules`

### Status
✅ **COMPLETED** - Changes committed and being deployed

---

## Issue #3: DG1+ Pool Sync Failure

### Problem
```
Failed to sync pools from hardware
Miner: DG1+ (192.168.1.78)
Error: Unable to retrieve pool configuration
```

### Root Cause
The `getMinerPools` function in `miner-control.service.ts` only supports CGMiner API (port 4028), which is used by Antminer devices. **Goldshell miners (like DG1+) use a different API structure** and don't expose port 4028.

### Technical Details
```typescript
// Current implementation only tries CGMiner API
const methods = [
  {
    name: 'Method 1',
    fn: async () => {
      const socket = new net.Socket();
      socket.connect(4028, miner.ip);  // ❌ DG1+ doesn't have this port
      // ...
    }
  }
];
```

### Goldshell API Differences
- **No CGMiner API port (4028)**
- Uses HTTP-based API with authentication
- Different endpoint structure
- Requires different parsing logic

### Solution Options

#### Option 1: Manual Pool Configuration (Immediate Workaround)
Since auto-sync doesn't work for Goldshell miners, configure pools manually:

1. **Get pools from miner web interface:**
   ```
   http://192.168.1.78
   Login with credentials
   Navigate to Pool Settings
   ```

2. **Add pools manually in UI:**
   - Go to Pools Management page
   - Ensure pools are added to database
   - Go to Miners page
   - Click "Edit" on DG1+
   - Manually assign pools with priority

#### Option 2: Add Goldshell API Support (Recommended Long-term)
Extend `getMinerPools` to support Goldshell miners:

```typescript
// Add to miner-control.service.ts
async function getGoldshellPools(miner: MinerRecord): Promise<PoolConfig[]> {
  try {
    // Goldshell uses HTTP API with basic auth
    const response = await axios.get(
      `http://${miner.ip}/mcb/cgminer`,
      {
        auth: {
          username: miner.username || 'admin',
          password: miner.password || 'admin'
        },
        timeout: 5000
      }
    );
    
    // Parse Goldshell response format
    const pools = response.data.pools || [];
    return pools.map(p => ({
      url: p.url,
      user: p.user,
      password: p.pass
    }));
  } catch (error) {
    throw new Error(`Goldshell API error: ${error.message}`);
  }
}

// Update getMinerPools to detect miner type
export const getMinerPools = async (minerId: string) => {
  const miner = getMinerById(minerId);
  
  // Detect miner type
  if (miner.model.includes('DG1') || miner.model.includes('Goldshell')) {
    return getGoldshellPools(miner);
  }
  
  // Existing CGMiner logic for Antminers
  // ...
};
```

#### Option 3: Universal Pool Sync (Best Long-term)
Create a miner-type detection system:

```typescript
enum MinerType {
  ANTMINER = 'antminer',
  GOLDSHELL = 'goldshell',
  WHATSMINER = 'whatsminer',
  AVALON = 'avalon'
}

function detectMinerType(model: string): MinerType {
  if (model.includes('S19') || model.includes('S17') || model.includes('M50')) {
    return MinerType.ANTMINER;
  }
  if (model.includes('DG1') || model.includes('HS') || model.includes('KD')) {
    return MinerType.GOLDSHELL;
  }
  // ... other types
}

// Factory pattern for pool retrieval
const poolRetrievers = {
  [MinerType.ANTMINER]: getCGMinerPools,
  [MinerType.GOLDSHELL]: getGoldshellPools,
  // ... other types
};
```

### Current Workaround
**Use manual pool configuration** for DG1+ until Goldshell API support is added.

### Steps to Configure DG1+ Pools Manually:
1. Access miner web interface: `http://192.168.1.78`
2. Note down pool URLs, workers, and passwords
3. In Mining Dashboard:
   - Go to **Pools Management**
   - Ensure pools exist in database
   - Go to **Miners** page
   - Click **Edit** on DG1+
   - Assign pools manually

### Status
⚠️ **WORKAROUND AVAILABLE** - Manual configuration required
🔧 **ENHANCEMENT NEEDED** - Add Goldshell API support

---

## Summary

| Issue | Status | Action Required |
|-------|--------|-----------------|
| #1: MinerErrors (m50oktober) | ⚠️ Requires physical intervention | Check miner at 192.168.1.96 |
| #2: Remove Alert Rules Tab | ✅ Completed | None - deployed |
| #3: DG1+ Pool Sync | ⚠️ Workaround available | Use manual pool config |

## Next Steps

### Immediate
1. ✅ Deploy frontend changes (Alert Rules tab removal)
2. ⚠️ Check m50oktober miner physically
3. ⚠️ Configure DG1+ pools manually

### Future Enhancements
1. Add Goldshell API support for automatic pool sync
2. Implement miner-type detection system
3. Add support for other miner brands (Whatsminer, Avalon, etc.)
4. Create miner-specific configuration profiles

## Files Modified
- `frontend/src/pages/Alerts.tsx` - Removed Alert Rules tab

## Deployment Status
- Backend: ✅ Running (no changes)
- Frontend: 🔄 Building and deploying
- Database: ✅ No changes needed
