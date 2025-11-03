# 🔧 Threshold Update Issue - Diagnosis & Fix

## Problem

**Issue:** "Update of the threshold doesn't change error"

When updating a miner's threshold in the UI, the error indicator doesn't clear even after the threshold is successfully saved.

---

## Root Cause Analysis

### Current Flow:

1. ✅ User edits threshold in UI
2. ✅ Frontend calls `PUT /api/mining/miners/:minerId` with new thresholds
3. ✅ Backend `updateMiner()` saves to `miners.yaml`
4. ✅ Frontend reloads miners via `loadMiners()`
5. ❌ **BUT**: Error still shows because:
   - Prometheus hasn't been updated with new rules
   - Old alert is still active in Alertmanager
   - Stats service still shows the error

---

## The Issue

The threshold update flow is **incomplete**:

```
User updates threshold
  ↓
Backend saves to miners.yaml  ✅
  ↓
??? Prometheus rules NOT regenerated  ❌
  ↓
??? Alertmanager still has old alert  ❌
  ↓
UI still shows error  ❌
```

---

## Complete Fix

### Step 1: Auto-Generate Prometheus Rules After Save

**File:** `backend/src/config/miners.config.ts`

Add a function to trigger rule generation after save:

```typescript
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

/**
 * Regenerate Prometheus rules after config change
 */
const regeneratePrometheusRules = async (): Promise<void> => {
  try {
    const pythonPath = process.env.NODE_ENV === 'production'
      ? '/opt/mining-stack/venv/bin/python3'
      : path.join(process.cwd(), 'venv', 'bin', 'python3');
    
    const scriptPath = process.env.NODE_ENV === 'production'
      ? '/opt/mining-stack/bin/generate_prometheus_rules.py'
      : path.join(process.cwd(), 'bin', 'generate_prometheus_rules.py');
    
    logger.info('Regenerating Prometheus rules...');
    await execAsync(`${pythonPath} ${scriptPath}`);
    
    // Reload Prometheus
    await execAsync('docker exec mining-stack-prometheus-1 kill -HUP 1');
    
    logger.info('Prometheus rules regenerated and reloaded');
  } catch (error) {
    logger.error('Failed to regenerate Prometheus rules:', error);
    // Don't throw - config was saved successfully
  }
};
```

**Update `saveMinersConfig` function:**

```typescript
export const saveMinersConfig = (minersToSave: MinerConfig[]): void => {
  try {
    // ... existing save logic ...
    
    fs.writeFileSync(configPath, yamlStr, 'utf8');
    logger.info(`Saved ${minersToSave.length} miners to ${configPath}`);
    
    // Regenerate Prometheus rules after save
    regeneratePrometheusRules().catch(err => {
      logger.warn('Failed to auto-regenerate Prometheus rules:', err);
    });
    
  } catch (error) {
    logger.error('Failed to save miners configuration:', error);
    throw error;
  }
};
```

---

### Step 2: Clear Existing Alerts

When a threshold is updated, we should clear any existing alerts for that miner.

**Option A: Clear via Alertmanager API**

```typescript
const clearMinerAlerts = async (minerId: string): Promise<void> => {
  try {
    const alertmanagerUrl = process.env.ALERTMANAGER_URL || 'http://alertmanager:9093';
    
    // Silence alerts for this miner for 5 minutes
    // This gives time for new thresholds to take effect
    const silence = {
      matchers: [
        { name: 'miner', value: minerId, isRegex: false }
      ],
      startsAt: new Date().toISOString(),
      endsAt: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
      createdBy: 'threshold-update',
      comment: 'Threshold updated - clearing old alerts'
    };
    
    await fetch(`${alertmanagerUrl}/api/v2/silences`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(silence)
    });
    
    logger.info(`Cleared alerts for miner ${minerId}`);
  } catch (error) {
    logger.warn(`Failed to clear alerts for miner ${minerId}:`, error);
  }
};
```

**Update `updateMiner` function:**

```typescript
export const updateMiner = (minerId: string, updates: Partial<MinerConfig>): MinerConfig | null => {
  try {
    const index = miners.findIndex(m => m.name === minerId || m.ip === minerId);
    if (index === -1) {
      logger.warn(`Miner ${minerId} not found for update`);
      return null;
    }
    
    // Check if thresholds are being updated
    const thresholdsUpdated = updates.thresholds !== undefined;
    
    miners[index] = { 
      ...miners[index], 
      ...updates,
      lastSeen: new Date(),
    };
    
    saveMinersConfig(miners);
    
    // If thresholds were updated, clear existing alerts
    if (thresholdsUpdated) {
      clearMinerAlerts(minerId).catch(err => {
        logger.warn('Failed to clear alerts:', err);
      });
    }
    
    logger.info(`Updated miner: ${miners[index].name} (${miners[index].ip})`);
    return miners[index];
  } catch (error) {
    logger.error('Failed to update miner:', error);
    throw error;
  }
};
```

