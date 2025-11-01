# API Call Flow Documentation

## Overview

This document maps all API calls from Frontend → Backend → Job Runner → Scripts.

## Call Flow Diagram

```
┌─────────────────────────────────────────────────────────────┐
│                        FRONTEND                              │
│                      (React/TypeScript)                      │
└─────────────────────────────────────────────────────────────┘
                           ↓
                    HTTP Requests
                           ↓
┌─────────────────────────────────────────────────────────────┐
│                        BACKEND                               │
│                      (Node.js/Express)                       │
│  - API Gateway                                               │
│  - Authentication                                            │
│  - Business Logic                                            │
└─────────────────────────────────────────────────────────────┘
                           ↓
              ┌────────────┴────────────┐
              ↓                         ↓
    Direct HTTP Calls          POST /run {"job": "..."}
    (to miners)                        ↓
                        ┌──────────────────────────────┐
                        │     JOB RUNNER SERVICE       │
                        │     (Python/FastAPI)         │
                        │  - Validates against allowlist│
                        │  - Executes Python scripts   │
                        └──────────────────────────────┘
                                       ↓
                              Python Scripts
                              (/bin/*.py)
```

## 1. Miner Discovery Flow

### Frontend → Backend → Job Runner → Script

```
┌──────────────────────────────────────────────────────────────┐
│ 1. Frontend: User clicks "Auto Discover" button             │
└──────────────────────────────────────────────────────────────┘
                           ↓
┌──────────────────────────────────────────────────────────────┐
│ frontend/src/services/api.ts                                 │
│ export const discoverMiners = async () => {                  │
│   const response = await api.post('/mining/discover');       │
│   return response.data;                                      │
│ }                                                             │
└──────────────────────────────────────────────────────────────┘
                           ↓
                  POST /api/mining/discover
                           ↓
┌──────────────────────────────────────────────────────────────┐
│ backend/src/routes/mining.routes.ts                          │
│ router.post('/mining/discover', async (req, res, next) => {  │
│   const result = await discoverMiners();                     │
│   res.json(result);                                          │
│ });                                                           │
└──────────────────────────────────────────────────────────────┘
                           ↓
┌──────────────────────────────────────────────────────────────┐
│ backend/src/services/mining.service.ts                       │
│ const discoverMiners = async () => {                         │
│   const response = await fetch(                              │
│     'http://python-scheduler:8000/run',                      │
│     {                                                         │
│       method: 'POST',                                        │
│       body: JSON.stringify({ job: 'discover_miners' })       │
│     }                                                         │
│   );                                                          │
│   return response.json();                                    │
│ }                                                             │
└──────────────────────────────────────────────────────────────┘
                           ↓
              POST http://python-scheduler:8000/run
              Body: {"job": "discover_miners"}
                           ↓
┌──────────────────────────────────────────────────────────────┐
│ python-scheduler/scheduler.py                                │
│ @app.post("/run")                                            │
│ async def run_job(request: JobRequest):                      │
│   # Validate against allowlist                              │
│   if job_name not in JOB_ALLOWLIST:                          │
│     raise HTTPException(400)                                 │
│                                                               │
│   # Execute script                                           │
│   subprocess.run(['python3', '/app/bin/farm_init.py'])       │
└──────────────────────────────────────────────────────────────┘
                           ↓
┌──────────────────────────────────────────────────────────────┐
│ bin/farm_init.py                                             │
│ - Scans network for miners using pyasic                      │
│ - Writes discovered miners to etc/miners.yaml                │
└──────────────────────────────────────────────────────────────┘
```

**Status:** ✅ Correctly uses Job Runner pattern

---

## 2. Miner Reboot Flow

### Frontend → Backend → Miner (Direct HTTP)

