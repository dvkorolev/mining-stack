# Pool Earnings - Simplified Refactoring Plan

## 🎯 Core Concept

**Miners = Source of Truth for Pool Configuration**
- Miners already have pool settings (URL, worker name)
- Miners page already has "Sync from Hardware" button
- Worker name format: `username.workername` (inherently links miner to pool account)

**Pool Earnings Page = API Integration for Monitoring ONLY**
- Add pool API accounts (EMCD, etc.) with API keys
- View earnings, payouts, workers from pool API
- NO manual pool configuration
- NO pool tracking tables needed

---

## 📊 Current State Analysis

### What EXISTS and WORKS ✅
1. **Miners Page** (`Miners.tsx`)
   - View miner details (click on miner)
   - "Sync from Hardware" button gets pools from miner
   - Shows pool configuration per miner
   - `getMinerPools()` API already working

2. **Pool Monitoring** (`Pools.tsx` at `/pool-monitoring`)
   - Add/edit pool accounts (API keys)
   - View earnings from EMCD API
   - Shows rewards, payouts, workers
   - Secure API key encryption

3. **Backend Services**
   - `pool.service.ts` - EMCD API integration ✅
   - `miner-control.service.ts` - Get pools from miners ✅
   - Database tables: `pool_accounts`, `pool_apis` ✅

### What is REDUNDANT ❌
1. **PoolsManagement Page** (`PoolsManagement.tsx` at `/pools`)
   - Manual pool add/edit/delete
   - Pool configuration settings
   - Test pool connections
   - **NOT NEEDED** - miners already have pool configs!

2. **Components to Remove**:
   - `PoolsList.tsx` - Manual pool list ❌
   - `PoolForm.tsx` - Manual pool add/edit form ❌
   - `PoolConfigPanel.tsx` - Pool testing config ❌
   - **KEEP**: `SyncResultsDialog.tsx` - Reusable ✅

3. **Database Tables to Remove**:
   - `pools` table - Redundant ❌
   - `pool_config` table - Not needed ❌
   - `miner_pools` table - Already exists, keep as-is ✅

### What is MISSING 🆕
- Better name for Pool Monitoring page ("Pool Earnings" or "Earnings Monitor")
- Direct visibility of which miners use which pool (via worker names)
- Aggregated earnings view across all accounts
- Better UX to understand pool account → miners relationship

---

## ✅ Simplified Solution

### Architecture

```
┌──────────────────────────────────────────────────────────┐
│                     DATA FLOW                            │
├──────────────────────────────────────────────────────────┤
│                                                          │
│  1. MINERS (Hardware) = Pool Configuration               │
│     ├─> Each miner has pools with worker names          │
│     ├─> Worker name format: username.minername          │
│     └─> "Sync from Hardware" gets this data             │
│                                                          │
│  2. POOL ACCOUNTS (Database) = API Keys                  │
│     ├─> User adds EMCD account with API key             │
│     ├─> API key is encrypted and stored                 │
│     └─> No link to pools table (doesn't exist!)         │
│                                                          │
│  3. POOL EARNINGS PAGE (Frontend)                        │
│     ├─> Manage pool accounts (add/edit/delete)          │
│     ├─> Fetch earnings from pool APIs                   │
│     ├─> Show which miners are on this account           │
│     │   (match worker names to configured miners)       │
│     └─> Display rewards, payouts, workers               │
│                                                          │
│  BENEFIT: No redundant pool storage!                     │
│           Miners own their config                        │
│           Pool Earnings focuses on API data only         │
│                                                          │
└──────────────────────────────────────────────────────────┘
```

### Database Schema (Simplified)

