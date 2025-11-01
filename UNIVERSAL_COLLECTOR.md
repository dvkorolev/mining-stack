# 🔧 Universal Miner Stats Collector

## 🎯 Overview

The **Universal Miner Collector** is a Python script that collects real-time metrics from **all types of mining hardware** without hardcoded values or dependencies on pyasic.

### **Supported Miners:**
- ✅ **Antminer** (Bitmain): S19, S19 Pro, S19K Pro, S17, etc.
- ✅ **Whatsminer** (MicroBT): M30S++, M50, M50S++, M20S, etc.
- ✅ **DG1+** (Scrypt miners for Litecoin/Dogecoin)
- ✅ **Any cgminer-compatible miner**

### **Key Features:**
- 🚀 **No hardcoded data** - All metrics from actual miner APIs
- 🔌 **Universal API support** - cgminer API + HTTP APIs
- 📊 **Complete metrics** - Hashrate, temperature, power, fans, shares
- ⚡ **Fast & concurrent** - Queries all miners in parallel
- 🎯 **Prometheus export** - Standard textfile format
- 🛡️ **Error handling** - Graceful failures, detailed logging

---

## 🚀 Quick Start

### **1. Install:**

```bash
cd /opt/mining-stack

# Run setup script
./bin/setup-universal-collector.sh
```

### **2. Test:**

```bash
cd /opt/mining-stack

# Run collector manually
./venv/bin/python3 bin/universal_miner_collector.py

# Check output
cat textfile/pyasic_metrics.prom
```

### **3. Set up Cron:**

```bash
# Edit crontab
crontab -e

# Add this line (runs every 2 minutes):
*/2 * * * * cd /opt/mining-stack && ./venv/bin/python3 bin/universal_miner_collector.py >> logs/collector.log 2>&1
```

---

## 📊 How It Works

### **Architecture:**

```
┌─────────────────────────────────────────┐
│  miners.yaml                            │
│  - List of all miners (IP, model)      │
└──────────────┬──────────────────────────┘
               │
               ▼
┌─────────────────────────────────────────┐
│  universal_miner_collector.py           │
│  - Detects miner type from model        │
│  - Queries appropriate API              │
│  - Parses response                      │
└──────────────┬──────────────────────────┘
               │
               ├─► cgminer API (port 4028)
               │   └─► Antminer, Whatsminer
               │
               └─► HTTP API
                   └─► DG1+, some Whatsminers
               │
               ▼
┌─────────────────────────────────────────┐
│  textfile/pyasic_metrics.prom           │
│  - Prometheus metrics format            │
└──────────────┬──────────────────────────┘
               │
               ▼
┌─────────────────────────────────────────┐
│  Prometheus → Grafana → Dashboard       │
└─────────────────────────────────────────┘
```

### **API Detection:**

The collector automatically detects the miner type from the model string:

```python
if 's19' in model or 'antminer' in model:
    → Use cgminer API (port 4028)
    → Parse Antminer-specific fields
    
elif 'm30' in model or 'm50' in model or 'whatsminer' in model:
    → Use cgminer API (port 4028)
    → Parse Whatsminer-specific fields (includes power!)
    
elif 'dg1' in model:
    → Use HTTP API (/cgi-bin/stats.cgi)
    → Parse Scrypt miner fields (MH/s → TH/s conversion)
    
else:
    → Try cgminer API (generic)
```

---

## 📈 Metrics Collected

### **All Miners:**
- `miner_scrape_success` - Whether scrape succeeded (1/0)
- `miner_hashrate_ths` - Hashrate in TH/s
- `miner_temp_max_c` - Maximum temperature in °C
- `miner_uptime_seconds` - Uptime in seconds
- `miner_fan_speed_rpm` - Fan speeds in RPM (per fan)

### **Whatsminer Only:**
- `miner_power_watts` - Power consumption in watts

### **DG1+ (Scrypt):**
- `miner_hashrate_ths` - Converted from MH/s to TH/s equivalent
- All standard metrics

---

## 🔍 Example Output

### **Antminer S19 Pro:**

```prometheus
miner_scrape_success{ip="192.168.1.64",name="EN-S19Pro-064",model="S19_Pro_Stock"} 1
miner_hashrate_ths{ip="192.168.1.64",name="EN-S19Pro-064",model="S19_Pro_Stock"} 105.24
miner_temp_max_c{ip="192.168.1.64",name="EN-S19Pro-064",model="S19_Pro_Stock"} 78.0
miner_power_watts{ip="192.168.1.64",name="EN-S19Pro-064",model="S19_Pro_Stock"} 0
miner_uptime_seconds{ip="192.168.1.64",name="EN-S19Pro-064",model="S19_Pro_Stock"} 368443
miner_fan_speed_rpm{ip="192.168.1.64",name="EN-S19Pro-064",model="S19_Pro_Stock",fan="1"} 5910
miner_fan_speed_rpm{ip="192.168.1.64",name="EN-S19Pro-064",model="S19_Pro_Stock",fan="2"} 5760
```

**Note:** Antminers don't report power via API (hardware limitation), so power shows as 0.

### **Whatsminer M30S++:**

