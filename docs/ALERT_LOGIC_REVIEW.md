# Alert Logic Review & Alignment

**Date**: November 6, 2025  
**Status**: Comprehensive Review

## Overview

The mining stack has a multi-layered alert system:
1. **Prometheus** - Evaluates alert rules based on metrics
2. **Alertmanager** - Routes and groups alerts
3. **Backend** - Processes webhooks and manages alert state
4. **Telegram** - Delivers notifications to users

---

## Alert Flow Architecture

```
┌─────────────────┐
│   Prometheus    │ ← Scrapes metrics every 30s
│  Alert Rules    │ ← Evaluates rules every 30s
└────────┬────────┘
         │ Fires alerts
         ↓
┌─────────────────┐
│  Alertmanager   │ ← Groups alerts (30s wait, 5m interval)
│   Routing       │ ← Routes by severity
└────────┬────────┘
         │ Webhook
         ↓
┌─────────────────┐
│  Backend API    │ ← /api/alerts/webhook
│  Alert Service  │ ← Stores state & history
└────────┬────────┘
         │ Forwards
         ↓
┌─────────────────┐
│ Telegram Bot    │ ← Sends to authorized users
│  Notifications  │ ← Different emoji per severity
└─────────────────┘
```

---

## Alert Rules Configuration

### 1. Mining Critical Alerts (`mining_critical` group)

| Alert | Condition | Duration | Threshold | Severity |
|-------|-----------|----------|-----------|----------|
| **MinerOffline** | `miner_scrape_success == 0` | 5m | N/A | Critical |
| **MinerHighTemperature** | `miner_temp_max_c > 85` | 2m | 85°C | Critical |
| **MinerNotMining** | `miner_is_mining == 0 AND online` | 5m | N/A | Critical |
| **MinerHashrateDrop** | `hashrate < 50 TH/s AND mining` | 10m | 50 TH/s | Critical |

### 2. Mining Warning Alerts (`mining_warning` group)

| Alert | Condition | Duration | Threshold | Severity |
|-------|-----------|----------|-----------|----------|
| **MinerTemperatureHigh** | `75°C < temp ≤ 85°C` | 5m | 75°C | Warning |
| **MinerHighRejectionRate** | `rejection_rate > 5%` | 10m | 5% | Warning |
| **MinerFaultLight** | `fault_light_on == 1` | 2m | N/A | Warning |
| **MinerErrors** | `errors_count > 0` | 5m | 0 | Warning |
| **MinerMissingChips** | `chips < expected` | 10m | Per board | Warning |
| **MinerFanSpeedLow** | `fan_speed < 2000 RPM` | 5m | 2000 RPM | Warning |
| **MinerPoorEfficiency** | `efficiency > 35 J/TH` | 15m | 35 J/TH | Warning |

### 3. Farm-Wide Alerts (`mining_farm` group)

| Alert | Condition | Duration | Threshold | Severity |
|-------|-----------|----------|-----------|----------|
| **FarmMultipleMinersOffline** | `offline_count > 3` | 5m | 3 miners | Critical |
| **FarmHashrateDrop** | `total < 1500 TH/s` | 10m | 1500 TH/s | Critical |
| **FarmHighTemperature** | `avg_temp > 80°C` | 10m | 80°C | Warning |
| **FarmHighPowerConsumption** | `total_power > 70kW` | 5m | 70kW | Warning |

### 4. Pool Network Alerts (`pool_network` group)

| Alert | Condition | Duration | Threshold | Severity |
|-------|-----------|----------|-----------|----------|
| **PoolUnreachable** | `reachable == 0` | 5m | N/A | Critical |
| **PoolHighPacketLoss** | `packet_loss > 10%` | 5m | 10% | Critical |
| **PoolHighLatency** | `latency > 100ms` | 10m | 100ms | Warning |
| **PoolPacketLoss** | `1% < loss ≤ 10%` | 10m | 1-10% | Warning |
| **PoolSlowConnection** | `connect_time > 1000ms` | 5m | 1000ms | Warning |
| **PoolDNSFailure** | `dns_resolved == 0` | 5m | N/A | Warning |

### 5. System Alerts (`system` group)

| Alert | Condition | Duration | Threshold | Severity |
|-------|-----------|----------|-----------|----------|
| **HighCPUUsage** | `cpu_usage > 80%` | 5m | 80% | Warning |
| **HighMemoryUsage** | `memory_usage > 85%` | 5m | 85% | Warning |
| **LowDiskSpace** | `disk_available < 15%` | 5m | 15% | Warning |

---

## Threshold Configuration

### Backend Configuration (`config.ts`)

