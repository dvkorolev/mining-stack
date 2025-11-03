# 🧪 Testing Strategy for Mining Stack

## Overview

This document outlines the basic tests needed to ensure the mining stack solution works correctly.

---

## 1. 🔧 Infrastructure Tests

### 1.1 Docker Container Health
**Purpose:** Verify all containers are running and healthy

```bash
# Test: All containers running
docker ps --format "table {{.Names}}\t{{.Status}}\t{{.Health}}"

# Expected:
# mining-stack-frontend-1    Up 5 minutes (healthy)
# mining-stack-backend-1     Up 5 minutes (healthy)
# prometheus                 Up 5 minutes
# node-exporter              Up 5 minutes
# alertmanager               Up 5 minutes
# grafana                    Up 5 minutes

# Test: Container health checks
docker inspect mining-stack-backend-1 | grep -A 5 "Health"
docker inspect mining-stack-frontend-1 | grep -A 5 "Health"

# Expected: Status: "healthy"
```

**Pass Criteria:**
- ✅ All 6 containers running
- ✅ Frontend and backend show "healthy" status
- ✅ No containers in "restarting" state

---

### 1.2 Volume Mounts
**Purpose:** Verify critical directories are mounted correctly

```bash
# Test: Backend can see venv
docker exec mining-stack-backend-1 ls -la /opt/mining-stack/venv/bin/python3

# Test: Backend can see bin scripts
docker exec mining-stack-backend-1 ls -la /opt/mining-stack/bin/farm_init.py

# Test: Backend can see config
docker exec mining-stack-backend-1 ls -la /opt/mining-stack/etc/miners.yaml

# Test: Node exporter can see textfile directory
docker exec node-exporter ls -la /textfile

# Test: Prometheus can see config
docker exec prometheus ls -la /etc/prometheus/prometheus.yml
```

**Pass Criteria:**
- ✅ All files/directories accessible
- ✅ No "Permission denied" errors
- ✅ venv/bin/python3 is executable

---

### 1.3 Network Connectivity
**Purpose:** Verify services can communicate

```bash
# Test: Backend can reach Prometheus
docker exec mining-stack-backend-1 wget -q -O- http://prometheus:9090/-/healthy

# Test: Backend can reach Alertmanager
docker exec mining-stack-backend-1 wget -q -O- http://alertmanager:9093/-/healthy

# Test: Prometheus can scrape node-exporter
curl -s http://localhost:9090/api/v1/targets | jq '.data.activeTargets[] | select(.labels.job=="node-exporter") | .health'

# Expected: "up"
```

**Pass Criteria:**
- ✅ All services respond to health checks
- ✅ Prometheus shows all targets as "up"
- ✅ No network errors in logs

---

## 2. 🐍 Python Environment Tests

### 2.1 Virtual Environment
**Purpose:** Verify Python venv is set up correctly

```bash
# Test: venv exists on host
ls -la /opt/mining-stack/venv/bin/python3

# Test: pyasic is installed
/opt/mining-stack/venv/bin/python3 -c "import pyasic; print('pyasic version:', pyasic.__version__)"

# Test: All dependencies installed
/opt/mining-stack/venv/bin/python3 -c "import yaml, netifaces, aiohttp; print('All dependencies OK')"

# Test: pyasic works in container
docker exec mining-stack-backend-1 /opt/mining-stack/venv/bin/python3 -c "import pyasic; print('OK')"
```

**Pass Criteria:**
- ✅ pyasic version >= 0.77.0
- ✅ All dependencies importable
- ✅ Works both on host and in container

---

### 2.2 Discovery Script
**Purpose:** Verify miner discovery works

```bash
# Test: Discovery script runs without errors
cd /opt/mining-stack
source venv/bin/activate
python3 bin/farm_init.py
deactivate

# Expected output:
# Found network: 192.168.1.0/24 (interface: eth0)
# [1/3] Scanning ports...
# Found 23 potential miners
# [2/3] Identifying miners...
# Identified 22 miners
# [3/3] Creating inventory file
# Success!

# Test: miners.yaml was created
cat /opt/mining-stack/etc/miners.yaml | head -20
```

