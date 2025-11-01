# Job Runner Pattern

## Overview

The **Job Runner Service** implements a generalized, secure pattern for executing predefined Python scripts via API. This is superior to creating individual endpoints for each task.

## Architecture

```
┌─────────────────────────────────────┐
│  Frontend (React)                   │
│  - Buttons for various tasks        │
└─────────────────────────────────────┘
           ↓ HTTP Request
┌─────────────────────────────────────┐
│  Backend (Node.js)                  │
│  - Validates user permissions       │
│  - Acts as secure API gateway       │
└─────────────────────────────────────┘
           ↓ POST /run {"job": "..."}
┌─────────────────────────────────────┐
│  Job Runner Service (Python)        │
│  - Single /run endpoint             │
│  - Validates job against allowlist  │
│  - Executes corresponding script    │
│  - Returns result                   │
└─────────────────────────────────────┘
           ↓ Executes
┌─────────────────────────────────────┐
│  Python Scripts (/bin)              │
│  - farm_init.py                     │
│  - reboot_miner.py                  │
│  - update_pools.py                  │
│  - etc.                             │
└─────────────────────────────────────┘
```

## Why Job Runner Pattern?

### ❌ Bad: Task-Specific Endpoints

```python
@app.post("/discover")
async def discover_miners():
    # Hard-coded logic
    
@app.post("/reboot")
async def reboot_miner():
    # Hard-coded logic
    
@app.post("/update_pools")
async def update_pools():
    # Hard-coded logic
```

**Problems:**
- New endpoint for every task
- Duplicated code
- Hard to maintain
- No standardization

### ✅ Good: Job Runner Pattern

```python
# Single endpoint
@app.post("/run")
async def run_job(request: JobRequest):
    # Validates job against allowlist
    # Executes corresponding script
    # Returns standardized response
```

**Benefits:**
- Single endpoint to maintain
- Easy to add new jobs
- Standardized interface
- Secure by design

## Allowlist Configuration

The allowlist defines which jobs can be executed:

```python
JOB_ALLOWLIST = {
    'discover_miners': {
        'scripts': ['/app/bin/farm_init.py'],
        'description': 'Discover miners on network',
        'timeout': 180
    },
    'collect_metrics': {
        'scripts': [
            '/app/bin/pyasic_textfile.py',
            '/app/bin/universal_miner_collector.py'
        ],
        'description': 'Collect metrics from all miners',
        'timeout': 120
    },
    'reboot_miner': {
        'scripts': ['/app/bin/reboot_miner.py'],
        'description': 'Reboot a specific miner',
        'timeout': 60,
        'requires_args': True
    }
}
```

### Allowlist Properties

| Property | Type | Description |
|----------|------|-------------|
| `scripts` | list | Python scripts to execute |
| `description` | string | Human-readable description |
| `timeout` | int | Max execution time (seconds) |
| `requires_args` | bool | Whether job needs arguments |

## API Reference

### POST /run

Execute a job from the allowlist.

**Request:**
```json
{
  "job": "discover_miners"
}
```

**With Arguments:**
```json
{
  "job": "reboot_miner",
  "args": {
    "miner_name": "miner-1"
  }
}
```

**Response:**
```json
{
  "success": true,
  "job": "discover_miners",
  "message": "Job completed successfully",
  "duration": 12.5,
  "output": "Found 23 miners..."
}
```

**Error Response:**
```json
{
  "success": false,
  "job": "discover_miners",
  "message": "Job failed",
  "duration": 5.2,
  "error": "Network unreachable"
}
```

### GET /jobs

List all available jobs.

**Response:**
```json
{
  "jobs": {
    "discover_miners": {
      "description": "Discover miners on network",
      "timeout": 180,
      "requires_args": false
    },
    "reboot_miner": {
      "description": "Reboot a specific miner",
      "timeout": 60,
      "requires_args": true
    }
  }
}
```

### GET /health

Health check endpoint.

**Response:**
```json
{
  "status": "healthy"
}
```

## Usage Examples

### From Frontend (React)

```typescript
// Discover miners
const discoverMiners = async () => {
  const response = await fetch('/api/jobs/run', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ job: 'discover_miners' })
  });
  const result = await response.json();
  return result;
};

// Reboot miner with args
const rebootMiner = async (minerName: string) => {
  const response = await fetch('/api/jobs/run', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      job: 'reboot_miner',
      args: { miner_name: minerName }
    })
  });
  const result = await response.json();
  return result;
};
```

### From Backend (Node.js)

