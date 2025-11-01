# 🔍 Debug Pyasic Exceptions

## 🎯 Problem

Two miners are showing exceptions in pyasic:
- **192.168.1.74** (M30S++ VH90) - Has web UI but pyasic fails
- **192.168.1.78** (DG1+) - Scrypt miner, different API

---

## 🔧 Miner 192.168.1.74 (M30S++ VH90)

### **Web Interface Found:**
```
https://192.168.1.74/cgi-bin/luci/admin/status/overview
```

This is a **LuCI web interface** (OpenWrt-based), which is common on Whatsminer models.

### **Possible Issues:**

1. **Authentication Required**
   - Pyasic might not have credentials
   - Web UI requires login

2. **HTTPS vs HTTP**
   - Web UI uses HTTPS
   - Pyasic might be trying HTTP

3. **API Endpoint Different**
   - LuCI interface uses different API paths
   - Standard cgminer API might be on different port

---

## 🧪 Diagnostic Steps

### **1. Check Standard API Ports:**

```bash
# On Raspberry Pi
cd /opt/mining-stack

# Try standard cgminer API (port 4028)
echo '{"command":"summary"}' | nc 192.168.1.74 4028

# Try HTTP API
curl -m 5 http://192.168.1.74/cgi-bin/summary.cgi

# Try with authentication
curl -m 5 -u admin:admin http://192.168.1.74/cgi-bin/summary.cgi
```

### **2. Check What Pyasic is Trying:**

```bash
# Run pyasic with debug logging
cd /opt/mining-stack
source venv/bin/activate

# Test single miner with verbose output
python3 << 'EOF'
import asyncio
import logging
from pyasic import get_miner

# Enable debug logging
logging.basicConfig(level=logging.DEBUG)

async def test():
    try:
        print("Attempting to connect to 192.168.1.74...")
        miner = await asyncio.wait_for(get_miner('192.168.1.74'), timeout=15)
        print(f"Miner type: {type(miner)}")
        
        if miner:
            print("Getting data...")
            data = await asyncio.wait_for(miner.get_data(), timeout=15)
            print(f"Success! Data: {data}")
        else:
            print("Failed to initialize miner")
    except Exception as e:
        print(f"Error: {type(e).__name__}: {e}")
        import traceback
        traceback.print_exc()

asyncio.run(test())
EOF
```

### **3. Check Pyasic Logs:**

```bash
# View detailed pyasic logs
tail -100 /opt/mining-stack/logs/pyasic_metrics.log

# Look for error messages related to .74
grep "192.168.1.74" /opt/mining-stack/logs/pyasic_metrics.log
```

---

## 🔑 Common Solutions

### **Solution 1: Add Authentication to Pyasic**

If the miner requires authentication, you may need to configure credentials.

**Check if pyasic supports auth:**
```python
# In bin/pyasic_textfile.py, you might need to add:
# miner = await get_miner(ip, username='admin', password='admin')
```

### **Solution 2: Use Different API Port**

Whatsminer might use a different port:

```bash
# Test different ports
nc -zv 192.168.1.74 4028  # cgminer API
nc -zv 192.168.1.74 4029  # Alternative
nc -zv 192.168.1.74 8080  # HTTP API
nc -zv 192.168.1.74 443   # HTTPS
```

### **Solution 3: Update Pyasic**

Ensure you have the latest pyasic version:

```bash
cd /opt/mining-stack
source venv/bin/activate
pip install --upgrade pyasic
```

### **Solution 4: Manual API Call**

If pyasic can't auto-detect, try manual API:

```bash
# Whatsminer API endpoint
curl -X POST http://192.168.1.74/cgi-bin/luci/admin/network/cgminer/api \
  -d '{"command":"summary"}' \
  -H "Content-Type: application/json"
```

---

## 🐛 Miner 192.168.1.78 (DG1+)

### **Known Issue:**
DG1+ is a **Scrypt miner** (Litecoin/Dogecoin), not SHA-256 (Bitcoin).

### **API Works:**
```bash
curl http://192.168.1.78/cgi-bin/stats.cgi
# Returns JSON with hashrate in MH/s (not TH/s)
```

### **Solution:**

**Option 1: Remove from Bitcoin monitoring**
```bash
# Edit miners.yaml, remove or comment out:
# - ip: 192.168.1.78
#   model: DG1+ (Stock)
#   alias: EN-DG1p-078
```

**Option 2: Create separate Scrypt monitoring**
- DG1+ mines different coins (LTC/DOGE)
- Needs separate dashboard
- Different metrics (MH/s vs TH/s)

**Option 3: Add custom handler**
Create a custom script for DG1+ that converts its metrics to Prometheus format.

---

## 📝 Recommended Actions

### **For 192.168.1.74 (M30S++ VH90):**

1. **Test API access:**
   ```bash
   echo '{"command":"summary"}' | nc 192.168.1.74 4028
   ```

2. **If that works**, pyasic should work too. Check logs for exact error.

3. **If authentication needed**, you may need to:
   - Disable authentication on miner
   - OR add credentials to pyasic script
   - OR use API token

4. **Check miner firmware version** - older firmware might have API issues

### **For 192.168.1.78 (DG1+):**

**Recommended:** Remove from Bitcoin miners list since it mines different coins.

```bash
cd /opt/mining-stack
nano etc/miners.yaml

# Comment out or remove:
# - ip: 192.168.1.78
#   model: DG1+ (Stock)
#   alias: EN-DG1p-078
#   owner: EN
#   status: active
```

Then restart metrics collection:
```bash
pkill -f pyasic_textfile.py
./venv/bin/python3 bin/pyasic_textfile.py
```

---

## 🎯 Quick Fix

To get 21/22 miners working (excluding DG1+):

```bash
cd /opt/mining-stack

# 1. Remove DG1+ from config
sed -i '/192.168.1.78/,+4d' etc/miners.yaml

# 2. Test .74 API directly
echo '{"command":"summary"}' | nc 192.168.1.74 4028

# 3. If .74 API works, check pyasic logs
tail -50 logs/pyasic_metrics.log | grep "192.168.1.74"

# 4. Restart metrics collection
pkill -f pyasic_textfile.py
./venv/bin/python3 bin/pyasic_textfile.py

# 5. Check results
cat textfile/pyasic_metrics.prom | grep "miner_scrape_success.*} 1$" | wc -l
```

---

## 📊 Expected Result

After fixing:
- **21 Bitcoin miners** reporting successfully
- **1 Scrypt miner** (DG1+) removed or monitored separately
- **Total: ~2,395 TH/s** from 21 miners
- **No more exceptions** in logs

---

## 🔍 Debug Output Template

When you run the diagnostic commands, share this info:

```bash
# 1. API test result
echo '{"command":"summary"}' | nc 192.168.1.74 4028

# 2. Pyasic error
tail -20 logs/pyasic_metrics.log | grep -A 5 "192.168.1.74"

# 3. Port scan
nc -zv 192.168.1.74 4028 4029 8080

# 4. HTTP API test
curl -m 5 http://192.168.1.74/cgi-bin/summary.cgi
```

Share the output and I can help identify the exact issue!

---

## ✅ Success Criteria

- ✅ 21 miners showing `miner_scrape_success{...} 1`
- ✅ No exceptions in pyasic logs
- ✅ All Bitcoin miners (M30S++, M50, S19) reporting
- ✅ DG1+ either removed or monitored separately
- ✅ Total hashrate: ~2,395 TH/s (or ~2,280 TH/s if .74 excluded)

---

**Run the diagnostic commands and share the output to identify the exact issue with .74!** 🔍
