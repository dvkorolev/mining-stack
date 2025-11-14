# Pool Account Assignment to Miners

## Summary

Added ability to assign pool accounts to individual miners through the Miners page edit dialog.

## What Was Changed

### Frontend: Miners.tsx ✅

**Added**:
1. Import `getPoolAccounts` and `PoolAccount` from API service
2. State variable `poolAccounts` to store available pool accounts
3. Field `pool_account_id` to formData
4. Pool account dropdown in the edit dialog
5. Load pool accounts when opening edit dialog
6. Fixed TypeScript types for `handleInputChange` to support null values

**New Dropdown Field**:
- Label: "Pool Account"
- Options: None + all available pool accounts
- Display format: `{account_name} ({pool_name})`
- Optional field (can be set to None)

### Backend ✅ (Already Complete)
- Database: `miners.pool_account_id` column already exists
- API: `updateMiner()` already handles `pool_account_id`

## Services Used

For this feature, only **1 service** is needed:
- **`api.ts`**: 
  - `getPoolAccounts()` - fetch pool accounts for dropdown
  - `updateMiner()` - save miner with pool_account_id

## NOT Used for This Feature

These services serve different purposes:
- `minerPoolsApi.ts` - For stratum pool assignments (mining pool URLs)
- `poolsApi.ts` - For managing pool configurations
- `apiSlice.ts` - Redux wrapper (optional)

## User Flow

1. User clicks "Edit" on a miner in Miners.tsx
2. Dialog opens and loads available pool accounts
3. User selects a pool account from dropdown (or None)
4. User clicks "Update"
5. Miner is updated with selected pool_account_id

## Benefits

- Link miners to pool accounts for reward tracking
- Easy assignment/reassignment through UI
- Pool account data (rewards, payouts) can be viewed on Pool Monitoring page
- Per-miner pool account management as requested

## Testing

1. Navigate to Miners page
2. Click "Edit" on any miner
3. See "Pool Account" dropdown at bottom of form
4. Select a pool account or leave as "None"
5. Click "Update"
6. Miner is saved with pool account assignment
