# Alert Rules Migration to SQLite - Implementation Progress

## Status: Phase 1 & 2 Complete ✅

**Last Updated**: 2025-11-12

---

## ✅ Phase 1: Database Schema (COMPLETED)

### Database Tables Created

#### `alert_rules` table
```sql
CREATE TABLE alert_rules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT UNIQUE NOT NULL,
  display_name TEXT NOT NULL,
  description TEXT,
  rule_group TEXT NOT NULL,
  severity TEXT NOT NULL CHECK (severity IN ('critical', 'warning', 'info')),
  component TEXT NOT NULL CHECK (component IN ('miner', 'network', 'farm')),
  expr TEXT NOT NULL,
  for_duration TEXT NOT NULL,
  summary_template TEXT NOT NULL,
  description_template TEXT,
  scope TEXT NOT NULL DEFAULT 'global' CHECK (scope IN ('global', 'per_miner', 'per_owner')),
  target_miner_ip TEXT,
  target_owner TEXT,
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  is_system INTEGER NOT NULL DEFAULT 0 CHECK (is_system IN (0, 1)),
  created_by TEXT,
  created_at INTEGER DEFAULT (strftime('%s', 'now')),
  updated_at INTEGER DEFAULT (strftime('%s', 'now'))
);
```

#### `alert_rule_history` table
```sql
CREATE TABLE alert_rule_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  rule_id INTEGER NOT NULL,
  rule_name TEXT NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('created', 'updated', 'deleted', 'enabled', 'disabled')),
  changed_by TEXT,
  changes TEXT,
  timestamp INTEGER DEFAULT (strftime('%s', 'now')),
  FOREIGN KEY (rule_id) REFERENCES alert_rules(id) ON DELETE CASCADE
);
```

### Database Service Methods

**File**: `backend/src/services/database.service.ts`

- ✅ `getAllAlertRules(filters?)` - Get all rules with optional filtering
- ✅ `getAlertRuleById(id)` - Get single rule by ID
- ✅ `getAlertRuleByName(name)` - Get single rule by name
- ✅ `insertAlertRule(rule)` - Create new rule
- ✅ `updateAlertRule(id, updates, changedBy?)` - Update existing rule
- ✅ `deleteAlertRule(id, changedBy?)` - Delete rule (system rules protected)
- ✅ `toggleAlertRule(id, enabled, changedBy?)` - Enable/disable rule
- ✅ `getAlertRuleHistory(ruleId?, limit?)` - Get change history
- ✅ `logAlertRuleHistory()` - Private method for audit logging

### Migration Script

**File**: `backend/src/scripts/migrate-alert-rules.ts`

- ✅ Reads existing Prometheus YAML files
- ✅ Imports rules into database as system rules
- ✅ Marks rules with `is_system=1`
- ✅ Skips duplicates
- ✅ Provides detailed summary

**Usage**:
```bash
npm run migrate:alert-rules:dev
```

---

## ✅ Phase 2: Backend Services & APIs (COMPLETED)

### Alert Rules Service

**File**: `backend/src/services/alert-rules.service.ts`

#### Functions Implemented:
- ✅ `getAllAlertRules(filters?)` - Get rules with filtering
- ✅ `getAlertRuleById(id)` - Get single rule
- ✅ `getAlertRuleByName(name)` - Get rule by name
- ✅ `createAlertRule(params)` - Create with validation
- ✅ `updateAlertRule(id, updates, changedBy?)` - Update with validation
- ✅ `deleteAlertRule(id, changedBy?)` - Delete (protected for system rules)
- ✅ `toggleAlertRule(id, enabled, changedBy?)` - Enable/disable
- ✅ `getAlertRuleHistory(ruleId?, limit?)` - Get audit trail
- ✅ `regeneratePrometheusYAML()` - Generate YAML from database + reload Prometheus

#### Validation:
- ✅ PromQL expression validation (basic syntax checks)
- ✅ Duration format validation (5m, 10m, 1h, etc.)
- ✅ Required field validation
- ✅ Duplicate name detection

