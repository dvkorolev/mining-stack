# Pools.yaml Integration - Implementation Progress

## Overview

Implementing full integration of `pools.yaml` configuration across the entire stack to make pool monitoring a first-class, user-configurable feature.

---

## ✅ Completed

### 1. Backend API Endpoints

**Files Created**:
- `backend/src/services/pools-config.service.ts` - Pool configuration management service
- `backend/src/routes/pools.routes.ts` - RESTful API routes for pool management

**Files Modified**:
- `backend/src/server.ts` - Registered pools routes

**API Endpoints**:
- `GET /api/pools/config` - Get full pools configuration
- `POST /api/pools/config` - Update full pools configuration
- `GET /api/pools` - Get list of pools
- `POST /api/pools` - Add a new pool
- `PUT /api/pools/:url` - Update a pool
- `DELETE /api/pools/:url` - Delete a pool
- `POST /api/pools/test/:url` - Test connection to a pool
- `POST /api/pools/collect` - Trigger immediate pool collection

**Features**:
- ✅ CRUD operations for pools
- ✅ Configuration validation
- ✅ Automatic collection triggering on changes
- ✅ Connection testing
- ✅ Error handling and logging

### 2. Python-Scheduler Enhancements

**Files Modified**:
- `python-scheduler/main.py` - Enhanced pool metrics collection

**Changes**:
- ✅ Updated `collect_pool_network_metrics_from_config()` to use distinct collector label: `pool_network_config`
- ✅ Added `source='pools_yaml'` to distinguish from miner-discovered pools
- ✅ Added `/collect-pools` endpoint to trigger pool collection via API

**Metrics Labels**:
- Pools from `pools.yaml`: `collector='pool_network_config'`, `source='pools_yaml'`
- Pools from miners: `collector='pool_network'`, `source='miner_discovery'`

### 3. Frontend API Service

**Files Created**:
- `frontend/src/services/poolsApi.ts` - TypeScript API client for pool management

**Functions**:
- ✅ `getPoolsConfig()` - Fetch configuration
- ✅ `updatePoolsConfig()` - Update configuration
- ✅ `getPools()` - Get pool list
- ✅ `addPool()` - Add new pool
- ✅ `updatePool()` - Update existing pool
- ✅ `deletePool()` - Delete pool
- ✅ `testPool()` - Test pool connection
- ✅ `triggerPoolCollection()` - Trigger collection

---

## 🚧 In Progress / TODO

### 4. React Frontend UI Component

**Files to Create**:
- `frontend/src/pages/PoolsManagement.tsx` - Main pools management page
- `frontend/src/components/pools/PoolsList.tsx` - Pool list component
- `frontend/src/components/pools/PoolForm.tsx` - Add/Edit pool form
- `frontend/src/components/pools/PoolTestButton.tsx` - Test connection button

**Features to Implement**:
- [ ] Pool list with status indicators
- [ ] Add/Edit/Delete pool functionality
- [ ] Test connection button for each pool
- [ ] Configuration settings panel (test_interval, enable_ping, etc.)
- [ ] Real-time status updates
- [ ] Validation and error handling
- [ ] Responsive design

### 5. Navigation Integration

**Files to Modify**:
- `frontend/src/App.tsx` or routing configuration
- Navigation menu/sidebar

**Changes Needed**:
- [ ] Add "Pools" menu item
- [ ] Add route for `/pools` page
- [ ] Add icon for pools section

### 6. Documentation

**Files to Create**:
- `POOLS_MANAGEMENT_GUIDE.md` - User guide for pool management feature

**Content Needed**:
- [ ] Feature overview
- [ ] API documentation
- [ ] UI usage guide
- [ ] Configuration options
- [ ] Troubleshooting

---

## Architecture

### Data Flow

