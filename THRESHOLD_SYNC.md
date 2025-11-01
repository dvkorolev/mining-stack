# 🔄 Threshold Synchronization with Prometheus/Alertmanager

## Problem

**Currently, thresholds are NOT synced:**

```
┌─────────────────────────────────────────────────────────┐
│  Backend (miners.yaml)                                  │
│  Temperature Critical: 90°C (per-miner)                 │
└─────────────────────────────────────────────────────────┘
                         ❌ NOT CONNECTED
┌─────────────────────────────────────────────────────────┐
│  Prometheus (mining_alerts.yml)                         │
│  Temperature Critical: 85°C (hardcoded)                 │
└─────────────────────────────────────────────────────────┘
```

**Result:** You set 90°C in UI, but Prometheus still alerts at 85°C!

---

## ✅ Solution: Dynamic Rule Generation

### **Architecture:**

```
miners.yaml (source of truth)
     ↓
generate_prometheus_rules.py
     ↓
mining_alerts.yml (generated)
     ↓
Prometheus reload
     ↓
Alertmanager (synced!)
```

---

## 🚀 Setup

### **1. Make Script Executable**

```bash
cd /opt/mining-stack
chmod +x bin/generate_prometheus_rules.py
```

### **2. Generate Rules**

```bash
# Generate Prometheus rules from miners.yaml
./venv/bin/python3 bin/generate_prometheus_rules.py

# Output:
# ✓ Generated 44 critical rules
# ✓ Generated 46 warning rules
# ✓ Written to docker/prometheus/rules/mining_alerts.yml
#
# Reload Prometheus to apply:
#   docker exec mining-stack-prometheus-1 kill -HUP 1
```

### **3. Reload Prometheus**

```bash
# Reload Prometheus configuration (no restart needed!)
docker exec mining-stack-prometheus-1 kill -HUP 1

# Verify rules loaded
curl -s http://localhost:9090/api/v1/rules | jq '.data.groups[].rules[].alert' | head -10
```

### **4. Automate Rule Generation**

Update backend to regenerate rules when thresholds change:

```typescript
// backend/src/config/miners.config.ts

import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

export const saveMinersConfig = async (minersToSave: MinerConfig[]): Promise<void> => {
  try {
    // ... existing save logic ...
    
    // Regenerate Prometheus rules
    await regeneratePrometheusRules();
    
  } catch (error) {
    logger.error('Failed to save miners configuration:', error);
    throw error;
  }
};

async function regeneratePrometheusRules(): Promise<void> {
  try {
    logger.info('Regenerating Prometheus alert rules...');
    
    const scriptPath = process.env.NODE_ENV === 'production'
      ? '/opt/mining-stack/bin/generate_prometheus_rules.py'
      : path.join(process.cwd(), 'bin', 'generate_prometheus_rules.py');
    
    const venvPython = process.env.NODE_ENV === 'production'
      ? '/opt/mining-stack/venv/bin/python3'
      : path.join(process.cwd(), 'venv', 'bin', 'python3');
    
    // Generate rules
    await execAsync(`${venvPython} ${scriptPath}`);
    
    // Reload Prometheus
    await execAsync('docker exec mining-stack-prometheus-1 kill -HUP 1');
    
    logger.info('✓ Prometheus rules regenerated and reloaded');
  } catch (error) {
    logger.error('Failed to regenerate Prometheus rules:', error);
    // Don't throw - this is not critical for config save
  }
}
```

---

## 📊 Generated Rules Example

### **Before (Hardcoded):**

```yaml
- alert: MinerHighTemperature
  expr: miner_temp_max_c > 85  # Same for ALL miners
  for: 2m
```

### **After (Per-Miner):**

