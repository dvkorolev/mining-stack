# Configuration Alignment Guide

## miners.yaml Structure

### Required Fields (All Collectors)

```yaml
miners:
  - ip: "192.168.1.100"      # Required: Miner IP address
    name: "miner-01"          # Required: Unique identifier
    model: "Antminer S19"     # Required: Model name for driver selection
```

### Optional Fields (Collector-Specific)

```yaml
miners:
  - ip: "192.168.1.100"
    name: "miner-01"
    model: "Antminer S19"
    
    # Optional fields:
    alias: "Main Rig 1"       # Friendly display name (defaults to name)
    api_port: 4028            # Custom CGMiner API port (default: 4028)
    username: "root"          # For Antminer CGI fallback (default: 'root')
    password: "root"          # For Antminer CGI fallback (default: 'root')
```

---

## Collector Field Usage

### 1. PyASIC Collector (Primary)
**File**: `collectors/pyasic_collector.py`

**Required Fields**:
- `ip` - Miner IP address
- `name` - Miner identifier
- `model` - For SCRYPT detection and logging

**Optional Fields**:
- `api_port` - Custom CGMiner API port for gap filling (default: 4028)

**Usage**:
```python
ip = miner_config['ip']
name = miner_config['name']
model = miner_config['model']
api_port = miner_config.get('api_port', 4028)
```

---

### 2. Antminer CGI Collector (Fallback)
**File**: `collectors/antminer_cgi_collector.py`

**Required Fields**:
- `ip` - Miner IP address

**Optional Fields**:
- `username` - HTTP digest auth username (default: 'root')
- `password` - HTTP digest auth password (default: 'root')

**Usage**:
```python
ip = miner_config.get('ip')
username = miner_config.get('username', 'root')
password = miner_config.get('password', 'root')
```

**Triggered When**:
- Primary collection fails (scrape_status < 1)
- Model contains: 'antminer', 's19', or 's17'

---

### 3. DG1 TCP Collector (Fallback)
**File**: `collectors/dg1_tcp_collector.py`

**Required Fields**:
- `ip` - Miner IP address

**Optional Fields**:
- None (uses hardcoded port 4028 and custom protocol)

**Usage**:
```python
ip = miner_config.get('ip')
```

**Triggered When**:
- Primary collection fails (scrape_status < 1)
- Model contains: 'dg1'

---

## Configuration Examples

### Example 1: Standard Antminer (PyASIC Only)
```yaml
miners:
  - ip: "192.168.1.100"
    name: "s19-01"
    model: "Antminer S19j Pro"
    alias: "Main Mining Rig"
```

**Collection Flow**:
1. PyASIC attempts connection
2. If successful: scrape_status = 2
3. If gaps found: CGMiner fills gaps (port 4028)

---

### Example 2: Antminer with CGI Fallback
```yaml
miners:
  - ip: "192.168.1.101"
    name: "s19-02"
    model: "Antminer S19"
    username: "admin"
    password: "secret123"
```

**Collection Flow**:
1. PyASIC attempts connection
2. If fails: Antminer CGI fallback triggered
3. Uses HTTP digest auth with provided credentials
4. If successful: scrape_status = 0.5

---

### Example 3: Antminer with Custom API Port
```yaml
miners:
  - ip: "192.168.1.102"
    name: "s19-03"
    model: "Antminer S19 XP"
    api_port: 4029
    username: "root"
    password: "root"
```

**Collection Flow**:
1. PyASIC attempts connection
2. Gap filling uses port 4029 instead of 4028
3. If PyASIC fails: CGI fallback with credentials

---

### Example 4: DG1 SCRYPT Miner
```yaml
miners:
  - ip: "192.168.1.103"
    name: "dg1-01"
    model: "ElphaPex DG1"
    alias: "DG1 Litecoin Miner"
```

**Collection Flow**:
1. PyASIC attempts connection (likely fails - no standard API)
2. DG1 TCP fallback triggered automatically
3. Uses custom TCP protocol on port 4028
4. If successful: scrape_status = 0.4

---

### Example 5: Whatsminer (No Special Config)
```yaml
miners:
  - ip: "192.168.1.104"
    name: "m30s-01"
    model: "Whatsminer M30S+"
    alias: "Backup Rig"
```

**Collection Flow**:
1. PyASIC attempts connection
2. If successful: scrape_status = 2
3. Gap filling for rejected shares via CGMiner

---

## Field Validation

