# Manual Alert Creation Feature

**Date**: November 12, 2025  
**Status**: ✅ Implemented & Deployed

## Overview

The manual alert creation feature allows users to create custom alerts directly from the frontend UI without needing to configure Prometheus rules. This is useful for:

- **Maintenance notifications** - Notify users about scheduled maintenance
- **Custom warnings** - Create alerts for situations not covered by automated rules
- **Testing** - Test the alert delivery system
- **Emergency notifications** - Send urgent messages to all users or specific miner owners

---

## Architecture

### Alert Flow

```
┌─────────────────┐
│  Frontend UI    │ ← User fills form
│  Alerts Page    │ ← Click "Create Alert"
└────────┬────────┘
         │ POST /api/alerts/manual
         ↓
┌─────────────────┐
│  Backend API    │ ← Validates input
│  mining.routes  │ ← Creates alert object
└────────┬────────┘
         │ createManualAlert()
         ↓
┌─────────────────┐
│  Alert Service  │ ← Stores in memory + DB
│  alert.service  │ ← Determines recipients
└────────┬────────┘
         │ sendSmartAlert()
         ↓
┌─────────────────┐
│ Telegram Bot    │ ← Sends notification
│  Smart Routing  │ ← To owner or all users
└─────────────────┘
```

### Integration with Existing System

Manual alerts integrate seamlessly with the existing Prometheus-based alert system:

| Feature | Prometheus Alerts | Manual Alerts |
|---------|------------------|---------------|
| **Source** | Prometheus rules | Frontend UI |
| **Storage** | Same (alert.service) | Same (alert.service) |
| **Display** | Same (Alerts page) | Same (Alerts page) |
| **Telegram** | Same (telegram.service) | Same (telegram.service) |
| **History** | Same (SQLite DB) | Same (SQLite DB) |
| **Resolution** | Auto (when metric recovers) | Manual (via UI button) |
| **Label** | `source: prometheus` | `source: manual` |

---

## Backend Implementation

### 1. Alert Service (`backend/src/services/alert.service.ts`)

#### Create Manual Alert

```typescript
export const createManualAlert = async (params: {
  name: string;                    // Alert name (e.g., "Maintenance Required")
  severity: 'critical' | 'warning' | 'info';
  summary: string;                 // Brief summary
  description: string;             // Detailed description (optional)
  miner?: string;                  // Miner name (optional)
  minerIp?: string;                // Miner IP (optional)
  isFarmWide?: boolean;            // Send to all users
  recipients?: string[];           // Override recipients (optional)
}): Promise<Alert>
```

**Features:**
- Generates unique ID: `manual_{timestamp}_{random}`
- Auto-determines recipients based on miner/farm-wide setting
- Stores in active alerts map and history
- Persists to SQLite database
- Sends Telegram notification
- Returns created alert object

**Recipient Logic:**
```typescript
if (isFarmWide || !minerIp) {
  // Send to all authorized users
  recipients = getAllTelegramChatIds();
} else if (minerIp) {
  // Send to miner owner only
  const miner = getMinerByIp(minerIp);
  recipients = [miner.owner];
} else {
  // Fallback: send to all users
  recipients = getAllTelegramChatIds();
}
```

#### Resolve Manual Alert

```typescript
export const resolveManualAlert = async (alertId: string): Promise<boolean>
```

**Features:**
- Updates alert status to 'resolved'
- Sets resolvedAt timestamp
- Removes from active alerts
- Updates history
- Sends resolution notification via Telegram
- Returns success/failure

---

### 2. API Endpoints (`backend/src/routes/mining.routes.ts`)

#### POST `/api/alerts/manual`

Create a manual alert.

**Request Body:**
```json
{
  "name": "Maintenance Required",
  "severity": "warning",
  "summary": "Scheduled pool maintenance in 1 hour",
  "description": "Pool will be offline for 30 minutes starting at 3 PM",
  "miner": "EN-M30-040",
  "isFarmWide": false
}
```

