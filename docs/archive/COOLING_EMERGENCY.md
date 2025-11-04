# 🔥 COOLING EMERGENCY GUIDE

## ⚠️ CRITICAL: Your Miners Are Overheating!

Based on current temperatures:
- **M30S++ miners**: 90-105°C ❌ **DANGEROUS**
- **M50 miners**: 88-103°C ❌ **DANGEROUS**
- **S19 miners**: 63-76°C ✅ Good
- **DG1+**: 68°C ✅ Good

## Temperature Danger Zones

| Range | Status | Risk | Action |
|-------|--------|------|--------|
| < 75°C | ✅ **Good** | None | Normal operation |
| 75-85°C | ⚠️ **Warning** | Reduced lifespan | Improve cooling |
| 85-95°C | 🔶 **High** | Hardware stress | **Immediate action needed** |
| 95-105°C | 🔴 **Critical** | Damage risk | **Reduce power NOW** |
| > 105°C | 💀 **Emergency** | Imminent failure | **SHUTDOWN IMMEDIATELY** |

## Immediate Actions (Next 24 Hours)

### 1. **Identify Critical Miners**

Current critical miners (>95°C):
```
EN-M30SppVH40-089: 101.9°C  ❌ SHUTDOWN NOW
EN-M30SppVH90-063: 105.1°C  ❌ SHUTDOWN NOW  
EN-M50VH50-130: 103.1°C     ❌ SHUTDOWN NOW
EN-M50VH70-053: 99.7°C      🔴 CRITICAL
```

### 2. **Emergency Shutdown**

**Option A: Via Dashboard**
1. Go to http://raspberrypi:3000/miners
2. Click on critical miner
3. Click "Reboot" or "Stop"

**Option B: Direct SSH**
```bash
# Shutdown specific miner
ssh root@192.168.1.89  # Replace with miner IP
reboot
```

**Option C: Power off at switch**
- Physically turn off miners above 100°C
- Let them cool for 30 minutes
- Check cooling before restarting

### 3. **Reduce Power Immediately**

For miners 95-100°C, reduce power consumption:

**Whatsminer (M30S++, M50):**
```bash
# SSH to miner
ssh admin@192.168.1.40

# Reduce power mode
# Check current mode
cat /config/cgminer.conf | grep power

# Options: High Performance, Balanced, Low Power
# Edit and restart
```

**Antminer (S19):**
```bash
# SSH to miner
ssh root@192.168.1.64

# Web interface: http://192.168.1.64
# Miner Configuration > Frequency
# Reduce from 100% to 80%
```

## Short-Term Solutions (This Week)

### 1. **Improve Airflow**

**Check:**
- [ ] Miners have 6+ inches clearance on intake/exhaust
- [ ] No obstructions blocking fans
- [ ] Miners not facing each other (hot exhaust into intake)
- [ ] Room has adequate ventilation

**Quick Fixes:**
- Remove any cardboard, plastic, or debris near miners
- Space miners further apart
- Add box fans to move air
- Open windows/doors for fresh air

### 2. **Clean Fans and Heatsinks**

**Every miner needs:**
1. Power off and unplug
2. Remove side panels
3. Blow out dust with compressed air
4. Check fan blades spin freely
5. Clean heatsink fins
6. Reassemble and test

**Frequency:**
- Dusty environment: Monthly
- Clean environment: Quarterly

### 3. **Check Fan Operation**

```bash
# Check fan speeds via dashboard
# Or query Prometheus:
curl 'http://localhost:9090/api/v1/query?query=miner_fan_speed_rpm'
```

**Expected fan speeds:**
- M30S++/M50: 5000-6000 RPM
- S19: 4000-5000 RPM

**If fans are slow:**
- Replace failed fans immediately
- Check fan power connectors
- Update miner firmware

### 4. **Ambient Temperature**

**Measure room temperature:**
```bash
# If you have a thermometer
# Ideal: 15-25°C (59-77°F)
# Maximum: 30°C (86°F)
```

**If room is hot:**
- Add air conditioning
- Add exhaust fans to remove hot air
- Seal room and use portable AC
- Move miners to cooler location

## Medium-Term Solutions (This Month)

### 1. **Dedicated Cooling System**

**Options:**
- **Exhaust fans**: Remove hot air from room
- **Intake fans**: Bring cool air in
- **Air conditioning**: Cool the entire room
- **Evaporative cooling**: For dry climates
- **Immersion cooling**: Advanced solution

