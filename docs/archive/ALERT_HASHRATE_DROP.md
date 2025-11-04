# Hashrate Drop Alert - Configuration and Troubleshooting

## Overview

The system has a **MinerHashrateDrop** alert configured to detect when miners get stuck or hashrate drops significantly. This document explains the alert configuration, how it works, and what actions to take.

---

## Current Alert Configuration

### Alert: MinerHashrateDrop

**Location:** `docker/prometheus/rules/mining_alerts.yml`

**Configuration:**
```yaml
- alert: MinerHashrateDrop
  expr: |
    (
      miner_hashrate_ths < 50
      and miner_is_mining == 1
    )
  for: 10m
  labels:
    severity: critical
    component: miner
  annotations:
    summary: "Miner {{ $labels.name }} hashrate critically low"
    description: "Miner {{ $labels.name }} hashrate is {{ $value }} TH/s (expected >50 TH/s)"
```

**How It Works:**
1. **Condition:** Hashrate drops below 50 TH/s
2. **Duration:** Must persist for 10 minutes
3. **Additional Check:** Miner must be reporting as "mining" (`miner_is_mining == 1`)
4. **Severity:** Critical
5. **Notification:** Sent via Telegram

---

## Alert Triggers

### When Alert Fires:

✅ Miner hashrate < 50 TH/s for 10+ minutes
✅ Miner is still reporting as "mining"
✅ Prometheus successfully scraping metrics

### Common Causes:

1. **Miner Stuck/Frozen**
   - Firmware bug
   - Memory leak
   - Overheating causing throttling
   - Network connectivity issues

2. **Hardware Issues**
   - Failed hashboard
   - Chip failure
   - Power supply problems
   - Overheating

3. **Pool Issues**
   - Pool connection lost
   - High latency
   - Pool maintenance

4. **Configuration Issues**
   - Wrong pool settings
   - Incorrect frequency/voltage
   - Bad overclocking settings

---

## Current Limitations

### Issue 1: Fixed Threshold (50 TH/s)

**Problem:**
- All miners use the same 50 TH/s threshold
- M30S++ miners typically run at ~105 TH/s
- S19 Pro miners typically run at ~110 TH/s
- Alert only fires when hashrate drops below 50%

**Example:**
```
M30S++ Normal: 105 TH/s
M30S++ Stuck:  60 TH/s  ❌ No alert (above 50 TH/s)
M30S++ Dead:   40 TH/s  ✅ Alert fires
```

**Recommendation:** Use per-miner expected hashrate thresholds

---

### Issue 2: No Percentage-Based Detection

**Problem:**
- Fixed threshold doesn't detect relative drops
- A miner dropping from 105 TH/s to 70 TH/s (33% drop) won't trigger alert
- Only absolute drops below 50 TH/s are detected

**Recommendation:** Add percentage-based alert

---

## Recommended Improvements

### 1. Per-Miner Expected Hashrate

**Add to miners.yaml:**
```yaml
miners:
  - ip: 192.168.1.40
    name: miner-192-168-1-40
    alias: EN-M30SppVH90-040
    model: M30S++ VH90
    
    # Add expected hashrate thresholds
    thresholds:
      hashrate:
        expected: 105        # Expected hashrate in TH/s
        warningPercent: 15   # Alert if 15% below expected (89 TH/s)
        criticalPercent: 30  # Alert if 30% below expected (73.5 TH/s)
```

**Benefits:**
- ✅ Detects 15% drop (105 → 89 TH/s)
- ✅ Critical at 30% drop (105 → 73.5 TH/s)
- ✅ Per-miner customization
- ✅ More sensitive detection

---

### 2. Enhanced Alert Rules

**Add to mining_alerts.yml:**

