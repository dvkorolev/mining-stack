# Lessons from Old Whatsminer Script

## Overview

The old `whatsminer_textfile.py` script contains several **production-grade patterns** that demonstrate excellent operational practices. This document analyzes what makes it good and what we've already adopted in the current scheduler.

---

## 🏆 **Production-Grade Patterns Found**

### 1. **Atomic File Writes** ⭐⭐⭐⭐⭐

**Pattern:**
```python
with tempfile.NamedTemporaryFile("w", delete=False, dir=os.path.dirname(OUT)) as tmp:
    tmp.write("\n".join(lines) + "\n")
os.replace(tmp.name, OUT)
```

**Why It's Excellent:**
- ✅ **Atomic operation**: File is either fully written or not at all
- ✅ **No partial reads**: Consumers never see incomplete data
- ✅ **Crash-safe**: If script crashes mid-write, old file remains intact
- ✅ **Race-condition free**: `os.replace()` is atomic on POSIX systems

**Use Cases:**
- Writing Prometheus textfile exports
- Writing configuration files
- Any file that must be consistent when read

**Current Scheduler Status:**
- ❌ Not needed currently (we use in-memory Prometheus metrics)
- ✅ Good pattern to remember for future textfile exports

---

### 2. **Smart Response Parsing with Heuristics** ⭐⭐⭐⭐

**Pattern:**
```python
buf = b""
while True:
    chunk = s.recv(8192)
    if not chunk: break
    buf += chunk
    # Simple heuristic: we got the full JSON
    if buf.strip().endswith(b'}'):
        break
```

**Why It's Smart:**
- ✅ Doesn't wait for connection close (faster)
- ✅ Detects complete JSON early
- ✅ Reduces timeout delays
- ✅ More responsive to fast miners

**Current Scheduler Status:**
- ⚠️ Uses fixed timeouts (10s)
- 💡 Could benefit from this heuristic for faster collection

**Potential Improvement:**
```python
async def _cgminer_command(ip: str, command: str) -> Optional[Dict]:
    reader, writer = await asyncio.open_connection(ip, 4028)
    writer.write(json.dumps({"command": command}).encode())
    await writer.drain()
    
    buf = b""
    while True:
        try:
            chunk = await asyncio.wait_for(reader.read(8192), timeout=1.0)
            if not chunk: break
            buf += chunk
            # Early exit if we have complete JSON
            if buf.strip().endswith(b'}'):
                break
        except asyncio.TimeoutError:
            break  # Got all data
    
    writer.close()
    await writer.wait_closed()
    return json.loads(buf.decode().strip('\x00'))
```

---

### 3. **Flexible Field Lookup with Fallbacks** ⭐⭐⭐⭐⭐

**Pattern:**
```python
def pick_summary(r):
    if isinstance(r.get("SUMMARY"), list) and r["SUMMARY"]: 
        return r["SUMMARY"][0]
    if isinstance(r.get("Msg"), dict): 
        return r["Msg"]
    if isinstance(r.get("result"), dict): 
        return r["result"]
    return {}
```

**Why It's Robust:**
- ✅ Handles multiple API response formats
- ✅ Never crashes on unexpected structure
- ✅ Graceful degradation
- ✅ Works with Antminer, Whatsminer, DG1+

**Current Scheduler Status:**
- ✅ **Already implemented!** See `_parse_cgminer_response()` lines 258-262:
```python
summary_data = None
if summary:
    if 'SUMMARY' in summary and len(summary['SUMMARY']) > 0:
        summary_data = summary['SUMMARY'][0]
    elif 'Msg' in summary and isinstance(summary['Msg'], dict):
        summary_data = summary['Msg']
```

---

### 4. **Separate Commands for Reliability** ⭐⭐⭐⭐

**Pattern:**
```python
# Two separate socket connections
r_sum = call_cmd(ip, "summary")   # First connection
r_pools = call_cmd(ip, "pools")   # Second connection
```

**Why It's Better:**
- ✅ If one command hangs, doesn't block the other
- ✅ Easier to debug which command failed
- ✅ More resilient to partial failures
- ✅ Can parallelize requests

**Current Scheduler Status:**
- ✅ **Already implemented!** See `collect_pyasic_metrics()` lines 377-379:
```python
stats = await _cgminer_command(ip, "stats")
summary = await _cgminer_command(ip, "summary")
pools = await _cgminer_command(ip, "pools")
```

---

### 5. **Safe Float Conversion** ⭐⭐⭐