```sql
-- REMOVE COMPLETELY
DROP TABLE IF EXISTS pools;
DROP TABLE IF EXISTS pool_config;
-- Note: miner_pools stays as-is (it's the actual miner config)

-- KEEP (existing tables)
CREATE TABLE pool_apis (
  id INTEGER PRIMARY KEY,
  name TEXT UNIQUE NOT NULL,          -- "EMCD", "ViaBTC", etc.
  api_base_url TEXT NOT NULL,
  supports_algorithms TEXT            -- JSON: ["sha256", "scrypt"]
);

CREATE TABLE pool_accounts (
  id INTEGER PRIMARY KEY,
  pool_api_id INTEGER NOT NULL,
  account_name TEXT NOT NULL,         -- User's descriptive name
  username TEXT,                      -- Pool username (for matching)
  api_key TEXT NOT NULL,              -- Encrypted
  coin TEXT DEFAULT 'btc',
  notes TEXT,
  created_at INTEGER,
  updated_at INTEGER,
  FOREIGN KEY (pool_api_id) REFERENCES pool_apis(id)
);

-- Keep existing
CREATE TABLE miner_pools (
  miner_ip TEXT NOT NULL,
  pool_url TEXT NOT NULL,
  pool_priority INTEGER,
  pool_user TEXT NOT NULL,            -- Format: username.workername
  pool_password TEXT,
  synced_at INTEGER,
  PRIMARY KEY (miner_ip, pool_priority)
);
```

**Key Addition**: `username` field in `pool_accounts` to match against `pool_user` in `miner_pools`

---

## 📋 Step-by-Step Implementation Plan

### Phase 1: Backend Cleanup (1-2 hours) 🔧

#### Step 1.1: Database Migration
**File**: `backend/src/services/database.service.ts`

**Actions**:
```sql
-- 1. Backup first!
-- 2. Add username field to pool_accounts
ALTER TABLE pool_accounts ADD COLUMN username TEXT;

-- 3. Drop redundant tables
DROP TABLE IF EXISTS pools;
DROP TABLE IF EXISTS pool_config;

-- 4. Clean up any foreign key references (if exist)
-- miner_pools.pool_id can be removed if it exists
```

**Code Changes**:
- Remove `getAllPools()`, `getPoolById()`, etc.
- Remove `getAllPoolConfig()`, `setPoolConfig()`, etc.
- Update `pool_accounts` methods to include `username` field

**Time**: 30 minutes

#### Step 1.2: Remove Pool Management Routes
**File**: `backend/src/routes/pools.routes.ts`