### config.py
**Ensures**:
- Each miner has a `name` field (generates from IP if missing)
- Uses `alias` as `name` if provided
- Caches configuration for 5 minutes

```python
for miner in miners:
    if 'name' not in miner:
        if 'alias' in miner:
            miner['name'] = miner['alias']
        else:
            miner['name'] = f"miner-{miner['ip'].replace('.', '-')}"
```

---

## Alignment Summary

### ✅ All Collectors Aligned

| Field      | PyASIC | Antminer CGI | DG1 TCP | Required | Default |
|------------|--------|--------------|---------|----------|---------|
| `ip`       | ✅     | ✅           | ✅      | Yes      | -       |
| `name`     | ✅     | -            | -       | Yes*     | Auto    |
| `model`    | ✅     | -            | -       | Yes      | -       |
| `alias`    | -      | -            | -       | No       | name    |
| `api_port` | ✅     | -            | -       | No       | 4028    |
| `username` | -      | ✅           | -       | No       | 'root'  |
| `password` | -      | ✅           | -       | No       | 'root'  |

*Auto-generated from IP if missing

---

## Migration Guide

### From Old Format
```yaml
# Old format (still works)
miners:
  - ip: "192.168.1.100"
    model: "Antminer S19"
```

### To New Format (Recommended)
```yaml
# New format with all options
miners:
  - ip: "192.168.1.100"
    name: "s19-01"              # Explicit name
    model: "Antminer S19"
    alias: "Main Rig"           # Friendly name
    username: "root"            # CGI fallback credentials
    password: "root"
    api_port: 4028              # Explicit port
```

---

## Best Practices

### 1. Always Provide Credentials for Antminers
```yaml
- ip: "192.168.1.100"
  model: "Antminer S19"
  username: "root"
  password: "root"
```
**Why**: Enables CGI fallback when port 4028 API fails

### 2. Use Explicit Names
```yaml
- ip: "192.168.1.100"
  name: "s19-rack1-01"
  model: "Antminer S19"
```
**Why**: Better logging and metric labels

### 3. Document Custom Ports
```yaml
- ip: "192.168.1.100"
  name: "s19-custom"
  model: "Antminer S19"
  api_port: 4029  # Custom port for testing
```
**Why**: Makes configuration self-documenting

### 4. Use Aliases for Display
```yaml
- ip: "192.168.1.100"
  name: "s19-01"
  model: "Antminer S19"
  alias: "Main Mining Rig - Rack 1 Position 1"
```
**Why**: Better UI display without affecting metric labels

---

## Troubleshooting

### Issue: Antminer CGI fallback not working
**Check**:
```yaml
- ip: "192.168.1.100"
  model: "Antminer S19"
  username: "root"      # ← Add these
  password: "root"      # ← Add these
```

### Issue: Custom port not being used
**Check**:
```yaml
- ip: "192.168.1.100"
  model: "Antminer S19"
  api_port: 4029        # ← Add this
```

### Issue: DG1 not detected
**Check**:
```yaml
- ip: "192.168.1.100"
  model: "ElphaPex DG1"  # ← Must contain 'DG1'
  # or
  model: "DG1"           # ← Simplified
```

---

## Validation Script

Create a validation script to check your configuration:

```python
import yaml

def validate_miners_config(config_path):
    with open(config_path) as f:
        config = yaml.safe_load(f)
    
    miners = config.get('miners', [])
    
    for i, miner in enumerate(miners):
        print(f"Miner {i+1}:")
        
        # Required fields
        assert 'ip' in miner, f"  ❌ Missing 'ip'"
        assert 'model' in miner, f"  ❌ Missing 'model'"
        print(f"  ✅ IP: {miner['ip']}")
        print(f"  ✅ Model: {miner['model']}")
        
        # Optional fields
        if 'name' in miner:
            print(f"  ✅ Name: {miner['name']}")
        else:
            print(f"  ⚠️  Name: Auto-generated")
        
        if 'username' in miner:
            print(f"  ✅ Username: {miner['username']}")
        
        if 'api_port' in miner:
            print(f"  ✅ API Port: {miner['api_port']}")
        
        print()

if __name__ == "__main__":
    validate_miners_config('/app/etc/miners.yaml')
```

---

## Summary

✅ **All collectors aligned** with unified configuration structure  
✅ **Backward compatible** with existing configurations  
✅ **Clear defaults** for optional fields  
✅ **Comprehensive examples** in `miners.yaml.example`  
✅ **Validation** ensures required fields present  

The configuration system is flexible, allowing minimal config for simple setups while supporting advanced features when needed.
