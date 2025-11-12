# Issues Analysis - November 12, 2025

## Issue #1: m50oktober Shows as Offline Despite Being Online

### Problem
- Dashboard shows miner as **offline**
- Miner IS actually online and reporting metrics
- Metrics show: `miner_scrape_status{name="m50oktober"} 2.0` (SUCCESS)
- Alerts are firing for rejection rate and efficiency

### Root Cause Analysis

#### Metric Name Mismatch
The alert rule and backend service are looking for the wrong metric name:

**Alert Rule (mining_alerts.yml):**
```yaml
- alert: MinerOffline
  expr: miner_scrape_success == 0  # ❌ This metric doesn't exist!
  for: 5m
```

**Python Scheduler Exports:**
```
miner_scrape_status{...} 2.0
# 2=success, 1=partial, 0=timeout, -1=refused, -2=error
```

**Backend Service:**
The backend likely checks for `miner_scrape_success` or similar, but the Python scheduler exports `miner_scrape_status` with different values.

### Current Metrics for m50oktober (192.168.1.96)
```
miner_hashrate_ths = 13.84 TH/s  ✓ Mining
miner_power_watts = 3544.6 W
miner_temp_max_c = 71.69°C
miner_is_mining = 1.0  ✓ Active
miner_uptime_seconds = 1005
miner_errors_count = 0  ✓ No errors
miner_scrape_status = 2.0  ✓ Success
```

### Active Alerts (Not Errors!)
1. **MinerRejectionRateCritical** - 11.54% rejection rate (threshold: 5%)
2. **MinerPoorEfficiency** - 257 J/TH (threshold: 35 J/TH)

These are **performance warnings**, not offline errors!

### Solution Required

#### 1. Fix Alert Rule
Update `mining_alerts.yml`:
```yaml
- alert: MinerOffline
  expr: miner_scrape_status < 1  # Use correct metric
  for: 5m
  labels:
    severity: critical
    component: miner
  annotations:
    summary: "Miner {{ $labels.name }} is offline"
    description: "Miner {{ $labels.name }} ({{ $labels.ip }}) has been unreachable for 5 minutes."
```

#### 2. Fix Backend Status Detection
Update `mining.service.ts` to use `miner_scrape_status`:
```typescript
// Query Prometheus for scrape status
const scrapeStatusQuery = `miner_scrape_status{ip="${miner.ip}"}`;
const scrapeStatus = await queryPrometheus(scrapeStatusQuery);

// Status values: 2=success, 1=partial, 0=timeout, -1=refused, -2=error
const isOnline = scrapeStatus >= 1;
```

#### 3. Update Database Migration
The `MinerOffline` rule in database needs the correct expression:
```sql
UPDATE alert_rules 
SET expr = 'miner_scrape_status < 1' 
WHERE name = 'MinerOffline';
```

---

## Issue #2: DG1+ Pool Sync - Already Supported!

### Discovery
The `dg1_http_collector.py` **ALREADY** collects pool information from DG1+ miners!

### Current Implementation
```python
# dg1_http_collector.py lines 44-49
async with session.get(f'http://{ip}/cgi-bin/pools.cgi') as response:
    if response.status == 200:
        pools_data = await response.json()

# Lines 142-155: Parse pool data
if pools_data and 'POOLS' in pools_data:
    for pool in pools_data['POOLS']:
        pools.append({
            'url': pool.get('url', ''),
            'user': pool.get('user', ''),
            'accepted': int(pool.get('accepted', 0)),
            'rejected': int(pool.get('rejected', 0)),
            'status': pool.get('status', 'Unknown'),
            'priority': int(pool.get('priority', 0))
        })
```

### Pool Data Available
The Python scheduler collects pools from DG1+ via:
- **Endpoint:** `http://192.168.1.78/cgi-bin/pools.cgi`
- **Auth:** HTTP Basic Auth (root/root)
- **Format:** JSON with pool details

### Solution Required

#### Option 1: Expose Pools via Backend API
Add endpoint to retrieve pools from Python scheduler metrics:

```typescript
// backend/src/routes/mining.routes.ts
router.get('/mining/miners/:minerIp/pools-from-metrics', async (req, res) => {
  const { minerIp } = req.params;
  
  // Query Prometheus for pool metrics
  const query = `miner_pool_accepted{ip="${minerIp}"}`;
  const result = await queryPrometheus(query);
  
  // Parse and return pools
  const pools = result.map(metric => ({
    url: metric.labels.pool_url,
    user: metric.labels.pool_user,
    accepted: metric.value,
    status: metric.labels.pool_status
  }));
  
  res.json({ success: true, pools });
});
```

#### Option 2: Add DG1 Support to getMinerPools
Extend `miner-control.service.ts`:

```typescript
async function getDG1Pools(miner: MinerRecord): Promise<PoolConfig[]> {
  try {
    const response = await axios.get(
      `http://${miner.ip}/cgi-bin/pools.cgi`,
      {
        auth: {
          username: miner.username || 'root',
          password: miner.password || 'root'
        },
        timeout: 5000
      }
    );
    
    if (response.data && response.data.POOLS) {
      return response.data.POOLS.map(p => ({
        url: p.url.replace(/^stratum\+tcp:\/\//, ''),
        user: p.user,
        password: 'x' // DG1 doesn't expose passwords
      }));
    }
    
    return [];
  } catch (error) {
    throw new Error(`DG1 API error: ${error.message}`);
  }
}

// Update getMinerPools
export const getMinerPools = async (minerId: string) => {
  const miner = getMinerById(minerId);
  
  // Detect DG1/Goldshell miners
  if (miner.model.includes('DG1') || miner.model.includes('Goldshell')) {
    return { success: true, pools: await getDG1Pools(miner) };
  }
  
  // Existing CGMiner logic...
};
```

---

## Summary

| Issue | Status | Root Cause | Solution |
|-------|--------|------------|----------|
| m50oktober "offline" | ❌ Bug | Metric name mismatch | Fix alert rule & backend |
| DG1+ pool sync | ✅ Already works! | Just not exposed to backend | Add DG1 support to backend API |

## Action Items

### High Priority
1. ✅ Fix `MinerOffline` alert rule to use `miner_scrape_status`
2. ✅ Update backend to check `miner_scrape_status` instead of `miner_scrape_success`
3. ✅ Regenerate Prometheus YAML from database

### Medium Priority
4. ✅ Add DG1 pool support to `getMinerPools` function
5. ✅ Test pool sync with DG1+ (192.168.1.78)

### Low Priority
6. Document metric naming conventions
7. Add miner-type detection system

## Files to Modify

1. **Alert Rule in Database:**
   - Update `MinerOffline` expression

2. **Backend Service:**
   - `backend/src/services/mining.service.ts` - Fix status detection
   - `backend/src/services/miner-control.service.ts` - Add DG1 pool support

3. **Documentation:**
   - Update metric reference guide
