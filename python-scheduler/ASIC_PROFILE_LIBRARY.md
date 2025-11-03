# ASIC Profile Library

## The Professional Solution to Miner Diversity

The ASIC Profile Library is a **data-driven approach** to managing the chaos of different miner types, protocols, and quirks. Instead of tangled if/else statements scattered throughout your code, you have a **centralized, queryable database** of ASIC knowledge.

---

## The Problem It Solves

### Before: Spaghetti Code

```python
# Scattered logic everywhere
if 'M50' in model or 'M30' in model:
    # Whatsminer quirks
    if 'MHS av' in data:
        hashrate = data['MHS av']  # Actually TH/s!
    username = 'admin'
    password = 'admin'
elif 'S19' in model or 'S17' in model:
    # Antminer quirks
    if 'MHS av' in data:
        hashrate = data['MHS av']  # Also TH/s!
    username = 'root'
    password = 'root'
    # Try CGI fallback...
elif 'DG1' in model:
    # DG1 quirks
    if 'MHS av' in data:
        hashrate = data['MHS av'] / 1000  # GH/s to TH/s
    # Use custom TCP protocol...
# ... and so on
```

**Problems**:
- Logic duplicated across multiple files
- Hard to maintain and extend
- No single source of truth
- Adding a new miner requires code changes everywhere

### After: Data-Driven Architecture

```python
# Clean, elegant workflow
profile = library.get_profile(miner['model'])
driver = profile.get_ordered_drivers()[0]
data = await driver.collect(miner)
parsed = parser.parse(data, profile.get_parser_quirks())
```

**Benefits**:
- ✅ Single source of truth (`asic_profiles.yaml`)
- ✅ No code duplication
- ✅ Add new miners without code changes
- ✅ Community-driven database
- ✅ Easy to understand and maintain

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                    asic_profiles.yaml                        │
│  The "Constitution" - Defines how to talk to each miner     │
│                                                              │
│  profiles:                                                   │
│    whatsminer_m50s:                                         │
│      drivers: [pyasic, cgminer]                             │
│      parser: whatsminer                                      │
│      quirks: {hashrate_unit: "TH/s", ...}                  │
│      credentials: {username: "admin", ...}                  │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│              asic_profile_loader.py                          │
│  Loads profiles and provides query interface                 │
│                                                              │
│  library.get_profile(model) → ASICProfile                   │
│  profile.get_ordered_drivers() → [driver1, driver2, ...]   │
│  profile.get_parser_quirks() → {hashrate_unit: "TH/s"}     │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                   Orchestrator (main.py)                     │
│  Clean, data-driven collection workflow                     │
│                                                              │
│  1. Get profile for miner                                   │
│  2. Try drivers in priority order                           │
│  3. Parse with profile-specific quirks                      │
│  4. Update metrics                                          │
└─────────────────────────────────────────────────────────────┘
```

---

## The Profile Schema

Each profile defines the "personality" of a miner type:

```yaml
whatsminer_m50s:
  # Identity
  name: "Whatsminer M50S Series"
  manufacturer: "MicroBT"
  algorithm: "sha256"
  models: ["M50S", "M50S++", "M50S++ VL30"]
  
  # How to collect data (ordered by preference)
  drivers:
    - type: "pyasic"
      priority: 1
      config: {api_port: 4028, timeout: 10}
    - type: "cgminer"
      priority: 2
      config: {api_port: 4028, timeout: 10}
  
  # How to parse data
  parser:
    type: "whatsminer"
    quirks:
      hashrate_field: "MHS av"
      hashrate_unit: "TH/s"      # Ignore field name!
      hashrate_scale: 1.0
      temp_source: "board"
      temp_fields: ["Temperature"]
      power_field: "Power"
  
  # Authentication
  credentials:
    username: "admin"
    password: "admin"
  
  # Expected performance (for anomaly detection)
  expected:
    hashrate_min: 100  # TH/s
    hashrate_max: 160
    power_min: 3000    # W
    power_max: 3800
    temp_max: 85       # °C