**Actions**:
- DELETE entire file (it's for manual pool management)
- Keep `backend/src/routes/pool.routes.ts` (for pool API integration)

**File**: `backend/src/server.ts`

**Changes**:
```typescript
// REMOVE
import poolsRoutes from './routes/pools.routes';
app.use('/api', poolsRoutes);

// KEEP
import poolRoutes from './routes/pool.routes';
app.use('/api', poolRoutes);
```

**Time**: 15 minutes

#### Step 1.3: Remove Pool Config Service
**File**: `backend/src/services/pools-config.service.ts`

**Actions**:
- DELETE entire file
- It was for manual pool management (loading/saving pools YAML/DB)
- No longer needed

**Update imports** in any files that reference it (likely none after route removal)

**Time**: 15 minutes

#### Step 1.4: Update Pool Account Methods
**File**: `backend/src/services/database.service.ts`

**Update PoolAccountRecord interface**:
```typescript
export interface PoolAccountRecord {
  id?: number;
  pool_api_id: number;
  account_name: string;
  username?: string;        // NEW: Pool username for matching
  api_key: string;
  coin?: string;
  notes?: string;
  created_at?: number;
  updated_at?: number;
}
```

**Update methods**:
```typescript
createPoolAccount(account: Omit<PoolAccountRecord, 'id'>): PoolAccountRecord {
  // Include username field
}

updatePoolAccount(id: number, updates: Partial<PoolAccountRecord>): void {
  // Include username field
}
```

**Time**: 20 minutes

---

### Phase 2: Frontend Cleanup (2-3 hours) 🎨

#### Step 2.1: Delete Redundant Components
**Delete these files**:
```bash
rm frontend/src/pages/PoolsManagement.tsx
rm frontend/src/components/pools/PoolsList.tsx
rm frontend/src/components/pools/PoolForm.tsx
rm frontend/src/components/pools/PoolConfigPanel.tsx
```

**Keep**:
- `frontend/src/components/pools/SyncResultsDialog.tsx` ✅
- `frontend/src/pages/Pools.tsx` ✅ (will rename and enhance)

**Time**: 5 minutes

#### Step 2.2: Remove API Functions
**File**: `frontend/src/services/poolsApi.ts`

**Actions**:
- DELETE entire file (it's for manual pool management)
- All pool API integration functions are in `frontend/src/services/api.ts` already

**Update imports** in `Pools.tsx` to use `api.ts` instead

**Time**: 10 minutes

#### Step 2.3: Update Navigation
**File**: `frontend/src/App.tsx`

**Changes**:
```typescript
// REMOVE
const PoolsManagement = lazy(() => import('./pages/PoolsManagement'));
<Route path="/pools" element={<PoolsManagement />} />

// KEEP & RENAME
const PoolEarnings = lazy(() => import('./pages/PoolEarnings'));
<Route path="/pool-earnings" element={<PoolEarnings />} />
```

**File**: `frontend/src/components/Sidebar.tsx`

**Changes**:
```typescript
// Change menu item
{
  label: 'Pool Earnings',     // Was: "Pool Monitoring"
  path: '/pool-earnings',     // Was: "/pool-monitoring"
  icon: <AccountBalanceWalletIcon />,
  adminOnly: false,
}

// Remove old "Pools" menu item if exists
```

**Time**: 15 minutes

#### Step 2.4: Rename & Enhance Pool Earnings Page
**File**: `frontend/src/pages/Pools.tsx` → Rename to `PoolEarnings.tsx`

**Layout Design**:
```typescript
┌────────────────────────────────────────────────────┐
│  Pool Earnings                        [Refresh]    │
├────────────────────────────────────────────────────┤
│                                                    │
│  📊 Summary Cards                                  │
│  ┌───────────┐ ┌───────────┐ ┌───────────┐       │
│  │ Balance   │ │ Today     │ │ This Week │       │
│  │ 0.05 BTC  │ │ 0.001 BTC │ │ 0.008 BTC │       │
│  └───────────┘ └───────────┘ └───────────┘       │
│                                                    │
│  🔑 Pool Accounts                    [+ Add]      │
│  ┌──────────────────────────────────────────┐     │
│  │ Account      │ Pool  │ Username │ Miners │     │
│  ├──────────────┼───────┼──────────┼────────┤     │
│  │ My BTC EMCD  │ EMCD  │ myuser   │ 15 [↗] │     │
│  │ DG1 Litecoin │ EMCD  │ ltcuser  │ 1  [↗] │     │
│  └──────────────────────────────────────────┘     │
│                                                    │
│  [Selected: My BTC EMCD]                          │
│  ┌──────────────────────────────────────────┐     │
│  │ Tabs: Info │ Rewards │ Payouts │ Workers │     │
│  ├──────────────────────────────────────────┤     │
│  │ 💰 Balance: 0.05 BTC                     │     │
│  │ 💸 Total Paid: 1.2 BTC                   │     │
│  │ 📍 Payout Address: bc1q...               │     │
│  │                                           │     │
│  │ 🖥️  Miners using this account: 15        │     │
│  │    Click to view list →                  │     │
│  └──────────────────────────────────────────┘     │
│                                                    │
└────────────────────────────────────────────────────┘
```

**New Features**:

1. **Summary Cards** (top)
   - Total balance across all accounts
   - Today's earnings
   - This week's earnings

2. **Pool Accounts Table** (middle)
   - Account name, Pool API, Username
   - **NEW**: "Miners" column showing count
   - Click count to see which miners use this account

3. **Account Details** (bottom)
   - Existing tabs (Info, Rewards, Payouts)
   - **NEW**: Miners list (shows miners with matching username in worker name)

**Code Structure**:
```typescript
// New function to get miners for account
const getMinersForAccount = (account: PoolAccount, allMiners: Miner[]) => {
  if (!account.username) return [];
  
  return allMiners.filter(miner => 
    miner.pools?.some(pool => 
      pool.user?.startsWith(account.username + '.')
    )
  );
};

// New component: MinersDialog
const MinersDialog = ({ open, onClose, miners, accountName }) => (
  <Dialog open={open} onClose={onClose}>
    <DialogTitle>Miners using {accountName}</DialogTitle>
    <DialogContent>
      <Table>
        <TableHead>
          <TableRow>
            <TableCell>Name</TableCell>
            <TableCell>IP</TableCell>
            <TableCell>Worker Name</TableCell>
            <TableCell>Pool URL</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {miners.map(miner => (
            <TableRow key={miner.ip}>
              <TableCell>{miner.name}</TableCell>
              <TableCell>{miner.ip}</TableCell>
              <TableCell>{miner.pools[0]?.user}</TableCell>
              <TableCell>{miner.pools[0]?.url}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </DialogContent>
  </Dialog>
);
```

**Time**: 2-2.5 hours

#### Step 2.5: Update Pool Account Form
**File**: `frontend/src/pages/PoolEarnings.tsx` (same file)

**Add username field to form**:
```typescript
const PoolAccountForm = () => {
  const [formData, setFormData] = useState({
    pool_api_id: 1,
    account_name: '',
    username: '',      // NEW: Pool username
    api_key: '',
    coin: 'btc',
    notes: '',
  });

  return (
    <Dialog>
      <DialogContent>
        <TextField
          label="Account Name"
          helperText="Descriptive name for this account"
        />
        <TextField
          label="Pool Username"
          helperText="Your username on the pool (for miner matching)"
          value={formData.username}
        />
        <TextField
          label="API Key"
          type="password"
          helperText="Your pool API key (encrypted)"
        />
        {/* ... */}
      </DialogContent>
    </Dialog>
  );
};
```

**Time**: 30 minutes

---

### Phase 3: Enhancements (Optional, 2-3 hours) 🎁

#### Step 3.1: Summary Dashboard
**Component**: `EarningsSummary.tsx`

**Features**:
- Aggregate balance from all accounts
- Calculate daily earnings (compare yesterday vs today)
- Calculate weekly earnings
- Show trend indicators (↑↓)

**Time**: 1-1.5 hours

#### Step 3.2: Earnings Charts
**Component**: `EarningsChart.tsx`

**Features**:
- Line chart: Earnings over time
- Bar chart: Earnings by account
- Pie chart: Distribution by coin (BTC, LTC, etc.)

**Libraries**: `recharts` or `chart.js`

**Time**: 1-1.5 hours

#### Step 3.3: Auto-Refresh
**Enhancement**: Periodic API data refresh

**Implementation**:
```typescript
useEffect(() => {
  const interval = setInterval(() => {
    if (selectedAccount) {
      loadPoolData(selectedAccount.id);
    }
  }, 300000); // 5 minutes

  return () => clearInterval(interval);
}, [selectedAccount]);
```

**Time**: 15 minutes

---

## 🔄 Migration & Deployment

### Pre-Deployment Checklist
- [ ] Backup database: `sqlite3 miners.db .dump > backup.sql`
- [ ] Test database migration locally
- [ ] Verify no references to deleted files
- [ ] Update imports in all files

### Deployment Steps

**Step 1: Backend**
```bash
cd backend
# Run migration
node -e "
  const db = require('better-sqlite3')('./data/miners.db');
  db.exec('ALTER TABLE pool_accounts ADD COLUMN username TEXT');
  db.exec('DROP TABLE IF EXISTS pools');
  db.exec('DROP TABLE IF EXISTS pool_config');
  db.close();
"

# Build and deploy
docker build -t localhost:5001/backend:latest .
docker push localhost:5001/backend:latest
```

**Step 2: Remote Deployment**
```bash
ssh admin@192.168.1.66 "cd /opt/mining-stack && \
  git pull && \
  docker compose -f docker-compose.prod.yml pull backend && \
  docker compose -f docker-compose.prod.yml up -d backend"
```

**Step 3: Frontend**
```bash
cd frontend
npm run build

# Deploy
ssh admin@192.168.1.66 "cd /opt/mining-stack && \
  docker compose -f docker-compose.prod.yml pull frontend && \
  docker compose -f docker-compose.prod.yml up -d frontend"
```

**Step 4: Verify**
```bash
# Check logs
ssh admin@192.168.1.66 "docker logs mining-stack-backend-1 --tail 50"

# Test API
curl http://192.168.1.66:5000/api/pool-accounts

# Open browser
open http://192.168.1.66/pool-earnings
```

---

## 📈 Benefits Summary

### Simplification
✅ **Removed 4 files**: PoolsManagement.tsx, PoolsList.tsx, PoolForm.tsx, PoolConfigPanel.tsx  
✅ **Removed 2 services**: pools-config.service.ts, poolsApi.ts  
✅ **Removed 2 DB tables**: pools, pool_config  
✅ **Removed 1 route file**: pools.routes.ts  

### Better UX
✅ **Single purpose**: Pool Earnings page focuses ONLY on API monitoring  
✅ **Clear data flow**: Miners → Pool Config, API Keys → Pool Earnings  
✅ **Better context**: See which miners use which accounts  
✅ **No confusion**: No manual pool management competing with miner configs  

### Maintainability
✅ **Less code**: ~1500 lines removed  
✅ **Clearer architecture**: Single source of truth (miners)  
✅ **Easier to extend**: Add new pool APIs (ViaBTC, F2Pool, etc.)  

---

## 🎯 Timeline

| Phase | Description | Time | Priority |
|-------|-------------|------|----------|
| **1.1** | Database migration | 30min | P0 |
| **1.2** | Remove pool routes | 15min | P0 |
| **1.3** | Remove pool config service | 15min | P0 |
| **1.4** | Update pool account methods | 20min | P0 |
| **2.1** | Delete redundant components | 5min | P0 |
| **2.2** | Remove poolsApi.ts | 10min | P0 |
| **2.3** | Update navigation | 15min | P0 |
| **2.4** | Rename & enhance page | 2-2.5h | P0 |
| **2.5** | Update account form | 30min | P0 |
| **3.1** | Summary dashboard | 1-1.5h | P1 |
| **3.2** | Earnings charts | 1-1.5h | P1 |
| **3.3** | Auto-refresh | 15min | P1 |
| **Total** | | **~6-9h** | |

**Recommended**: Do P0 tasks (Phase 1 & 2) first (~4-5 hours), then P1 enhancements later

---

## ✅ Success Criteria

### Functional
- [ ] Can add pool account with API key and username
- [ ] Can view earnings, rewards, payouts from EMCD
- [ ] Can see which miners use each pool account (by username matching)
- [ ] Summary cards show correct totals
- [ ] No manual pool management UI visible
- [ ] Miners page still shows pool config correctly

### Technical
- [ ] No references to deleted files
- [ ] Database migration successful
- [ ] All API endpoints working
- [ ] No console errors
- [ ] Tests passing (if any)

### User Experience
- [ ] Navigation clear (Pool Earnings in sidebar)
- [ ] Account → Miners relationship visible
- [ ] Loading states and error handling work
- [ ] Mobile responsive

---

## 🚀 Next Steps

**Ready to start?**

1. **Review this plan** - Any adjustments needed?
2. **Backup database** - Safety first!
3. **Start Phase 1** - Backend cleanup (1-1.5 hours)
4. **Continue Phase 2** - Frontend refactoring (2-3 hours)
5. **Test & Deploy** - Verify everything works
6. **Add Phase 3** - Enhancements (optional)

**Total time estimate**: 4-5 hours for core refactoring, +2-3 hours for enhancements

Shall we proceed? 🎯