**Pass Criteria:**
- ✅ Script completes without errors
- ✅ Discovers expected number of miners (20-25)
- ✅ Creates valid miners.yaml file
- ✅ Each miner has ip, name, model, alias

---

### 2.3 Metrics Collection
**Purpose:** Verify metrics collectors work

```bash
# Test: pyasic collector
/opt/mining-stack/venv/bin/python3 /opt/mining-stack/bin/pyasic_textfile.py

# Test: Output file created
ls -lh /opt/mining-stack/textfile/pyasic_metrics.prom

# Test: Metrics format is valid
head -20 /opt/mining-stack/textfile/pyasic_metrics.prom

# Expected: Prometheus format metrics
# miner_hashrate_ths{ip="192.168.1.74",name="miner-192-168-1-74",...} 104.5
# miner_temp_max_c{ip="192.168.1.74",...} 68.0

# Test: Universal collector
/opt/mining-stack/venv/bin/python3 /opt/mining-stack/bin/universal_miner_collector.py

# Test: Both collectors in parallel
./bin/collect_all_metrics.sh
```

**Pass Criteria:**
- ✅ Both collectors run without errors
- ✅ Output files created in textfile/
- ✅ Metrics in valid Prometheus format
- ✅ Metrics for all miners present

---

## 3. 🌐 Backend API Tests

### 3.1 Health & Status
**Purpose:** Verify backend is running and responsive

```bash
# Test: Health endpoint
curl -s http://localhost:5000/health | jq '.'

# Expected: {"status":"ok","timestamp":...}

# Test: Mining stats endpoint
curl -s http://localhost:5000/api/mining/stats | jq '.totalHashrate, .activeMiners'

# Expected: Non-zero hashrate and miner count
```

**Pass Criteria:**
- ✅ Health endpoint returns 200 OK
- ✅ Stats endpoint returns valid data
- ✅ Response time < 1 second

---

### 3.2 Miner Management
**Purpose:** Verify CRUD operations on miners

```bash
# Test: List all miners
curl -s http://localhost:5000/api/mining/miners | jq 'length'

# Expected: 20-25 miners

# Test: Get specific miner
curl -s http://localhost:5000/api/mining/miners/miner-192-168-1-74 | jq '.name, .model, .status'

# Test: Update miner threshold
curl -X PUT http://localhost:5000/api/mining/miners/miner-192-168-1-74 \
  -H "Content-Type: application/json" \
  -d '{"thresholds":{"temperature":{"critical":90}}}'

# Expected: {"success":true}

# Test: Verify miners.yaml was updated
grep -A 5 "192.168.1.74" /opt/mining-stack/etc/miners.yaml
```

**Pass Criteria:**
- ✅ List returns all miners
- ✅ Get returns correct miner data
- ✅ Update modifies miners.yaml
- ✅ Prometheus rules regenerated after update

---

### 3.3 Auto-Discovery
**Purpose:** Verify auto-discovery endpoint works

```bash
# Test: Auto-discover API
curl -X POST http://localhost:5000/api/mining/discover | jq '.success, .message, (.miners | length)'

# Expected:
# {
#   "success": true,
#   "message": "Discovered 22 miners",
#   "miners": 22
# }

# Test: miners.yaml updated with new discoveries
cat /opt/mining-stack/etc/miners.yaml | grep "ip:" | wc -l

# Expected: 20-25 miners
```

**Pass Criteria:**
- ✅ Returns success: true
- ✅ Discovers 20-25 miners
- ✅ Updates miners.yaml
- ✅ Response time < 120 seconds

---

### 3.4 Alert Management
**Purpose:** Verify alert endpoints work

