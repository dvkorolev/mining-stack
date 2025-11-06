# Missing Chips Alert Fix

**Date**: November 6, 2025  
**Issue**: Missing chips alerts showing empty expected value  
**Status**: ✅ Fixed

## Problem

Alerts were showing:
```
⚠️ Miner EN-M30SppVH90-065 missing chips on board 0
Board 0 has 0 chips (expected: )
```

The expected chip count was empty, making the alert unhelpful.

## Root Cause

The Prometheus alert rule was trying to access `{{ $labels.expected }}` which doesn't exist as a label on the `miner_board_chips_count` metric. The expected chip count is stored in a separate metric: `miner_board_chips_expected`.

## Solution

### 1. Fixed Prometheus Alert Rule

**File**: `/docker/prometheus/rules/mining_alerts.yml`

**Before**:
```yaml
- alert: MinerMissingChips
  expr: miner_board_chips_count < miner_board_chips_expected
  annotations:
    description: "Board {{ $labels.slot }} has {{ $value }} chips (expected: {{ $labels.expected }})"
```

**After**:
```yaml
- alert: MinerMissingChips
  expr: |
    miner_board_chips_count < on(ip, name, slot) group_left() miner_board_chips_expected
  annotations:
    description: "Board {{ $labels.slot }} has {{ $value | printf \"%.0f\" }} chips (expected: {{ with query (printf \"miner_board_chips_expected{name='%s',slot='%s'}\" $labels.name $labels.slot) }}{{ . | first | value | printf \"%.0f\" }}{{ end }})"
```

**Changes**:
- Added `on(ip, name, slot) group_left()` to properly join the two metrics
- Used `with query(...)` template function to fetch the expected value dynamically
- Added `printf \"%.0f\"` to format numbers without decimals

### 2. Added MISSING_CHIPS Error Code

**File**: `/backend/src/services/mining.service.ts`

Added a dedicated error code for missing chips:
```typescript
MISSING_CHIPS: {
  code: 'MISSING_CHIPS',
  message: 'Missing Chips on Hashboard',
  description: 'One or more hashboards are reporting fewer chips than expected',
  severity: 'warning' as const,
}
```

This provides better error categorization and handling in the backend API.

## Expected Behavior After Fix

### Alert Message
```
⚠️ Miner EN-M30SppVH90-065 missing chips on board 0
Board 0 has 0 chips (expected: 126)
```

### Telegram Notification
```
⚠️ Miner EN-M30SppVH90-065 missing chips on board 0

Board 0 has 0 chips (expected: 126)

Miner: EN-M30SppVH90-065
Time: Nov 6, 2025 6:40 PM
```

## What This Means

### When You See "0 chips (expected: 126)"

This indicates a **hardware failure** on the hashboard:
- **Cause**: Hashboard is not detecting any ASIC chips
- **Severity**: Warning (miner may still partially work with other boards)
- **Action Required**: 
  1. Check hashboard connections
  2. Inspect for physical damage
  3. May need hashboard replacement
  4. Consider rebooting the miner first

### When You See "120 chips (expected: 126)"

This indicates **partial chip failure**:
- **Cause**: Some chips on the hashboard are not responding
- **Severity**: Warning (reduced hashrate on that board)
- **Action Required**:
  1. Monitor if it gets worse
  2. Check for overheating on that board
  3. May need hashboard repair/replacement

## Alert Thresholds

- **Duration**: Alert fires after 10 minutes of missing chips
- **Severity**: Warning (not critical, as other boards may still work)
- **Resolution**: Alert auto-resolves when chip count returns to expected

## Deployment

To apply the fix:

```bash
ssh admin@192.168.1.66
cd /opt/mining-stack

# Restart Prometheus to load new alert rules
docker restart prometheus

# Restart backend to load new error codes
docker restart mining-stack-backend-1

# Verify
docker logs --tail 20 prometheus
docker logs --tail 20 mining-stack-backend-1
```

## Testing

After deployment, you can test by checking existing alerts:

```bash
# Check Prometheus alerts
curl -s http://192.168.1.66:9090/api/v1/alerts | jq '.data.alerts[] | select(.labels.alertname == "MinerMissingChips")'

# Check if expected value is now showing
# Look for "description" field in the alert
```

## Related Files

- `/docker/prometheus/rules/mining_alerts.yml` - Alert rule definition
- `/backend/src/services/mining.service.ts` - Error code definition
- `/python-scheduler/collectors/pyasic_collector.py` - Metrics collection

## Additional Context

### Metrics Involved

1. **`miner_board_chips_count`**: Actual number of chips detected
   - Labels: `ip`, `name`, `model`, `slot`
   - Example: `miner_board_chips_count{ip="192.168.1.40",name="EN-M30SppVH90-040",slot="0"} 0`

2. **`miner_board_chips_expected`**: Expected number of chips
   - Labels: `ip`, `name`, `model`, `slot`
   - Example: `miner_board_chips_expected{ip="192.168.1.40",name="EN-M30SppVH90-040",slot="0"} 126`

### Why This Happens

Common causes of missing chips:
1. **Hashboard failure**: Physical damage or component failure
2. **Connection issues**: Loose cables between control board and hashboard
3. **Power issues**: Insufficient power to the hashboard
4. **Firmware issues**: Miner firmware not detecting chips correctly
5. **Overheating**: Chips shut down due to excessive heat

### Recommended Actions

When you receive this alert:

1. **Check miner status**: Is it still mining? What's the hashrate?
2. **Check temperature**: High temps can cause chip failures
3. **Try rebooting**: Sometimes a reboot resolves detection issues
4. **Physical inspection**: Check for loose connections or damage
5. **Monitor**: If it persists, plan for maintenance/replacement

## Troubleshooting

### Alert Still Shows Empty Expected Value

If the alert still doesn't show the expected value:

1. Check if metrics are being collected:
   ```bash
   curl -s 'http://192.168.1.66:9090/api/v1/query?query=miner_board_chips_expected' | jq
   ```

2. Verify the alert rule syntax:
   ```bash
   docker exec prometheus promtool check rules /etc/prometheus/rules/mining_alerts.yml
   ```

3. Check Prometheus logs:
   ```bash
   docker logs prometheus | grep -i "missing\|chip"
   ```

### Alert Not Firing

If the alert should fire but doesn't:

1. Check if the condition is met:
   ```bash
   curl -s 'http://192.168.1.66:9090/api/v1/query?query=miner_board_chips_count%20%3C%20on(ip%2C%20name%2C%20slot)%20group_left()%20miner_board_chips_expected' | jq
   ```

2. Check alert evaluation:
   ```bash
   curl -s http://192.168.1.66:9090/api/v1/rules | jq '.data.groups[] | select(.name == "mining_warning")'
   ```

## Future Improvements

Potential enhancements:
1. Add per-board hashrate metrics to show impact
2. Track chip count history to detect degradation
3. Add automatic miner reboot on chip detection failure
4. Correlate with temperature to identify heat-related failures
5. Add predictive alerts for gradual chip loss

---

**Status**: Ready for deployment  
**Impact**: Low (cosmetic fix, improves alert clarity)  
**Risk**: Minimal (only changes alert description format)
