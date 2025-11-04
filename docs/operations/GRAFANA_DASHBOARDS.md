# Grafana Dashboards - Analysis & Compatibility

## 📊 Dashboard Inventory

| Dashboard | File | Status | Notes |
|-----------|------|--------|-------|
| **Mining Farm Overview** | `mining-overview.json` | ✅ Fixed | Updated to use `miner_scrape_status` |
| **Per-Miner Details** | `per-miner-details.json` | ✅ Compatible | No changes needed |
| **Pool Network Quality** | `pool-network-quality.json` | ✅ Compatible | No changes needed |

---

## 🔧 Recent Fix: Metric Name Change

### **Problem**
Dashboard used old metric name that no longer exists:
```promql
# OLD (broken)
count(max by (ip) (miner_scrape_success) == 1)
```

### **Solution**
Updated to use new detailed status metric:
```promql
# NEW (fixed)
count(max by (ip) (miner_scrape_status) >= 1)
```

### **Why `>= 1`?**

The new `miner_scrape_status` uses detailed status codes:

| Status | Meaning | Include in "Active"? |
|--------|---------|---------------------|
| **`2`** | Full success (PyASIC + gap-filling) | ✅ Yes |
| **`1`** | Partial success (gaps not filled) | ✅ Yes |
| **`0`** | Timeout | ❌ No |
| **`-1`** | Connection refused | ❌ No |
| **`-2`** | API error | ❌ No |

**Query Logic**: `status >= 1` counts miners that are collecting data (even if partial).

---

## 📈 Dashboard #1: Mining Farm Overview

### **Panels**

#### **1. Total Hashrate**
```promql
sum(max by (ip) (miner_hashrate_ths))
```
- ✅ **Status**: Working
- **Unit**: TH/s
- **Thresholds**: 
  - Red: < 1000 TH/s
  - Yellow: 1000-1500 TH/s
  - Green: > 1500 TH/s

#### **2. Active Miners** ⚠️ **FIXED**
```promql
count(max by (ip) (miner_scrape_status) >= 1)
```
- ✅ **Status**: Fixed (was using old metric)
- **Unit**: Count
- **Thresholds**:
  - Red: < 15 miners
  - Yellow: 15-20 miners
  - Green: > 20 miners

#### **3. Total Power**
```promql
sum(max by (ip) (miner_power_watts)) / 1000
```
- ⚠️ **Status**: Partially working
- **Unit**: kW
- **Issue**: Antminers don't report power (will show lower than actual)
- **Workaround**: Add estimated power for Antminers (optional)

#### **4. Avg Efficiency**
```promql
avg(max by (ip) (miner_efficiency_j_th))
```
- ✅ **Status**: Working
- **Unit**: J/TH
- **Thresholds**:
  - Green: < 30 J/TH
  - Yellow: 30-35 J/TH
  - Red: > 35 J/TH

#### **5. Farm Hashrate Over Time**
```promql
sum(max by (ip) (miner_hashrate_ths))
```
- ✅ **Status**: Working
- **Type**: Time series graph
- **Refresh**: 30s

#### **6. Power Consumption Over Time**
```promql
sum(max by (ip) (miner_power_watts)) / 1000
```
- ⚠️ **Status**: Partially working
- **Issue**: Missing Antminer power data

#### **7. Farm Rejection Rate - Lifetime**
```promql
100 * (sum(max by (ip) (miner_pool_rejected_total)) / 
       (sum(max by (ip) (miner_pool_accepted_total)) + 
        sum(max by (ip) (miner_pool_rejected_total))))
```
- ✅ **Status**: Working
- **Unit**: Percent
- **Thresholds**:
  - Green: < 2%
  - Yellow: 2-5%
  - Red: > 5%

#### **8. Miner Status Table**
Queries:
- **A**: `max by (ip, name, model) (miner_hashrate_ths)`
- **B**: `max by (ip) (miner_power_watts)`
- **C**: `max by (ip) (miner_temp_max_c)`
- **D**: `100 * (miner_pool_rejected_total / (miner_pool_accepted_total + miner_pool_rejected_total))`

- ✅ **Status**: Working
- **Columns**: Miner, IP, Model, Hashrate, Power, Temp, Rejection%
- **Features**:
  - Color-coded temperature (green < 75°C, yellow 75-85°C, orange 85-95°C, red > 95°C)
  - Color-coded rejection rate (green < 2%, yellow 2-5%, red > 5%)

---

## 📈 Dashboard #2: Per-Miner Details

### **Panels**

#### **1. Hashrate by Miner**
```promql
max by (ip, name) (miner_hashrate_ths)
```
- ✅ **Status**: Working
- **Type**: Time series (one line per miner)
- **Legend**: `{{name}} ({{ip}})`

#### **2. Temperature by Miner**
```promql
max by (ip, name) (miner_temp_max_c)
```
- ✅ **Status**: Working (after temperature fix)
- **Note**: Whatsminer 192.168.1.117 will now show correct temp

#### **3. Power by Miner**
```promql
max by (ip, name) (miner_power_watts)
```
- ⚠️ **Status**: Partially working
- **Issue**: Antminers show 0W

#### **4. Board Temperatures**
```promql
max by (ip, name, slot) (miner_board_temp_c)
```
- ✅ **Status**: Working
- **Type**: Heatmap or time series

#### **5. Fan Speeds**
```promql
max by (ip, name, fan_id) (miner_fan_speed_rpm)
```
- ✅ **Status**: Working

---

## 📈 Dashboard #3: Pool Network Quality

### **Panels**