---

### Step 3: Update Frontend to Show Success Message

**File:** `frontend/src/pages/Miners.tsx`

Update the `handleSaveMiner` function to show a success message:

```typescript
const [successMessage, setSuccessMessage] = useState<string | null>(null);

const handleSaveMiner = async () => {
  try {
    if (editingMiner) {
      await updateMinerAPI(editingMiner.minerId, formData);
      setSuccessMessage('Miner updated successfully. Prometheus rules will be regenerated.');
    } else {
      await addMinerAPI(formData);
      setSuccessMessage('Miner added successfully.');
    }
    handleCloseDialog();
    await loadMiners();
    
    // Clear success message after 5 seconds
    setTimeout(() => setSuccessMessage(null), 5000);
  } catch (error) {
    console.error('Error saving miner:', error);
    setError('Failed to save miner');
  }
};
```

Add success alert to the UI:

```tsx
{successMessage && (
  <Alert severity="success" sx={{ mb: 2 }} onClose={() => setSuccessMessage(null)}>
    {successMessage}
  </Alert>
)}
```

---

## Quick Fix (Immediate)

If you need an immediate fix without code changes:

### Manual Steps After Updating Threshold:

```bash
# On Raspberry Pi
cd /opt/mining-stack

# 1. Regenerate Prometheus rules
./venv/bin/python3 bin/generate_prometheus_rules.py

# 2. Reload Prometheus
docker exec mining-stack-prometheus-1 kill -HUP 1

# 3. Wait 30 seconds for new rules to take effect

# 4. Refresh the UI
```

---

## Testing After Fix

### Test 1: Update Threshold

```bash
# 1. Note current error on miner
# 2. Update threshold to be above current value
# 3. Save
# 4. Wait 30 seconds
# 5. Refresh page
# 6. Error should be cleared
```

### Test 2: Verify Prometheus Rules

```bash
# Check rules were regenerated
cat /opt/mining-stack/docker/prometheus/rules/mining_alerts.yml | grep -A5 "192.168.1.74"

# Should show new threshold values
```

### Test 3: Check Alertmanager

```bash
# Check active alerts
curl http://localhost:9093/api/v2/alerts | jq

# Should not show alerts for updated miner (or they should be silenced)
```

---

## Expected Behavior After Fix

### Before:
1. User updates threshold
2. ❌ Error still shows
3. ❌ Alert still active
4. ❌ Prometheus using old rules

### After:
1. User updates threshold
2. ✅ Config saved to miners.yaml
3. ✅ Prometheus rules regenerated automatically
4. ✅ Prometheus reloaded
5. ✅ Old alerts cleared/silenced
6. ✅ New thresholds active within 30 seconds
7. ✅ Error clears on next refresh

---

## Alternative: Manual Workflow

If automatic regeneration is too complex, document the manual workflow:

### In UI:
Add a note when saving thresholds:

```
⚠️ After updating thresholds, run these commands on the server:
1. ./venv/bin/python3 bin/generate_prometheus_rules.py
2. docker exec mining-stack-prometheus-1 kill -HUP 1

Or wait for the next scheduled rule generation (every hour).
```

---

## Recommended Solution

**Implement Step 1 (Auto-regenerate rules)** - This is the most important fix.

**Optional:** Implement Step 2 (Clear alerts) - Nice to have but not critical.

**Optional:** Implement Step 3 (Success message) - Good UX improvement.

---

## Files to Modify

1. `backend/src/config/miners.config.ts`
   - Add `regeneratePrometheusRules()` function
   - Update `saveMinersConfig()` to call it
   - Optional: Add `clearMinerAlerts()` function
   - Optional: Update `updateMiner()` to clear alerts

2. `frontend/src/pages/Miners.tsx`
   - Add success message state
   - Update `handleSaveMiner()` to show success
   - Add success Alert component

---

## Deployment

```bash
# 1. Apply fixes locally
cd /Users/dmitrykor82/CascadeProjects/windsurf-project/mining-stack

# 2. Commit changes
git add backend/src/config/miners.config.ts
git add frontend/src/pages/Miners.tsx
git commit -m "Auto-regenerate Prometheus rules after threshold update"

# 3. Push to GitHub
git push origin main

# 4. Deploy to Raspberry Pi
ssh admin@raspberrypi
cd /opt/mining-stack
git pull origin main
docker compose -f docker-compose.prod.yml build backend frontend
docker compose -f docker-compose.prod.yml up -d
```

---

**Status:** Fix ready to implement  
**Priority:** Medium (workaround available)  
**Estimated Time:** 30 minutes  
**Impact:** Improved UX, automatic threshold sync
