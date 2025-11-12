# Editing Prometheus Alert Rules

**Last Updated**: November 12, 2025

## Overview

This guide explains how to view, edit, and reload Prometheus alert rules for your mining farm monitoring system.

---

## Current Alert Rules Tab

The **Alert Rules** tab in the frontend currently shows a **static reference list** of the configured rules. This is for documentation purposes.

### ⚠️ Important Note

**New rules will NOT automatically appear in this tab** because the list is hardcoded. However, I've added a backend API that can read the actual rules files dynamically (see Future Enhancement section below).

---

## Two Types of Alert Rules

### 1. **Static Global Rules** (Manual Editing)

These are rules that apply to all miners or use fixed thresholds.

**Location:**
- `/opt/mining-stack/docker/prometheus/rules/mining_alerts.yml`
- `/opt/mining-stack/docker/prometheus/rules/pool_network_alerts.yml`

**Examples:**
- MinerOffline - Applies to all miners
- MinerNotMining - Applies to all miners
- Pool network alerts - Apply to all pools

### 2. **Dynamic Per-Miner Rules** (Auto-Generated)

These are rules generated from `miners.yaml` with per-miner thresholds.

**Location:**
- `/opt/mining-stack/etc/miners.yaml` - Source configuration

**Examples:**
- MinerHighTemperature - Per-miner threshold
- MinerHashrateCritical - Based on expected hashrate
- MinerFanFailure - Per-miner threshold

---

## How to Edit Static Global Rules

### Step 1: SSH to Raspberry Pi

```bash
ssh admin@192.168.1.66
```

### Step 2: Navigate to Rules Directory

```bash
cd /opt/mining-stack/docker/prometheus/rules
```

### Step 3: Edit the Rules File

```bash
# Edit mining alerts
nano mining_alerts.yml

# Or edit pool/network alerts
nano pool_network_alerts.yml
```

### Step 4: Example - Add a New Rule

```yaml
groups:
  - name: mining_warning
    interval: 30s
    rules:
      # ... existing rules ...
      
      # NEW RULE: Alert when miner efficiency is poor
      - alert: MinerPoorEfficiency
        expr: miner_efficiency_j_th > 40
        for: 20m
        labels:
          severity: warning
          component: miner
        annotations:
          summary: "Miner {{ $labels.name }} poor efficiency"
          description: "Miner {{ $labels.name }} efficiency is {{ $value }} J/TH (threshold: 40 J/TH)"
```

### Step 5: Validate YAML Syntax

```bash
# Check if YAML is valid
python3 -c "import yaml; yaml.safe_load(open('mining_alerts.yml'))"
```

### Step 6: Reload Prometheus

**Option A: Send HUP Signal (Recommended)**
```bash
docker exec mining-stack-prometheus-1 kill -HUP 1
```

**Option B: Restart Container**
```bash
cd /opt/mining-stack
docker compose -f docker-compose.prod.yml restart prometheus
```

**Option C: Via API (if backend is running)**
```bash
curl -X POST http://192.168.1.66:3000/api/prometheus/reload
```

### Step 7: Verify Rules Loaded

```bash
# Check Prometheus logs
docker logs mining-stack-prometheus-1 --tail 50

# Look for: "Loading configuration file" and "Completed loading of configuration file"
```

---

## How to Edit Per-Miner Thresholds

### Step 1: Edit miners.yaml

```bash
ssh admin@192.168.1.66
cd /opt/mining-stack/etc
nano miners.yaml
```

### Step 2: Add/Modify Thresholds

```yaml
miners:
  - ip: 192.168.1.40
    name: EN-M30-040
    alias: "Miner 040"
    model: "M30S++"
    thresholds:
      temperature:
        warning: 70      # Override: 70°C instead of default 75°C
        critical: 80     # Override: 80°C instead of default 85°C
        shutdown: 90     # Override: 90°C instead of default 95°C
      hashrate:
        expected: 106    # Expected hashrate for this miner (TH/s)
        warningPercent: 20   # Alert if < 80% of expected
        criticalPercent: 50  # Alert if < 50% of expected
      fanSpeed:
        warning: 3500    # Override: 3500 RPM instead of default 3000 RPM
        critical: 2500   # Override: 2500 RPM instead of default 2000 RPM
```

### Step 3: Regenerate Prometheus Rules

