# Alert System Migration to SQLite - Analysis & Implementation Plan

## Executive Summary

**Goal**: Migrate Prometheus alert rules from YAML files to SQLite database for easier management, editing, and multi-user support.

**Benefits**:
- ✅ Dynamic alert rule management via UI
- ✅ Per-user alert rule customization
- ✅ Version history and audit trail
- ✅ No need to edit YAML files or reload Prometheus manually
- ✅ Centralized configuration with miners data
- ✅ Easier backup and restore

---

## Current Architecture Analysis

### 1. **Current Data Storage**

#### Already in SQLite ✅
- **Miners** (`miners` table) - IP, name, model, owner, credentials, thresholds
- **Pools** (`pools` table) - Pool configurations
- **Stats** (`stats_raw`, `stats_hourly`, `stats_daily`) - Time-series metrics
- **Alerts History** (`alerts` table in `alerts.db`) - Fired/resolved alerts
- **Settings** (`settings` table) - Application configuration

#### Currently in YAML Files ❌
- **Prometheus Alert Rules** (`mining_alerts.yml`, `pool_network_alerts.yml`)
  - 15+ predefined alert rules
  - Static thresholds
  - No per-user customization
  - Requires Prometheus reload after changes

### 2. **Current Alert Rule Structure**

From `mining_alerts.yml` and `pool_network_alerts.yml`:

```yaml
groups:
  - name: mining_critical
    interval: 30s
    rules:
      - alert: MinerOffline
        expr: miner_scrape_success == 0
        for: 5m
        labels:
          severity: critical
          component: miner
        annotations:
          summary: "Miner {{ $labels.name }} is offline"
          description: "Miner {{ $labels.name }} ({{ $labels.ip }}) has been unreachable for 5 minutes."
```

**Key Components**:
- **Group Name**: Logical grouping (e.g., `mining_critical`, `mining_warning`, `pool_network`)
- **Interval**: Evaluation frequency (e.g., `30s`)
- **Alert Name**: Unique identifier (e.g., `MinerOffline`)
- **Expression**: PromQL query (e.g., `miner_scrape_success == 0`)
- **Duration**: How long condition must be true (e.g., `5m`)
- **Severity**: `critical`, `warning`, `info`
- **Component**: `miner`, `network`, `farm`
- **Annotations**: Human-readable summary and description

### 3. **Current Alert Types**

#### Mining Alerts (15 rules)
- **Critical** (5 rules):
  - `MinerOffline` - Miner unreachable for 5m
  - `MinerHighTemperature` - Temp > 85°C for 2m
  - `MinerNotMining` - Online but not mining for 5m
  - `MinerHashrateCriticalSHA256` - Hashrate < 50% expected for 10m
  - `MinerHashrateCriticalSCRYPT` - Hashrate < 10000 MH/s for 10m

- **Warning** (7 rules):
  - `MinerTemperatureHigh` - Temp 75-85°C for 5m
  - `MinerHashrateWarningSHA256` - Hashrate 50-80% expected for 10m
  - `MinerHashrateWarningSCRYPT` - Hashrate 10000-12000 MH/s for 10m
  - `MinerFanSpeedLow` - Fan < 3000 RPM for 5m
  - `MinerPowerHighSHA256` - Power > 110% expected for 10m
  - `MinerPowerLowSHA256` - Power < 80% expected for 10m
  - `MinerHighRejectionRate` - Rejection rate > 5% for 10m

- **Farm-Wide** (3 rules):
  - `FarmMultipleMinersOffline` - 3+ miners offline
  - `FarmLowHashrate` - Total hashrate < 80% expected
  - `FarmHighAverageTemperature` - Avg temp > 80°C

#### Pool/Network Alerts (6 rules)
- **Critical** (2 rules):
  - `PoolUnreachable` - Pool unreachable for 5m
  - `PoolHighPacketLoss` - Packet loss > 10% for 5m

- **Warning** (4 rules):
  - `PoolHighLatency` - Latency > 100ms for 10m
  - `PoolPacketLoss` - Packet loss 1-10% for 10m
  - `PoolSlowConnection` - Connect time > 1000ms for 5m
  - `PoolDNSFailure` - DNS resolution failed for 5m

---

## Proposed Database Schema

### New Table: `alert_rules`

