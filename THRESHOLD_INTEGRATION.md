# 🔄 Threshold Integration: farm_init.py & Backend

## 📋 How It Works

### **Complete Flow:**

```
1. farm_init.py discovers miners
   ↓
2. Reads actual hashrate & power from each miner
   ↓
3. Writes miners.yaml with expected values
   ↓
4. Backend loads miners.yaml
   ↓
5. Backend merges with global defaults
   ↓
6. Dashboard displays with thresholds
```

---

## 🔍 What `farm_init.py` Adds

### **Before (Old):**
```yaml
miners:
  - ip: "192.168.1.40"
    model: "M30S++ VH90 (Stock)"
    alias: "EN-M30SppVH90-040"
    owner: "EN"
    status: "active"
```

### **After (New):**
```yaml
miners:
  - ip: "192.168.1.40"
    model: "M30S++ VH90 (Stock)"
    alias: "EN-M30SppVH90-040"
    owner: "EN"
    status: "active"
    thresholds:
      hashrate:
        expected: 106.2    # Actual measured hashrate
      power:
        expected: 3413     # Actual measured power
```

### **Key Points:**
- ✅ Only adds `expected` values (hashrate & power)
- ✅ Uses **actual measured data** from miner
- ✅ Other thresholds (warning %, critical %, temp, etc.) use **global defaults**
- ✅ If miner doesn't report power (Antminers), only hashrate is added

---

## 🔧 Backend Behavior

### **Loading Configuration:**

```typescript
// 1. Load miners.yaml
const config = yaml.load(fileContents);

// 2. For each miner, merge with global defaults
const effectiveThresholds = getEffectiveThresholds(miner);

// Result:
{
  temperature: {
    warning: 75,      // From global default
    critical: 85,     // From global default
    shutdown: 90      // From global default
  },
  hashrate: {
    expected: 106.2,  // From miners.yaml (measured!)
    warningPercent: 20,   // From global default
    criticalPercent: 50   // From global default
  },
  power: {
    expected: 3413,   // From miners.yaml (measured!)
    warningPercent: 15    // From global default
  },
  // ... etc
}
```

### **Saving Configuration:**

When you edit a miner in the UI:

```typescript
// Backend saves to miners.yaml
saveMinersConfig(miners);

// Output includes thresholds if set:
miners:
  - ip: "192.168.1.40"
    thresholds:
      temperature:
        critical: 90  # Custom override
      hashrate:
        expected: 106.2
      power:
        expected: 3413
```

---

## ✅ Benefits

### **1. Smart Defaults:**
- `farm_init.py` captures **actual performance**
- No need to manually enter expected hashrate/power
- Accurate baseline for alerts

### **2. Flexible Overrides:**
- Edit any miner in UI to customize
- Changes saved to `miners.yaml`
- Backend automatically reloads

### **3. No Backend Changes Needed:**
- Backend already supports thresholds
- `loadMinersConfig()` reads them from YAML
- `getEffectiveThresholds()` merges with globals
- Everything works automatically!

---

## 🎯 Example Scenarios

### **Scenario 1: Fresh Discovery**

```bash
# Run farm_init.py
python3 bin/farm_init.py

# Result: miners.yaml created with expected values
miners:
  - ip: "192.168.1.40"
    thresholds:
      hashrate:
        expected: 106.2  # Measured during discovery
      power:
        expected: 3413   # Measured during discovery
```

**Backend loads this and uses:**
- Temperature thresholds: **Global defaults** (75/85/90°C)
- Hashrate expected: **106.2 TH/s** (from YAML)
- Hashrate warning: **20% below** (global default)
- Power expected: **3413W** (from YAML)
- Power warning: **±15%** (global default)

### **Scenario 2: Manual Override**

```bash
# User edits miner in UI
# Sets: Temperature Critical = 90°C (instead of 85°C)

# Backend saves to miners.yaml:
miners:
  - ip: "192.168.1.40"
    thresholds:
      temperature:
        critical: 90     # Custom override
      hashrate:
        expected: 106.2  # Preserved from discovery
      power:
        expected: 3413   # Preserved from discovery
```

**Backend loads this and uses:**
- Temperature critical: **90°C** (from YAML override)
- Temperature warning: **75°C** (global default - not overridden)
- Hashrate expected: **106.2 TH/s** (from YAML)
- Everything else: **Global defaults**

### **Scenario 3: Antminer (No Power)**

