# Pool Monitoring Implementation

## Overview
This document tracks the implementation of pool monitoring functionality, allowing users to connect their mining pool accounts (EMCD, etc.) to view rewards, payouts, and account information.

## Backend Implementation ✅ COMPLETED

### 1. Database Schema ✅
**File**: `backend/src/services/database.service.ts`

Added new tables:
- `pool_apis`: Stores pool API configurations (name, base URL)
- `pool_accounts`: Stores user pool accounts with encrypted API keys
- `miners.pool_account_id`: Foreign key linking miners to pool accounts

### 2. Pool Service ✅
**File**: `backend/src/services/pool.service.ts`

Features:
- API key encryption/decryption using AES-256-CBC
- EMCD API integration functions:
  - `getPoolUserInfo()`: Fetch account info
  - `getPoolRewards()`: Fetch rewards history
  - `getPoolPayouts()`: Fetch payout history
  - `getPoolWorkers()`: Fetch worker stats
- Extensible design for adding more pool APIs

### 3. API Routes ✅
**File**: `backend/src/routes/pool.routes.ts`

Endpoints:
- **Pool API Management**:
  - `GET /api/pool-apis`: List all pool APIs
  - `POST /api/pool-apis`: Add new pool API
  - `PUT /api/pool-apis/:id`: Update pool API
  - `DELETE /api/pool-apis/:id`: Delete pool API

- **Pool Account Management**:
  - `GET /api/pool-accounts`: List all accounts (sanitized, no API keys)
  - `GET /api/pool-accounts/:id`: Get specific account
  - `POST /api/pool-accounts`: Create account (encrypts API key)
  - `PUT /api/pool-accounts/:id`: Update account
  - `DELETE /api/pool-accounts/:id`: Delete account

- **Pool Data Proxy** (secure, API keys never exposed to frontend):
  - `GET /api/pool-data/:accountId/info`: Get user info
  - `GET /api/pool-data/:accountId/rewards?coin=btc`: Get rewards
  - `GET /api/pool-data/:accountId/payouts?coin=btc`: Get payouts
  - `GET /api/pool-data/:accountId/workers?coin=btc`: Get workers

### 4. Miner Updates ✅
**File**: `backend/src/config/miners.config.ts`

- Updated `updateMiner()` to support `pool_account_id` field
- Miners can now be assigned to a pool account

### 5. Server Configuration ✅
**File**: `backend/src/server.ts`

- Mounted pool routes at `/api`
- Routes are protected by optional authentication middleware

## Frontend Implementation ✅ COMPLETED

### 1. API Service ✅
**File**: `frontend/src/services/api.ts`

Features:
- Added TypeScript interfaces: `PoolApi`, `PoolAccount`, `PoolUserInfo`, `PoolReward`, `PoolPayout`
- Added functions to manage pool accounts: `getPoolApis()`, `getPoolAccounts()`, `createPoolAccount()`, `updatePoolAccount()`, `deletePoolAccount()`
- Added functions to fetch pool data: `getPoolUserInfo()`, `getPoolRewards()`, `getPoolPayouts()`

### 2. Pools Page ✅
**File**: `frontend/src/pages/Pools.tsx`

Features:
- Full-featured pool monitoring page with Material-UI
- List of pool accounts with edit/delete actions
- Add/Edit pool account modal with form validation
- Tabbed interface for viewing:
  - Account Info (balance, total paid, payout address)
  - Rewards history table
  - Payouts history table
- Real-time data loading with loading states
- Error handling and user feedback
- Route added at `/pool-monitoring` in `App.tsx`
- Link added to `Sidebar.tsx` with wallet icon

### 3. Miners Page Update ✅ COMPLETED
**File**: `frontend/src/pages/Miners.tsx`

Features:
- Added pool account dropdown in Edit Miner dialog
- Loads available pool accounts when dialog opens
- Shows format: `{account_name} ({pool_name})`
- Allows setting pool_account_id to null (None)
- Saves pool_account_id when updating miner

**Only uses `api.ts`** - No need for other API services for this feature

## Deployment ⏳ PENDING

TODO:
- Build backend and frontend
- Deploy to Raspberry Pi
- Test end-to-end functionality

## Security Considerations

1. **API Key Encryption**: All pool API keys are encrypted using AES-256-CBC before storage
2. **Proxy Pattern**: Frontend never sees API keys; all pool API calls are proxied through backend
3. **Environment Variable**: Encryption key stored in `POOL_API_ENCRYPTION_KEY` env var
4. **Authentication**: All routes protected by optional auth middleware

## EMCD API Reference

Base URL: `https://api.emcd.io/v2`

Endpoints used:
- `GET /info/{api_key}`: User account information
- `GET /{coin}/income/{api_key}`: Rewards history
- `GET /{coin}/payouts/{api_key}`: Payout history
- `GET /{coin}/workers/{api_key}`: Worker statistics

Supported coins: `btc`, `ltc`, `bch`, `bsv`, `etc`

## Next Steps

1. ✅ Complete backend implementation
2. ⏳ Implement frontend API service
3. ⏳ Create Pools page
4. ⏳ Update Miners page
5. ⏳ Build and deploy
6. ⏳ Test with real EMCD account
