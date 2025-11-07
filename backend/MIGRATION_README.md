# YAML to Database Migration Guide

This guide explains how to migrate your miner configuration from `etc/miners.yaml` to the new SQLite database.

## Prerequisites

1. **Set Admin Telegram Chat ID**
   
   All miners will be assigned to this chat ID as the owner during migration.
   
   ```bash
   export ADMIN_TELEGRAM_CHAT_ID="your_telegram_chat_id"
   ```
   
   To find your Telegram chat ID:
   - Send `/whoami` to your Telegram bot
   - Copy the Chat ID from the response

2. **Verify miners.yaml exists**
   
   Ensure your miners configuration file exists at `etc/miners.yaml`

## Running the Migration

### Option 1: Using npm script (Recommended)

```bash
cd backend
export ADMIN_TELEGRAM_CHAT_ID="123456789"
npm run migrate
```

### Option 2: Direct execution

```bash
cd backend
export ADMIN_TELEGRAM_CHAT_ID="123456789"
npx ts-node src/scripts/migrate-yaml-to-db.ts
```

### Option 3: Custom YAML path

```bash
export ADMIN_TELEGRAM_CHAT_ID="123456789"
export MINERS_YAML_PATH="/path/to/your/miners.yaml"
npm run migrate
```

## What the Migration Does

1. **Reads** all miners from `etc/miners.yaml`
2. **Validates** each miner has required fields (ip, name, model)
3. **Converts** YAML format to database records
4. **Inserts** or updates each miner in the `miners` table
5. **Assigns** all miners to the specified admin chat ID as owner
6. **Reports** success/failure for each miner

## Migration Output

The script will display:
- Progress for each miner
- Summary of successful and failed migrations
- Next steps

Example output:
```
✓ Migrated: miner-01 (192.168.1.100)
✓ Migrated: miner-02 (192.168.1.101)
✓ Migrated: miner-03 (192.168.1.102)

============================================================
Migration Summary:
  Total miners in YAML: 3
  Successfully migrated: 3
  Failed: 0
  Owner (admin): 123456789
============================================================
✓ Migration completed successfully!
```

## Post-Migration Steps

1. **Verify the data**
   
   Check the database to ensure all miners were migrated correctly:
   ```bash
   sqlite3 data/mining-stats.db "SELECT ip, name, model, owner FROM miners;"
   ```

2. **Update services**
   
   Services will need to be updated to read from the database instead of YAML.
   This will be handled in Phase 2 of the migration plan.

3. **Backup YAML file**
   
   Consider backing up the original YAML file:
   ```bash
   cp etc/miners.yaml etc/miners.yaml.backup
   ```

## Troubleshooting

### Error: ADMIN_TELEGRAM_CHAT_ID not set

```
ADMIN_TELEGRAM_CHAT_ID environment variable is required
```

**Solution:** Set the environment variable before running the migration.

### Error: YAML file not found

```
Miners YAML file not found at: etc/miners.yaml
```

**Solution:** 
- Ensure the file exists at `etc/miners.yaml`
- Or set `MINERS_YAML_PATH` to the correct location

### Error: Invalid YAML format

```
Invalid YAML format: "miners" array not found
```

**Solution:** Verify your YAML file has the correct structure:
```yaml
miners:
  - ip: "192.168.1.100"
    name: "miner-01"
    model: "Antminer S19"
    # ... other fields
```

### Migration completed with errors

If some miners failed to migrate, check the logs for specific errors.
Common issues:
- Missing required fields (ip, name, model)
- Duplicate IPs or names
- Invalid data types

## Re-running the Migration

The migration script is **idempotent** - it can be run multiple times safely.
It uses `INSERT OR REPLACE`, so:
- Existing miners will be updated
- New miners will be added
- No duplicates will be created

## Database Schema

The `miners` table structure:

| Column | Type | Description |
|--------|------|-------------|
| ip | TEXT | Primary key, miner IP address |
| name | TEXT | Unique miner name |
| model | TEXT | Miner model |
| alias | TEXT | Friendly display name |
| owner | TEXT | Telegram chat ID of owner |
| status | TEXT | 'active', 'inactive', etc. |
| credentials | TEXT | JSON string with username/password |
| use_https | INTEGER | 0 or 1 (boolean) |
| static_power | INTEGER | Power consumption in watts |
| api_port | INTEGER | Custom API port |
| created_at | INTEGER | Unix timestamp |
| updated_at | INTEGER | Unix timestamp |

## Next Steps

After successful migration:
1. Proceed to **Task 1.3**: Implement core security layer
2. Update services to use database instead of YAML (Phase 2)
3. Test multi-user functionality