```bash
# Test: Get active alerts
curl -s http://localhost:5000/api/mining/alerts | jq 'length'

# Test: Get alert history
curl -s http://localhost:5000/api/mining/alerts/history?limit=10 | jq 'length'

# Test: Get alerts for specific miner
curl -s http://localhost:5000/api/mining/alerts/miner/miner-192-168-1-74 | jq '.'

# Test: Get alert statistics
curl -s http://localhost:5000/api/mining/alerts/stats | jq '.active, .critical, .warning'
```

**Pass Criteria:**
- ✅ All endpoints return valid JSON
- ✅ Alert counts are reasonable
- ✅ No 500 errors

---

## 4. 📊 Prometheus Tests

### 4.1 Metrics Scraping
**Purpose:** Verify Prometheus is collecting metrics

```bash
# Test: Prometheus is up
curl -s http://localhost:9090/-/healthy

# Test: Check targets
curl -s http://localhost:9090/api/v1/targets | jq '.data.activeTargets[] | {job: .labels.job, health: .health}'

# Expected: All targets "up"

# Test: Query miner metrics
curl -s 'http://localhost:9090/api/v1/query?query=miner_hashrate_ths' | jq '.data.result | length'

# Expected: 20-25 results (one per miner)

# Test: Query node metrics
curl -s 'http://localhost:9090/api/v1/query?query=node_cpu_seconds_total' | jq '.status'

# Expected: "success"
```

**Pass Criteria:**
- ✅ All targets showing as "up"
- ✅ Miner metrics available
- ✅ Node exporter metrics available
- ✅ Textfile collector working

---

### 4.2 Alert Rules
**Purpose:** Verify alert rules are loaded and working

```bash
# Test: Check loaded rules
curl -s http://localhost:9090/api/v1/rules | jq '.data.groups[].name'

# Expected: "mining_alerts", "node_alerts", etc.

# Test: Check specific miner rules
curl -s http://localhost:9090/api/v1/rules | jq '.data.groups[] | select(.name=="mining_alerts") | .rules[] | .name' | head -5

# Test: Check for firing alerts
curl -s http://localhost:9090/api/v1/alerts | jq '.data.alerts[] | {name: .labels.alertname, state: .state}'
```

**Pass Criteria:**
- ✅ Alert rules loaded
- ✅ Per-miner rules present
- ✅ Rules use correct thresholds
- ✅ Alerts firing when appropriate

---

### 4.3 Rule Regeneration
**Purpose:** Verify rules regenerate when config changes

```bash
# Test: Update miner threshold via API
curl -X PUT http://localhost:5000/api/mining/miners/miner-192-168-1-74 \
  -H "Content-Type: application/json" \
  -d '{"thresholds":{"temperature":{"critical":95}}}'

# Wait 30 seconds for regeneration
sleep 30

# Test: Check rules file was updated
grep -A 10 "192.168.1.74" /opt/mining-stack/docker/prometheus/rules/mining_alerts.yml

# Expected: New threshold (95) in rules

# Test: Prometheus reloaded
curl -s http://localhost:9090/api/v1/status/config | jq '.status'

# Expected: "success"
```

**Pass Criteria:**
- ✅ Rules file updated within 30 seconds
- ✅ Prometheus reloaded automatically
- ✅ New thresholds active

---

## 5. 🎨 Frontend Tests

### 5.1 Page Load
**Purpose:** Verify all pages load without errors

```bash
# Test: Frontend is accessible
curl -s http://localhost:3000 | grep -q "Mining Stack" && echo "OK"

# Test: Dashboard page
curl -s http://localhost:3000 | grep -q "dashboard" && echo "OK"

# Manual tests (open in browser):
# - http://localhost:3000 - Dashboard
# - http://localhost:3000/miners - Miners Management
# - http://localhost:3000/analytics - Analytics
# - http://localhost:3000/alerts - Alerts
# - http://localhost:3000/settings - Settings
```

**Pass Criteria:**
- ✅ All pages load without 404 errors
- ✅ No console errors in browser
- ✅ API calls succeed

---

### 5.2 Miners Management Page
**Purpose:** Verify miner management UI works