```yaml
# Miner 1: Custom threshold (90°C)
- alert: MinerHighTemperature
  expr: miner_temp_max_c{name="EN-M30SppVH90-040"} > 90
  for: 2m
  annotations:
    summary: "Miner EN-M30SppVH90-040 temperature critical"
    description: "Temperature is {{ $value }}°C (threshold: 90°C)"

# Miner 2: Global default (85°C)
- alert: MinerHighTemperature
  expr: miner_temp_max_c{name="EN-M30SppVH90-074"} > 85
  for: 2m
  annotations:
    summary: "Miner EN-M30SppVH90-074 temperature critical"
    description: "Temperature is {{ $value }}°C (threshold: 85°C)"
```

---

## 🔄 Workflow

### **When You Update Thresholds:**

```
1. User edits miner in UI
   ↓
2. Frontend sends to backend API
   ↓
3. Backend saves to miners.yaml
   ↓
4. Backend calls generate_prometheus_rules.py
   ↓
5. Script generates new mining_alerts.yml
   ↓
6. Backend reloads Prometheus (HUP signal)
   ↓
7. Prometheus applies new rules
   ↓
8. Alertmanager uses new thresholds
   ↓
9. ✅ SYNCED!
```

**Total time: ~2 seconds**

---

## 🎯 What Gets Synced

### **Per-Miner Thresholds:**

✅ **Temperature**
- Warning threshold (default: 75°C)
- Critical threshold (default: 85°C)
- Per-miner overrides

✅ **Hashrate**
- Expected hashrate (from miners.yaml)
- Warning % (default: 20% below)
- Critical % (default: 50% below)
- Per-miner overrides

✅ **Fan Speed**
- Warning threshold (default: 3000 RPM)
- Critical threshold (default: 2000 RPM)
- Per-miner overrides

### **Global Thresholds:**

✅ **Rejection Rate**
- Warning: 2%
- Critical: 5%

✅ **Miner Offline**
- 5 minutes unreachable

✅ **Not Mining**
- 5 minutes stopped

---

## 📈 Example Scenarios

### **Scenario 1: Hot Environment**

```yaml
# Set all miners to lower thresholds
THRESHOLD_TEMP_WARNING=70
THRESHOLD_TEMP_CRITICAL=80

# Regenerate rules
./venv/bin/python3 bin/generate_prometheus_rules.py

# Reload Prometheus
docker exec mining-stack-prometheus-1 kill -HUP 1

# Result: All miners now alert at 70°C/80°C
```

### **Scenario 2: One Problematic Miner**

```yaml
# In miners.yaml, set custom threshold for one miner
miners:
  - ip: "192.168.1.74"
    name: "EN-M30SppVH90-074"
    thresholds:
      temperature:
        critical: 90  # Higher tolerance for this miner

# Regenerate rules
./venv/bin/python3 bin/generate_prometheus_rules.py

# Result: 
# - Miner .074 alerts at 90°C
# - All others alert at 85°C (global default)
```

### **Scenario 3: Expected Hashrate**

```yaml
# farm_init.py discovers miners and sets expected hashrate
miners:
  - ip: "192.168.1.40"
    thresholds:
      hashrate:
        expected: 106.2  # Measured during discovery

# Regenerate rules
./venv/bin/python3 bin/generate_prometheus_rules.py

# Result: Prometheus alerts if hashrate drops below:
# - Warning: 84.96 TH/s (20% below 106.2)
# - Critical: 53.1 TH/s (50% below 106.2)
```

---

## 🔍 Verification

### **Check Generated Rules:**

```bash
# View generated rules
cat docker/prometheus/rules/mining_alerts.yml

# Count rules
echo "Critical rules: $(grep -c "severity: critical" docker/prometheus/rules/mining_alerts.yml)"
echo "Warning rules: $(grep -c "severity: warning" docker/prometheus/rules/mining_alerts.yml)"
```

### **Check Prometheus Loaded Rules:**