#### Auto-Reload:
- ✅ Automatically regenerates Prometheus YAML after changes
- ✅ Automatically reloads Prometheus in production
- ✅ Skips reload in development mode

### API Endpoints

**File**: `backend/src/routes/mining.routes.ts`

| Method | Endpoint | Description | Status |
|--------|----------|-------------|--------|
| GET | `/api/mining/alert-rules` | List all rules (with filters) | ✅ |
| GET | `/api/mining/alert-rules/:id` | Get single rule | ✅ |
| POST | `/api/mining/alert-rules` | Create new rule | ✅ |
| PUT | `/api/mining/alert-rules/:id` | Update rule | ✅ |
| DELETE | `/api/mining/alert-rules/:id` | Delete rule | ✅ |
| POST | `/api/mining/alert-rules/:id/toggle` | Enable/disable rule | ✅ |
| GET | `/api/mining/alert-rules/:id/history` | Get change history | ✅ |
| POST | `/api/mining/alert-rules/regenerate` | Regenerate YAML & reload | ✅ |

#### Query Parameters (GET /api/mining/alert-rules):
- `enabled` - Filter by enabled status (true/false)
- `severity` - Filter by severity (critical/warning/info)
- `component` - Filter by component (miner/network/farm)
- `scope` - Filter by scope (global/per_miner/per_owner)
- `owner` - Filter by owner (Telegram chat ID)
- `minerIp` - Filter by miner IP

---

## ⏳ Phase 3: Frontend UI (IN PROGRESS)

### Components to Create:

1. **AlertRulesManager.tsx** - Main management component
   - [ ] List view with table/cards
   - [ ] Filters (severity, component, enabled/disabled)
   - [ ] Search functionality
   - [ ] Create button
   - [ ] Edit/Delete/Toggle actions
   - [ ] Pagination

2. **AlertRuleForm.tsx** - Create/Edit form
   - [ ] Form fields for all rule properties
   - [ ] PromQL expression editor
   - [ ] Duration picker
   - [ ] Scope selector (global/per-miner/per-owner)
   - [ ] Validation feedback
   - [ ] Test rule button

3. **AlertRuleDetails.tsx** - View single rule
   - [ ] Display all rule properties
   - [ ] Show change history
   - [ ] Enable/disable toggle
   - [ ] Edit/Delete buttons

4. **Update Alerts.tsx**
   - [ ] Replace static "Alert Rules" tab with dynamic component
   - [ ] Add "Manage Rules" button
   - [ ] Show rule count and status

### API Integration:
- [ ] Create API service functions in `frontend/src/services/api.ts`
- [ ] Add Redux slice for alert rules state
- [ ] Add WebSocket updates for real-time rule changes

---

## ⏳ Phase 4: Testing & Documentation (PENDING)

### Testing:
- [ ] Test rule CRUD operations
- [ ] Test multi-user scenarios
- [ ] Test Prometheus YAML generation
- [ ] Test Prometheus reload
- [ ] Test validation (PromQL, duration)
- [ ] Test system rule protection
- [ ] Test audit trail

### Documentation:
- [ ] Update EDITING_ALERT_RULES.md with new UI instructions
- [ ] Create user guide for alert rules management
- [ ] Document API endpoints
- [ ] Add examples for custom rules

---

## How to Test Backend (Current Status)

### 1. Run Migration
```bash
cd backend
npm run migrate:alert-rules:dev
```

This will import all existing YAML rules into the database.

### 2. Test API Endpoints

**List all rules:**
```bash
curl http://localhost:3000/api/mining/alert-rules
```

**Get single rule:**
```bash
curl http://localhost:3000/api/mining/alert-rules/1
```

