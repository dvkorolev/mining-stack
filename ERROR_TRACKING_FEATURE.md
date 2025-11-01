# ✅ Enhanced Error Tracking Feature

## 🎯 What Was Added

Detailed error descriptions are now shown in both the UI and logs for better debugging and monitoring.

---

## 🔧 Backend Changes

### **1. Error Interface** (`MinerError`)

```typescript
interface MinerError {
  code: string;           // Error code (e.g., 'HIGH_TEMP')
  message: string;        // Short message (e.g., 'High Temperature')
  description: string;    // Detailed description
  severity: 'critical' | 'warning' | 'info';
  timestamp: number;      // When error occurred
  details?: Record<string, any>; // Additional context
}
```

### **2. Error Code Definitions**

Added 7 predefined error types with descriptions:

| Code | Message | Severity | Description |
|------|---------|----------|-------------|
| `HIGH_TEMP` | High Temperature | Critical | Temperature exceeds 85°C |
| `FAN_FAILURE` | Fan Failure | Critical | Cooling fans not working |
| `LOW_HASHRATE` | Low Hashrate | Warning | Performance below expected |
| `HIGH_REJECTION` | High Share Rejection | Warning | Rejection rate > 5% |
| `POWER_ISSUE` | Power Fluctuation | Warning | Unstable power supply |
| `NETWORK_ERROR` | Network Connection Issue | Critical | Pool connection problems |
| `CHIP_ERROR` | ASIC Chip Error | Critical | ASIC chips not responding |

### **3. Error Logging**

Errors are now logged with full context:

```typescript
logger.warn(`Miner ${minerId} error: ${error.message} - ${error.description}`, {
  miner: minerId,
  errorCode: error.code,
  severity: error.severity,
  details: error.details,
});
```

**Log Output Example:**
```
[2025-11-01 15:20:35] WARN: Miner miner-1 error: High Temperature - Miner temperature exceeds safe operating threshold (>85°C)
{
  miner: "miner-1",
  errorCode: "HIGH_TEMP",
  severity: "critical",
  details: { temperature: "87.3" }
}
```

---

## 🎨 Frontend Changes

### **1. Enhanced Miner Interface**

```typescript
interface Miner {
  // ... existing fields
  statusMessage?: string;      // Human-readable status
  errors?: MinerError[];       // Array of errors
  errorCount?: number;         // Total error count
  lastError?: MinerError;      // Most recent error
}
```

### **2. Error Display in UI**

**Status Column:**
- Shows status chip with human-readable message
- Warning icon appears when errors exist
- Hover over icon to see error details

**Error Tooltip Shows:**
- ⚠️ Error message (bold)
- 📝 Detailed description
- 🔍 Additional details (if any)
- 🕐 Timestamp

**Visual Example:**
```
┌─────────────────────────────────────┐
│ Status: ERROR                    ⚠️ │
│                                     │
│ Tooltip on hover:                   │
│ ┌───────────────────────────────┐  │
│ │ High Temperature              │  │
│ │ Miner temperature exceeds     │  │
│ │ safe operating threshold      │  │
│ │                               │  │
│ │ Details: { temperature: 87.3 }│  │
│ │ Nov 1, 2025, 3:20:35 PM       │  │
│ └───────────────────────────────┘  │
└─────────────────────────────────────┘
```

---

## 📊 Error Flow

```
┌──────────────┐
│ Miner Status │
│   = error    │
└──────┬───────┘
       │
       ▼
┌──────────────────────┐
│ Generate Error       │
│ - Check temperature  │
│ - Check rejection    │
│ - Random issues      │
└──────┬───────────────┘
       │
       ▼
┌──────────────────────┐
│ Create MinerError    │
│ - Code               │
│ - Message            │
│ - Description        │
│ - Severity           │
│ - Details            │
└──────┬───────────────┘
       │
       ├─────────────────────┐
       │                     │
       ▼                     ▼
┌──────────────┐    ┌────────────────┐
│ Log to File  │    │ Send to UI     │
│ (combined.log)│    │ (WebSocket)    │
└──────────────┘    └────────┬───────┘
                             │
                             ▼
                    ┌────────────────┐
                    │ Display in UI  │
                    │ - Status chip  │
                    │ - Warning icon │
                    │ - Tooltip      │
                    └────────────────┘
```

---

## 🔍 How to Use