```bash
# Query Prometheus API
curl -s http://localhost:9090/api/v1/rules | jq '.data.groups[].rules[] | select(.name=="MinerHighTemperature")'

# Check specific miner threshold
curl -s http://localhost:9090/api/v1/rules | jq '.data.groups[].rules[] | select(.name=="MinerHighTemperature") | select(.labels.miner=="EN-M30SppVH90-040")'
```

### **Test Alert:**

```bash
# Temporarily set low threshold to test
# Edit miners.yaml:
thresholds:
  temperature:
    critical: 70  # Lower than current temp

# Regenerate and reload
./venv/bin/python3 bin/generate_prometheus_rules.py
docker exec mining-stack-prometheus-1 kill -HUP 1

# Check alerts firing
curl -s http://localhost:9090/api/v1/alerts | jq '.data.alerts[] | select(.labels.alertname=="MinerHighTemperature")'

# Restore threshold
# Edit miners.yaml back to 85°C
# Regenerate and reload
```

---

## 🐛 Troubleshooting

### **Rules Not Updating:**

```bash
# Check if script runs successfully
./venv/bin/python3 bin/generate_prometheus_rules.py

# Check Prometheus logs
docker logs mining-stack-prometheus-1 | tail -50

# Verify rules file
cat docker/prometheus/rules/mining_alerts.yml | grep -A5 "MinerHighTemperature"

# Force reload
docker exec mining-stack-prometheus-1 kill -HUP 1
```

### **Prometheus Reload Failed:**

```bash
# Check Prometheus status
docker exec mining-stack-prometheus-1 promtool check rules /etc/prometheus/rules/mining_alerts.yml

# If invalid, fix and regenerate
./venv/bin/python3 bin/generate_prometheus_rules.py

# Restart Prometheus (last resort)
docker compose -f docker-compose.prod.yml restart prometheus
```

### **Alerts Not Firing:**

```bash
# Check rule expression
curl -s http://localhost:9090/api/v1/query?query=miner_temp_max_c{name="EN-M30SppVH90-040"}

# Check alert status
curl -s http://localhost:9090/api/v1/alerts | jq '.data.alerts[] | select(.labels.miner=="EN-M30SppVH90-040")'

# Check Alertmanager
curl -s http://localhost:9093/api/v2/alerts
```

---

## 🎯 Best Practices

### **1. Regenerate After Changes:**

```bash
# After editing miners.yaml manually
./venv/bin/python3 bin/generate_prometheus_rules.py
docker exec mining-stack-prometheus-1 kill -HUP 1
```

### **2. Backup Rules:**

```bash
# Before regenerating
cp docker/prometheus/rules/mining_alerts.yml docker/prometheus/rules/mining_alerts.yml.backup
```

### **3. Test in Development:**

```bash
# Test rule generation locally
./venv/bin/python3 bin/generate_prometheus_rules.py

# Review generated rules
cat docker/prometheus/rules/mining_alerts.yml

# Validate with promtool
docker run --rm -v $(pwd)/docker/prometheus/rules:/rules prom/prometheus:latest promtool check rules /rules/mining_alerts.yml
```

### **4. Monitor Rule Changes:**

```bash
# Add to git
git add docker/prometheus/rules/mining_alerts.yml
git commit -m "Update alert rules with new thresholds"

# Track changes
git diff HEAD~1 docker/prometheus/rules/mining_alerts.yml
```

---

## 📝 Summary

### **Before Sync:**
- ❌ Thresholds in two places
- ❌ Manual updates required
- ❌ Easy to get out of sync
- ❌ Hardcoded values

### **After Sync:**
- ✅ Single source of truth (miners.yaml)
- ✅ Automatic rule generation
- ✅ Per-miner customization
- ✅ Dynamic thresholds

### **Workflow:**
1. Edit threshold in UI or miners.yaml
2. Script generates Prometheus rules
3. Prometheus reloads automatically
4. Alertmanager uses new thresholds
5. ✅ Everything synced!

**Your monitoring system is now fully integrated!** 🚀
