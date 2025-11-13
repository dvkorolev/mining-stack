# Alert Deduplication Fix

## Issue
Alerts were appearing multiple times in the alert history, showing both FIRING and RESOLVED states for the same alert. This caused:
- Confusion about actual alert status
- Cluttered alert history
- Duplicate entries in the UI
- Incorrect alert counts

Example of duplicate alerts seen:
```
RESOLVED | CRITICAL | MinerOffline | DG1+ | 11/13/2025, 11:19:46 AM | 5m
FIRING   | CRITICAL | MinerOffline | DG1+ | 11/13/2025, 11:19:46 AM | 3h 25m | Active
```

## Root Cause Analysis

### 1. **addToHistory() Function**
- Always used `unshift()` to add alerts to the beginning of the array
- Never checked if an alert with the same ID already existed
- When an alert was resolved, it added a new entry instead of updating the existing one

### 2. **Database Loading**
- `loadAlertsFromDb()` loaded all alerts from database without deduplication
- If database had duplicates (from before the fix), they were all loaded into memory

### 3. **Alert Lifecycle**
- When alert fires: Added to `activeAlerts` Map and `alertHistory` array
- When alert resolves: Removed from `activeAlerts` but **added again** to `alertHistory`
- Result: Same alert appears twice in history (once as FIRING, once as RESOLVED)

## Solution Implemented

### 1. **Updated addToHistory() Function**
```typescript
const addToHistory = (alert: Alert): void => {
  // Check if alert already exists in history
  const existingIndex = alertHistory.findIndex(a => a.id === alert.id);
  
  if (existingIndex !== -1) {
    // Update existing alert in place
    alertHistory[existingIndex] = alert;
  } else {
    // Add new alert to beginning of history
    alertHistory.unshift(alert);
    
    // Keep history size limited
    if (alertHistory.length > MAX_HISTORY_SIZE) {
      alertHistory.splice(MAX_HISTORY_SIZE);
    }
  }
  
  // Persist to database
  enqueueAlertPersistence(alert);
};
```

**Benefits:**
- Alerts are updated in place when status changes
- No duplicate entries in memory
- Matches database behavior (INSERT OR REPLACE)

### 2. **Updated loadAlertsFromDb() Function**
```typescript
const loadAlertsFromDb = (): void => {
  // ... fetch rows from database ...
  
  // Use a Map to deduplicate alerts by ID (keep most recent version)
  const alertsMap = new Map<string, Alert>();
  
  rows.forEach(row => {
    const alert: Alert = { /* ... */ };
    
    // Only keep the most recent version of each alert
    if (!alertsMap.has(alert.id)) {
      alertsMap.set(alert.id, alert);
    }
  });
  
  // Convert map to array and add to storage
  alertsMap.forEach(alert => {
    if (alert.status === 'firing') {
      activeAlerts.set(alert.id, alert);
    }
    alertHistory.push(alert);
  });
};
```

**Benefits:**
- Deduplicates alerts on startup
- Handles legacy duplicate data gracefully
- Ensures clean state after restart

### 3. **Added cleanupDuplicateAlerts() Function**
```typescript
export const cleanupDuplicateAlerts = (): { removed: number } => {
  // Find duplicate alert IDs in database
  // For each duplicate, keep only the most recent entry (by created_at)
  // Delete older entries
  // Return count of removed duplicates
};
```

**Benefits:**
- Cleans up existing duplicates in database
- Can be called manually or automatically
- Provides feedback on how many duplicates were removed

### 4. **Added API Endpoint**
```
POST /api/mining/alerts/cleanup-duplicates
```

**Response:**
```json
{
  "success": true,
  "message": "Cleaned up 15 duplicate alerts",
  "removed": 15
}
```

## Testing Steps

### 1. Verify Fix in Development
```bash
# Restart backend to load the fix
docker compose -f docker-compose.prod.yml restart backend

# Check logs for alert deduplication
docker compose -f docker-compose.prod.yml logs backend | grep -i "alert"
```

### 2. Clean Up Existing Duplicates
```bash
# Call cleanup endpoint
curl -X POST http://192.168.1.66:5000/api/mining/alerts/cleanup-duplicates

# Expected response:
# {"success":true,"message":"Cleaned up X duplicate alerts","removed":X}
```

### 3. Verify in UI
- Navigate to Alerts page
- Check that each alert appears only once
- Verify RESOLVED alerts show resolved status, not duplicate FIRING entries
- Check that alert counts are accurate

### 4. Test Alert Lifecycle
- Wait for a miner to go offline (or simulate)
- Verify alert appears once as FIRING
- Wait for miner to come back online
- Verify same alert updates to RESOLVED (doesn't create new entry)

## Database Schema
The alerts table uses `id` as PRIMARY KEY with `INSERT OR REPLACE`:
```sql
CREATE TABLE IF NOT EXISTS alerts (
  id TEXT PRIMARY KEY,  -- Unique alert ID (alertname_miner)
  name TEXT NOT NULL,
  severity TEXT NOT NULL,
  status TEXT NOT NULL,  -- 'firing' or 'resolved'
  miner TEXT,
  summary TEXT NOT NULL,
  description TEXT,
  fired_at INTEGER NOT NULL,
  resolved_at INTEGER,
  labels TEXT,
  annotations TEXT,
  created_at INTEGER DEFAULT (strftime('%s', 'now'))
);
```

## Alert ID Generation
Alerts are uniquely identified by:
```typescript
const generateAlertId = (alert: any): string => {
  const labels = alert.labels || {};
  const key = `${labels.alertname}_${labels.miner || labels.instance || 'unknown'}`;
  return key;
};
```

Example IDs:
- `MinerOffline_DG1+`
- `HighTemperature_AntminerS19`
- `LowHashrate_WhatsminerM30S`

## Monitoring

### Check for Duplicates
```bash
# Query database for duplicate alert IDs
sqlite3 /path/to/alerts.db "
  SELECT id, COUNT(*) as count 
  FROM alerts 
  GROUP BY id 
  HAVING count > 1
"
```

### Check In-Memory State
```bash
# Get alert stats
curl http://192.168.1.66:5000/api/mining/alerts/stats

# Get alert history
curl http://192.168.1.66:5000/api/mining/alerts/history?limit=50
```

## Git Commit
```
commit 369d388
fix: Alert deduplication - prevent duplicate alerts in history
```

## Files Changed
- `backend/src/services/alert.service.ts` - Core deduplication logic
- `backend/src/routes/mining.routes.ts` - Added cleanup endpoint

## Future Improvements
1. Add automatic cleanup on startup (optional)
2. Add metrics for duplicate detection
3. Consider adding alert versioning for audit trail
4. Add UI button to trigger cleanup from admin panel