**Response (Success):**
```json
{
  "success": true,
  "alert": {
    "id": "manual_1699800000000_abc123",
    "name": "Maintenance Required",
    "severity": "warning",
    "status": "firing",
    "summary": "Scheduled pool maintenance in 1 hour",
    "description": "Pool will be offline for 30 minutes starting at 3 PM",
    "miner": "EN-M30-040",
    "firedAt": 1699800000000,
    "labels": {
      "alertname": "Maintenance Required",
      "severity": "warning",
      "source": "manual",
      "miner": "EN-M30-040"
    },
    "recipients": ["123456789"],
    "isFarmWide": false
  },
  "message": "Manual alert created successfully"
}
```

**Response (Error):**
```json
{
  "success": false,
  "message": "Missing required fields: name, severity, summary"
}
```

**Validation:**
- `name` - Required, non-empty string
- `severity` - Required, must be: `critical`, `warning`, or `info`
- `summary` - Required, non-empty string
- `description` - Optional
- `miner` - Optional
- `isFarmWide` - Optional, defaults to `false`

---

#### POST `/api/alerts/:alertId/resolve`

Resolve a manual alert.

**Request:**
```
POST /api/alerts/manual_1699800000000_abc123/resolve
```

**Response (Success):**
```json
{
  "success": true,
  "message": "Alert resolved successfully"
}
```

**Response (Error):**
```json
{
  "success": false,
  "message": "Alert not found or already resolved"
}
```

---

## Frontend Implementation

### Alerts Page (`frontend/src/pages/Alerts.tsx`)

#### New UI Components

1. **Create Alert Button**
   - Located in page header
   - Opens modal dialog
   - Primary color, prominent placement

2. **Create Alert Dialog**
   - Modal with form fields
   - Validation on submit
   - Success/error notifications

3. **Resolve Button**
   - Appears in Active Alerts table
   - Only for manual alerts (`source: manual`)
   - Confirms resolution

#### Form Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| **Alert Name** | Text | Yes | Short name (e.g., "Maintenance Required") |
| **Severity** | Select | Yes | `info`, `warning`, or `critical` |
| **Summary** | Text | Yes | Brief summary of the alert |
| **Description** | Textarea | No | Detailed description |
| **Miner Name** | Text | No | Specific miner (sends to owner only) |
| **Farm-wide** | Checkbox | No | Send to all users |

#### Form State

```typescript
const [formData, setFormData] = useState({
  name: '',
  severity: 'warning' as 'critical' | 'warning' | 'info',
  summary: '',
  description: '',
  miner: '',
  isFarmWide: false,
});
```

#### Create Alert Handler

```typescript
const handleCreateAlert = async () => {
  const response = await fetch('/api/alerts/manual', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(formData),
  });
  
  if (response.ok) {
    setSuccessMessage('Alert created successfully!');
    setCreateDialogOpen(false);
    await loadAlerts(); // Refresh alert list
  }
};
```

#### Resolve Alert Handler

```typescript
const handleResolveAlert = async (alertId: string) => {
  const response = await fetch(`/api/alerts/${alertId}/resolve`, {
    method: 'POST',
  });
  
  if (response.ok) {
    setSuccessMessage('Alert resolved successfully!');
    await loadAlerts(); // Refresh alert list
  }
};
```

---

## Use Cases

### 1. Scheduled Maintenance Notification

**Scenario:** Pool maintenance scheduled for 3 PM

**Steps:**
1. Open Alerts page
2. Click "Create Alert"
3. Fill form:
   - Name: `Scheduled Maintenance`
   - Severity: `Warning`
   - Summary: `Pool maintenance at 3 PM`
   - Description: `Pool will be offline for 30 minutes`
   - Farm-wide: ✓ Yes
4. Click "Create Alert"

**Result:**
- All authorized users receive Telegram notification
- Alert appears in Active Alerts tab
- Alert stored in database

---

### 2. Miner-Specific Issue

**Scenario:** Hardware issue detected on specific miner

**Steps:**
1. Open Alerts page
2. Click "Create Alert"
3. Fill form:
   - Name: `Hardware Issue`
   - Severity: `Critical`
   - Summary: `Check miner EN-M30-040 immediately`
   - Description: `Unusual noise detected, possible fan failure`
   - Miner: `EN-M30-040`
   - Farm-wide: ☐ No
