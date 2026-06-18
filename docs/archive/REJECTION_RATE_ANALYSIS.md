# Rejection Rate Analysis and Troubleshooting

## Current Rejection Rate Data

Based on your Grafana dashboard data:

| Miner | IP | Current | Mean | Max | Status |
|-------|----|---------|----- |-----|--------|
| EN-S19-114 | 192.168.1.114 | 0% | 0.427% | **9.09%** | ⚠️ High peaks |
| EN-S19KPro-115 | 192.168.1.115 | 0% | 1.16% | **10%** | ⚠️ High peaks |
| EN-S19Pro-064 | 192.168.1.64 | 0% | 2.83% | **25%** | 🔴 Critical |

---

## Analysis

### ⚠️ Issues Identified:

**1. EN-S19Pro-064 (192.168.1.64) - CRITICAL**
- **Max rejection: 25%** (extremely high!)
- **Mean rejection: 2.83%** (above 2% warning threshold)
- **Current: 0%** (intermittent issue)

**Problem:** This miner has severe intermittent rejection rate spikes

**2. EN-S19KPro-115 (192.168.1.115) - WARNING**
- **Max rejection: 10%** (high)
- **Mean rejection: 1.16%** (acceptable but peaks are concerning)
- **Current: 0%** (intermittent)

**3. EN-S19-114 (192.168.1.114) - WARNING**
- **Max rejection: 9.09%** (high)
- **Mean rejection: 0.427%** (good average)
- **Current: 0%** (intermittent)

### 🟢 Good News:

- All miners currently at 0% rejection (issues are intermittent)
- Average rejection rates are relatively low
- No sustained high rejection rates

### ⚠️ Concerns:

- **Peak rejection rates are very high** (up to 25%)
- **Intermittent spikes** indicate network or pool issues
- **Pattern suggests temporary connectivity problems**

---

## Current Alert Configuration

**Alert:** `MinerHighRejectionRate`

**Configuration:**
```yaml
- alert: MinerHighRejectionRate
  expr: |
    (
      rate(miner_pool_rejected_total[5m]) / 
      (rate(miner_pool_accepted_total[5m]) + rate(miner_pool_rejected_total[5m]))
    ) > 0.05
  for: 10m
  labels:
    severity: warning
    component: miner
  annotations:
    summary: "Miner {{ $labels.name }} high rejection rate"
    description: "Miner {{ $labels.name }} rejection rate is {{ $value | humanizePercentage }} (threshold: 5%)"
```

**Threshold:** 5% sustained for 10 minutes
**Severity:** Warning

---

## Why High Rejection Rates Occur

### Common Causes:

**1. Network Latency/Issues** (Most Common)
- High ping to pool
- Network congestion
- Unstable connection
- Router/switch issues

**2. Pool Problems**
- Pool server overloaded
- Pool maintenance
- DDoS attack on pool
- Stale share issues

**3. Miner Configuration**
- Wrong difficulty setting
- Incorrect pool URL
- Bad DNS resolution
- Firewall blocking

**4. Hardware Issues**
- Unstable hashboards
- Memory errors
- Overclocking too aggressive
- Power supply fluctuations

**5. Timing Issues**
- Miner clock drift
- NTP not synced
- Slow share submission

---

## Troubleshooting Steps

### For EN-S19Pro-064 (25% max rejection):

**1. Check Network Latency**
```bash
# From Raspberry Pi, ping pool server
ping pool.example.com

# Check for packet loss
ping -c 100 pool.example.com | grep loss

# Trace route to pool
traceroute pool.example.com
```

**Expected:** <50ms ping, 0% packet loss

**2. Check Pool Connection**
```bash
# View miner pools
curl http://localhost:5000/api/mining/miners/miner-192-168-1-64/pools

# Or via Telegram
/pools miner-192-168-1-64
```

**3. Check Miner Logs**

Access miner web interface:
```
http://192.168.1.64
```

Look for:
- Connection errors
- Pool reconnections
- Network timeouts
- Share submission failures

**4. Test Different Pool**

Temporarily switch to backup pool:
- If rejection rate drops → pool issue
- If rejection rate stays high → miner/network issue

**5. Check Local Network**
```bash
# Check switch/router between miner and gateway
# Look for:
# - Port errors
# - Collisions
# - Dropped packets
```

