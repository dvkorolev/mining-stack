# 🎯 Miner Threshold Configuration

Complete guide to configuring and managing miner thresholds for monitoring and alerting.

---

## 📋 Table of Contents

1. [Overview](#overview)
2. [Global Default Thresholds](#global-default-thresholds)
3. [Configuration Methods](#configuration-methods)
4. [Threshold Types](#threshold-types)
5. [Prometheus Integration](#prometheus-integration)
6. [Best Practices](#best-practices)

---

## Overview

The Mining Dashboard supports **configurable thresholds** with **Global Defaults + Per-Miner Overrides**.

### **Architecture:**

```
Global Defaults (.env)
     ↓
Per-Miner Overrides (miners.yaml)
     ↓
Backend Merges (getEffectiveThresholds)
     ↓
Prometheus Rules (auto-generated)
     ↓
Alertmanager (notifications)
```

---

## Global Default Thresholds

### **Temperature**
- **Warning**: 75°C (elevated temperature)
- **Critical**: 85°C (dangerous - triggers alerts)
- **Shutdown**: 90°C (emergency threshold)

### **Hashrate**
- **Warning**: 20% below expected
- **Critical**: 50% below expected
- **Expected**: Must be set per-miner

### **Power**
- **Warning**: ±15% deviation from expected
- **Expected**: Must be set per-miner

### **Rejection Rate**
- **Warning**: 2%
- **Critical**: 5%

### **Fan Speed**
- **Warning**: <3000 RPM
- **Critical**: <2000 RPM

---

## Configuration Methods

### **Method 1: Environment Variables (Global)**

Edit `.env` file:

```bash
# Temperature thresholds (°C)
THRESHOLD_TEMP_WARNING=75
THRESHOLD_TEMP_CRITICAL=85
THRESHOLD_TEMP_SHUTDOWN=90

# Hashrate thresholds (% below expected)
THRESHOLD_HASHRATE_WARNING_PCT=20
THRESHOLD_HASHRATE_CRITICAL_PCT=50

# Power thresholds (% deviation)
THRESHOLD_POWER_WARNING_PCT=15

# Rejection rate thresholds (%)
THRESHOLD_REJECTION_WARNING=2.0
THRESHOLD_REJECTION_CRITICAL=5.0

# Fan speed thresholds (RPM)
THRESHOLD_FAN_WARNING=3000
THRESHOLD_FAN_CRITICAL=2000
```

### **Method 2: Per-Miner Override (UI)**

1. Go to **Miners** page
2. Click **Edit** on any miner
3. Expand **"Advanced Thresholds (Optional)"** section
4. Set custom values for that specific miner
5. Leave empty to use global defaults

### **Method 3: YAML Configuration**

Edit `etc/miners.yaml`:

```yaml
miners:
  - ip: "192.168.1.40"
    name: "EN-M30SppVH90-040"
    model: "M30S++ VH90 (Stock)"
    thresholds:
      temperature:
        warning: 80      # Custom: 80°C instead of 75°C
        critical: 90     # Custom: 90°C instead of 85°C
        shutdown: 95     # Custom: 95°C instead of 90°C
      hashrate:
        expected: 106    # Expected 106 TH/s
        warningPercent: 15
        criticalPercent: 40
      power:
        expected: 3400   # Expected 3400W
        warningPercent: 10
      rejectionRate:
        warning: 1.5
        critical: 3.0
      fanSpeed:
        warning: 3500
        critical: 2500
```

---

## Threshold Types

### **Temperature Thresholds**

```yaml
temperature:
  warning: 75      # Yellow alert
  critical: 85     # Red alert + notification
  shutdown: 90     # Emergency threshold
```

**Use Cases:**
- Hot climate: Lower thresholds (70/80/85°C)
- Cold climate: Higher thresholds (80/90/95°C)
- Older miners: More tolerance

### **Hashrate Thresholds**

```yaml
hashrate:
  expected: 106.2      # Expected hashrate in TH/s
  warningPercent: 20   # Alert at 20% below (84.96 TH/s)
  criticalPercent: 50  # Critical at 50% below (53.1 TH/s)
```

**Auto-Discovery:**
- `farm_init.py` measures actual hashrate
- Sets `expected` automatically
- Thresholds calculated from expected

### **Power Thresholds**

```yaml
power:
  expected: 3400       # Expected power in W
  warningPercent: 15   # Alert at ±15% (2890-3910W)
```

**Use Cases:**
- Detect power supply issues
- Monitor efficiency changes
- Track overclocking

### **Rejection Rate Thresholds**

```yaml
rejectionRate:
  warning: 2.0     # 2% rejection rate
  critical: 5.0    # 5% rejection rate
```

**Indicates:**
- Pool connectivity issues
- Network problems
- Miner instability

### **Fan Speed Thresholds**

```yaml
fanSpeed:
  warning: 3000    # Below 3000 RPM
  critical: 2000   # Below 2000 RPM
```

**Prevents:**
- Overheating
- Hardware damage
- Reduced lifespan

---

## Prometheus Integration

### **Automatic Rule Generation**

Thresholds are automatically synced with Prometheus:

```bash
# Generate Prometheus rules from miners.yaml
./venv/bin/python3 bin/generate_prometheus_rules.py

# Reload Prometheus (no restart!)
docker exec mining-stack-prometheus-1 kill -HUP 1
```

### **Generated Rules Example**

```yaml
# Per-miner temperature alert
- alert: MinerHighTemperature
  expr: miner_temp_max_c{name="EN-M30SppVH90-040"} > 90
  for: 2m
  annotations:
    summary: "Miner EN-M30SppVH90-040 temperature critical"
    description: "Temperature is {{ $value }}°C (threshold: 90°C)"

# Per-miner hashrate alert
- alert: MinerHashrateCritical
  expr: miner_hashrate_ths{name="EN-M30SppVH90-040"} < 53.1
  for: 10m
  annotations:
    summary: "Miner EN-M30SppVH90-040 hashrate critically low"
    description: "Hashrate is {{ $value }} TH/s (expected: 106.2, threshold: 53.1)"
```

### **Workflow**

```
1. Edit threshold in UI
   ↓
2. Backend saves to miners.yaml
   ↓
3. generate_prometheus_rules.py runs
   ↓
4. mining_alerts.yml updated
   ↓
5. Prometheus reloaded (2 seconds)
   ↓
6. Alertmanager uses new thresholds
```

---

## Best Practices

### **1. Start with Defaults**
- Use global defaults initially
- Monitor for a week
- Adjust based on your environment

### **2. Customize for Environment**
- **Hot climate**: Lower temperature thresholds
- **Cold climate**: Can use higher thresholds
- **Stable power**: Tighter power deviation %

### **3. Per-Miner Tuning**
- **Older miners**: Higher temperature tolerance
- **Overclocked**: Adjust expected hashrate/power
- **Different locations**: Different ambient temps

### **4. Seasonal Adjustments**
- **Summer**: Lower temperature thresholds
- **Winter**: Can relax temperature thresholds
- Update via environment variables

### **5. Use Auto-Discovery**
```bash
# Let farm_init.py measure actual performance
python3 bin/farm_init.py

# Expected hashrate/power set automatically
# No manual data entry needed
```

---

## Recommended Settings by Model

### **Antminer S19 Series**
```yaml
thresholds:
  temperature:
    warning: 75
    critical: 85
    shutdown: 90
  hashrate:
    expected: 95-110  # Varies by model
    warningPercent: 20
    criticalPercent: 50
  power:
    expected: 3250
    warningPercent: 15
```

### **Whatsminer M30S++**
```yaml
thresholds:
  temperature:
    warning: 75
    critical: 85
    shutdown: 90
  hashrate:
    expected: 100-112  # Varies by VH version
    warningPercent: 20
    criticalPercent: 50
  power:
    expected: 3300-3600
    warningPercent: 15
```

### **Whatsminer M50 Series**
```yaml
thresholds:
  temperature:
    warning: 75
    critical: 85
    shutdown: 90
  hashrate:
    expected: 115-155  # Varies by model
    warningPercent: 20
    criticalPercent: 50
  power:
    expected: 3400-3700
    warningPercent: 15
```

---

## Troubleshooting

### **Thresholds Not Applied**

```bash
# Restart backend to reload config
docker compose -f docker-compose.prod.yml restart backend

# Check logs
docker logs mining-stack-backend-1 | grep "threshold"
```

### **Too Many Alerts**

- Increase warning thresholds
- Increase alert duration (in Prometheus rules)
- Check if miners need maintenance

### **No Alerts When Expected**

- Verify thresholds are set correctly
- Check Prometheus is scraping metrics
- Verify alert rules are loaded

```bash
# Check Prometheus rules
curl -s http://localhost:9090/api/v1/rules | jq '.data.groups[].rules[] | select(.name=="MinerHighTemperature")'
```

---

## Quick Reference

### **Priority Order:**
1. **Per-Miner Override** (if set in miners.yaml)
2. **Global Default** (if no override)

### **Visual Indicators:**
- 🟢 **Green**: Below warning threshold
- 🟡 **Yellow**: Warning ≤ value < Critical
- 🔴 **Red**: Critical or above

### **Alert Triggers:**
- **Temperature Critical** (85°C): Alert after 2 minutes
- **Hashrate Low** (20% below): Alert after 10 minutes
- **Fan Failure** (<2000 RPM): Immediate alert
- **High Rejection** (>5%): Alert after 5 minutes

---

## See Also

- [Configuration Guide](./CONFIGURATION.md) - General configuration
- [Monitoring Guide](./MONITORING.md) - Prometheus & Grafana setup
- [Telegram Bot](./TELEGRAM_BOT.md) - Alert notifications
- [Troubleshooting](./TROUBLESHOOTING.md) - Common issues

---

**Last Updated**: November 1, 2025  
**Feature Version**: 2.1 (Configurable Thresholds)
