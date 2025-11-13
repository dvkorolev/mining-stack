# Deployment Fixes Summary

## Issues Reported

### 1. ✅ All miners showing offline after last 2 releases
**Root Cause**: Backend Prometheus queries were filtering by `algorithm` label that doesn't exist yet in metrics (python-scheduler not rebuilt with new code).

**Fix Applied** (Commit `42936a2`):
- Modified Prometheus queries to work **with or without** algorithm label
- Query all metrics first: `miner_hashrate_ths` (no filter)
- Then filter by algorithm label if present in results
- Backward compatible - works immediately without rebuilding python-scheduler

### 2. ⏳ Dashboard not showing SHA256/SCRYPT separation
**Root Cause**: Frontend hasn't been rebuilt yet with the new code.

**Status**: Code is correct, just needs rebuild and deployment.

### 3. ✅ Algorithm label in metrics
**Status**: Python-scheduler code already adds `algorithm` label to all metrics (line 260-290 in `pyasic_collector.py`). Just needs rebuild.

## All Commits Ready for Deployment

1. `d107e3f` - Backend hashrate separation
2. `1e9c949` - Telegram bot hashrate updates  
3. `ca7a11a` - Frontend hashrate updates
4. `3dc6f86` - Hashrate separation documentation
5. `3185cb4` - Telegram navigation fix (pools view)
6. `369d388` - Alert deduplication fix
7. `93e0466` - Alert deduplication documentation
8. `42936a2` - **Fix Prometheus queries for backward compatibility** ⭐

## Deployment Order

### Step 1: Deploy Backend (CRITICAL - Fixes offline miners)
```bash
# Build backend
./build-local.sh backend

# Push to registry
docker push your-registry/mining-stack-backend:latest

# On server (admin@192.168.1.66)
docker compose -f docker-compose.prod.yml pull backend
docker compose -f docker-compose.prod.yml restart backend
```

**Expected Result**: Miners should come back online immediately (queries work without algorithm label)

### Step 2: Deploy Python-Scheduler (Adds algorithm label)
```bash
# Build python-scheduler
./build-local.sh python-scheduler

# Push to registry
docker push your-registry/mining-stack-python-scheduler:latest

# On server
docker compose -f docker-compose.prod.yml pull python-scheduler
docker compose -f docker-compose.prod.yml restart python-scheduler
```

**Expected Result**: Metrics will now have `algorithm` label, backend will use it for better filtering

### Step 3: Deploy Frontend (Shows SHA256/SCRYPT separation)
```bash
# Build frontend
./build-local.sh frontend

# Push to registry
docker push your-registry/mining-stack-frontend:latest

# On server
docker compose -f docker-compose.prod.yml pull frontend
docker compose -f docker-compose.prod.yml restart frontend
```

**Expected Result**: 
- Dashboard shows separate 24h avg hashrate for SHA-256 and SCRYPT
- Analytics page shows separate metrics and charts

### Step 4: Clean Up Duplicate Alerts
```bash
# On server, call cleanup endpoint
curl -X POST http://192.168.1.66:5000/api/mining/alerts/cleanup-duplicates
```

**Expected Result**: Removes duplicate alert entries from database

## Verification Steps

### After Backend Deployment
```bash
# Check backend logs
docker compose -f docker-compose.prod.yml logs backend | tail -50

# Verify miners are online
curl http://192.168.1.66:5000/api/mining/stats | jq '.activeMiners'

# Should show non-zero active miners
```

### After Python-Scheduler Deployment
```bash
# Check scheduler logs
docker compose -f docker-compose.prod.yml logs python-scheduler | tail -50

# Verify metrics have algorithm label
curl http://192.168.1.66:8000/metrics | grep 'miner_hashrate_ths{.*algorithm='

# Should see algorithm="sha256" or algorithm="scrypt" in labels
```

### After Frontend Deployment
```bash
# Open browser to http://192.168.1.66:3000
# Navigate to Dashboard
# Check "24h Avg Hashrate" card - should show separate sections for SHA-256 and SCRYPT

# Navigate to Analytics page
# Should see separate metric cards for each algorithm
# Charts should exclude SCRYPT miners
```

## Rollback Plan

If issues occur after deployment:

### Rollback Backend
```bash
docker compose -f docker-compose.prod.yml pull backend:previous-tag
docker compose -f docker-compose.prod.yml restart backend
```

### Rollback Python-Scheduler
```bash
docker compose -f docker-compose.prod.yml pull python-scheduler:previous-tag
docker compose -f docker-compose.prod.yml restart python-scheduler
```

### Rollback Frontend
```bash
docker compose -f docker-compose.prod.yml pull frontend:previous-tag
docker compose -f docker-compose.prod.yml restart frontend
```

## Key Technical Details

### Prometheus Query Changes
**Before** (broken without algorithm label):
```promql
max by (ip, algorithm) (miner_hashrate_ths{algorithm="sha256"})
```

**After** (works with or without label):
```promql
max by (ip, algorithm) (miner_hashrate_ths)
# Then filter by algorithm label if present in code
```

### Python-Scheduler Metrics
All metrics now include `algorithm` label:
- `miner_hashrate_ths{ip="...", name="...", model="...", algorithm="sha256"}`
- `miner_hashrate_mhs{ip="...", name="...", model="...", algorithm="scrypt"}`
- `miner_state{ip="...", name="...", model="...", algorithm="..."}`
- `miner_scrape_status{ip="...", name="...", model="...", algorithm="..."}`
- etc.

### Backend API Response
Now includes separate fields:
```json
{
  "totalHashrate": 100.5,
  "totalHashrateSha256": 95.0,
  "totalHashrateScrypt": 0.0055,
  "averageHashrate24h": 98.2,
  "averageHashrate24hSha256": 93.0,
  "averageHashrate24hScrypt": 0.0052,
  "activeMiners": 10,
  "activeMinersSha256": 9,
  "activeMinersScrypt": 1,
  "aggregates": {
    "maxHashrate": 100.0,
    "minHashrate": 90.0,
    "maxHashrateScrypt": 0.006,
    "minHashrateScrypt": 0.005
  }
}
```

## Testing Checklist

- [ ] Backend deployed and miners show online
- [ ] Python-scheduler deployed and metrics have algorithm label
- [ ] Frontend deployed and Dashboard shows separate hashrates
- [ ] Analytics page shows separate SHA-256 metrics
- [ ] Analytics charts exclude SCRYPT miners
- [ ] Telegram bot shows separate hashrates in /status
- [ ] Telegram bot navigation works (pools view back button)
- [ ] Alert deduplication working (no duplicate entries)
- [ ] Alert cleanup endpoint works

## Support

If issues persist after deployment:
1. Check logs: `docker compose -f docker-compose.prod.yml logs <service>`
2. Verify Prometheus metrics: `curl http://192.168.1.66:8000/metrics`
3. Check backend API: `curl http://192.168.1.66:5000/api/mining/stats`
4. Review this document for rollback procedures