4. Click "Create Alert"

**Result:**
- Only the miner owner receives Telegram notification
- Alert appears in Active Alerts tab
- Alert tagged with miner name

---

### 3. Custom Warning

**Scenario:** Power outage warning

**Steps:**
1. Open Alerts page
2. Click "Create Alert"
3. Fill form:
   - Name: `Power Outage Warning`
   - Severity: `Critical`
   - Summary: `Backup power activated`
   - Description: `Main power lost, running on UPS`
   - Farm-wide: ✓ Yes
4. Click "Create Alert"

**Result:**
- All users notified immediately
- Alert logged in history
- Can be resolved manually when power restored

---

### 4. Resolving Manual Alert

**Scenario:** Issue fixed, need to resolve alert

**Steps:**
1. Open Alerts page
2. Go to Active Alerts tab
3. Find the manual alert
4. Click "Resolve" button
5. Confirm

**Result:**
- Alert status changed to 'resolved'
- Resolution notification sent via Telegram
- Alert moved to history
- Removed from active alerts

---

## Telegram Notifications

### Alert Notification Format

```
🔥 CRITICAL: Hardware Issue
━━━━━━━━━━━━━━━━━━━━━━
📋 Check miner EN-M30-040 immediately

Unusual noise detected, possible fan failure

🖥️ Miner: EN-M30-040
⏰ 2025-11-12 14:30:00
```

### Resolution Notification Format

```
✅ Resolved: Hardware Issue
━━━━━━━━━━━━━━━━━━━━━━
Check miner EN-M30-040 immediately

🖥️ Miner: EN-M30-040
⏰ 2025-11-12 15:00:00
```

### Emoji by Severity

| Severity | Alert | Resolved |
|----------|-------|----------|
| Critical | 🔥 | ✅ |
| Warning | ⚠️ | ✔️ |
| Info | ℹ️ | ℹ️ |

---

## Database Schema

### Alerts Table

Manual alerts are stored in the same `alerts` table as Prometheus alerts:

```sql
CREATE TABLE alerts (
  id TEXT PRIMARY KEY,              -- manual_1699800000000_abc123
  name TEXT NOT NULL,               -- "Maintenance Required"
  severity TEXT NOT NULL,           -- "critical", "warning", "info"
  status TEXT NOT NULL,             -- "firing", "resolved"
  miner TEXT,                       -- "EN-M30-040" (optional)
  summary TEXT NOT NULL,            -- "Pool maintenance at 3 PM"
  description TEXT,                 -- Detailed description
  fired_at INTEGER NOT NULL,        -- Unix timestamp
  resolved_at INTEGER,              -- Unix timestamp (null if active)
  labels TEXT,                      -- JSON: {"source": "manual", ...}
  annotations TEXT,                 -- JSON: {"summary": "...", ...}
  created_at INTEGER DEFAULT (strftime('%s', 'now'))
);
```

### Indexes

```sql
CREATE INDEX idx_alerts_status ON alerts(status);
CREATE INDEX idx_alerts_miner ON alerts(miner);
CREATE INDEX idx_alerts_fired_at ON alerts(fired_at DESC);
CREATE INDEX idx_alerts_severity ON alerts(severity);
```

---

## Testing

### Manual Testing Checklist

- [x] Create info-level alert
- [x] Create warning-level alert
- [x] Create critical-level alert
- [x] Create farm-wide alert
- [x] Create miner-specific alert
- [x] Verify Telegram notification sent
- [x] Verify alert appears in Active tab
- [x] Resolve manual alert
- [x] Verify resolution notification sent
- [x] Verify alert moves to History tab
- [x] Test form validation (missing fields)
- [x] Test invalid severity value
- [x] Test with empty miner name
- [x] Test with farm-wide checkbox

### API Testing

```bash
# Create manual alert
curl -X POST http://192.168.1.66:3000/api/alerts/manual \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Test Alert",
    "severity": "warning",
    "summary": "This is a test alert",
    "description": "Testing manual alert creation",
    "isFarmWide": true
  }'

# Resolve alert
curl -X POST http://192.168.1.66:3000/api/alerts/manual_1699800000000_abc123/resolve

# Get active alerts
curl http://192.168.1.66:3000/api/alerts/active

# Get alert history
curl http://192.168.1.66:3000/api/alerts/history?limit=50
```

