# 🔍 Debug Miners Status Errors

If you see errors on miners' status but don't know what the exact error is, follow these steps to diagnose the issue.

---

## 🚨 Quick Diagnosis

### **Step 1: Check Backend Logs**

```bash
cd /opt/mining-stack

# View recent logs
docker logs mining-stack-backend-1 --tail 100

# Follow logs in real-time
docker logs mining-stack-backend-1 -f
```

Look for:
- ❌ Connection errors
- ❌ Database errors
- ❌ Configuration errors
- ❌ Miner communication errors

---

### **Step 2: Check Browser Console**

1. Open your browser (Chrome/Firefox)
2. Press `F12` to open Developer Tools
3. Go to **Console** tab
4. Look for red error messages

Common errors:
- `Failed to fetch` - Backend not responding
- `Network error` - Connection issues
- `500 Internal Server Error` - Backend crash

---

### **Step 3: Check API Directly**

Test if the backend API is working:

```bash
# Check health
curl http://localhost:5000/health

# Check mining stats
curl http://localhost:5000/api/mining/stats

# Check specific miner
curl http://localhost:5000/api/miners/miner-1/stats
```

Expected responses:
```json
{
  "status": "healthy",
  "timestamp": "2025-11-01T..."
}
```

---

## 🔧 Common Issues & Solutions

### **Issue 1: Backend Container Not Running**

**Symptoms:**
- All miners show error status
- Dashboard shows "Failed to fetch"
- API returns connection refused

**Check:**
```bash
docker compose -f docker-compose.prod.yml ps
```

**Fix:**
```bash
# Restart backend
docker compose -f docker-compose.prod.yml restart backend

# Check logs
docker logs mining-stack-backend-1
```

---

### **Issue 2: Database Permission Error**

**Symptoms:**
- Backend logs show: `SqliteError: unable to open database file`
- Miners status not updating

**Fix:**
```bash
cd /opt/mining-stack

# Fix permissions
sudo chown -R $(whoami):$(whoami) ./data ./logs ./etc
chmod -R 755 ./data ./logs ./etc

# Restart backend
docker compose -f docker-compose.prod.yml restart backend
```

---

### **Issue 3: Miners Configuration Missing**

**Symptoms:**
- "No miners configured" message
- Empty miners list

**Check:**
```bash
cat /opt/mining-stack/etc/miners.yaml
```

**Fix:**
```bash
cd /opt/mining-stack

# Create default configuration
cat > etc/miners.yaml << 'EOF'
miners:
  - name: "miner-1"
    ip: "192.168.1.100"
    model: "Antminer S19j Pro"
    alias: "Miner 1"
    owner: "Farm Owner"
EOF

# Restart backend
docker compose -f docker-compose.prod.yml restart backend
```

---

### **Issue 4: WebSocket Connection Failed**

**Symptoms:**
- Stats don't update in real-time
- Console shows: `WebSocket connection failed`

**Check:**
```bash
# Test WebSocket
curl -i -N -H "Connection: Upgrade" \
  -H "Upgrade: websocket" \
  -H "Host: localhost:5000" \
  http://localhost:5000/ws
```

**Fix:**
```bash
# Restart backend
docker compose -f docker-compose.prod.yml restart backend
```

---

### **Issue 5: Miner Status Stuck on "Error"**

**Symptoms:**
- Miner shows red error status
- `errors` field shows: `["High temperature warning"]`

**This is simulation behavior:**
- Miners randomly go into error state (5% chance)
- They automatically recover after 5 minutes
- This is normal for the simulation

**To force recovery:**
```bash
# Restart the simulation
curl -X POST http://localhost:5000/api/mining/stop
curl -X POST http://localhost:5000/api/mining/start
```

---

## 📊 Detailed Debugging

### **Get Full Backend Status**

```bash
cd /opt/mining-stack

# Check all services
docker compose -f docker-compose.prod.yml ps

# Check backend health
curl http://localhost:5000/health

# Check mining stats with details
curl http://localhost:5000/api/mining/stats | jq '.'

# Check specific miner
curl http://localhost:5000/api/miners/miner-1/stats | jq '.'
```

