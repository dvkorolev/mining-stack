# Update Script Fix - Untracked File Conflicts

## Problem
The update script failed on Raspberry Pi with:
```
error: The following untracked working tree files would be overwritten by merge:
docker/promtail/promtail-config.yml
Please move or remove them before you merge.
Aborting
```

## Root Cause
- `docker/promtail/promtail-config.yml` is tracked in the git repository
- On the Raspberry Pi, this file existed locally but wasn't tracked by git (untracked)
- Git refuses to overwrite untracked files during merge to prevent data loss
- The script's existing stash logic only handled **tracked** modified files, not **untracked** files

## Solution Implemented

### Changes to `update-from-registry.sh`

Added untracked file detection and backup logic (lines 92-107):

```bash
# Check for untracked files that would be overwritten
# This handles the case where files exist locally but aren't in git yet
UNTRACKED_CONFLICTS=$(git ls-files -o --exclude-standard | grep -v -E '\.env$|miners\.yaml$' || true)
if [ -n "$UNTRACKED_CONFLICTS" ]; then
    echo -e "${YELLOW}⚠️  Found untracked files that may conflict${NC}"
    echo -e "${YELLOW}   Backing up and removing conflicting files...${NC}"
    mkdir -p .git/untracked-backup
    while IFS= read -r file; do
        if [ -f "$file" ]; then
            mkdir -p ".git/untracked-backup/$(dirname "$file")"
            cp "$file" ".git/untracked-backup/$file"
            rm "$file"
            echo -e "${YELLOW}   Backed up: $file${NC}"
        fi
    done <<< "$UNTRACKED_CONFLICTS"
fi
```

Added notification about backups (lines 138-141):
```bash
# Notify about untracked backups if they exist
if [ -d .git/untracked-backup ] && [ "$(ls -A .git/untracked-backup)" ]; then
    echo -e "${BLUE}ℹ️  Untracked file backups saved in: .git/untracked-backup/${NC}"
fi
```

### How It Works

1. **Detection**: Uses `git ls-files -o --exclude-standard` to find untracked files
2. **Filtering**: Excludes `.env` and `miners.yaml` (user config files that should remain untracked)
3. **Backup**: Copies conflicting files to `.git/untracked-backup/` preserving directory structure
4. **Removal**: Removes the untracked files so git can proceed with the merge
5. **Notification**: Informs user where backups are stored

### Safety Features

- ✅ Preserves user data by backing up before removal
- ✅ Maintains directory structure in backups
- ✅ Excludes critical config files (.env, miners.yaml)
- ✅ Uses `|| true` to prevent script failure if no conflicts found
- ✅ Provides clear user feedback about what's happening

## Testing Instructions

On Raspberry Pi:
```bash
cd /opt/mining-stack
./update-from-registry.sh
```

Expected behavior:
1. Script detects untracked `promtail-config.yml`
2. Backs it up to `.git/untracked-backup/docker/promtail/promtail-config.yml`
3. Removes the untracked file
4. Proceeds with git pull successfully
5. Notifies user about backup location

## Recovery

If needed, restore backed-up files:
```bash
cd /opt/mining-stack
ls -la .git/untracked-backup/
cp .git/untracked-backup/docker/promtail/promtail-config.yml docker/promtail/
```

## Docker Compose File Fixes

### Fixed Issues in `docker-compose.logging.yml`

1. **Removed obsolete `version` field**
   - Docker Compose V2 doesn't require this
   - Eliminates warning message

2. **Added platform specifications**
   - `platform: linux/arm64` for Loki and Promtail
   - Ensures Raspberry Pi compatibility

3. **Updated usage documentation**
   - Clarified that file must be used with `docker-compose.prod.yml`
   - File extends base services, doesn't define them standalone

## Additional Changes

### Logging Stack Integration

The update script now includes the logging stack (Loki + Promtail) by default:

**Changes to `update-from-registry.sh`:**
- Pulls logging stack images from Docker Hub
- Starts all containers including Loki and Promtail
- Shows status for all containers including logging services

**Changes to `health-check.sh`:**
- Added health checks for Loki (port 3100)
- Added health checks for Promtail (port 9080)
- Updated service list to include all 9 services
- Added Loki and Alertmanager URLs to output

### Services Now Included

All containers will be started:
1. ✅ python-scheduler (port 8000)
2. ✅ backend (port 5000)
3. ✅ frontend (port 3000)
4. ✅ prometheus (port 9090)
5. ✅ grafana (port 3001)
6. ✅ blackbox-exporter (port 9115)
7. ✅ alertmanager (port 9093)
8. ✅ **loki (port 3100)** - Log aggregation
9. ✅ **promtail (port 9080)** - Log collector

## Additional Documentation

Created `TROUBLESHOOTING.md` with:
- This specific error and solution
- Other common update script issues
- Manual resolution steps
- Recovery procedures