```sql
CREATE TABLE alert_rules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  
  -- Basic Info
  name TEXT UNIQUE NOT NULL,              -- e.g., "MinerOffline"
  display_name TEXT NOT NULL,             -- e.g., "Miner Offline"
  description TEXT,                       -- Human-readable description
  
  -- Rule Configuration
  rule_group TEXT NOT NULL,               -- e.g., "mining_critical", "pool_network"
  severity TEXT NOT NULL,                 -- "critical", "warning", "info"
  component TEXT NOT NULL,                -- "miner", "network", "farm"
  
  -- Prometheus Expression
  expr TEXT NOT NULL,                     -- PromQL expression
  for_duration TEXT NOT NULL,             -- e.g., "5m", "10m"
  
  -- Annotations (templates)
  summary_template TEXT NOT NULL,         -- e.g., "Miner {{ $labels.name }} is offline"
  description_template TEXT,              -- Detailed description template
  
  -- Scope
  scope TEXT NOT NULL DEFAULT 'global',   -- "global", "per_miner", "per_owner"
  target_miner_ip TEXT,                   -- If per_miner, which miner
  target_owner TEXT,                      -- If per_owner, which owner
  
  -- Status
  enabled INTEGER NOT NULL DEFAULT 1,     -- 0 = disabled, 1 = enabled
  is_system INTEGER NOT NULL DEFAULT 0,   -- 0 = user-created, 1 = system default
  
  -- Metadata
  created_by TEXT,                        -- Telegram chat ID of creator
  created_at INTEGER DEFAULT (strftime('%s', 'now')),
  updated_at INTEGER DEFAULT (strftime('%s', 'now')),
  
  -- Constraints
  CHECK (severity IN ('critical', 'warning', 'info')),
  CHECK (component IN ('miner', 'network', 'farm')),
  CHECK (scope IN ('global', 'per_miner', 'per_owner')),
  CHECK (enabled IN (0, 1)),
  CHECK (is_system IN (0, 1))
);

CREATE INDEX idx_alert_rules_enabled ON alert_rules(enabled);
CREATE INDEX idx_alert_rules_severity ON alert_rules(severity);
CREATE INDEX idx_alert_rules_scope ON alert_rules(scope);
CREATE INDEX idx_alert_rules_owner ON alert_rules(target_owner);
CREATE INDEX idx_alert_rules_miner ON alert_rules(target_miner_ip);
```

### New Table: `alert_rule_history`

Track changes to alert rules for audit trail:

```sql
CREATE TABLE alert_rule_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  rule_id INTEGER NOT NULL,
  rule_name TEXT NOT NULL,
  action TEXT NOT NULL,                   -- "created", "updated", "deleted", "enabled", "disabled"
  changed_by TEXT,                        -- Telegram chat ID
  changes TEXT,                           -- JSON of what changed
  timestamp INTEGER DEFAULT (strftime('%s', 'now')),
  
  FOREIGN KEY (rule_id) REFERENCES alert_rules(id) ON DELETE CASCADE,
  CHECK (action IN ('created', 'updated', 'deleted', 'enabled', 'disabled'))
);

CREATE INDEX idx_alert_rule_history_rule ON alert_rule_history(rule_id);
CREATE INDEX idx_alert_rule_history_timestamp ON alert_rule_history(timestamp DESC);
```

---

## Migration Strategy

### Phase 1: Database Schema ✅
1. Add `alert_rules` and `alert_rule_history` tables to `database.service.ts`
2. Create migration script to populate from existing YAML files
3. Add CRUD methods to database service

### Phase 2: Backend Services 🔄
1. Create `alert-rules.service.ts`:
   - CRUD operations for alert rules
   - Generate Prometheus YAML from database
   - Validate PromQL expressions
   - Handle rule scope (global/per-miner/per-owner)

2. Update `prometheus.service.ts`:
   - Add function to regenerate YAML from database
   - Keep existing `reloadPrometheusConfig()` function

3. Add API endpoints in `mining.routes.ts`:
   - `GET /api/alert-rules` - List all rules (filtered by owner)
   - `GET /api/alert-rules/:id` - Get single rule
   - `POST /api/alert-rules` - Create new rule
   - `PUT /api/alert-rules/:id` - Update rule
   - `DELETE /api/alert-rules/:id` - Delete rule
   - `POST /api/alert-rules/:id/toggle` - Enable/disable rule
   - `POST /api/alert-rules/regenerate` - Regenerate Prometheus YAML

### Phase 3: Frontend UI 🎨
1. Create `AlertRulesManager.tsx` component:
   - List view with filters (severity, component, enabled/disabled)
   - Create/Edit form with validation
   - PromQL expression builder/helper
   - Test rule functionality
   - Enable/disable toggle
   - Delete confirmation

2. Update `Alerts.tsx`:
   - Replace static "Alert Rules" tab with dynamic component
   - Add "Manage Rules" button
   - Show rule status (enabled/disabled)

### Phase 4: Testing & Documentation 📝
1. Test rule CRUD operations
2. Test Prometheus YAML generation
3. Test multi-user scenarios
4. Update documentation

---

## Implementation Details

### 1. **Rule Scopes**

#### Global Rules (Default)
- Apply to all miners/pools
- Visible to all users
- Example: `MinerOffline`, `PoolUnreachable`

#### Per-Miner Rules
- Apply to specific miner
- Only visible to miner owner
- Example: Custom temperature threshold for specific miner

#### Per-Owner Rules
- Apply to all miners owned by specific user
- Only visible to that owner
- Example: Owner wants different hashrate thresholds