```
┌──────────────────────────────────────────────────────────────┐
│ 1. Frontend: User clicks "Reboot" button                    │
└──────────────────────────────────────────────────────────────┘
                           ↓
┌──────────────────────────────────────────────────────────────┐
│ frontend/src/services/api.ts                                 │
│ export const rebootMiner = async (minerId: string) => {      │
│   const response = await api.post(                           │
│     `/mining/miners/${minerId}/reboot`                       │
│   );                                                          │
│   return response.data;                                      │
│ }                                                             │
└──────────────────────────────────────────────────────────────┘
                           ↓
            POST /api/mining/miners/:minerId/reboot
                           ↓
┌──────────────────────────────────────────────────────────────┐
│ backend/src/routes/mining.routes.ts                          │
│ router.post('/mining/miners/:minerId/reboot', ...) => {      │
│   const result = await rebootMiner(minerId);                 │
│   res.json(result);                                          │
│ });                                                           │
└──────────────────────────────────────────────────────────────┘
                           ↓
┌──────────────────────────────────────────────────────────────┐
│ backend/src/services/miner-control.service.ts                │
│ export const rebootMiner = async (minerId: string) => {      │
│   const miner = getMinerById(minerId);                       │
│                                                               │
│   // Direct HTTP to miner                                    │
│   await axios.get(`http://${miner.ip}/cgi-bin/reboot.cgi`);  │
│ }                                                             │
└──────────────────────────────────────────────────────────────┘
                           ↓
                  Direct HTTP to Miner
                  http://192.168.1.100/cgi-bin/reboot.cgi
```

**Status:** ✅ Correct - Direct HTTP is appropriate for simple API calls

**Note:** Could optionally use Job Runner if you want to:
- Add retry logic
- Log reboots centrally
- Run pre/post reboot scripts

---

## 3. Get Miner Pools Flow

### Frontend → Backend → Miner (Direct HTTP)

```
┌──────────────────────────────────────────────────────────────┐
│ 1. Frontend: User views pool configuration                  │
└──────────────────────────────────────────────────────────────┘
                           ↓
┌──────────────────────────────────────────────────────────────┐
│ frontend/src/services/api.ts                                 │
│ export const getMinerPools = async (minerId: string) => {    │
│   const response = await api.get(                            │
│     `/mining/miners/${minerId}/pools`                        │
│   );                                                          │
│   return response.data;                                      │
│ }                                                             │
└──────────────────────────────────────────────────────────────┘
                           ↓
            GET /api/mining/miners/:minerId/pools
                           ↓
┌──────────────────────────────────────────────────────────────┐
│ backend/src/routes/mining.routes.ts                          │
│ router.get('/mining/miners/:minerId/pools', ...) => {        │
│   const result = await getMinerPools(minerId);               │
│   res.json(result);                                          │
│ });                                                           │
└──────────────────────────────────────────────────────────────┘
                           ↓
┌──────────────────────────────────────────────────────────────┐
│ backend/src/services/miner-control.service.ts                │
│ export const getMinerPools = async (minerId: string) => {    │
│   const miner = getMinerById(minerId);                       │
│                                                               │
│   // Direct HTTP to miner                                    │
│   const response = await axios.get(                          │
│     `http://${miner.ip}/cgi-bin/pools.cgi`                   │
│   );                                                          │
│   return response.data;                                      │
│ }                                                             │
└──────────────────────────────────────────────────────────────┘
                           ↓
                  Direct HTTP to Miner
                  http://192.168.1.100/cgi-bin/pools.cgi
```

**Status:** ✅ Correct - Direct HTTP for simple queries

---

## 4. Metrics Collection Flow (Automatic)

### Scheduled → Job Runner → Scripts

```
┌──────────────────────────────────────────────────────────────┐
│ python-scheduler/scheduler.py                                │
│ schedule.every(2).minutes.do(collect_metrics)                │
└──────────────────────────────────────────────────────────────┘
                           ↓
                    Every 2 minutes
                           ↓
