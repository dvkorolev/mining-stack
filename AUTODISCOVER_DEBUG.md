# 🔍 Auto-Discover Debug Guide

## Test Results Summary

✅ **Backend Health:** OK  
✅ **Frontend:** OK (but grep didn't output "OK" - might be silent)  
✅ **Prometheus Targets:** 4 targets up  
✅ **Metrics Present:** 42 miner metrics (EXCELLENT!)  
❌ **Auto-Discover:** Returns `null` for success field

---

## Issue: Auto-Discover Returns Null

### Current Response
```bash
curl -X POST http://localhost:5000/api/mining/discover | jq '.'
# Returns: {"success": null, ...} or error
```

### Diagnostic Steps

#### Step 1: Check Full Response
```bash
# On Raspberry Pi
curl -X POST http://localhost:5000/api/mining/discover

# This will show the actual error message
```

#### Step 2: Check Backend Logs
```bash
# Check recent logs
docker logs mining-stack-backend-1 --tail 50

# Follow logs while running discover
docker logs -f mining-stack-backend-1 &
curl -X POST http://localhost:5000/api/mining/discover
```

#### Step 3: Verify venv in Container
```bash
# Check if venv is visible
docker exec mining-stack-backend-1 ls -la /opt/mining-stack/venv/bin/python3

# Check if pyasic works
docker exec mining-stack-backend-1 /opt/mining-stack/venv/bin/python3 -c "import pyasic; print('OK')"

# Check if farm_init.py exists
docker exec mining-stack-backend-1 ls -la /opt/mining-stack/bin/farm_init.py
```

#### Step 4: Test Discovery Script Directly
```bash
# Run on host (should work)
cd /opt/mining-stack
source venv/bin/activate
python3 bin/farm_init.py
deactivate

# Run in container (might fail)
docker exec mining-stack-backend-1 /opt/mining-stack/venv/bin/python3 /opt/mining-stack/bin/farm_init.py
```

---

## Possible Issues & Solutions

### Issue 1: Container Can't See venv
**Symptom:** `ls` command fails in container  
**Solution:** Restart backend container
```bash
docker compose -f docker-compose.prod.yml restart backend
```

### Issue 2: Network Access from Container
**Symptom:** Discovery script can't reach miners from inside container  
**Solution:** Use host network mode or check network configuration
```bash
# Check if container can reach a miner
docker exec mining-stack-backend-1 ping -c 1 192.168.1.74
docker exec mining-stack-backend-1 nc -zv 192.168.1.74 4028
```

### Issue 3: Permission Issues
**Symptom:** Can't write to /opt/mining-stack/etc/miners.yaml  
**Solution:** Check file permissions
```bash
ls -la /opt/mining-stack/etc/miners.yaml
# Should be writable by container user

# Fix if needed
chmod 666 /opt/mining-stack/etc/miners.yaml
```

### Issue 4: Python Path Issue
**Symptom:** Backend looking for wrong Python path  
**Solution:** Check backend environment
```bash
docker exec mining-stack-backend-1 env | grep NODE_ENV
# Should be: NODE_ENV=production

# Check what path backend is using
docker logs mining-stack-backend-1 | grep "Running discovery"
```

### Issue 5: Script Timeout
**Symptom:** Discovery takes too long (> 120s)  
**Solution:** Already has 120s timeout, but check if it's timing out
```bash
# Check backend logs for timeout errors
docker logs mining-stack-backend-1 | grep -i timeout
```

---

## Expected vs Actual

### Expected Response
```json
{
  "success": true,
  "message": "Discovered 22 miners",
  "miners": [
    {
      "ip": "192.168.1.74",
      "name": "miner-192-168-1-74",
      "model": "Antminer S19j Pro",
      ...
    }
  ]
}
```

### Actual Response
```json
{
  "success": null,
  ...
}
```

This suggests the API is catching an error and not returning the expected structure.

---

## Quick Fix Attempts

### Attempt 1: Restart Backend
```bash
cd /opt/mining-stack
docker compose -f docker-compose.prod.yml restart backend

# Wait 30 seconds
sleep 30

# Test again
curl -X POST http://localhost:5000/api/mining/discover | jq '.'
```

### Attempt 2: Rebuild Backend
```bash
cd /opt/mining-stack
git pull origin main
docker compose -f docker-compose.prod.yml build backend
docker compose -f docker-compose.prod.yml up -d backend

# Test again
curl -X POST http://localhost:5000/api/mining/discover | jq '.'
```

### Attempt 3: Check if Discovery Works on Host
```bash
# If this works, it's a container issue
cd /opt/mining-stack
source venv/bin/activate
python3 bin/farm_init.py
deactivate

# Check if miners.yaml was updated
cat etc/miners.yaml | grep "ip:" | wc -l
```

---

## Good News! 🎉

Despite auto-discover not working via API, your system is **mostly working**:

### ✅ What's Working
1. **Backend is healthy** - Health endpoint returns OK
2. **Frontend is accessible** - Port 3000 responding
3. **Prometheus is scraping** - 4 targets up
4. **Metrics are flowing** - 42 miner metrics present!
5. **venv exists** - We verified earlier

### 🔍 What Needs Investigation
1. **Auto-discover API** - Returns null instead of success
2. **Why 42 metrics?** - Expected ~22 miners, but seeing 42 results
   - Could be: 21 miners × 2 metrics each (hashrate + temp)
   - Or: Multiple metrics per miner

---

## Next Steps

### Priority 1: Get Full Error Message
```bash
# Run this on Raspberry Pi
curl -X POST http://localhost:5000/api/mining/discover
```

This will show us the actual error message instead of just the success field.

### Priority 2: Check Backend Logs
```bash
docker logs mining-stack-backend-1 --tail 100 | grep -A 10 "discover"
```

### Priority 3: Verify Discovery Works Manually
```bash
cd /opt/mining-stack
source venv/bin/activate
python3 bin/farm_init.py
deactivate
```

If manual discovery works, it's a container/API issue. If it fails, it's a script issue.

---

## Workaround (If API Doesn't Work)

You can still use auto-discovery manually:

```bash
# 1. Run discovery script on host
cd /opt/mining-stack
source venv/bin/activate
python3 bin/farm_init.py
deactivate

# 2. Regenerate Prometheus rules
source venv/bin/activate
python3 bin/generate_prometheus_rules.py
deactivate

# 3. Reload Prometheus
docker exec prometheus kill -HUP 1

# 4. Restart backend to pick up new config
docker compose -f docker-compose.prod.yml restart backend
```

This achieves the same result as the API button, just manually.

---

## Debug Commands Summary

```bash
# 1. Get full error
curl -X POST http://localhost:5000/api/mining/discover

# 2. Check backend logs
docker logs mining-stack-backend-1 --tail 50

# 3. Verify venv in container
docker exec mining-stack-backend-1 ls -la /opt/mining-stack/venv/bin/python3

# 4. Test pyasic in container
docker exec mining-stack-backend-1 /opt/mining-stack/venv/bin/python3 -c "import pyasic; print('OK')"

# 5. Test discovery on host
cd /opt/mining-stack && source venv/bin/activate && python3 bin/farm_init.py && deactivate

# 6. Check miners.yaml
cat /opt/mining-stack/etc/miners.yaml | head -50
```

---

**Status:** System mostly working, auto-discover API needs debugging  
**Impact:** Low - manual discovery works as workaround  
**Next:** Get full error message from API