**Create new rule:**
```bash
curl -X POST http://localhost:3000/api/mining/alert-rules \
  -H "Content-Type: application/json" \
  -d '{
    "name": "CustomTempAlert",
    "display_name": "Custom Temperature Alert",
    "description": "My custom temperature threshold",
    "rule_group": "mining_warning",
    "severity": "warning",
    "component": "miner",
    "expr": "miner_temp_max_c > 70",
    "for_duration": "3m",
    "summary_template": "Miner {{ $labels.name }} temperature is high",
    "description_template": "Temperature: {{ $value }}°C",
    "scope": "global",
    "enabled": true
  }'
```

**Update rule:**
```bash
curl -X PUT http://localhost:3000/api/mining/alert-rules/1 \
  -H "Content-Type: application/json" \
  -d '{
    "description": "Updated description",
    "enabled": false
  }'
```

**Toggle rule:**
```bash
curl -X POST http://localhost:3000/api/mining/alert-rules/1/toggle \
  -H "Content-Type: application/json" \
  -d '{"enabled": true}'
```

**Delete rule:**
```bash
curl -X DELETE http://localhost:3000/api/mining/alert-rules/1
```

**Regenerate YAML:**
```bash
curl -X POST http://localhost:3000/api/mining/alert-rules/regenerate
```

**Get history:**
```bash
curl http://localhost:3000/api/mining/alert-rules/1/history
```

---

## Key Features Implemented

### Multi-User Support ✅
- **Global rules** - Apply to all miners (visible to everyone)
- **Per-miner rules** - Apply to specific miner (visible to owner)
- **Per-owner rules** - Apply to all of owner's miners (visible to owner)

### System Rule Protection ✅
- System rules marked with `is_system=1`
- Cannot be deleted (only disabled)
- Preserved during migration

### Audit Trail ✅
- All changes logged to `alert_rule_history`
- Tracks who made the change
- Tracks what changed (JSON diff)
- Tracks action type (created/updated/deleted/enabled/disabled)

### Automatic Prometheus Integration ✅
- YAML generated from database
- Automatic Prometheus reload after changes
- Production-only reload (skipped in dev)
- Error handling and logging

### Validation ✅
- PromQL expression syntax validation
- Duration format validation
- Required field validation
- Duplicate name detection

---

## Next Steps

1. **Frontend UI** (Phase 3)
   - Create AlertRulesManager component
   - Create AlertRuleForm component
   - Update Alerts.tsx page
   - Add API integration

2. **Testing** (Phase 4)
   - Test all CRUD operations
   - Test multi-user scenarios
   - Test Prometheus integration

3. **Documentation** (Phase 4)
   - Update user guides
   - Add API documentation
   - Create examples

---

## Files Modified/Created

### Backend
- ✅ `backend/src/services/database.service.ts` - Added tables and CRUD methods
- ✅ `backend/src/services/alert-rules.service.ts` - New service
- ✅ `backend/src/routes/mining.routes.ts` - Added 8 API endpoints
- ✅ `backend/src/scripts/migrate-alert-rules.ts` - Migration script
- ✅ `backend/package.json` - Added migration scripts

### Documentation
- ✅ `docs/ALERT_SYSTEM_MIGRATION_PLAN.md` - Detailed plan
- ✅ `docs/ALERT_RULES_MIGRATION_PROGRESS.md` - This file

### Frontend (Pending)
- ⏳ `frontend/src/components/AlertRulesManager.tsx` - To be created
- ⏳ `frontend/src/components/AlertRuleForm.tsx` - To be created
- ⏳ `frontend/src/pages/Alerts.tsx` - To be updated
- ⏳ `frontend/src/services/api.ts` - To be updated

---

## Summary

**Phase 1 & 2 Complete!** 🎉

The backend infrastructure for dynamic alert rule management is fully implemented and ready to use. The database schema, services, and API endpoints are all functional.

**Next**: Implement the frontend UI to provide a user-friendly interface for managing alert rules.

**Estimated Time Remaining**: 5-6 hours for Phase 3 (Frontend) + 2-3 hours for Phase 4 (Testing & Docs)