**Manual Tests:**
1. **List Miners**
   - ✅ Shows all miners in table
   - ✅ Columns: Status, Name, IP, Model, Alias, Owner, Actions
   - ✅ No hashrate/temp/power columns (removed)

2. **Add Miner**
   - ✅ Click "Add Miner" button
   - ✅ Fill form (IP, name, model)
   - ✅ Save successfully
   - ✅ Miner appears in list

3. **Edit Miner**
   - ✅ Click edit icon
   - ✅ Modify thresholds
   - ✅ Save successfully
   - ✅ Changes reflected immediately

4. **Delete Miner**
   - ✅ Click delete icon
   - ✅ Confirm dialog appears
   - ✅ Miner removed from list

5. **Auto-Discover**
   - ✅ Click "Auto-Discover" button
   - ✅ Shows "Discovering..." state
   - ✅ Success message: "Discovered 22 miners"
   - ✅ List refreshes with new miners

**Pass Criteria:**
- ✅ All CRUD operations work
- ✅ Auto-discover finds miners
- ✅ No error messages
- ✅ UI responsive and clean

---

### 5.3 Analytics Page
**Purpose:** Verify analytics display correctly

**Manual Tests:**
1. **Summary Cards**
   - ✅ Shows: Avg Hashrate, Peak Hashrate, Uptime, Total BTC

2. **Charts**
   - ✅ Miner Performance Comparison (bar chart)
   - ✅ Mining Efficiency (bar chart)

3. **Detailed Statistics Table**
   - ✅ Columns: Miner, Status, Hashrate, Efficiency, Temperature, Rejection %
   - ✅ No Power or Shares columns (removed)
   - ✅ Color coding for warnings (temp > 80°C, rejection > 5%)

4. **Export**
   - ✅ Click "Export CSV" button
   - ✅ Downloads CSV file
   - ✅ Contains correct data

**Pass Criteria:**
- ✅ All metrics display correctly
- ✅ Charts render without errors
- ✅ Table shows all miners
- ✅ Export works

---

### 5.4 Alerts Page
**Purpose:** Verify alerts display and management

**Manual Tests:**
1. **Active Alerts**
   - ✅ Shows current firing alerts
   - ✅ Color coded by severity (critical=red, warning=orange)
   - ✅ Shows miner name, alert type, timestamp

2. **Alert History**
   - ✅ Shows past alerts
   - ✅ Includes resolved alerts
   - ✅ Sortable by time

3. **Refresh**
   - ✅ Click refresh button
   - ✅ Alerts update

**Pass Criteria:**
- ✅ Alerts display correctly
- ✅ Real-time updates work
- ✅ No duplicate alerts

---

## 6. 📈 Grafana Tests

### 6.1 Dashboard Access
**Purpose:** Verify Grafana dashboards work

```bash
# Test: Grafana is accessible
curl -s http://localhost:3001/api/health | jq '.database'

# Expected: "ok"

# Manual tests:
# 1. Open http://localhost:3001
# 2. Login: admin / mining123
# 3. Check dashboards exist
```

**Pass Criteria:**
- ✅ Grafana loads
- ✅ Login works
- ✅ Datasource connected to Prometheus
- ✅ Dashboards visible

---

### 6.2 Dashboard Data
**Purpose:** Verify dashboards show correct data

**Manual Tests:**
1. **Mining Overview Dashboard**
   - ✅ Total hashrate panel shows data
   - ✅ Active miners count correct
   - ✅ Temperature graphs show all miners
   - ✅ No "No Data" panels

2. **Individual Miner Dashboard**
   - ✅ Select miner from dropdown
   - ✅ Hashrate graph shows data
   - ✅ Temperature graph shows data
   - ✅ Fan speed graph shows data

**Pass Criteria:**
- ✅ All panels show data
- ✅ No query errors
- ✅ Time range selector works
- ✅ Auto-refresh works

---

## 7. 🔔 Alerting Tests