**Pattern:**
```python
def f(v, d=0.0):
    try: 
        x = float(v)
        return d if x != x else x  # Check for NaN
    except: 
        return d
```

**Why It's Safe:**
- ✅ Never crashes on bad data
- ✅ Handles None, empty strings, invalid numbers
- ✅ Checks for NaN (x != x is True for NaN)
- ✅ Provides sensible defaults

**Current Scheduler Status:**
- ⚠️ Uses direct `float()` calls with `.get(key, 0)`
- 💡 Could benefit from this safer pattern

---

## 📊 **Comparison: Old vs Current**

| Feature | Old Script | Current Scheduler | Winner |
|---------|-----------|-------------------|--------|
| **Atomic Writes** | ✅ tempfile + os.replace | N/A (in-memory) | Old (for textfiles) |
| **Response Parsing** | ✅ Heuristic early-exit | ⚠️ Fixed timeout | Old |
| **Field Fallbacks** | ✅ Multiple formats | ✅ Multiple formats | **Tie** |
| **Separate Commands** | ✅ Independent calls | ✅ Independent calls | **Tie** |
| **Safe Float Conversion** | ✅ NaN-aware | ⚠️ Basic | Old |
| **Async/Await** | ❌ Synchronous | ✅ Fully async | **Current** |
| **Batch Collection** | ❌ Sequential | ✅ Parallel | **Current** |
| **Gap Filling** | ❌ None | ✅ Smart merge | **Current** |
| **Error Diagnostics** | ⚠️ Basic | ✅ Detailed codes | **Current** |
| **Prometheus Integration** | ⚠️ Textfile | ✅ Native client | **Current** |

---

## 💡 **Recommended Improvements**

### Priority 1: Add Smart Response Parsing
```python
# Add to scheduler.py
async def _cgminer_command_smart(ip: str, command: str) -> Optional[Dict]:
    """Send cgminer command with smart early-exit parsing"""
    try:
        reader, writer = await asyncio.open_connection(ip, 4028)
        writer.write(json.dumps({"command": command}).encode())
        await writer.drain()
        
        buf = b""
        while True:
            try:
                chunk = await asyncio.wait_for(reader.read(8192), timeout=1.0)
                if not chunk: break
                buf += chunk
                # Early exit if complete JSON detected
                if buf.strip().endswith(b'}'):
                    break
            except asyncio.TimeoutError:
                break  # No more data
        
        writer.close()
        await writer.wait_closed()
        
        response_str = buf.decode().strip('\x00')
        return json.loads(response_str)
        
    except Exception:
        return None
```

**Benefit**: Faster collection (especially for fast-responding miners)

---

### Priority 2: Add Safe Float Conversion
```python
# Add to scheduler.py
def safe_float(value: Any, default: float = 0.0) -> float:
    """Safely convert value to float, handling None, NaN, and invalid data"""
    try:
        x = float(value)
        return default if x != x else x  # NaN check
    except (TypeError, ValueError):
        return default
```

**Benefit**: More robust against bad miner data

---

### Priority 3: Add Atomic File Export (Future)
```python
# For future textfile export feature
import tempfile

def export_metrics_atomic(metrics: str, output_path: str):
    """Atomically write metrics to file"""
    output_dir = os.path.dirname(output_path)
    with tempfile.NamedTemporaryFile("w", delete=False, dir=output_dir) as tmp:
        tmp.write(metrics)
        tmp.flush()
        os.fsync(tmp.fileno())  # Ensure written to disk
    os.replace(tmp.name, output_path)
```

**Benefit**: Safe textfile exports for Node Exporter compatibility

---

## 🎓 **Key Takeaways**

1. **Atomic operations matter**: Use tempfile + os.replace for file writes
2. **Heuristics reduce latency**: Don't always wait for timeouts
3. **Defensive programming wins**: Handle multiple formats, check for NaN
4. **Separate concerns**: Independent commands are more resilient
5. **Current scheduler is excellent**: Already implements most best practices

---

## 🚀 **Next Steps**

1. ✅ Document these patterns (this file)
2. ⏳ Consider adding smart response parsing (Priority 1)
3. ⏳ Consider adding safe float conversion (Priority 2)
4. ⏳ Keep atomic file pattern for future textfile export feature

---

**Created**: 2025-11-03  
**Source**: Analysis of `/opt/miner-monitor-OLD/bin/whatsminer_textfile.py`  
**Current Scheduler**: `/python-scheduler/scheduler.py`
