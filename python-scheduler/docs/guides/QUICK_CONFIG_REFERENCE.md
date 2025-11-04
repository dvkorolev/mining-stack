# Quick Configuration Reference

## Minimal Configuration (Works for Most Miners)

```yaml
miners:
  - ip: "192.168.1.100"
    name: "miner-01"
    model: "Antminer S19"
```

---

## Full Configuration (All Options)

```yaml
miners:
  - ip: "192.168.1.100"          # Required: IP address
    name: "miner-01"              # Required: Unique ID
    model: "Antminer S19"         # Required: Model name
    alias: "Main Rig"             # Optional: Display name
    api_port: 4028                # Optional: CGMiner port (default: 4028)
    username: "root"              # Optional: CGI auth (default: 'root')
    password: "root"              # Optional: CGI auth (default: 'root')
```

---

## Quick Examples

### Standard Antminer
```yaml
- ip: "192.168.1.100"
  name: "s19-01"
  model: "Antminer S19"
  username: "root"
  password: "root"
```

### DG1 SCRYPT Miner
```yaml
- ip: "192.168.1.101"
  name: "dg1-01"
  model: "ElphaPex DG1"
```

### Whatsminer
```yaml
- ip: "192.168.1.102"
  name: "m30s-01"
  model: "Whatsminer M30S+"
```

---

## Field Defaults

| Field      | Default Value | Used By           |
|------------|---------------|-------------------|
| `alias`    | `name`        | All               |
| `api_port` | `4028`        | PyASIC, CGMiner   |
| `username` | `'root'`      | Antminer CGI      |
| `password` | `'root'`      | Antminer CGI      |

---

## Collector Triggers

| Model Contains | Fallback Driver  | Needs Credentials |
|----------------|------------------|-------------------|
| `antminer`     | Antminer CGI     | Yes (username/password) |
| `s19`          | Antminer CGI     | Yes (username/password) |
| `s17`          | Antminer CGI     | Yes (username/password) |
| `dg1`          | DG1 TCP          | No                |

---

## Common Issues

### ❌ CGI Fallback Not Working
**Add credentials**:
```yaml
username: "root"
password: "root"
```

### ❌ Custom Port Not Used
**Add api_port**:
```yaml
api_port: 4029
```

### ❌ DG1 Not Detected
**Model must contain 'DG1'**:
```yaml
model: "ElphaPex DG1"  # ✅
model: "DG-1"          # ❌
```

---

## Validation Checklist

- [ ] Every miner has `ip`
- [ ] Every miner has `name`
- [ ] Every miner has `model`
- [ ] Antminers have `username` and `password`
- [ ] DG1 model contains 'DG1'
- [ ] Custom ports specified with `api_port`

---

## See Also

- **Full Guide**: `CONFIG_ALIGNMENT.md`
- **Example File**: `/etc/miners.yaml.example`
- **Driver Docs**: `DRIVERS_IMPLEMENTATION.md`