```prometheus
miner_scrape_success{ip="192.168.1.74",name="EN-M30SppVH90-074",model="M30S++_VH90_Stock"} 1
miner_hashrate_ths{ip="192.168.1.74",name="EN-M30SppVH90-074",model="M30S++_VH90_Stock"} 105.43
miner_temp_max_c{ip="192.168.1.74",name="EN-M30SppVH90-074",model="M30S++_VH90_Stock"} 94.21
miner_power_watts{ip="192.168.1.74",name="EN-M30SppVH90-074",model="M30S++_VH90_Stock"} 3386
miner_uptime_seconds{ip="192.168.1.74",name="EN-M30SppVH90-074",model="M30S++_VH90_Stock"} 380779
miner_fan_speed_rpm{ip="192.168.1.74",name="EN-M30SppVH90-074",model="M30S++_VH90_Stock",fan="1"} 5010
```

**Note:** Whatsminers report power consumption!

### **DG1+ (Scrypt):**

```prometheus
miner_scrape_success{ip="192.168.1.78",name="EN-DG1p-078",model="DG1+_Stock"} 1
miner_hashrate_ths{ip="192.168.1.78",name="EN-DG1p-078",model="DG1+_Stock"} 0.38
miner_temp_max_c{ip="192.168.1.78",name="EN-DG1p-078",model="DG1+_Stock"} 69.8
miner_power_watts{ip="192.168.1.78",name="EN-DG1p-078",model="DG1+_Stock"} 0
miner_uptime_seconds{ip="192.168.1.78",name="EN-DG1p-078",model="DG1+_Stock"} 75740
```

**Note:** DG1+ hashrate is ~380 GH/s for Scrypt (shown as 0.38 TH/s for consistency).

---

## 🆚 Comparison: Universal Collector vs Pyasic

| Feature | Universal Collector | Pyasic |
|---------|-------------------|--------|
| **Antminer support** | ✅ Full | ✅ Full |
| **Whatsminer support** | ✅ Full | ✅ Full |
| **DG1+ support** | ✅ Full | ❌ Limited |
| **Power from Antminer** | ❌ Not available* | ❌ Not available* |
| **Power from Whatsminer** | ✅ Yes | ✅ Yes |
| **Dependencies** | Minimal (aiohttp, PyYAML) | Many (pyasic + deps) |
| **Installation size** | ~5 MB | ~50 MB |
| **Customizable** | ✅ Easy to modify | ❌ Complex |
| **Error handling** | ✅ Detailed logs | ⚠️ Generic |

*Antminers don't expose power via API - hardware limitation, not software.

---

## 🐛 Troubleshooting

### **No metrics for a miner:**

```bash
# Check if miner API is accessible
echo '{"command":"summary"}' | nc 192.168.1.XX 4028

# Check collector logs
tail -50 /opt/mining-stack/logs/collector.log

# Run collector with debug output
cd /opt/mining-stack
./venv/bin/python3 bin/universal_miner_collector.py
```

### **DG1+ showing 0 hashrate:**

DG1+ uses HTTP API, not cgminer API. Check:

```bash
# Test HTTP API
curl http://192.168.1.78/cgi-bin/stats.cgi

# Should return JSON with stats
```

### **Antminer showing 0W power:**

This is **normal** - Antminers don't report power consumption via API. This is a hardware limitation.

**Solutions:**
1. Use external power monitoring (smart PDU)
2. Calculate from known specs (not recommended - varies by load)
3. Accept 0W for Antminers (efficiency calc will be wrong)

---

## 🔧 Advanced Configuration

### **Add Custom Miner Type:**

Edit `universal_miner_collector.py`:

```python
def _detect_miner_type(self) -> str:
    model_lower = self.model.lower()
    
    # Add your custom miner
    if 'your_miner' in model_lower:
        return 'custom_type'
    
    # ... existing code
```

Then add parsing logic:

```python
async def _get_custom_stats(self) -> Optional[Dict[str, Any]]:
    # Your custom API logic
    pass
```

### **Change Collection Interval:**

```bash
# Edit crontab
crontab -e

# Every 1 minute:
*/1 * * * * cd /opt/mining-stack && ./venv/bin/python3 bin/universal_miner_collector.py >> logs/collector.log 2>&1

# Every 5 minutes:
*/5 * * * * cd /opt/mining-stack && ./venv/bin/python3 bin/universal_miner_collector.py >> logs/collector.log 2>&1
```

---

## 📊 Integration with Dashboard

The collector exports to the same format as pyasic, so **no backend changes needed**!

The dashboard will automatically show:
- ✅ Real hashrate from all miners
- ✅ Real temperatures
- ✅ Real power (Whatsminers only)
- ✅ Fan speeds
- ✅ Uptime
- ✅ Online/offline status

---

## 🎉 Benefits

### **vs Pyasic:**
- ✅ **Supports DG1+** and other exotic miners
- ✅ **Smaller footprint** - minimal dependencies
- ✅ **Easier to debug** - simple Python code
- ✅ **Faster** - direct API access
- ✅ **Customizable** - add your own miner types

### **vs Hardcoded Values:**
- ✅ **Real data** - no estimates or assumptions
- ✅ **Accurate** - reflects actual miner state
- ✅ **Dynamic** - adapts to miner changes
- ✅ **Trustworthy** - verifiable metrics

---

## 🚀 Next Steps

1. **Deploy the collector** on Raspberry Pi
2. **Set up cron job** for automatic collection
3. **Verify metrics** in Prometheus
4. **Check dashboard** shows real data
5. **Monitor all miner types** including DG1+

---

**Your mining farm now has universal, real-time monitoring for ALL miner types!** 🎉