```yaml
# Warning: Hashrate 15% below expected
- alert: MinerHashrateWarning
  expr: |
    (
      miner_hashrate_ths < (miner_expected_hashrate * 0.85)
      and miner_is_mining == 1
    )
  for: 15m
  labels:
    severity: warning
    component: miner
  annotations:
    summary: "Miner {{ $labels.name }} hashrate low"
    description: "Miner {{ $labels.name }} hashrate is {{ $value }} TH/s (expected: {{ $labels.expected }} TH/s)"

# Critical: Hashrate 30% below expected
- alert: MinerHashrateCritical
  expr: |
    (
      miner_hashrate_ths < (miner_expected_hashrate * 0.70)
      and miner_is_mining == 1
    )
  for: 10m
  labels:
    severity: critical
    component: miner
  annotations:
    summary: "Miner {{ $labels.name }} hashrate critically low"
    description: "Miner {{ $labels.name }} hashrate is {{ $value }} TH/s (expected: {{ $labels.expected }} TH/s)"
```

---

### 3. Automatic Reboot on Stuck Miner

**Option A: Manual Reboot via Telegram**

When alert fires, Telegram bot sends:
```
🔥 Miner EN-M30SppVH90-040 hashrate critically low
Hashrate: 45 TH/s (expected: 105 TH/s)

Actions:
[Reboot Miner] [View Details] [Dismiss]
```

**Option B: Automatic Reboot (Advanced)**

Add auto-reboot script triggered by alert:
```python
# auto_reboot_stuck_miners.py
def handle_hashrate_alert(miner_name, current_hashrate, expected_hashrate):
    drop_percent = (expected_hashrate - current_hashrate) / expected_hashrate * 100
    
    if drop_percent > 50:  # More than 50% drop
        logger.warning(f"Miner {miner_name} hashrate dropped {drop_percent}%")
        logger.info(f"Attempting automatic reboot...")
        
        result = reboot_miner(miner_name)
        
        if result['success']:
            send_telegram_alert(f"✅ Auto-rebooted {miner_name} due to hashrate drop")
        else:
            send_telegram_alert(f"❌ Failed to auto-reboot {miner_name}: {result['message']}")
```

---

## Current Alert Flow

```
┌─────────────────────────────────────────────────────────┐
│ 1. Miner Gets Stuck                                     │
│    - Hashrate drops from 105 TH/s → 45 TH/s           │
└─────────────────────────────────────────────────────────┘
                         ↓
┌─────────────────────────────────────────────────────────┐
│ 2. Prometheus Detects (after 10 minutes)               │
│    - miner_hashrate_ths < 50                           │
│    - miner_is_mining == 1                              │
└─────────────────────────────────────────────────────────┘
                         ↓
┌─────────────────────────────────────────────────────────┐
│ 3. Alertmanager Fires Alert                            │
│    - Sends webhook to backend                          │
└─────────────────────────────────────────────────────────┘
                         ↓
┌─────────────────────────────────────────────────────────┐
│ 4. Backend Processes Alert                             │
│    - alert.service.ts receives webhook                 │
│    - Stores in active alerts                           │
└─────────────────────────────────────────────────────────┘
                         ↓
┌─────────────────────────────────────────────────────────┐
│ 5. Telegram Notification Sent                          │
│    🔥 Miner EN-M30SppVH90-040 hashrate critically low  │
│    Hashrate: 45 TH/s (expected >50 TH/s)              │
└─────────────────────────────────────────────────────────┘
                         ↓
┌─────────────────────────────────────────────────────────┐
│ 6. Manual Action Required                              │
│    - User receives Telegram notification              │
│    - User reboots miner via:                          │
│      • Telegram: /reboot miner-192-168-1-40           │
│      • Frontend: Miners page → Reboot button          │
│      • API: POST /api/mining/miners/{id}/reboot       │
└─────────────────────────────────────────────────────────┘
```

---

## Troubleshooting Steps

### When You Receive Hashrate Drop Alert:

**1. Check Miner Status**
```bash
# Via Grafana
http://192.168.1.66:3001/d/per-miner-details

# Via API
curl http://localhost:5000/api/mining/stats | jq '.miners[] | select(.minerId=="miner-192-168-1-40")'
```

**2. Check Miner Metrics**
- Current hashrate
- Temperature
- Fan speed
- Pool connection
- Rejection rate

**3. Determine Cause**