**6. Check Miner Configuration**

Verify pool settings:
```yaml
Pool 1: stratum+tcp://pool.example.com:3333
User: your_wallet.worker_name
Password: x
```

**7. Monitor Over Time**

Watch rejection rate in Grafana:
```
http://192.168.1.66:3001/d/per-miner-details
```

Look for patterns:
- Time of day (network congestion?)
- Specific pool (pool issue?)
- After events (temperature spike?)

---

## Recommended Actions

### Immediate Actions:

**1. For EN-S19Pro-064 (25% max):**
```bash
# Check if currently having issues
curl http://localhost:5000/api/mining/stats | jq '.miners[] | select(.ip=="192.168.1.64")'

# If rejection rate is currently high, reboot
curl -X POST http://localhost:5000/api/mining/miners/miner-192-168-1-64/reboot
```

**2. Monitor Network Quality:**
```bash
# Install mtr for better network diagnostics
sudo apt-get install mtr

# Run continuous monitoring to pool
mtr -r -c 100 pool.example.com
```

**3. Check Pool Status:**
- Visit pool website
- Check pool status page
- Verify no maintenance
- Check pool hashrate (if pool hashrate dropped, might be under attack)

### Long-term Solutions:

**1. Add Rejection Rate Alert Levels:**

Edit `mining_alerts.yml`:
```yaml
# Critical: Very high rejection rate
- alert: MinerRejectionRateCritical
  expr: |
    (
      rate(miner_pool_rejected_total[5m]) / 
      (rate(miner_pool_accepted_total[5m]) + rate(miner_pool_rejected_total[5m]))
    ) > 0.10
  for: 5m
  labels:
    severity: critical
    component: miner
  annotations:
    summary: "Miner {{ $labels.name }} rejection rate critical"
    description: "Miner {{ $labels.name }} rejection rate is {{ $value | humanizePercentage }} (threshold: 10%)"
```

**2. Configure Backup Pools:**

Ensure all miners have backup pools configured:
```yaml
Pool 1: stratum+tcp://primary-pool.com:3333
Pool 2: stratum+tcp://backup-pool.com:3333
Pool 3: stratum+tcp://backup2-pool.com:3333
```

**3. Network Quality Monitoring:**

Add network latency monitoring:
```yaml
# Prometheus blackbox exporter
- job_name: 'pool_latency'
  metrics_path: /probe
  params:
    module: [icmp]
  static_configs:
    - targets:
      - pool.example.com
```

**4. Set Per-Miner Rejection Thresholds:**

In `miners.yaml`:
```yaml
miners:
  - ip: 192.168.1.64
    name: miner-192-168-1-64
    alias: EN-S19Pro-064
    model: S19 Pro
    
    thresholds:
      rejectionRate:
        warning: 2    # Alert at 2%
        critical: 5   # Critical at 5%
```

---

## Understanding Rejection Rate

### What is Normal?

| Rejection Rate | Status | Action |
|----------------|--------|--------|
| **0-1%** | 🟢 Excellent | None needed |
| **1-2%** | 🟢 Good | Monitor |
| **2-5%** | 🟡 Warning | Investigate |
| **5-10%** | 🟠 High | Take action |
| **>10%** | 🔴 Critical | Immediate action |

### Why Rejection Matters:

**Impact on Profitability:**
```
Normal:     100 shares → 100 accepted → 100% profit
2% reject:  100 shares →  98 accepted →  98% profit
5% reject:  100 shares →  95 accepted →  95% profit
10% reject: 100 shares →  90 accepted →  90% profit
25% reject: 100 shares →  75 accepted →  75% profit ❌
```

**EN-S19Pro-064 at 25% rejection = 25% profit loss!**

---

## Monitoring Rejection Rate

### Grafana Dashboard

**Per-Miner Details:**
```
http://192.168.1.66:3001/d/per-miner-details
```

**Rejection Rate Chart shows:**
- Real-time rejection rate per miner
- Color-coded thresholds:
  - Green: <2%
  - Yellow: 2-5%
  - Red: >5%

### Telegram Monitoring

```bash
# Check specific miner
/miner miner-192-168-1-64

# View alerts
/alerts
```

### API Monitoring