```

---

## Key Concepts

### 1. Profiles

A **profile** is a complete definition of how to interact with a miner type.

**Components**:
- **Identity**: Name, manufacturer, algorithm, models
- **Drivers**: How to collect data (PyASIC, CGMiner, CGI, TCP)
- **Parser**: How to interpret the data
- **Quirks**: Miner-specific oddities (field names, units, etc.)
- **Credentials**: Default username/password
- **Expected**: Normal operating ranges

### 2. Drivers

**Drivers** are the "verbs" - they know how to **collect** data.

**Types**:
- `pyasic`: Use PyASIC library (best for modern ASICs)
- `cgminer`: Direct CGMiner API calls
- `antminer_cgi`: HTTP CGI fallback for Antminers
- `dg1_tcp`: Custom TCP protocol for DG1

**Priority**: Drivers are tried in order (1 = highest priority)

### 3. Parsers

**Parsers** know how to **interpret** the raw data.

**Types**:
- `whatsminer`: Handles Whatsminer quirks
- `antminer`: Handles Antminer quirks
- `dg1`: Handles DG1 quirks
- `generic`: Fallback parser

### 4. Quirks

**Quirks** are the magic - they encode miner-specific oddities.

**Examples**:
```yaml
quirks:
  # Whatsminer: "MHS av" field contains TH/s
  hashrate_field: "MHS av"
  hashrate_unit: "TH/s"
  hashrate_scale: 1.0
  
  # DG1: "MHS av" field contains GH/s
  hashrate_field: "MHS av"
  hashrate_unit: "GH/s"
  hashrate_scale: 0.001  # Convert to TH/s
  
  # Antminer: Temperature from chip sensors
  temp_source: "chip"
  temp_fields: ["temp", "temp2_", "temp_chip"]
```

---

## Usage Examples

### Loading the Library

```python
from asic_profile_loader import get_library

# Get the global library instance
library = get_library()

# Or create a custom instance
library = ASICProfileLibrary('/path/to/profiles.yaml')
```

### Getting a Profile

```python
# By model name
profile = library.get_profile("Whatsminer M50S++ VL30")

# With algorithm override
profile = library.get_profile("Unknown Model", algorithm_override="sha256")

# By profile ID
profile = library.get_profile_by_id("whatsminer_m50s")
```

### Using a Profile

```python
# Get ordered drivers
drivers = profile.get_ordered_drivers()
# [{'type': 'pyasic', 'priority': 1, ...}, {'type': 'cgminer', 'priority': 2, ...}]

# Get parser configuration
parser_type = profile.get_parser_type()  # "whatsminer"
quirks = profile.get_parser_quirks()
# {'hashrate_field': 'MHS av', 'hashrate_unit': 'TH/s', ...}

# Get credentials
username = profile.credentials.get('username', 'root')
password = profile.credentials.get('password', 'root')

# Get expected ranges
min_hashrate = profile.expected.get('hashrate_min', 0)
max_hashrate = profile.expected.get('hashrate_max', 999)
```

### Collection Workflow

```python
async def collect_miner(miner_config):
    # 1. Get profile
    profile = library.get_profile(
        miner_config['model'],
        miner_config.get('algorithm')
    )
    
    if not profile:
        logger.warning(f"No profile for {miner_config['model']}")
        return None
    
    # 2. Try drivers in priority order
    for driver_spec in profile.get_ordered_drivers():
        driver_type = driver_spec['type']
        driver_config = driver_spec.get('config', {})
        
        try:
            # Get the driver module
            driver = get_driver(driver_type)
            
            # Collect data
            raw_data = await driver.collect(miner_config, driver_config)
            
            if raw_data:
                # 3. Parse with profile quirks
                parser = get_parser(profile.get_parser_type())
                parsed_data = parser.parse(raw_data, profile.get_parser_quirks())
                
                return parsed_data
        
        except Exception as e:
            logger.debug(f"Driver {driver_type} failed: {e}")
            continue
    
    return None
```

---

## Model Matching

The library uses a two-tier matching system:

### 1. Exact Matches (Highest Priority)

```yaml
matching:
  exact:
    "Antminer S19 Pro": "antminer_s19"
    "Whatsminer M50S++ VL30": "whatsminer_m50s"
    "ElphaPex DG1": "elphapex_dg1"
```

### 2. Regex Patterns (Fallback)

```yaml
matching:
  patterns:
    - pattern: "^Whatsminer M50S"
      profile: "whatsminer_m50s"
    - pattern: "^Antminer S19"
      profile: "antminer_s19"
    - pattern: "DG1"
      profile: "elphapex_dg1"
