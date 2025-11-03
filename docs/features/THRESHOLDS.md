# 🎯 Threshold Configuration Guide

## Overview

The Mining Dashboard now supports **configurable thresholds** for monitoring your miners with **Global Defaults + Per-Miner Overrides**.

---

## 🌍 Global Default Thresholds

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

## ⚙️ Configuration Methods

### **Method 1: Environment Variables (Global)**

Edit `.env` file to change global defaults:

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
    alias: "EN-M30SppVH90-040"
    owner: "EN"
    thresholds:
      temperature:
        warning: 80      # Custom: 80°C instead of 75°C
        critical: 90     # Custom: 90°C instead of 85°C
        shutdown: 95     # Custom: 95°C instead of 90°C
      hashrate:
        expected: 106    # Expected 106 TH/s
        warningPercent: 15   # Warn at 15% below (not 20%)
        criticalPercent: 40  # Critical at 40% below (not 50%)
      power:
        expected: 3400   # Expected 3400W
        warningPercent: 10   # Warn at ±10% (not ±15%)
      rejectionRate:
        warning: 1.5     # Warn at 1.5% (not 2%)
        critical: 3.0    # Critical at 3% (not 5%)
      fanSpeed:
        warning: 3500    # Warn below 3500 RPM (not 3000)
        critical: 2500   # Critical below 2500 RPM (not 2000)
```

---

## 📊 How Thresholds Work

### **Priority Order:**
1. **Per-Miner Override** (if set)
2. **Global Default** (if no override)

### **Example:**

```
Global Default: Temperature Critical = 85°C
Miner A: No override → Uses 85°C
Miner B: Override = 90°C → Uses 90°C
```

---

## 🎨 Visual Indicators

### **Temperature Display:**
- 🟢 **Green**: Below warning threshold
- 🟡 **Yellow**: Warning ≤ temp < Critical
- 🔴 **Red**: Critical or above

### **Status Indicators:**
- **ONLINE**: All metrics within thresholds
- **WARNING**: One or more warning thresholds exceeded
- **ERROR**: One or more critical thresholds exceeded
- **OFFLINE**: Miner not responding

### **Tooltip Details:**
Hover over ⚠️ icon to see:
- Error code and message
- Detailed description
- Current value vs threshold
- Timestamp

---

## 🔔 Alert Triggers

### **When Alerts Fire:**

**Temperature Critical** (85°C):
- Dashboard shows ERROR status
- Prometheus alert fires after 2 minutes
- Telegram notification (if configured)

**Hashrate Low** (20% below expected):
- Dashboard shows WARNING status
- Prometheus alert fires after 10 minutes

**Fan Failure** (<2000 RPM):
- Dashboard shows ERROR status
- Immediate alert

**High Rejection** (>5%):
- Dashboard shows ERROR status
- Alert after 5 minutes

---

## 💡 Recommended Settings by Model

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
    expected: 3300-3600  # Varies by VH version
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
    expected: 3400-3700  # Varies by model
    warningPercent: 15
```

---

## 🧪 Testing Thresholds

### **1. Test Temperature Alert:**
```bash
# Temporarily set low threshold
THRESHOLD_TEMP_CRITICAL=70

# Check if miners above 70°C show ERROR
```

### **2. Test Hashrate Alert:**
```yaml
# Set expected hashrate for a miner
thresholds:
  hashrate:
    expected: 150  # Higher than actual
    warningPercent: 10
```

### **3. Monitor Alerts:**
```bash
# Check Prometheus alerts
curl http://localhost:9090/api/v1/alerts

# Check backend logs
docker logs mining-stack-backend-1 | grep "threshold"
```

---

## 📈 Best Practices

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

---

## 🔧 Troubleshooting

### **Thresholds Not Applied:**
```bash
# Restart backend to reload config
docker compose -f docker-compose.prod.yml restart backend

# Check logs
docker logs mining-stack-backend-1 | grep "threshold"
```

### **Too Many Alerts:**
- Increase warning thresholds
- Increase alert duration (in Prometheus rules)
- Check if miners need maintenance

### **No Alerts When Expected:**
- Verify thresholds are set correctly
- Check Prometheus is scraping metrics
- Verify alert rules are loaded

---

## 📝 Example: Complete Miner Configuration

```yaml
miners:
  # High-performance miner - tight thresholds
  - ip: "192.168.1.40"
    name: "EN-M50SppVL30-126"
    model: "M50S++ VL30"
    alias: "Main Rig 1"
    owner: "EN"
    thresholds:
      temperature:
        warning: 70      # Stricter
        critical: 80
        shutdown: 85
      hashrate:
        expected: 152
        warningPercent: 10  # Alert at 10% drop
        criticalPercent: 30
      power:
        expected: 3388
        warningPercent: 10  # Tight power monitoring
      rejectionRate:
        warning: 1.0
        critical: 2.0
      fanSpeed:
        warning: 4000    # Higher minimum
        critical: 3000

  # Older miner - relaxed thresholds
  - ip: "192.168.1.74"
    name: "EN-M30SppVH90-074"
    model: "M30S++ VH90"
    alias: "Backup Rig"
    owner: "EN"
    thresholds:
      temperature:
        warning: 80      # More tolerant
        critical: 90
        shutdown: 95
      hashrate:
        expected: 105
        warningPercent: 25  # More tolerance
        criticalPercent: 60
      power:
        expected: 3386
        warningPercent: 20
```

---

## 🎯 Summary

✅ **Global defaults** for easy setup  
✅ **Per-miner overrides** for flexibility  
✅ **Environment variables** for quick changes  
✅ **UI configuration** for convenience  
✅ **YAML configuration** for bulk management  
✅ **Visual indicators** for quick status  
✅ **Prometheus alerts** for notifications  

**Your mining operation now has professional-grade threshold monitoring!** 🚀
