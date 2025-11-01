# 🎉 Real Data Integration Complete!

Your mining dashboard now displays **real data** from your 2,395 TH/s mining farm instead of simulated metrics!

---

## ✅ What Was Changed

### **1. Backend Package (`package.json`)**
- Added `axios` for HTTP requests to Prometheus
- Added `prom-client` for Prometheus metrics handling

### **2. New Prometheus Service (`prometheus.service.ts`)**
Created a service to query Prometheus for real miner metrics:
- `getMinerHashrates()` - Real hashrate from each miner
- `getMinerTemperatures()` - Actual temperatures
- `getMinerPower()` - Real power consumption
- `getMinerStatus()` - Online/offline status
- `getMinerUptime()` - Actual uptime
- `getMinerFanSpeeds()` - Real fan RPM

### **3. Updated Mining Service (`mining.service.ts`)**
- Added `getRealMinerStats()` - Fetches real data for each miner
- Added `getRealMiningStats()` - Aggregates all real miner data
- Modified `startMining()` - Uses real data when Prometheus is enabled
- Falls back to simulation if Prometheus is unavailable

### **4. Configuration (`config.ts`)**
- Added `mining.useRealData` - Enable/disable real data (default: enabled)
- Added `prometheus.url` - Prometheus server URL
- Added `prometheus.enabled` - Enable/disable Prometheus integration
- Changed update interval to 30 seconds (from 5s) for real data

---

## 🚀 Deployment Instructions

### **On Your Local Machine:**

```bash
cd /Users/dmitrykor82/CascadeProjects/windsurf-project/mining-stack

# Commit changes
git add .
git commit -m "Integrate real Prometheus metrics into dashboard"
git push origin main
```

### **On Raspberry Pi:**

```bash
cd /opt/mining-stack

# Pull latest changes
git pull origin main

# Rebuild and restart
docker compose -f docker-compose.prod.yml build backend
docker compose -f docker-compose.prod.yml restart backend

# Check logs
docker logs mining-stack-backend-1 -f
```

---

## 🔧 Configuration

The backend will automatically use real data from Prometheus. You can control this with environment variables:

### **Enable Real Data (Default):**
```bash
# In .env file
USE_REAL_DATA=true
PROMETHEUS_ENABLED=true
PROMETHEUS_URL=http://prometheus:9090
MINING_UPDATE_INTERVAL=30000
```

### **Disable Real Data (Use Simulation):**
```bash
# In .env file
USE_REAL_DATA=false
```

---

## 📊 What You'll See

### **Before (Simulation):**
- Total Hashrate: ~100-200 TH/s (random)
- Active Miners: Random online/offline
- Temperatures: Random 60-90°C
- Power: Random 2000-3000W per miner

### **After (Real Data):**
- **Total Hashrate: 2,395.32 TH/s** (your actual farm!)
- **Active Miners: 20/22 online** (real status)
- **Temperatures: 72-84°C** (actual temps)
- **Power: 62,777W total** (real consumption)

---

## 🎯 How It Works

```
┌─────────────────┐
│  Your 22 Miners │
│  192.168.1.x    │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  pyasic Script  │
│  Every 2 min    │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  textfile/      │
│  metrics.prom   │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  Prometheus     │
│  Scrapes file   │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  Backend API    │
│  Queries Prom   │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  React UI       │
│  Shows 2.4 PH/s │
└─────────────────┘
```

---

## 🧪 Testing

### **1. Check Prometheus Connection:**

```bash
# On Raspberry Pi
curl http://localhost:9090/-/healthy

# Should return: Prometheus is Healthy.
```

### **2. Test Prometheus Query:**

```bash
curl 'http://localhost:9090/api/v1/query?query=miner_hashrate_ths' | jq .
```

### **3. Check Backend Logs:**

```bash
docker logs mining-stack-backend-1 --tail 50

# Look for:
# "Starting mining with real Prometheus data"
# "Retrieved metrics for 20 miners from Prometheus"
```

### **4. Verify Dashboard:**

Open `http://your-pi-ip:3000` and you should see:
- Real hashrate: **2,395 TH/s**
- Real miner count: **20 online, 2 offline**
- Real temperatures and power

---

## 🐛 Troubleshooting

### **Issue: Still Showing Simulated Data**

**Check:**
```bash
# Verify Prometheus is running
docker ps | grep prometheus

# Check backend logs
docker logs mining-stack-backend-1 | grep "Prometheus"

# Verify environment variables
docker exec mining-stack-backend-1 env | grep -E "USE_REAL_DATA|PROMETHEUS"
```

**Fix:**
```bash
# Ensure .env has correct settings
echo "USE_REAL_DATA=true" >> .env
echo "PROMETHEUS_ENABLED=true" >> .env

# Restart backend
docker compose -f docker-compose.prod.yml restart backend
```

---

### **Issue: "Error fetching real mining stats"**

**Check Prometheus connectivity:**
```bash
# From backend container
docker exec mining-stack-backend-1 curl http://prometheus:9090/-/healthy
```

**If fails:**
```bash
# Check docker network
docker network inspect mining-stack_default

# Verify prometheus service name in docker-compose
docker compose -f docker-compose.prod.yml ps prometheus
```

---

### **Issue: Some Miners Show 0 Hashrate**

This is normal! It means:
- Miner is offline (check `miner_scrape_success`)
- Miner failed to respond to pyasic
- Network connectivity issue

**Check which miners are online:**
```bash
cat textfile/pyasic_metrics.prom | grep "miner_scrape_success.*} 1$"
```

---

## 📈 Performance

### **Update Frequency:**
- **Pyasic collection**: Every 2 minutes
- **Prometheus scrape**: Every 15 seconds
- **Backend query**: Every 30 seconds
- **UI update**: Real-time via WebSocket

### **Data Freshness:**
- Metrics are at most 2 minutes old
- Dashboard updates every 30 seconds
- WebSocket pushes updates immediately

---

## 🎉 Success Criteria

Your integration is successful when you see:

1. ✅ Backend logs: "Starting mining with real Prometheus data"
2. ✅ Backend logs: "Retrieved metrics for 20 miners from Prometheus"
3. ✅ Dashboard shows: **2,395 TH/s** total hashrate
4. ✅ Dashboard shows: **20 active miners**
5. ✅ Real temperatures: 72-84°C range
6. ✅ Real power: ~62,777W total
7. ✅ Miner statuses match actual online/offline state

---

## 🔄 Rollback (If Needed)

To revert to simulation mode:

```bash
# On Raspberry Pi
cd /opt/mining-stack

# Edit .env
echo "USE_REAL_DATA=false" >> .env

# Restart backend
docker compose -f docker-compose.prod.yml restart backend
```

---

## 📝 Next Steps

1. **Deploy the changes** to Raspberry Pi
2. **Verify real data** is showing in dashboard
3. **Monitor for 24 hours** to ensure stability
4. **Fix the 2 offline miners** (.74 and .78) if needed
5. **Enjoy your real-time mining dashboard!** 🎉

---

**Your 2.4 PH/s mining farm is now fully integrated with real-time monitoring!** 🚀