The system will automatically regenerate rules when you update `miners.yaml` via the backend API. But you can also do it manually:

```bash
cd /opt/mining-stack
/opt/mining-stack/venv/bin/python3 bin/generate_prometheus_rules.py
```

### Step 4: Reload Prometheus

```bash
docker exec mining-stack-prometheus-1 kill -HUP 1
```

---

## Alert Rule Syntax

### Basic Structure

```yaml
- alert: AlertName
  expr: prometheus_query_expression
  for: duration
  labels:
    severity: critical|warning|info
    component: miner|farm|network|system
  annotations:
    summary: "Short description"
    description: "Detailed description with {{ $labels.name }} and {{ $value }}"
```

### Common Expressions

**Temperature Alerts:**
```yaml
expr: miner_temp_max_c > 85
expr: miner_temp_max_c{name="EN-M30-040"} > 80
```

**Hashrate Alerts:**
```yaml
# SHA-256 miners
expr: miner_hashrate_ths < 50

# SCRYPT miners
expr: miner_hashrate_mhs < 10000

# Below expected (with percentage)
expr: miner_hashrate_ths < (miner_expected_hashrate_ths * 0.8)
```

**Fan Speed Alerts:**
```yaml
expr: miner_fan_speed_rpm < 3000 and miner_fan_speed_rpm > 0
```

**Rejection Rate Alerts:**
```yaml
expr: |
  (
    rate(miner_pool_rejected_total[5m]) / 
    (rate(miner_pool_accepted_total[5m]) + rate(miner_pool_rejected_total[5m]))
  ) > 0.05
```

**Farm-Wide Alerts:**
```yaml
# Multiple miners offline
expr: count(miner_scrape_success == 0) > 3

# Total hashrate drop
expr: sum(miner_hashrate_ths) < 1500

# Average temperature high
expr: avg(miner_temp_max_c) > 80
```

### Duration Syntax

- `2m` - 2 minutes
- `5m` - 5 minutes
- `10m` - 10 minutes
- `1h` - 1 hour

The alert fires only if the condition persists for this duration.

---

## Testing Alert Rules

### 1. Check Rule Syntax

```bash
# Validate YAML
python3 -c "import yaml; yaml.safe_load(open('/opt/mining-stack/docker/prometheus/rules/mining_alerts.yml'))"
```

### 2. Test Expression in Prometheus UI

1. Open Prometheus: http://192.168.1.66:9090
2. Go to **Graph** tab
3. Enter your expression
4. Click **Execute**
5. Verify it returns expected results

### 3. Check Active Alerts

1. Open Prometheus: http://192.168.1.66:9090
2. Go to **Alerts** tab
3. See which alerts are currently firing
4. Check alert state: Inactive, Pending, Firing

### 4. Trigger Test Alert

```bash
# Temporarily lower threshold to trigger alert
# Edit rule, reload, wait for duration, then revert
```

---

## Troubleshooting

### Rules Not Loading

**Check Prometheus logs:**
```bash
docker logs mining-stack-prometheus-1 --tail 100
```

**Look for errors like:**
- `error loading rules: ...` - Syntax error in YAML
- `invalid expression: ...` - Invalid PromQL expression

**Common Issues:**
1. **YAML syntax error** - Check indentation (use spaces, not tabs)
2. **Invalid PromQL** - Test expression in Prometheus UI first
3. **Missing metric** - Metric doesn't exist or isn't being scraped
4. **Prometheus not reloaded** - Send HUP signal again

### Alert Not Firing

**Possible Causes:**
1. **Condition not met** - Check metric value in Prometheus
2. **Duration not elapsed** - Wait for `for:` duration
3. **Metric missing** - Miner offline or not reporting metric
4. **Expression error** - Test in Prometheus UI

**Debug Steps:**
```bash
# 1. Check if metric exists
curl 'http://192.168.1.66:9090/api/v1/query?query=miner_temp_max_c'

# 2. Check alert state
curl 'http://192.168.1.66:9090/api/v1/alerts'

# 3. Check Alertmanager
curl 'http://192.168.1.66:9093/api/v2/alerts'
```

### Prometheus Won't Reload

**Check container status:**
```bash
docker ps | grep prometheus
```

**Restart if needed:**
```bash
docker compose -f /opt/mining-stack/docker-compose.prod.yml restart prometheus
```