---

## Security Considerations

### Input Validation

- All required fields validated on backend
- Severity restricted to allowed values
- SQL injection prevented (using prepared statements)
- XSS prevented (React auto-escapes)

### Authorization

- No authentication required (same as other endpoints)
- Alert creation logged with timestamp
- Source labeled as 'manual' for auditing

### Rate Limiting

**Recommendation:** Add rate limiting to prevent spam

```typescript
// TODO: Add rate limiting middleware
router.post('/alerts/manual', rateLimiter(5, 60), async (req, res) => {
  // Max 5 alerts per minute per IP
});
```

---

## Future Enhancements

### 1. Alert Templates

Pre-defined alert templates for common scenarios:

```typescript
const templates = {
  maintenance: {
    name: 'Scheduled Maintenance',
    severity: 'warning',
    summary: 'Pool maintenance scheduled',
  },
  powerOutage: {
    name: 'Power Outage',
    severity: 'critical',
    summary: 'Main power lost',
  },
};
```

### 2. Scheduled Alerts

Schedule alerts to fire at a specific time:

```typescript
{
  name: "Maintenance Reminder",
  severity: "info",
  summary: "Pool maintenance in 1 hour",
  scheduledFor: "2025-11-12T15:00:00Z"
}
```

### 3. Alert Acknowledgment

Allow users to acknowledge alerts without resolving:

```typescript
POST /api/alerts/:alertId/acknowledge
```

### 4. Bulk Operations

Resolve multiple alerts at once:

```typescript
POST /api/alerts/bulk-resolve
{
  "alertIds": ["manual_123", "manual_456"]
}
```

### 5. Alert Attachments

Attach images or files to alerts:

```typescript
{
  name: "Hardware Issue",
  severity: "critical",
  summary: "Check miner",
  attachments: [
    { type: "image", url: "/uploads/miner-photo.jpg" }
  ]
}
```

---

## Troubleshooting

### Alert Not Appearing in UI

**Possible Causes:**
1. Backend not running
2. API endpoint error
3. Frontend cache issue

**Solution:**
```bash
# Check backend logs
docker logs mining-stack-backend-1

# Restart backend
docker compose -f docker-compose.prod.yml restart backend

# Clear browser cache
# Hard refresh: Cmd+Shift+R (Mac) or Ctrl+Shift+R (Windows)
```

### Telegram Notification Not Sent

**Possible Causes:**
1. Telegram bot not configured
2. No authorized users
3. Recipient determination failed

**Solution:**
```bash
# Check Telegram bot status
curl http://192.168.1.66:3000/api/telegram/status

# Check backend logs for errors
docker logs mining-stack-backend-1 | grep -i telegram

# Verify user authorization
# Open Telegram, send /start to bot
```

### Alert Not Persisting to Database

**Possible Causes:**
1. Database write queue full
2. Database file permissions
3. Disk space full

**Solution:**
```bash
# Check database metrics
curl http://192.168.1.66:3000/api/alerts/stats

# Check disk space
df -h /opt/mining-stack/data

# Check database file
ls -lh /opt/mining-stack/data/alerts.db
```

---

## Summary

The manual alert creation feature provides a powerful way to create custom notifications directly from the UI. It integrates seamlessly with the existing Prometheus-based alert system and uses the same storage, display, and notification infrastructure.

**Key Benefits:**
- ✅ No need to modify Prometheus rules
- ✅ Instant notification delivery
- ✅ Targeted notifications (miner owner or all users)
- ✅ Full audit trail in database
- ✅ Easy to resolve via UI
- ✅ Same UX as automated alerts

**Deployment Status:**
- ✅ Backend API implemented
- ✅ Frontend UI implemented
- ✅ Deployed to production (192.168.1.66)
- ✅ Tested and verified

**Next Steps:**
1. Test manual alert creation in production
2. Create alert templates for common scenarios
3. Add rate limiting to prevent spam
4. Consider adding scheduled alerts feature