| Symptom | Likely Cause | Action |
|---------|--------------|--------|
| Hashrate 0 TH/s | Miner offline | Check power, network |
| Hashrate 20-40 TH/s | Hashboard failure | Check hardware |
| Hashrate 50-70 TH/s | Throttling/stuck | Reboot miner |
| High rejection rate | Pool issues | Check pool connection |
| High temperature | Cooling issue | Check fans, clean miner |

**4. Reboot Miner**

**Via Telegram:**
```
/reboot miner-192-168-1-40
```

**Via Frontend:**
1. Go to http://localhost:3000/miners
2. Find miner in list
3. Click "Reboot" button
4. Confirm action

**Via API:**
```bash
curl -X POST http://localhost:5000/api/mining/miners/miner-192-168-1-40/reboot
```

**5. Monitor Recovery**
- Wait 2-3 minutes for miner to reboot
- Check hashrate returns to normal
- Verify temperature is acceptable
- Confirm rejection rate is low

---

## Alert History

**View active alerts:**
```bash
# Via API
curl http://localhost:5000/api/alerts/active

# Via Telegram
/alerts
```

**View alert history:**
```bash
# Via API
curl http://localhost:5000/api/alerts/history?limit=50
```

---

## Configuration Files

### Alert Rules
**File:** `docker/prometheus/rules/mining_alerts.yml`
```yaml
# Current hashrate drop alert
- alert: MinerHashrateDrop
  expr: miner_hashrate_ths < 50 and miner_is_mining == 1
  for: 10m
```

### Alert Service
**File:** `backend/src/services/alert.service.ts`
- Processes Alertmanager webhooks
- Stores active alerts
- Forwards to Telegram

### Telegram Service
**File:** `backend/src/services/telegram.service.ts`
- Sends alert notifications
- Provides `/alerts` command
- Enables `/reboot` command

---

## Monitoring Recommendations

### 1. Set Per-Miner Expected Hashrate

Edit `/opt/mining-stack/etc/miners.yaml`:
```yaml
miners:
  - ip: 192.168.1.40
    model: M30S++ VH90
    thresholds:
      hashrate:
        expected: 105
        warningPercent: 15
        criticalPercent: 30
```

### 2. Regenerate Alert Rules

```bash
cd /opt/mining-stack
python3 bin/generate_prometheus_rules.py
docker compose -f docker-compose.prod.yml restart prometheus
```

### 3. Monitor Grafana Dashboard

**Per-Miner Details Dashboard:**
- http://192.168.1.66:3001/d/per-miner-details
- Shows hashrate trends for all miners
- Color-coded thresholds
- Easy to spot drops

### 4. Enable Telegram Notifications

Ensure Telegram bot is configured:
```bash
# Check .env
TELEGRAM_BOT_TOKEN=your_bot_token
TELEGRAM_CHAT_ID=your_chat_id
```

---

## Quick Reference

### Check Alert Status
```bash
# Prometheus alerts
curl http://localhost:9090/api/v1/alerts

# Active alerts via API
curl http://localhost:5000/api/alerts/active

# Telegram
/alerts
```

### Reboot Stuck Miner
```bash
# Single miner
curl -X POST http://localhost:5000/api/mining/miners/miner-192-168-1-40/reboot

# Telegram
/reboot miner-192-168-1-40
```

### View Miner Details
```bash
# Grafana
http://192.168.1.66:3001/d/per-miner-details

# Telegram
/miner miner-192-168-1-40
```

---

## Summary

✅ **Alert is configured** - MinerHashrateDrop fires when hashrate < 50 TH/s for 10+ minutes
✅ **Telegram notifications** - Alerts sent automatically
✅ **Manual reboot available** - Via Telegram, Frontend, or API
⚠️ **Fixed threshold** - Currently 50 TH/s for all miners
⚠️ **No auto-reboot** - Requires manual intervention

### Recommended Next Steps:

1. **Add per-miner expected hashrate** to `miners.yaml`
2. **Regenerate alert rules** with percentage-based thresholds
3. **Consider auto-reboot** for miners with >50% hashrate drop
4. **Monitor Grafana dashboard** for early detection
5. **Test reboot functionality** to ensure it works

**The alert system is working, but can be improved with per-miner thresholds!** ✅