**Budget options:**
- Box fans: $20-50 each
- Window exhaust fan: $100-200
- Portable AC: $300-500

### 2. **Optimize Miner Layout**

**Best practices:**
```
[Cool Air] → [Miner] → [Hot Air] → [Exhaust]
              ↓
           [Space]
              ↓
[Cool Air] → [Miner] → [Hot Air] → [Exhaust]
```

**Avoid:**
```
[Miner] → [Hot Air] → [Miner]  ❌ Hot air recycling
[Miner][Miner][Miner]          ❌ Too close together
```

### 3. **Firmware Updates**

Check for firmware updates that improve:
- Fan control algorithms
- Temperature monitoring
- Power management

**Whatsminer:**
- https://www.whatsminer.com/firmware

**Antminer:**
- https://www.bitmain.com/support/download

### 4. **Underclocking**

Reduce hashrate to lower temperature:

**Trade-off:**
- -10% hashrate = -15% temperature
- -20% hashrate = -25% temperature

**Still profitable if:**
- Prevents hardware damage
- Extends miner lifespan
- Reduces electricity costs

## Long-Term Solutions

### 1. **Professional Cooling Setup**

**Industrial solutions:**
- HVAC system for mining room
- Hot aisle / cold aisle design
- Negative pressure exhaust
- Filtered intake air

**Cost:** $2,000-10,000 depending on scale

### 2. **Immersion Cooling**

**Benefits:**
- 50-60°C operating temperature
- Silent operation
- Increased hashrate potential
- Extended hardware life

**Cost:** $500-1000 per miner for conversion

### 3. **Relocate Mining Operation**

**Consider:**
- Basement (naturally cooler)
- Garage with ventilation
- Dedicated mining facility
- Colocation data center

## Monitoring & Alerts

### 1. **Set Up Telegram Alerts**

Get notified when temperatures spike:

1. Go to http://raspberrypi:3000/settings
2. Configure Telegram bot
3. Set alert thresholds:
   - Warning: 85°C
   - Critical: 95°C
   - Emergency: 100°C

### 2. **Check Dashboard Daily**

http://raspberrypi:3000

Monitor:
- Temperature trends
- Fan speeds
- Hashrate drops (indicates thermal throttling)

### 3. **Temperature Logs**

```bash
# View temperature history in Grafana
http://raspberrypi:3001

# Or query Prometheus
curl 'http://localhost:9090/api/v1/query?query=miner_temp_max_c'
```

## Updated Thresholds

After fixing cooling, adjust thresholds in `.env`:

```bash
# Current (emergency thresholds)
THRESHOLD_TEMP_WARNING=85
THRESHOLD_TEMP_CRITICAL=95
THRESHOLD_TEMP_SHUTDOWN=105

# Target (after cooling improvements)
THRESHOLD_TEMP_WARNING=75
THRESHOLD_TEMP_CRITICAL=85
THRESHOLD_TEMP_SHUTDOWN=90
```

## Cost-Benefit Analysis

### Do Nothing
- **Cost**: $0
- **Risk**: Hardware failure ($500-2000 per miner)
- **Lifespan**: 6-12 months instead of 3-5 years

### Basic Cooling ($200-500)
- Box fans + room ventilation
- **Benefit**: 10-15°C temperature drop
- **ROI**: Immediate (prevents hardware damage)

### Professional Cooling ($2000-5000)
- HVAC + exhaust system
- **Benefit**: 20-30°C temperature drop
- **ROI**: 6-12 months (extended hardware life + efficiency)

## Emergency Contacts

**If miners catch fire:**
1. Cut power at breaker
2. Use CO2 fire extinguisher (NOT water!)
3. Call fire department

**If you smell burning:**
1. Shutdown affected miner immediately
2. Inspect for damage
3. Do not restart until inspected

## Summary

**RIGHT NOW:**
1. ✅ Shutdown miners above 100°C
2. ✅ Reduce power on miners 95-100°C
3. ✅ Check for obstructions

**THIS WEEK:**
1. ✅ Clean all miners
2. ✅ Improve room airflow
3. ✅ Check fan operation

**THIS MONTH:**
1. ✅ Install exhaust fans
2. ✅ Add air conditioning
3. ✅ Optimize miner layout

**Your miners will thank you!** 🌡️➡️❄️