### 7.1 Alert Generation
**Purpose:** Verify alerts fire correctly

**Test Scenarios:**

1. **High Temperature Alert**
   ```bash
   # Simulate: Wait for a miner to exceed 85°C
   # Or manually set low threshold for testing
   
   # Check alert fires:
   curl -s http://localhost:9090/api/v1/alerts | jq '.data.alerts[] | select(.labels.alertname=="MinerHighTemperature")'
   ```

2. **Low Hashrate Alert**
   ```bash
   # Check if any miner is below expected hashrate
   curl -s http://localhost:9090/api/v1/alerts | jq '.data.alerts[] | select(.labels.alertname=="MinerLowHashrate")'
   ```

3. **Miner Offline Alert**
   ```bash
   # Simulate: Power off a miner
   # Wait 5 minutes
   # Check alert fires:
   curl -s http://localhost:9090/api/v1/alerts | jq '.data.alerts[] | select(.labels.alertname=="MinerOffline")'
   ```

**Pass Criteria:**
- ✅ Alerts fire when conditions met
- ✅ Alerts include correct labels (miner name, IP)
- ✅ Alerts clear when condition resolves
- ✅ Alert timing is appropriate (not too fast/slow)

---

### 7.2 Telegram Notifications
**Purpose:** Verify Telegram bot sends alerts

**Manual Test:**
1. Configure Telegram bot token in .env
2. Restart alertmanager
3. Trigger an alert (e.g., set low temp threshold)
4. Check Telegram for notification

**Pass Criteria:**
- ✅ Notification received in Telegram
- ✅ Message includes miner name, alert type
- ✅ Message formatted correctly
- ✅ No duplicate notifications

---

## 8. 🔄 Integration Tests

### 8.1 End-to-End Discovery Flow
**Purpose:** Test complete discovery workflow

**Steps:**
1. Delete miners.yaml
2. Click Auto-Discover in UI
3. Wait for completion
4. Verify miners appear in UI
5. Check Prometheus has metrics
6. Check Grafana shows data
7. Verify alerts configured

**Pass Criteria:**
- ✅ Discovery completes successfully
- ✅ All miners added to config
- ✅ Metrics start flowing within 5 minutes
- ✅ Dashboards populate with data
- ✅ Alert rules generated

---

### 8.2 Threshold Update Flow
**Purpose:** Test threshold update propagation

**Steps:**
1. Update miner threshold in UI
2. Wait 30 seconds
3. Check miners.yaml updated
4. Check Prometheus rules regenerated
5. Check Prometheus reloaded
6. Verify new threshold active

**Pass Criteria:**
- ✅ Config file updated immediately
- ✅ Rules regenerated within 30 seconds
- ✅ Prometheus reloaded automatically
- ✅ New threshold enforced
- ✅ Old alerts cleared if threshold raised

---

### 8.3 Container Restart Recovery
**Purpose:** Verify system recovers from restarts

**Steps:**
1. Restart backend: `docker restart mining-stack-backend-1`
2. Check health endpoint
3. Verify miners still listed
4. Check metrics still flowing

**Pass Criteria:**
- ✅ Backend recovers within 30 seconds
- ✅ No data loss
- ✅ Metrics collection continues
- ✅ UI remains functional

---

## 9. 📊 Performance Tests

### 9.1 Metrics Collection Performance
**Purpose:** Verify collectors run efficiently

```bash
# Test: Collection time
time ./bin/collect_all_metrics.sh

# Expected: < 60 seconds for 25 miners

# Test: CPU usage during collection
top -b -n 1 | grep python3

# Expected: < 50% CPU

# Test: Memory usage
docker stats mining-stack-backend-1 --no-stream

# Expected: < 512MB
```

**Pass Criteria:**
- ✅ Collection completes in < 60 seconds
- ✅ CPU usage reasonable
- ✅ Memory usage within limits
- ✅ No timeouts

---

### 9.2 API Response Times
**Purpose:** Verify API is responsive