```
┌─────────────────────────────────────────────────────────┐
│                    React Frontend                       │
│  ┌─────────────────────────────────────────────────┐   │
│  │  PoolsManagement Page                           │   │
│  │  - View pools list                              │   │
│  │  - Add/Edit/Delete pools                        │   │
│  │  - Test connections                             │   │
│  │  - Configure settings                           │   │
│  └─────────────────────────────────────────────────┘   │
│                         ↓                               │
│  ┌─────────────────────────────────────────────────┐   │
│  │  poolsApi.ts (API Client)                       │   │
│  └─────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────┘
                         ↓
┌─────────────────────────────────────────────────────────┐
│                    Backend API                          │
│  ┌─────────────────────────────────────────────────┐   │
│  │  pools.routes.ts                                │   │
│  │  - GET/POST/PUT/DELETE /api/pools               │   │
│  │  - POST /api/pools/test/:url                    │   │
│  │  - POST /api/pools/collect                      │   │
│  └─────────────────────────────────────────────────┘   │
│                         ↓                               │
│  ┌─────────────────────────────────────────────────┐   │
│  │  pools-config.service.ts                        │   │
│  │  - Load/Save pools.yaml                         │   │
│  │  - Validation                                   │   │
│  │  - Trigger python-scheduler                     │   │
│  └─────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────┘
                         ↓
┌─────────────────────────────────────────────────────────┐
│                Python-Scheduler                         │
│  ┌─────────────────────────────────────────────────┐   │
│  │  /collect-pools endpoint                        │   │
│  │  - Trigger pool collection                      │   │
│  └─────────────────────────────────────────────────┘   │
│                         ↓                               │
│  ┌─────────────────────────────────────────────────┐   │
│  │  collect_pool_network_metrics_from_config()     │   │
│  │  - Load pools.yaml                              │   │
│  │  - Test TCP connections                         │   │
│  │  - Update Prometheus metrics                    │   │
│  │  - Label: collector='pool_network_config'       │   │
│  │  - Label: source='pools_yaml'                   │   │
│  └─────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────┘
                         ↓
┌─────────────────────────────────────────────────────────┐
│                    Prometheus                           │
│  - Scrapes metrics from python-scheduler                │
│  - Stores time-series data                              │
│  - Distinguishes pools.yaml vs miner-discovered pools   │
└─────────────────────────────────────────────────────────┘
```

---

## API Examples

### Get Pools Configuration

```bash
curl http://localhost:5000/api/pools/config
```

Response:
```json
{
  "success": true,
  "config": {
    "pools": [
      {
        "url": "stratum.slushpool.com:3333",
        "name": "SlushPool",
        "algorithm": "sha256",
        "priority": "high"
      }
    ],
    "config": {
      "test_interval": 5,
      "enable_ping": false,
      "connection_timeout": 5,
      "dns_timeout": 3
    }
  }
}
```

### Add a Pool

```bash
curl -X POST http://localhost:5000/api/pools \
  -H "Content-Type: application/json" \
  -d '{
    "url": "stratum.f2pool.com:3333",
    "name": "F2Pool",
    "algorithm": "sha256",
    "priority": "high"
  }'
```

### Test Pool Connection

```bash
curl -X POST http://localhost:5000/api/pools/test/stratum.slushpool.com%3A3333
```

Response:
```json
{
  "success": true,
  "message": "Pool is reachable",
  "url": "stratum.slushpool.com:3333",
  "hostname": "stratum.slushpool.com",
  "port": 3333,
  "duration_ms": 45,
  "status": "online"
}
```

---

## Next Steps

1. **Create React UI Components** (Priority: High)
   - PoolsManagement page
   - Pool list with CRUD operations
   - Configuration panel

2. **Add Navigation** (Priority: High)
   - Add "Pools" menu item
   - Configure routing

3. **Testing** (Priority: Medium)
   - Test all API endpoints
   - Test UI functionality
   - Test error handling

4. **Documentation** (Priority: Medium)
   - User guide
   - API documentation
   - Screenshots

5. **Polish** (Priority: Low)
   - Add loading states
   - Add success/error notifications
   - Add confirmation dialogs
   - Improve styling

---

## Benefits

Once complete, this feature will provide:

- ✅ **User-Friendly Management**: No need to manually edit YAML files
- ✅ **Real-Time Testing**: Test pool connections before adding them
- ✅ **Automatic Updates**: Changes trigger immediate collection
- ✅ **Clear Metrics**: Distinguish pools.yaml from miner-discovered pools
- ✅ **Production-Ready**: Full validation and error handling
- ✅ **V3 Architecture**: Fully integrated with APScheduler and state management

---

## Status: 60% Complete

**Completed**: Backend API, Python-Scheduler enhancements, Frontend API service  
**Remaining**: React UI components, Navigation, Documentation