```typescript
thresholds: {
  temperature: {
    warning: 85°C,   // ENV: THRESHOLD_TEMP_WARNING
    critical: 95°C,  // ENV: THRESHOLD_TEMP_CRITICAL
    shutdown: 105°C  // ENV: THRESHOLD_TEMP_SHUTDOWN
  },
  hashrate: {
    warningPercent: 20%,   // 20% below expected
    criticalPercent: 50%   // 50% below expected
  },
  power: {
    warningPercent: 15%    // ±15% deviation
  },
  rejectionRate: {
    warning: 2.0%,
    critical: 5.0%
  },
  fanSpeed: {
    warning: 3000 RPM,
    critical: 2000 RPM
  }
}
```

### Prometheus Alert Rules

```yaml
# Temperature thresholds
MinerTemperatureHigh: > 75°C (warning)
MinerHighTemperature: > 85°C (critical)

# These DO NOT match backend config!
```

---

## Issues & Misalignments

### 🔴 **Critical Issues**

1. **Temperature Threshold Mismatch**
   - **Prometheus Warning**: 75°C (`MinerTemperatureHigh`)
   - **Backend Warning**: 85°C
   - **Impact**: Alerts fire 10°C earlier than backend expects
   - **Recommendation**: Align to 75°C warning, 85°C critical

2. **Rejection Rate Mismatch**
   - **Prometheus**: 5% threshold (`MinerHighRejectionRate`)
   - **Backend**: 2% warning, 5% critical
   - **Impact**: Missing warning-level alerts
   - **Recommendation**: Add 2% warning rule in Prometheus

3. **Fan Speed Mismatch**
   - **Prometheus**: < 2000 RPM (`MinerFanSpeedLow`)
   - **Backend**: 3000 RPM warning, 2000 RPM critical
   - **Impact**: Only critical alerts, no warnings
   - **Recommendation**: Add 3000 RPM warning rule

### ⚠️ **Warning Issues**

4. **Hashrate Threshold Inconsistency**
   - **Prometheus**: Fixed 50 TH/s threshold
   - **Backend**: Percentage-based (20%/50% below expected)
   - **Impact**: Doesn't account for different miner models
   - **Recommendation**: Use per-miner expected hashrate

5. **Alert Resolution Notifications**
   - **Current**: Only critical alerts send resolution notifications
   - **Impact**: Users don't know when warnings are resolved
   - **Recommendation**: Make resolution notifications configurable

6. **Alert Grouping Delay**
   - **Alertmanager**: 30s group_wait, 5m group_interval
   - **Impact**: Multiple alerts from same miner arrive separately
   - **Recommendation**: Consider reducing group_wait to 10s

### ℹ️ **Minor Issues**

7. **Missing Chip Count Alert in Backend**
   - Prometheus has `MinerMissingChips` rule
   - Backend doesn't have corresponding threshold config
   - **Recommendation**: Add chip count thresholds

8. **No Alert Deduplication**
   - Same alert can fire multiple times if it flaps
   - **Recommendation**: Add hysteresis or repeat_interval tuning

9. **Alert History Size**
   - Fixed at 1000 alerts in memory
   - No persistence across restarts
   - **Recommendation**: Consider database storage

---

## Recommended Alignment Plan

### Phase 1: Critical Threshold Alignment (Immediate)

1. **Update Prometheus Rules** (`mining_alerts.yml`):
```yaml
# Temperature - Two-tier system
- alert: MinerTemperatureWarning
  expr: miner_temp_max_c > 75 and miner_temp_max_c <= 85
  for: 5m
  labels:
    severity: warning

- alert: MinerTemperatureCritical
  expr: miner_temp_max_c > 85
  for: 2m
  labels:
    severity: critical

# Rejection Rate - Two-tier system
- alert: MinerRejectionRateWarning
  expr: rejection_rate > 0.02 and rejection_rate <= 0.05
  for: 10m
  labels:
    severity: warning

- alert: MinerRejectionRateCritical
  expr: rejection_rate > 0.05
  for: 5m
  labels:
    severity: critical

# Fan Speed - Two-tier system
- alert: MinerFanSpeedWarning
  expr: miner_fan_speed_rpm < 3000 and miner_fan_speed_rpm >= 2000
  for: 5m
  labels:
    severity: warning

- alert: MinerFanSpeedCritical
  expr: miner_fan_speed_rpm < 2000
  for: 2m
  labels:
    severity: critical
```

2. **Update Backend Config** (`config.ts`):
```typescript
thresholds: {
  temperature: {
    warning: 75,   // Match Prometheus
    critical: 85,  // Match Prometheus
    shutdown: 95   // Reduce from 105
  }
}
```

### Phase 2: Per-Miner Thresholds (Short-term)

1. **Use Expected Hashrate from miners.yaml**:
```yaml
miners:
  - ip: 192.168.1.40
    name: EN-M30SppVH90-040
    model: M30S++ VH90
    thresholds:
      hashrate:
        expected: 106  # TH/s
      temperature:
        warning: 70    # Override for this miner
        critical: 80
```