```bash
# Get miner stats including rejection
curl http://localhost:5000/api/mining/stats | jq '.miners[] | {
  name: .name,
  ip: .ip,
  accepted: .shares.accepted,
  rejected: .shares.rejected,
  rejection_rate: (.shares.rejected / (.shares.accepted + .shares.rejected) * 100)
}'
```

---

## Diagnostic Commands

### Check Current Rejection Rate:

```bash
# Via Prometheus
curl -s 'http://localhost:9090/api/v1/query?query=100*(miner_pool_rejected_total/(miner_pool_accepted_total%2Bminer_pool_rejected_total))' | jq '.data.result[] | {name: .metric.name, rejection: .value[1]}'

# Via Grafana API
curl -s 'http://admin:<GF_SECURITY_ADMIN_PASSWORD>@192.168.1.66:3001/api/datasources/proxy/1/api/v1/query?query=100*(miner_pool_rejected_total/(miner_pool_accepted_total%2Bminer_pool_rejected_total))' | jq .
```

### Test Pool Connection:

```bash
# Test pool connectivity
telnet pool.example.com 3333

# Check DNS resolution
nslookup pool.example.com

# Check if pool is reachable
nc -zv pool.example.com 3333
```

### Check Miner Network:

```bash
# Ping miner
ping 192.168.1.64

# Check if miner web interface is accessible
curl -I http://192.168.1.64

# Check miner API
echo '{"command":"pools"}' | nc 192.168.1.64 4028
```

---

## Alert Configuration

### Current Alert:

**Threshold:** 5% for 10 minutes
**Severity:** Warning

### Recommended Enhancement:

```yaml
# Warning: 2% for 15 minutes
- alert: MinerRejectionRateWarning
  expr: |
    (
      rate(miner_pool_rejected_total[5m]) / 
      (rate(miner_pool_accepted_total[5m]) + rate(miner_pool_rejected_total[5m]))
    ) > 0.02
  for: 15m
  labels:
    severity: warning
  annotations:
    summary: "Miner {{ $labels.name }} rejection rate elevated"
    description: "Rejection rate: {{ $value | humanizePercentage }} (threshold: 2%)"

# Critical: 10% for 5 minutes
- alert: MinerRejectionRateCritical
  expr: |
    (
      rate(miner_pool_rejected_total[5m]) / 
      (rate(miner_pool_accepted_total[5m]) + rate(miner_pool_rejected_total[5m]))
    ) > 0.10
  for: 5m
  labels:
    severity: critical
  annotations:
    summary: "Miner {{ $labels.name }} rejection rate critical"
    description: "Rejection rate: {{ $value | humanizePercentage }} (threshold: 10%)"
```

---

## Summary

### Current Situation:

🔴 **EN-S19Pro-064**: Max 25% rejection - **NEEDS IMMEDIATE ATTENTION**
⚠️ **EN-S19KPro-115**: Max 10% rejection - Monitor closely
⚠️ **EN-S19-114**: Max 9% rejection - Monitor closely

### Likely Causes:

1. **Network latency** to pool (most common)
2. **Pool issues** (temporary overload)
3. **Local network problems** (switch/router)
4. **Miner configuration** (wrong pool settings)

### Immediate Actions:

1. **Check network latency** to pool
2. **Verify pool status** (not under maintenance/attack)
3. **Monitor EN-S19Pro-064** closely
4. **Consider rebooting** if rejection rate spikes again
5. **Test backup pool** to isolate issue

### Long-term Actions:

1. **Configure backup pools** on all miners
2. **Add network monitoring** (latency to pool)
3. **Set per-miner rejection thresholds**
4. **Add critical rejection alert** (>10%)
5. **Document pool performance** over time

### Quick Commands:

```bash
# Check current rejection rates
curl http://localhost:5000/api/mining/stats | jq '.miners[] | select(.ip=="192.168.1.64")'

# Reboot problematic miner
curl -X POST http://localhost:5000/api/mining/miners/miner-192-168-1-64/reboot

# Check pool connection
/pools miner-192-168-1-64

# Monitor in Grafana
http://192.168.1.66:3001/d/per-miner-details
```

**The 25% max rejection rate on EN-S19Pro-064 indicates a serious issue that needs investigation!** 🔴