### 2. **Prometheus YAML Generation**

Backend will generate YAML files from database:

```typescript
// Pseudo-code
function generatePrometheusYAML() {
  const rules = db.getEnabledAlertRules();
  
  const groups = groupBy(rules, 'rule_group');
  
  const yaml = {
    groups: groups.map(group => ({
      name: group.name,
      interval: '30s',
      rules: group.rules.map(rule => ({
        alert: rule.name,
        expr: rule.expr,
        for: rule.for_duration,
        labels: {
          severity: rule.severity,
          component: rule.component,
        },
        annotations: {
          summary: rule.summary_template,
          description: rule.description_template,
        },
      })),
    })),
  };
  
  fs.writeFileSync('mining_alerts.yml', yaml.stringify(yaml));
  reloadPrometheus();
}
```

### 3. **Multi-User Support**

When user requests alert rules:
```typescript
GET /api/alert-rules?owner=<telegram_chat_id>

// Returns:
// - All global rules (scope='global')
// - Rules for their miners (scope='per_miner', target_miner_ip IN user_miners)
// - Rules for their owner (scope='per_owner', target_owner=user_chat_id)
```

### 4. **Backward Compatibility**

- Keep existing YAML files as backup
- System rules marked with `is_system=1` (cannot be deleted, only disabled)
- Migration script preserves all existing rules
- Prometheus continues reading from YAML files (generated from DB)

---

## API Endpoints Specification

### GET `/api/alert-rules`
**Query Params**:
- `owner` - Filter by owner (Telegram chat ID)
- `severity` - Filter by severity
- `component` - Filter by component
- `enabled` - Filter by enabled status
- `scope` - Filter by scope

**Response**:
```json
{
  "success": true,
  "rules": [
    {
      "id": 1,
      "name": "MinerOffline",
      "display_name": "Miner Offline",
      "severity": "critical",
      "component": "miner",
      "enabled": true,
      "is_system": true,
      "expr": "miner_scrape_success == 0",
      "for_duration": "5m",
      "summary_template": "Miner {{ $labels.name }} is offline",
      "scope": "global"
    }
  ]
}
```

### POST `/api/alert-rules`
**Body**:
```json
{
  "name": "CustomTempAlert",
  "display_name": "Custom Temperature Alert",
  "description": "Alert when my miner gets too hot",
  "rule_group": "mining_warning",
  "severity": "warning",
  "component": "miner",
  "expr": "miner_temp_max_c{name=\"EN-M30-040\"} > 70",
  "for_duration": "3m",
  "summary_template": "Miner {{ $labels.name }} temperature is high",
  "description_template": "Temperature: {{ $value }}°C",
  "scope": "per_miner",
  "target_miner_ip": "192.168.1.40"
}
```

### PUT `/api/alert-rules/:id`
Update existing rule (same body as POST)

### DELETE `/api/alert-rules/:id`
Delete rule (only if `is_system=0`)

### POST `/api/alert-rules/:id/toggle`
Enable/disable rule

### POST `/api/alert-rules/regenerate`
Regenerate Prometheus YAML from database and reload

---

## Migration Checklist

- [ ] Add database schema to `database.service.ts`
- [ ] Create migration script to import YAML rules
- [ ] Create `alert-rules.service.ts` with CRUD operations
- [ ] Add YAML generation function
- [ ] Add API endpoints to `mining.routes.ts`
- [ ] Create `AlertRulesManager.tsx` component
- [ ] Update `Alerts.tsx` to use dynamic rules
- [ ] Add PromQL expression validator
- [ ] Test multi-user scenarios
- [ ] Update documentation
- [ ] Deploy and test on production

---

## Benefits Summary

### Before (YAML-based)
- ❌ Must SSH to Raspberry Pi to edit rules
- ❌ Must manually reload Prometheus
- ❌ No per-user customization
- ❌ No audit trail
- ❌ Risk of syntax errors breaking Prometheus
- ❌ No UI for management

### After (SQLite-based)
- ✅ Edit rules from web UI
- ✅ Automatic Prometheus reload
- ✅ Per-user and per-miner rules
- ✅ Full audit trail
- ✅ Validation before saving
- ✅ Modern UI with search/filter
- ✅ Centralized with miner data
- ✅ Easy backup/restore

---

## Timeline Estimate

- **Phase 1** (Database Schema): 2-3 hours
- **Phase 2** (Backend Services): 4-5 hours
- **Phase 3** (Frontend UI): 5-6 hours
- **Phase 4** (Testing & Docs): 2-3 hours

**Total**: ~15-20 hours of development

---

## Next Steps

1. **Review this plan** - Confirm approach and priorities
2. **Start with Phase 1** - Database schema and migration
3. **Iterate** - Build incrementally with testing at each phase
4. **Deploy** - Test on production with real data

---

**Status**: ✅ Analysis Complete - Ready for Implementation