---

### **Check Miner Status in Database**

```bash
cd /opt/mining-stack

# Access database
docker exec -it mining-stack-backend-1 sh -c "cd /app && node -e \"
const db = require('./dist/services/database.service').getDatabase();
const stats = db.getRecentStats(10);
console.log(JSON.stringify(stats, null, 2));
\""
```

---

### **Enable Debug Logging**

```bash
cd /opt/mining-stack

# Edit .env
nano .env

# Add this line:
LOG_LEVEL=debug

# Restart backend
docker compose -f docker-compose.prod.yml restart backend

# View detailed logs
docker logs mining-stack-backend-1 -f
```

---

## 🎯 Understanding Miner Status

### **Status Types:**

| Status | Icon | Meaning | Duration |
|--------|------|---------|----------|
| `online` | 🟢 | Miner is working normally | Stable |
| `offline` | ⚫ | Miner is not responding | Until restart |
| `error` | 🔴 | Miner has issues (high temp, etc) | ~5 minutes |

### **Status Changes:**

The system uses **persistent state** to avoid constant status changes:
- Minimum 5 minutes between status changes
- Only 5% chance of change after minimum interval
- Smooth transitions to avoid flickering

---

## 🧪 Test Miner Communication

If you have real miners (not simulation):

```bash
cd /opt/mining-stack

# Test miner connectivity
ping 192.168.1.100

# Test miner API (Antminer)
curl http://192.168.1.100/cgi-bin/stats.cgi

# Test with pyasic
source venv/bin/activate
python3 -c "
import asyncio
from pyasic import get_miner

async def test():
    miner = await get_miner('192.168.1.100')
    print(f'Found: {miner}')
    data = await miner.get_data()
    print(f'Data: {data}')

asyncio.run(test())
"
```

---

## 📝 Collect Debug Information

Run this to collect all debug info:

```bash
cd /opt/mining-stack

echo "=== System Info ===" > debug_info.txt
date >> debug_info.txt
echo "" >> debug_info.txt

echo "=== Docker Status ===" >> debug_info.txt
docker compose -f docker-compose.prod.yml ps >> debug_info.txt
echo "" >> debug_info.txt

echo "=== Backend Logs (last 50 lines) ===" >> debug_info.txt
docker logs mining-stack-backend-1 --tail 50 >> debug_info.txt
echo "" >> debug_info.txt

echo "=== Health Check ===" >> debug_info.txt
curl -s http://localhost:5000/health >> debug_info.txt
echo "" >> debug_info.txt

echo "=== Mining Stats ===" >> debug_info.txt
curl -s http://localhost:5000/api/mining/stats >> debug_info.txt
echo "" >> debug_info.txt

echo "=== Miners Config ===" >> debug_info.txt
cat etc/miners.yaml >> debug_info.txt
echo "" >> debug_info.txt

echo "Debug info saved to debug_info.txt"
cat debug_info.txt
```

---

## 🆘 Still Having Issues?

If you still see errors after trying these steps:

1. **Share the debug info:**
   ```bash
   cat /opt/mining-stack/debug_info.txt
   ```

2. **Check specific error messages:**
   - Backend logs
   - Browser console
   - API responses

3. **Provide details:**
   - What exactly do you see in the UI?
   - What error messages appear?
   - When did it start happening?

---

## ✅ Quick Fix Checklist

- [ ] Backend container is running
- [ ] Database permissions are correct
- [ ] `miners.yaml` exists and is valid
- [ ] API responds to health check
- [ ] No errors in backend logs
- [ ] Browser console shows no errors
- [ ] WebSocket connection works

---

**Run these commands now to diagnose:**

```bash
cd /opt/mining-stack

# Quick status check
docker compose -f docker-compose.prod.yml ps
curl http://localhost:5000/health
docker logs mining-stack-backend-1 --tail 20
```

This will show you exactly what's wrong! 🔍