```bash
# farm_init.py discovers Antminer S19 Pro
# Antminer API doesn't report power

# Result:
miners:
  - ip: "192.168.1.64"
    model: "S19 Pro (Stock)"
    thresholds:
      hashrate:
        expected: 105.8  # Measured
      # No power - API doesn't provide it
```

**Backend loads this and uses:**
- Hashrate expected: **105.8 TH/s** (from YAML)
- Power expected: **0** (not set, backend won't alert on power)
- All other thresholds: **Global defaults**

---

## 🔄 Update Flow

### **When You Edit a Miner:**

```
1. User clicks "Edit" in UI
   ↓
2. Form shows current thresholds (merged with globals)
   ↓
3. User changes "Temperature Critical" to 90°C
   ↓
4. User clicks "Update"
   ↓
5. Frontend sends to backend API
   ↓
6. Backend calls saveMinersConfig()
   ↓
7. miners.yaml updated with new threshold
   ↓
8. Backend reloads config automatically
   ↓
9. Dashboard shows new threshold
```

### **No Restart Needed!**
- Backend watches `miners.yaml` for changes
- Automatically reloads on file change
- New thresholds active immediately

---

## 📊 YAML Structure

### **Complete Example:**

```yaml
miners:
  # Miner with auto-discovered values only
  - ip: "192.168.1.40"
    model: "M30S++ VH90 (Stock)"
    alias: "EN-M30SppVH90-040"
    owner: "EN"
    status: "active"
    thresholds:
      hashrate:
        expected: 106.2
      power:
        expected: 3413

  # Miner with custom overrides
  - ip: "192.168.1.74"
    model: "M30S++ VH90 (Stock)"
    alias: "EN-M30SppVH90-074"
    owner: "EN"
    status: "active"
    thresholds:
      temperature:
        warning: 80      # Custom
        critical: 90     # Custom
      hashrate:
        expected: 105.4
        warningPercent: 15  # Custom
      power:
        expected: 3386

  # Antminer without power
  - ip: "192.168.1.64"
    model: "S19 Pro (Stock)"
    alias: "EN-S19Pro-064"
    owner: "EN"
    status: "active"
    thresholds:
      hashrate:
        expected: 105.8

  # Miner using all global defaults
  - ip: "192.168.1.114"
    model: "S19 (Stock)"
    alias: "EN-S19-114"
    owner: "EN"
    status: "active"
    # No thresholds - uses all global defaults
```

---

## 🚀 Deployment

### **1. Commit Changes:**

```bash
cd /Users/dmitrykor82/CascadeProjects/windsurf-project/mining-stack

git add bin/farm_init.py backend/src/config/miners.config.ts
git commit -m "Add threshold auto-discovery to farm_init.py"
git push origin main
```

### **2. Deploy to Raspberry Pi:**

```bash
ssh admin@raspberrypi
cd /opt/mining-stack
git pull origin main

# Rebuild backend (includes new threshold handling)
docker compose -f docker-compose.prod.yml build backend
docker compose -f docker-compose.prod.yml up -d
```

### **3. Re-run Discovery (Optional):**

```bash
# This will update miners.yaml with expected values
python3 bin/farm_init.py

# Backend will automatically reload the new config
```

---

## ❓ FAQ

### **Q: Will farm_init.py overwrite my custom thresholds?**
**A:** No! `farm_init.py` only sets `expected` values for hashrate and power. Your custom temperature, warning %, etc. are preserved.

### **Q: What if I don't run farm_init.py?**
**A:** Miners will use **all global defaults**. You can manually set expected values in the UI.

### **Q: Can I edit miners.yaml directly?**
**A:** Yes! Backend reloads automatically. Just follow the YAML structure above.

### **Q: What happens if I delete thresholds from YAML?**
**A:** Miner will use **global defaults** for everything. No problem!

### **Q: Do I need to restart the backend?**
**A:** No! Backend automatically reloads `miners.yaml` when it changes.

### **Q: What if a miner's performance changes?**
**A:** Re-run `farm_init.py` to update expected values, or edit manually in UI.

---

## 🎯 Summary

✅ **`farm_init.py`** adds expected hashrate & power (measured data)  
✅ **Backend** merges with global defaults automatically  
✅ **UI** allows easy customization  
✅ **YAML** is the single source of truth  
✅ **No restart** needed for changes  
✅ **Backward compatible** - old configs still work  

**Your threshold system is fully integrated and production-ready!** 🚀