### **View Errors in UI:**

1. Open Miners page
2. Look for miners with ERROR status
3. See warning icon (⚠️) next to status
4. Hover over icon to see error details

### **View Errors in Logs:**

```bash
cd /opt/mining-stack

# View all errors
docker logs mining-stack-backend-1 | grep "error:"

# View recent errors
docker logs mining-stack-backend-1 --tail 50 | grep WARN

# Follow errors in real-time
docker logs mining-stack-backend-1 -f | grep "error:"
```

### **Check Error Files:**

```bash
cd /opt/mining-stack

# View error log
cat logs/error.log

# View combined log with errors
cat logs/combined.log | grep "error:"

# Tail error log
tail -f logs/error.log
```

---

## 📝 Example Scenarios

### **Scenario 1: High Temperature**

**UI Shows:**
```
Status: HIGH TEMPERATURE ⚠️
```

**Tooltip:**
```
High Temperature
Miner temperature exceeds safe operating threshold (>85°C)

Details: { temperature: "87.3" }
Nov 1, 2025, 3:20:35 PM
```

**Log Entry:**
```json
{
  "level": "warn",
  "message": "Miner miner-1 error: High Temperature - Miner temperature exceeds safe operating threshold (>85°C)",
  "miner": "miner-1",
  "errorCode": "HIGH_TEMP",
  "severity": "critical",
  "details": { "temperature": "87.3" },
  "timestamp": "2025-11-01T15:20:35.123Z"
}
```

---

### **Scenario 2: ASIC Chip Error**

**UI Shows:**
```
Status: ASIC CHIP ERROR ⚠️
```

**Tooltip:**
```
ASIC Chip Error
One or more ASIC chips are not responding

Details: { affectedChips: 2 }
Nov 1, 2025, 3:25:10 PM
```

**Log Entry:**
```json
{
  "level": "warn",
  "message": "Miner miner-2 error: ASIC Chip Error - One or more ASIC chips are not responding",
  "miner": "miner-2",
  "errorCode": "CHIP_ERROR",
  "severity": "critical",
  "details": { "affectedChips": 2 },
  "timestamp": "2025-11-01T15:25:10.456Z"
}
```

---

## 🎯 Benefits

### **For Users:**
- ✅ Clear error messages in UI
- ✅ Detailed descriptions on hover
- ✅ No need to check logs for common issues
- ✅ Timestamp shows when error occurred

### **For Operators:**
- ✅ Structured error logging
- ✅ Easy to grep and filter logs
- ✅ Severity levels for prioritization
- ✅ Additional context in details field

### **For Debugging:**
- ✅ Error codes for quick identification
- ✅ Full error history in logs
- ✅ Correlation between UI and logs
- ✅ JSON format for log analysis tools

---

## 🔄 Error Recovery

Errors automatically resolve after ~5 minutes when miner status changes back to `online`.

**Recovery Flow:**
1. Miner enters error state
2. Error is logged and displayed
3. After 5+ minutes, status may change
4. When status = online, errors clear
5. UI updates automatically

---

## 📊 Monitoring Errors

### **Count Errors by Type:**

```bash
# In logs
grep "errorCode" logs/combined.log | grep -o '"errorCode":"[^"]*"' | sort | uniq -c

# Example output:
#   15 "errorCode":"HIGH_TEMP"
#    8 "errorCode":"FAN_FAILURE"
#    5 "errorCode":"NETWORK_ERROR"
```

### **Find Critical Errors:**

```bash
grep '"severity":"critical"' logs/combined.log
```

### **Errors in Last Hour:**

```bash
docker logs mining-stack-backend-1 --since 1h | grep "error:"
```

---

## ✅ Summary

**What Changed:**
- ✅ Detailed error objects with codes and descriptions
- ✅ Error logging with full context
- ✅ UI displays error details in tooltips
- ✅ 7 predefined error types
- ✅ Severity levels (critical/warning/info)

**Where to See Errors:**
- 🖥️ **UI**: Miners page, hover over ⚠️ icon
- 📝 **Logs**: `logs/combined.log` and `logs/error.log`
- 🐳 **Docker**: `docker logs mining-stack-backend-1`

**Error Information Includes:**
- Error code
- Short message
- Detailed description
- Severity level
- Timestamp
- Additional details (temperature, chips, etc.)

Now you can easily identify and debug miner issues! 🎉