┌──────────────────────────────────────────────────────────────┐
│ def collect_metrics():                                       │
│   # Run pyasic collector                                     │
│   subprocess.run(['python3', '/app/bin/pyasic_textfile.py']) │
│                                                               │
│   # Run universal collector                                  │
│   subprocess.run([                                           │
│     'python3',                                               │
│     '/app/bin/universal_miner_collector.py'                  │
│   ])                                                          │
└──────────────────────────────────────────────────────────────┘
                           ↓
┌──────────────────────────────────────────────────────────────┐
│ bin/pyasic_textfile.py                                       │
│ - Collects metrics from ASIC miners using pyasic             │
│ - Writes to /metrics/pyasic_metrics.prom                     │
└──────────────────────────────────────────────────────────────┘
                           ↓
┌──────────────────────────────────────────────────────────────┐
│ bin/universal_miner_collector.py                             │
│ - Collects metrics from all miner types via HTTP             │
│ - Writes to /metrics/universal_metrics.prom                  │
└──────────────────────────────────────────────────────────────┘
                           ↓
                  Shared Docker Volume
                  /metrics/*.prom
                           ↓
┌──────────────────────────────────────────────────────────────┐
│ Node Exporter                                                │
│ - Reads .prom files                                          │
│ - Exposes on :9100/metrics                                   │
└──────────────────────────────────────────────────────────────┘
                           ↓
┌──────────────────────────────────────────────────────────────┐
│ Prometheus                                                   │
│ - Scrapes Node Exporter every 15s                            │
│ - Stores time-series data                                    │
└──────────────────────────────────────────────────────────────┘
```

**Status:** ✅ Correct - Scheduled collection via Job Runner

---

## 5. Manual Metrics Collection Flow

### Frontend → Backend → Job Runner → Scripts

```
┌──────────────────────────────────────────────────────────────┐
│ 1. Frontend: User clicks "Collect Now" button               │
└──────────────────────────────────────────────────────────────┘
                           ↓
┌──────────────────────────────────────────────────────────────┐
│ frontend/src/services/api.ts                                 │
│ export const collectMetrics = async () => {                  │
│   const response = await api.post('/metrics/collect');       │
│   return response.data;                                      │
│ }                                                             │
└──────────────────────────────────────────────────────────────┘
                           ↓
                  POST /api/metrics/collect
                           ↓
┌──────────────────────────────────────────────────────────────┐
│ backend/src/routes/metrics.routes.ts                         │
│ router.post('/metrics/collect', async (req, res) => {        │
│   const response = await fetch(                              │
│     'http://python-scheduler:8000/run',                      │
│     {                                                         │
│       method: 'POST',                                        │
│       body: JSON.stringify({ job: 'collect_metrics' })       │
│     }                                                         │
│   );                                                          │
│   res.json(await response.json());                           │
│ });                                                           │
└──────────────────────────────────────────────────────────────┘
                           ↓
              POST http://python-scheduler:8000/run
              Body: {"job": "collect_metrics"}
                           ↓
┌──────────────────────────────────────────────────────────────┐
│ python-scheduler/scheduler.py                                │
│ @app.post("/run")                                            │
│ async def run_job(request: JobRequest):                      │
│   # Validate and execute                                     │
│   subprocess.run(['python3', '/app/bin/pyasic_textfile.py']) │
│   subprocess.run([                                           │
│     'python3',                                               │
│     '/app/bin/universal_miner_collector.py'                  │
│   ])                                                          │
└──────────────────────────────────────────────────────────────┘
```

**Status:** ⚠️ **MISSING** - Backend route doesn't exist yet

---

## Summary Table

| Feature | Frontend Call | Backend Route | Backend Service | Job Runner | Direct HTTP |
|---------|---------------|---------------|-----------------|------------|-------------|
| **Discover Miners** | `POST /mining/discover` | ✅ Exists | ✅ Calls Job Runner | ✅ `/run {"job": "discover_miners"}` | - |
| **Reboot Miner** | `POST /mining/miners/:id/reboot` | ✅ Exists | ✅ Direct HTTP | - | ✅ To miner |
| **Get Pools** | `GET /mining/miners/:id/pools` | ✅ Exists | ✅ Direct HTTP | - | ✅ To miner |
| **Update Pools** | `PUT /mining/miners/:id/pools` | ✅ Exists | ✅ Direct HTTP | - | ✅ To miner |
| **Collect Metrics (Auto)** | - | - | - | ✅ Scheduled | - |
| **Collect Metrics (Manual)** | ❌ Missing | ❌ Missing | - | ✅ Ready | - |

---

## Issues Found

### ✅ Working Correctly

1. **Miner Discovery** - Uses Job Runner pattern
2. **Miner Reboot** - Direct HTTP (appropriate)
3. **Pool Management** - Direct HTTP (appropriate)
4. **Auto Metrics Collection** - Scheduled in Job Runner

### ⚠️ Missing Features

1. **Manual Metrics Collection Endpoint**
   - Job Runner is ready: `POST /run {"job": "collect_metrics"}`
   - Backend route missing
   - Frontend button could trigger it

---

## Recommendations

### 1. Add Manual Metrics Collection

**Backend Route:**
```typescript
// backend/src/routes/metrics.routes.ts
router.post('/metrics/collect', async (req, res, next) => {
  try {
    const jobRunnerUrl = process.env.JOB_RUNNER_URL || 'http://python-scheduler:8000';
    const response = await fetch(`${jobRunnerUrl}/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ job: 'collect_metrics' })
    });
    const result = await response.json();
    res.json(result);
  } catch (error) {
    next(error);
  }
});
```

**Frontend API:**
```typescript
// frontend/src/services/api.ts
export const collectMetrics = async () => {
  const response = await api.post('/metrics/collect');
  return response.data;
};
```

### 2. Optional: Move Reboot to Job Runner

If you want centralized logging and retry logic:

**Add to Job Runner allowlist:**
```python
'reboot_miner': {
    'scripts': ['/app/bin/reboot_miner.py'],
    'timeout': 60,
    'requires_args': True
}
```

**Backend calls:**
```typescript
const response = await fetch(`${jobRunnerUrl}/run`, {
  method: 'POST',
  body: JSON.stringify({
    job: 'reboot_miner',
    args: { miner_id: minerId }
  })
});
```

---

## Environment Variables

| Service | Variable | Default | Purpose |
|---------|----------|---------|---------|
| Backend | `JOB_RUNNER_URL` | `http://python-scheduler:8000` | Job Runner service URL |
| Job Runner | `METRICS_DIR` | `/metrics` | Metrics output directory |
| Job Runner | `COLLECTION_INTERVAL` | `2` | Minutes between collections |

---

## Testing Commands

### Test Discovery
```bash
# From frontend
curl -X POST http://localhost:5000/api/mining/discover

# Direct to Job Runner
curl -X POST http://localhost:8000/run \
  -H "Content-Type: application/json" \
  -d '{"job": "discover_miners"}'
```

### Test Reboot
```bash
# From frontend
curl -X POST http://localhost:5000/api/mining/miners/miner-1/reboot
```

### Test Manual Collection
```bash
# Direct to Job Runner (backend route missing)
curl -X POST http://localhost:8000/run \
  -H "Content-Type: application/json" \
  -d '{"job": "collect_metrics"}'
```

### List Available Jobs
```bash
curl http://localhost:8000/jobs
```

---

## Conclusion

**Current Status:** ✅ **Architecture is correct**

- Discovery uses Job Runner ✅
- Reboot uses direct HTTP ✅ (appropriate for simple calls)
- Metrics collection scheduled ✅
- Job Runner pattern implemented ✅

**Optional Improvements:**
- Add manual metrics collection endpoint
- Consider moving reboot to Job Runner for centralized logging

**No critical issues found!** 🎯
