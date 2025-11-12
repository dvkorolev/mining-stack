# Alert Rules Architecture

## How Alert Rules Work

### Source of Truth: **SQLite Database** ✅

The **SQLite database** (`mining-stats.db`) is the **single source of truth** for all alert rules.

```
┌─────────────────────────────────────────────────────────────┐
│                     SQLite Database                         │
│                  (Source of Truth)                          │
│                                                             │
│  Table: alert_rules                                         │
│  - id, name, expr, severity, enabled, etc.                  │
└─────────────────────────────────────────────────────────────┘
                          │
                          │ Auto-regenerate on changes
                          ▼
┌─────────────────────────────────────────────────────────────┐
│              Prometheus YAML Files                          │
│            (Generated from Database)                        │
│                                                             │
│  /opt/mining-stack/docker/prometheus/rules/                 │
│  └── mining_alerts.yml  (28 enabled rules)                  │
└─────────────────────────────────────────────────────────────┘
                          │
                          │ Loaded by Prometheus
                          ▼
┌─────────────────────────────────────────────────────────────┐
│                    Prometheus                               │
│              (Evaluates Alert Rules)                        │
│                                                             │
│  - Evaluates expressions every 30s                          │
│  - Fires alerts when conditions met                         │
│  - Sends to Alertmanager → Telegram                         │
└─────────────────────────────────────────────────────────────┘
```

---

## YAML is NOT a Backup - It's Generated Output

**Important:** The YAML file is **generated from the database**, not the other way around.

### Flow:

1. **User edits alert rule** (via UI or API)
   - Creates/updates/deletes/toggles rule in SQLite database

2. **Backend auto-regenerates YAML** (immediately)
   ```typescript
   // After any CRUD operation:
   regeneratePrometheusYAML().catch(err => {
     logger.warn('Failed to auto-regenerate Prometheus YAML:', err);
   });
   ```

3. **Prometheus reloads** (automatically)
   ```bash
   curl -X POST http://prometheus:9090/-/reload
   ```

4. **New rules take effect** (within 30 seconds)

---

## When YAML is Regenerated

### Automatic Regeneration
The YAML is **automatically regenerated** after:

1. ✅ **Creating** a new alert rule
2. ✅ **Updating** an existing rule
3. ✅ **Deleting** a rule
4. ✅ **Toggling** enabled/disabled status

### Manual Regeneration
You can also manually trigger regeneration:

```bash
# Via API
curl -X POST http://192.168.1.66:5000/api/mining/alert-rules/regenerate

# Via UI
Alert Rules Management → "Regenerate YAML" button (if exists)
```

---

## What Gets Generated

### Only Enabled Rules
```typescript
const rules = db.getAllAlertRules({ enabled: true });
```

**Key Point:** Only rules with `enabled = 1` are written to the YAML file.

### Example Database → YAML Conversion

**Database Record:**
```sql
INSERT INTO alert_rules (
  name, expr, severity, enabled, component, rule_group,
  for_duration, summary_template, description_template
) VALUES (
  'MinerOffline',
  'miner_scrape_status < 1',
  'critical',
  1,  -- enabled
  'miner',
  'mining_critical',
  '5m',
  'Miner {{ $labels.name }} is offline',
  'Miner {{ $labels.name }} ({{ $labels.ip }}) has been unreachable for 5 minutes.'
);
```

**Generated YAML:**
```yaml
groups:
  - name: mining_critical
    interval: 30s
    rules:
      - alert: MinerOffline
        expr: miner_scrape_status < 1
        for: 5m
        labels:
          severity: critical
          component: miner
        annotations:
          summary: "Miner {{ $labels.name }} is offline"
          description: "Miner {{ $labels.name }} ({{ $labels.ip }}) has been unreachable for 5 minutes."
```

---

## Current State (After Fixes)

### Database Rules: 31 Total
```
Enabled:  28 rules
Disabled: 3 rules (PoolSlowConnection, PoolHighLatency, 1 other)
```

### Generated YAML: 28 Rules
```
/opt/mining-stack/docker/prometheus/rules/mining_alerts.yml
```

**Breakdown by Component:**
- **Miner:** 16 rules (critical + warning)
- **Farm:** 5 rules (farm-wide monitoring)
- **Network:** 4 rules (pool connectivity)
- **System:** 3 rules (CPU, memory, disk)

### Static Files (Disabled)
```
pool_network_alerts.yml.backup  (no longer loaded)
```

---

## Why This Architecture?

### ✅ Advantages

1. **Single Source of Truth**
   - Database is authoritative
   - No confusion about which file is "real"

2. **Dynamic Management**
   - Edit rules via UI without SSH
   - Changes apply immediately
   - No manual YAML editing needed

3. **Version Control**
   - Database changes tracked in Git (via migrations)
   - YAML is reproducible from database

4. **Enabled/Disabled Toggle**
   - Disable rules without deleting them
   - Easy to re-enable later
   - YAML only contains active rules

5. **Validation**
   - Backend validates rules before saving
   - Prevents invalid PromQL expressions
   - Ensures required fields are present

### ⚠️ Important Notes

1. **Don't Edit YAML Directly**
   - Changes will be overwritten on next regeneration
   - Always edit via database/UI

2. **YAML is Ephemeral**
   - Can be deleted and regenerated anytime
   - Not backed up separately (database is backed up)

3. **Prometheus Reads YAML**
   - Prometheus doesn't know about the database
   - It only reads the generated YAML files

---

## Troubleshooting

### Alert Not Firing?

1. **Check if enabled in database:**
   ```sql
   SELECT name, enabled FROM alert_rules WHERE name = 'YourAlertName';
   ```

2. **Regenerate YAML:**
   ```bash
   curl -X POST http://192.168.1.66:5000/api/mining/alert-rules/regenerate
   ```

3. **Verify in YAML:**
   ```bash
   grep -A 5 "YourAlertName" /opt/mining-stack/docker/prometheus/rules/mining_alerts.yml
   ```

4. **Check Prometheus:**
   ```bash
   curl "http://192.168.1.66:9090/api/v1/rules" | jq '.data.groups[].rules[] | select(.name == "YourAlertName")'
   ```

### Disabled Alert Still Firing?

1. **Check for static YAML files:**
   ```bash
   ls /opt/mining-stack/docker/prometheus/rules/
   # Should only see: mining_alerts.yml
   ```

2. **Rename any static files:**
   ```bash
   mv pool_network_alerts.yml pool_network_alerts.yml.backup
   ```

3. **Reload Prometheus:**
   ```bash
   curl -X POST http://192.168.1.66:9090/-/reload
   ```

---

## Best Practices

### ✅ DO

- Edit rules via Alert Rules Management UI
- Use the database as the source of truth
- Regenerate YAML after manual database changes
- Disable rules instead of deleting (can re-enable later)
- Test rule expressions in Prometheus UI before saving

### ❌ DON'T

- Edit `mining_alerts.yml` directly (will be overwritten)
- Create static YAML files in the rules directory
- Manually reload Prometheus (backend does it automatically)
- Delete rules you might need later (disable instead)

---

## Summary

| Aspect | Answer |
|--------|--------|
| **Source of Truth** | SQLite database (`alert_rules` table) |
| **YAML Purpose** | Generated output for Prometheus to read |
| **Is YAML a backup?** | ❌ No - it's regenerated from database |
| **Can I edit YAML?** | ❌ No - changes will be overwritten |
| **When is YAML updated?** | Automatically after any rule change |
| **How to edit rules?** | Via UI or database, then regenerate |

**Bottom Line:** The database is the master, YAML is the servant. Always edit the database, never the YAML.