#### **1. Pool Reachability**
```promql
pool_network_reachable
```
- ✅ **Status**: Working
- **Values**: 1 = reachable, 0 = unreachable

#### **2. DNS Resolution**
```promql
pool_network_dns_resolved
```
- ✅ **Status**: Working

#### **3. Connection Time**
```promql
pool_network_connect_time_ms
```
- ✅ **Status**: Working
- **Unit**: milliseconds

#### **4. Ping Statistics**
```promql
pool_network_ping_avg_ms
pool_network_ping_min_ms
pool_network_ping_max_ms
```
- ✅ **Status**: Working

#### **5. Packet Loss**
```promql
pool_network_packet_loss_percent
```
- ✅ **Status**: Working
- **Unit**: percent

---

## ⚠️ Known Dashboard Limitations

### **1. Antminer Power = 0**

**Affected Panels**:
- Total Power
- Power Consumption Over Time
- Per-Miner Power

**Cause**: Antminer cgminer API doesn't expose power consumption.

**Workarounds**:

#### **Option A: Add Note to Dashboard**
Add annotation explaining that Antminer power is not available.

#### **Option B: Estimate Power (Recommended)**
Add estimated power based on model specs:

```promql
# Total Power with Antminer estimates
sum(
  max by (ip) (miner_power_watts) 
  or 
  (max by (ip, model) (miner_hashrate_ths) * 
   on(model) group_left() 
   label_replace(
     vector(3250), "model", "S19 Pro (Stock)", "", ""
   ))
)
```

**Model Power Specs**:
- S19 Pro: ~3250W at 110 TH/s
- S19: ~3250W at 95 TH/s
- S19K Pro: ~3010W at 120 TH/s

#### **Option C: Filter Antminers**
Show only Whatsminers in power panels:

```promql
sum(max by (ip) (miner_power_watts{model=~"M.*"})) / 1000
```

---

### **2. Temperature = 0 for Some Miners**

**Status**: ✅ **FIXED** (commit `aa97fd5`)

**Previously Affected**: Whatsminer 192.168.1.117

**Fix**: Enhanced cgminer parser to use `DEVS[*].Temperature` instead of chip temps.

**Verification**:
```bash
curl -s localhost:8000/metrics | grep 'name="EN-M30SppVH90-117"'
# Should show: miner_temp_max_c{...} 77.06 (not 0.0)
```

---

### **3. Zero-Value Guards**

Some panels may show misleading data when metrics are 0. Consider adding guards:

#### **Temperature Panel**
```promql
# Filter out zero temps
max by (ip, name) (miner_temp_max_c > 0)
```

#### **Power Panel**
```promql
# Filter out zero power (Antminers)
max by (ip, name) (miner_power_watts > 0)
```

#### **Efficiency Panel**
```promql
# Only show miners with valid efficiency
avg(max by (ip) (miner_efficiency_j_th > 0))
```

---

## 🎨 Dashboard Enhancements (Optional)

### **1. Add Miner State Panel**

Show miner states with color coding:

```promql
max by (ip, name) (miner_state)
```

**Legend**:
- `0` = Faulty (red)
- `1` = Idle (yellow)
- `2` = Mining (green)

### **2. Add Scrape Status Panel**

Show detailed scrape status:

```promql
max by (ip, name) (miner_scrape_status)
```

**Legend**:
- `2` = Full success (green)
- `1` = Partial success (yellow)
- `0` = Timeout (orange)
- `-1` = Connection refused (red)
- `-2` = API error (red)

### **3. Add Gap-Filling Indicator**

Show which miners needed gap-filling:

```promql
count(miner_scrape_status == 1)
```

### **4. Add Collection Duration**

Monitor scheduler performance:

```promql
mining_collection_duration_seconds{collector="hybrid"}
```

---

## 🚀 Deployment

### **After Pulling Latest Code**

Grafana will automatically reload dashboards from:
```
/opt/mining-stack/docker/grafana/dashboards/
```

**No manual import needed** - dashboards are provisioned automatically.

### **Verify Dashboard Update**

1. Open Grafana: `http://192.168.1.66:3000`
2. Navigate to "Mining Farm Overview"
3. Check "Active Miners" panel
4. Should show 21 miners (not 0 or error)

---

## 📚 Prometheus Query Tips

### **Best Practices**

1. **Use `max by (ip)`** to deduplicate metrics:
   ```promql
   sum(max by (ip) (miner_hashrate_ths))
   ```

2. **Filter by model** for specific miner types:
   ```promql
   sum(miner_hashrate_ths{model=~"M.*"})  # Whatsminers only
   sum(miner_hashrate_ths{model=~"S19.*"})  # Antminers only
   ```

3. **Use `> 0`** to filter invalid data:
   ```promql
   avg(miner_temp_max_c > 0)
   ```

4. **Calculate rates** for share metrics:
   ```promql
   rate(miner_pool_accepted_total[5m])
   ```

---

## ✅ Verification Checklist

After deployment, verify:

- [ ] "Active Miners" panel shows correct count (21)
- [ ] "Total Hashrate" shows ~2471 TH/s
- [ ] "Miner Status" table shows all miners
- [ ] Temperature panel shows valid temps (not all 0)
- [ ] Whatsminer 192.168.1.117 shows temp ~77°C
- [ ] No "No data" errors in panels
- [ ] Graphs updating every 30 seconds

---

**Status**: ✅ **All Dashboards Compatible** (2025-11-03)

**Last Updated**: Commit `111626b` - Fixed `miner_scrape_success` → `miner_scrape_status`