```bash
# Test: Stats endpoint
time curl -s http://localhost:5000/api/mining/stats > /dev/null

# Expected: < 1 second

# Test: Miners list
time curl -s http://localhost:5000/api/mining/miners > /dev/null

# Expected: < 1 second

# Test: Discovery (long-running)
time curl -X POST http://localhost:5000/api/mining/discover > /dev/null

# Expected: < 120 seconds
```

**Pass Criteria:**
- ✅ Quick endpoints < 1 second
- ✅ Discovery < 120 seconds
- ✅ No timeouts
- ✅ Consistent performance

---

## 10. 🔒 Security Tests

### 10.1 Basic Security Checks

```bash
# Test: Backend doesn't expose sensitive info
curl -s http://localhost:5000/health | grep -i "password\|token\|secret"

# Expected: No matches

# Test: File permissions
ls -la /opt/mining-stack/etc/miners.yaml

# Expected: -rw-r--r-- (644)

# Test: Container runs as non-root (if configured)
docker exec mining-stack-backend-1 whoami

# Test: No hardcoded credentials in code
grep -r "password.*=" backend/src/ | grep -v "PASSWORD"

# Expected: No matches
```

**Pass Criteria:**
- ✅ No credentials exposed in API responses
- ✅ Config files have appropriate permissions
- ✅ No hardcoded secrets in code

---

## 📋 Test Checklist

### Quick Smoke Test (5 minutes)
```bash
# Run this after deployment to verify basic functionality

# 1. Containers running
docker ps | grep -E "frontend|backend|prometheus|grafana" | wc -l
# Expected: 6

# 2. Backend healthy
curl -s http://localhost:5000/health | jq '.status'
# Expected: "ok"

# 3. Frontend accessible
curl -s http://localhost:3000 | grep -q "Mining Stack" && echo "OK"

# 4. Prometheus scraping
curl -s http://localhost:9090/api/v1/targets | jq '.data.activeTargets[] | .health' | grep -c "up"
# Expected: 2+ targets up

# 5. Metrics present
curl -s 'http://localhost:9090/api/v1/query?query=miner_hashrate_ths' | jq '.data.result | length'
# Expected: 20-25

# 6. Auto-discover works
curl -X POST http://localhost:5000/api/mining/discover | jq '.success'
# Expected: true
```

### Full Test Suite (30 minutes)
Run all tests in sections 1-10 above.

---

## 🚀 Automated Testing

### Future Improvements

1. **Unit Tests**
   - Backend API endpoints
   - Python collector scripts
   - Frontend components

2. **Integration Tests**
   - Docker Compose test environment
   - Automated UI tests (Playwright/Cypress)
   - API contract tests

3. **CI/CD Tests**
   - Build verification
   - Container image scanning
   - Deployment smoke tests

4. **Monitoring Tests**
   - Synthetic monitoring
   - Alert testing
   - Performance regression tests

---

## 📝 Test Results Template

```markdown
# Test Results - [Date]

## Environment
- Raspberry Pi Model: 4B / 8GB
- Docker Version: 24.0.x
- Mining Stack Version: [commit hash]
- Number of Miners: 22

## Test Summary
- ✅ Infrastructure Tests: PASS
- ✅ Python Environment: PASS
- ✅ Backend API: PASS
- ✅ Prometheus: PASS
- ✅ Frontend: PASS
- ✅ Grafana: PASS
- ✅ Alerting: PASS
- ✅ Integration: PASS
- ⚠️ Performance: PASS (with notes)
- ✅ Security: PASS

## Issues Found
1. [Issue description]
   - Severity: Low/Medium/High
   - Status: Open/Fixed
   - Notes: [details]

## Performance Metrics
- Metrics collection time: 45s
- API response time (stats): 0.8s
- Discovery time: 95s
- Memory usage (backend): 380MB

## Recommendations
1. [Recommendation]
2. [Recommendation]
```

---

**Last Updated:** 2025-01-01  
**Version:** 1.0  
**Status:** Ready for implementation