```

**Matching Order**:
1. Try exact match
2. Try regex patterns in order
3. If algorithm override provided, find any profile with that algorithm
4. Return None if no match

---

## Adding a New Miner

To support a new miner, you **only need to edit `asic_profiles.yaml`**:

```yaml
profiles:
  # Add your new profile
  avalon_1246:
    name: "Avalon 1246"
    manufacturer: "Canaan"
    algorithm: "sha256"
    models: ["Avalon 1246", "A1246"]
    
    drivers:
      - type: "cgminer"
        priority: 1
        config:
          api_port: 4028
          timeout: 10
    
    parser:
      type: "generic"  # Or create a custom parser
      quirks:
        hashrate_field: "GHS av"
        hashrate_unit: "GH/s"
        hashrate_scale: 0.001  # Convert to TH/s
        temp_source: "chip"
        temp_fields: ["temp"]
    
    credentials:
      username: "root"
      password: "root"
    
    expected:
      hashrate_min: 80
      hashrate_max: 100
      power_min: 3000
      power_max: 3500
      temp_max: 85

# Add matching rule
matching:
  exact:
    "Avalon 1246": "avalon_1246"
  patterns:
    - pattern: "^Avalon 124"
      profile: "avalon_1246"
```

**That's it!** No code changes needed.

---

## Benefits

### 1. Infinite Extensibility

Add new miners by editing YAML, not code.

### 2. Zero Code Duplication

Each quirk defined once, used everywhere.

### 3. Clarity and Simplicity

Main collection loop is clean and readable.

### 4. Community Power

Share `asic_profiles.yaml` as a community database.

### 5. Easy Testing

Test profiles without running actual miners:

```python
profile = library.get_profile("M50S++")
assert profile.get_parser_quirks()['hashrate_unit'] == 'TH/s'
```

### 6. Hot Reloading

Update profiles without restarting:

```python
from asic_profile_loader import reload_library
reload_library()
```

### 7. Anomaly Detection

Use expected ranges to detect issues:

```python
hashrate = data['hashrate']
if hashrate < profile.expected['hashrate_min']:
    alert("Hashrate below minimum!")
```

---

## Migration Path

### Phase 1: Add Profile Library (Non-Breaking)

1. Add `asic_profiles.yaml`
2. Add `asic_profile_loader.py`
3. Keep existing code working

### Phase 2: Refactor Collectors (Gradual)

1. Update one collector at a time
2. Use profiles alongside existing logic
3. Test thoroughly

### Phase 3: Remove Old Code (Final)

1. Delete old if/else chains
2. Remove hardcoded quirks
3. Clean, maintainable codebase

---

## Community Contribution

The ASIC Profile Library becomes more powerful with community contributions:

### Contributing a Profile

1. **Fork the repo**
2. **Add your profile** to `asic_profiles.yaml`
3. **Test it** with your miners
4. **Submit PR** with:
   - Profile definition
   - Model matching rules
   - Expected performance ranges
   - Any special notes

### Profile Quality Checklist

- [ ] Accurate model names
- [ ] Correct algorithm (sha256/scrypt)
- [ ] Tested drivers in priority order
- [ ] Verified quirks (hashrate units, temp sources)
- [ ] Default credentials documented
- [ ] Expected ranges from real data
- [ ] Matching rules cover all variants

---

## Future Enhancements

### 1. Profile Versioning

```yaml
whatsminer_m50s:
  version: "1.2"
  changelog:
    - "1.2: Added VL30 model support"
    - "1.1: Fixed temperature source"
```

### 2. Firmware-Specific Profiles

```yaml
whatsminer_m50s_fw2023:
  inherits: "whatsminer_m50s"
  firmware: "2023.*"
  quirks:
    # Firmware-specific quirks
```

### 3. Auto-Discovery Hints

```yaml
whatsminer_m50s:
  discovery:
    ports: [4028, 80]
    fingerprint: "Whatsminer"
```

### 4. Performance Tuning

```yaml
whatsminer_m50s:
  tuning:
    optimal_temp: 75
    optimal_fan_speed: 4000
    power_modes: ["normal", "low", "high"]
```

---

## Summary

The ASIC Profile Library transforms your collector from a tangled mess into a **clean, data-driven system**.

✅ **Single source of truth** - `asic_profiles.yaml`  
✅ **No code duplication** - Quirks defined once  
✅ **Easy to extend** - Add miners without code changes  
✅ **Community-driven** - Share and improve together  
✅ **Professional architecture** - Clean, maintainable, scalable  

**The result**: A collector that's easy to understand, maintain, and extend! 🎉