```typescript
// Backend acts as secure gateway
const discoverMiners = async () => {
  const jobRunnerUrl = 'http://python-scheduler:8000';
  const response = await fetch(`${jobRunnerUrl}/run`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ job: 'discover_miners' })
  });
  return await response.json();
};
```

### From Command Line

```bash
# Discover miners
curl -X POST http://localhost:8000/run \
  -H "Content-Type: application/json" \
  -d '{"job": "discover_miners"}'

# Reboot miner
curl -X POST http://localhost:8000/run \
  -H "Content-Type: application/json" \
  -d '{"job": "reboot_miner", "args": {"miner_name": "miner-1"}}'

# List available jobs
curl http://localhost:8000/jobs
```

## Security

### Allowlist Protection

**Only jobs in the allowlist can execute:**
```python
if job_name not in JOB_ALLOWLIST:
    raise HTTPException(
        status_code=400,
        detail=f"Job '{job_name}' not found"
    )
```

**No arbitrary script execution:**
- Scripts must be predefined in allowlist
- No user-provided script paths
- No command injection possible

### Timeout Protection

Each job has a maximum execution time:
```python
result = subprocess.run(
    cmd,
    timeout=job_config['timeout']
)
```

### Argument Validation

Jobs can require arguments:
```python
if job_config.get('requires_args', False) and not job_args:
    raise HTTPException(
        status_code=400,
        detail=f"Job '{job_name}' requires arguments"
    )
```

## Adding New Jobs

To add a new job, simply update the allowlist:

```python
JOB_ALLOWLIST = {
    # ... existing jobs ...
    
    'update_firmware': {
        'scripts': ['/app/bin/update_firmware.py'],
        'description': 'Update miner firmware',
        'timeout': 300,
        'requires_args': True
    }
}
```

**That's it!** No new endpoints needed.

## Future: Async Jobs

For long-running tasks, the pattern can evolve:

### Phase 1: Synchronous (Current)
```
POST /run → Wait for completion → Return result
```

### Phase 2: Asynchronous (Future)
```
POST /run → Return 202 Accepted + jobId
GET /jobs/{jobId} → Check status
WebSocket → Push completion notification
```

**Implementation:**
```python
@app.post("/run")
async def run_job(request: JobRequest):
    job_id = str(uuid.uuid4())
    
    # Start job in background
    asyncio.create_task(execute_job(job_id, request))
    
    # Return immediately
    return {
        "job_id": job_id,
        "status": "running"
    }

@app.get("/jobs/{job_id}")
async def get_job_status(job_id: str):
    return job_status_db[job_id]
```

## Comparison

### Before: Multiple Services

```
discover-service → farm_init.py
reboot-service → reboot_miner.py
update-service → update_pools.py
```

**Problems:**
- 3 services to maintain
- 3 Dockerfiles
- 3 sets of dependencies
- Complex orchestration

### After: Single Job Runner

```
job-runner → {
  discover_miners: farm_init.py
  reboot_miner: reboot_miner.py
  update_pools: update_pools.py
}
```

**Benefits:**
- 1 service to maintain
- 1 Dockerfile
- 1 set of dependencies
- Simple orchestration

## Best Practices

### 1. Keep Scripts Separate

```
✅ Good:
job-runner/scheduler.py → Orchestration
bin/farm_init.py → Business logic

❌ Bad:
job-runner/scheduler.py → Everything mixed
```

### 2. Use Allowlist

```
✅ Good:
JOB_ALLOWLIST = {'discover_miners': {...}}

❌ Bad:
@app.post("/run/{script_name}")  # Arbitrary execution
```

### 3. Validate Arguments

```
✅ Good:
if job_config.get('requires_args') and not args:
    raise HTTPException(...)

❌ Bad:
# No validation, pass args blindly
```

### 4. Set Timeouts

```
✅ Good:
'timeout': 180  # 3 minutes max

❌ Bad:
# No timeout, can hang forever
```

### 5. Return Structured Responses

```
✅ Good:
{
  "success": true,
  "job": "discover_miners",
  "duration": 12.5,
  "output": "..."
}

❌ Bad:
"Success"  # Unstructured string
```

## Summary

The **Job Runner Pattern** is:
- ✅ **Secure** - Allowlist-based, no arbitrary execution
- ✅ **Scalable** - Easy to add new jobs
- ✅ **Maintainable** - Single endpoint, standardized
- ✅ **Reusable** - Works for any Python script
- ✅ **Self-documenting** - `/jobs` endpoint lists capabilities

**One service to rule them all!** 🎯