**Check for config errors:**
```bash
docker logs mining-stack-prometheus-1 | grep -i error
```

---

## API Endpoints

### Get Current Alert Rules

```bash
curl http://192.168.1.66:3000/api/prometheus/rules
```

**Response:**
```json
{
  "mining": {
    "groups": [
      {
        "name": "mining_critical",
        "interval": "30s",
        "rules": [...]
      }
    ]
  },
  "poolNetwork": {
    "groups": [...]
  }
}
```

### Reload Prometheus

```bash
curl -X POST http://192.168.1.66:3000/api/prometheus/reload
```

**Response:**
```json
{
  "success": true,
  "message": "Prometheus configuration reloaded successfully"
}
```

---

## Best Practices

### 1. Test Before Deploying

- Test expressions in Prometheus UI
- Validate YAML syntax
- Check for typos in metric names

### 2. Use Appropriate Durations

- **Critical alerts**: 2-5 minutes (fast response)
- **Warning alerts**: 5-15 minutes (avoid false positives)
- **Info alerts**: 15-30 minutes (low priority)

### 3. Set Realistic Thresholds

- Base on historical data
- Account for normal variance
- Avoid alert fatigue

### 4. Document Changes

- Add comments in YAML files
- Update this documentation
- Track changes in git

### 5. Monitor Alert Frequency

- Too many alerts = thresholds too sensitive
- No alerts = thresholds too lenient
- Adjust based on experience

---

## Future Enhancement: Dynamic Alert Rules Tab

I've added backend API endpoints to read the actual Prometheus rules files. To make the frontend tab dynamic:

### Backend API (Already Implemented)

```typescript
// Get all rules from YAML files
GET /api/prometheus/rules

// Reload Prometheus config
POST /api/prometheus/reload
```

### Frontend Update (To Be Implemented)

```typescript
// In Alerts.tsx
const [alertRules, setAlertRules] = useState<any>(null);

useEffect(() => {
  fetch('/api/prometheus/rules')
    .then(res => res.json())
    .then(data => setAlertRules(data));
}, []);

// Then render rules dynamically from alertRules state
```

### Benefits of Dynamic Tab

✅ Always shows current rules
✅ Reflects changes immediately after reload
✅ No need to update frontend code when rules change
✅ Can show per-miner threshold overrides
✅ Can add "Reload Prometheus" button in UI

---

## Quick Reference

### Common Commands

```bash
# Edit mining rules
nano /opt/mining-stack/docker/prometheus/rules/mining_alerts.yml

# Edit per-miner thresholds
nano /opt/mining-stack/etc/miners.yaml

# Regenerate rules from miners.yaml
/opt/mining-stack/venv/bin/python3 /opt/mining-stack/bin/generate_prometheus_rules.py

# Reload Prometheus
docker exec mining-stack-prometheus-1 kill -HUP 1

# Check Prometheus logs
docker logs mining-stack-prometheus-1 --tail 50

# View active alerts
curl http://192.168.1.66:9090/api/v1/alerts

# Test PromQL expression
curl 'http://192.168.1.66:9090/api/v1/query?query=miner_temp_max_c'
```

### File Locations

| File | Purpose |
|------|---------|
| `/opt/mining-stack/docker/prometheus/rules/mining_alerts.yml` | Mining alert rules |
| `/opt/mining-stack/docker/prometheus/rules/pool_network_alerts.yml` | Pool/network alert rules |
| `/opt/mining-stack/etc/miners.yaml` | Per-miner configuration and thresholds |
| `/opt/mining-stack/bin/generate_prometheus_rules.py` | Script to generate rules from miners.yaml |
| `/opt/mining-stack/docker/prometheus/prometheus.yml` | Prometheus main config |
| `/opt/mining-stack/docker/alertmanager/alertmanager.yml` | Alertmanager routing config |

---

## Summary

**To add/edit alert rules:**

1. **For global rules**: Edit YAML files directly
2. **For per-miner thresholds**: Edit `miners.yaml`
3. **Always reload Prometheus** after changes
4. **Test in Prometheus UI** before deploying
5. **Monitor alert frequency** and adjust thresholds

**The Alert Rules tab** currently shows a static list for reference. The backend API can read actual rules dynamically, but the frontend needs to be updated to use it (future enhancement).