2. **Update Prometheus to use expected values**:
```yaml
- alert: MinerHashrateWarning
  expr: |
    miner_hashrate_ths < (miner_expected_hashrate_ths * 0.8)
  for: 10m
```

### Phase 3: Enhanced Alert Management (Long-term)

1. **Add Alert Persistence**:
   - Store alerts in SQLite database
   - Survive backend restarts
   - Enable historical analysis

2. **Add Alert Acknowledgment**:
   - Allow users to acknowledge alerts
   - Suppress repeat notifications for acknowledged alerts
   - Auto-resolve after timeout

3. **Add Alert Silencing**:
   - Silence specific miners during maintenance
   - Silence alert types temporarily
   - Schedule maintenance windows

4. **Add Alert Analytics**:
   - Track MTBF (Mean Time Between Failures)
   - Alert frequency by miner
   - Most common alert types

---

## Testing Checklist

### Alert Rule Testing

- [ ] Temperature warning fires at 75°C
- [ ] Temperature critical fires at 85°C
- [ ] Rejection rate warning fires at 2%
- [ ] Rejection rate critical fires at 5%
- [ ] Fan speed warning fires at 3000 RPM
- [ ] Fan speed critical fires at 2000 RPM
- [ ] Hashrate alert uses per-miner expected values
- [ ] Offline alert fires after 5 minutes
- [ ] Farm-wide alerts aggregate correctly

### Alert Delivery Testing

- [ ] Webhook receives alerts from Alertmanager
- [ ] Backend stores alerts in activeAlerts map
- [ ] Telegram sends notifications to all authorized users
- [ ] Critical alerts use 🔥 emoji
- [ ] Warning alerts use ⚠️ emoji
- [ ] Resolution notifications sent for critical alerts
- [ ] Alert history maintains last 1000 alerts
- [ ] Alert stats API returns correct counts

### Integration Testing

- [ ] Prometheus → Alertmanager → Backend → Telegram flow works
- [ ] Alert grouping works (30s wait, 5m interval)
- [ ] Alert deduplication works (repeat_interval: 4h)
- [ ] Multiple alerts from same miner grouped together
- [ ] Resolved alerts removed from activeAlerts
- [ ] Alert history persists resolved alerts

---

## Current Alert Status (From Logs)

Based on recent logs from 192.168.1.66:

### Active Alerts
- ✅ **MinerTemperatureHigh** - Multiple miners (EN-M30SppVH90-040, EN-M50SppVL30-126, etc.)
- ✅ **MinerMissingChips** - EN-M30SppVH90-040 (boards 0, 1, 2)
- ⚠️ **High Temperature** - EN-M30SppVH40-070 (95.1°C), EN-M30SppVH40-089 (100.8°C)

### Alert Delivery
- ✅ Telegram notifications working
- ✅ Webhook endpoint receiving alerts
- ✅ Alert service processing correctly
- ✅ 2 authorized users receiving notifications

### Issues Observed
- Temperature alerts firing frequently (every 5 minutes)
- Some miners consistently above warning threshold
- Missing chips alerts persistent (hardware issue)

---

## Configuration Files Reference

### Key Files
1. `/docker/prometheus/rules/mining_alerts.yml` - Alert rule definitions
2. `/docker/prometheus/rules/pool_network_alerts.yml` - Pool alert rules
3. `/docker/alertmanager/alertmanager.yml` - Alert routing config
4. `/backend/src/config/config.ts` - Backend threshold config
5. `/backend/src/services/alert.service.ts` - Alert processing logic
6. `/backend/src/services/telegram.service.ts` - Notification delivery
7. `/etc/miners.yaml` - Per-miner threshold overrides

### Environment Variables
```bash
# Temperature thresholds
THRESHOLD_TEMP_WARNING=75
THRESHOLD_TEMP_CRITICAL=85
THRESHOLD_TEMP_SHUTDOWN=95

# Hashrate thresholds
THRESHOLD_HASHRATE_WARNING_PCT=20
THRESHOLD_HASHRATE_CRITICAL_PCT=50

# Rejection rate thresholds
THRESHOLD_REJECTION_WARNING=2.0
THRESHOLD_REJECTION_CRITICAL=5.0

# Fan speed thresholds
THRESHOLD_FAN_WARNING=3000
THRESHOLD_FAN_CRITICAL=2000
```

---

## Next Steps

1. **Immediate**: Review and approve alignment plan
2. **Short-term**: Implement Phase 1 threshold alignment
3. **Medium-term**: Add per-miner threshold support (Phase 2)
4. **Long-term**: Enhance alert management features (Phase 3)
5. **Ongoing**: Monitor alert frequency and adjust thresholds

---

## Questions for Review

1. Should temperature warning be 75°C or 80°C?
2. Should we send resolution notifications for all severities?
3. Should alert history be persisted to database?
4. Should we add alert acknowledgment feature?
5. Should we reduce Alertmanager group_wait from 30s to 10s?
6. Should we add per-miner threshold overrides in UI?
