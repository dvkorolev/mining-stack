# Telegram Bot Troubleshooting Guide

## Current Issues & Solutions

### 1. Empty Lines in telegram.log ✅ FIXED
**Problem:** telegram.log file filling with empty lines  
**Cause:** Filter returned empty string instead of false  
**Solution:** Updated logger filter to properly return false for non-telegram logs  
**Status:** Fixed in commit 031d357

### 2. Bot Shows Nothing / Chat Not Found
**Error:** `ETELEGRAM: 400 Bad Request: chat not found`  
**Cause:** Wrong chat ID or bot not added to chat

**Solution:**
```bash
# Get your chat ID using @userinfobot
1. Open Telegram
2. Search: @userinfobot
3. Send any message
4. Copy your ID

# Update chat ID
cd /opt/mining-stack
nano docker-compose.prod.yml
# Update: TELEGRAM_CHAT_ID=YOUR_ACTUAL_ID

# Restart
docker compose -f docker-compose.prod.yml restart backend
```

### 3. Multiple Bot Instances (409 Conflict)
**Error:** `409 Conflict: terminated by other getUpdates request`  
**Cause:** Multiple bot instances running with same token

**Solution:**
```bash
# Stop all containers
docker compose -f docker-compose.prod.yml down

# Verify nothing running
docker ps | grep backend

# Start fresh
docker compose -f docker-compose.prod.yml up -d

# Verify only one backend
docker ps | grep backend | wc -l  # Should be: 1
```

### 4. Python Not Found in Container
**Error:** `stat /opt/mining-stack/venv/bin/python3: no such file or directory`  
**Cause:** Container built before Python was added to Dockerfile

**Solution:**
```bash
cd /opt/mining-stack
git pull origin main
docker compose -f docker-compose.prod.yml build backend --no-cache
docker compose -f docker-compose.prod.yml up -d
```

### 5. Script Permission Denied
**Error:** `./bin/collect_all_metrics.sh: Permission denied`  
**Cause:** Scripts lost execute permissions after git pull

**Solution:**
```bash
cd /opt/mining-stack
git pull origin main
chmod +x bin/*.sh bin/*.py
```

## Verification Commands

### Check Bot Status
```bash
# View logs
docker logs mining-stack-backend-1 --tail 50 | grep -i telegram

# Should see:
# [info]: Telegram bot initialized successfully
# [info]: Telegram startup notification sent
# NO 409 or 400 errors
```

### Check Python Installation
```bash
# Verify Python in container
docker exec mining-stack-backend-1 python3 --version

# Verify pyasic
docker exec mining-stack-backend-1 python3 -c "import pyasic; print('OK')"
```

### Check Telegram Logs
```bash
# View telegram-specific logs
tail -f /opt/mining-stack/logs/telegram.log

# Should be clean, no empty lines
```

### Check Script Permissions
```bash
# List script permissions
ls -la /opt/mining-stack/bin/*.sh

# Should show: -rwxr-xr-x (executable)
```

## Common Chat ID Formats

| Type | Format | Example |
|------|--------|---------|
| Private Chat | Positive number | `123456789` |
| Group Chat | Negative with -100 | `-1001234567890` |
| Channel | Negative with -100 | `-1001234567890` |

## Getting Chat ID Methods

### Method 1: @userinfobot (Easiest)
```
1. Search @userinfobot in Telegram
2. Send any message
3. Copy the ID shown
```

### Method 2: Telegram API
```bash
# Send /start to your bot first, then:
curl https://api.telegram.org/bot<YOUR_TOKEN>/getUpdates

# Look for: "chat":{"id":123456789}
```

### Method 3: @RawDataBot
```
1. Add @RawDataBot to your group
2. It shows the chat ID
3. Remove the bot
```

## Bot Token Management

### Get Token from BotFather
```
1. Open Telegram
2. Search: @BotFather
3. Send: /mybots
4. Select your bot
5. Click "API Token"
```

### Revoke Token (if stuck)
```
1. @BotFather → /mybots
2. Select bot → API Token
3. Revoke current token
4. Copy new token
5. Update in docker-compose.prod.yml
6. Restart backend
```

## Log Files Location

```
/opt/mining-stack/logs/
├── combined.log      # All logs
├── error.log         # Errors only
├── telegram.log      # Telegram only (no empty lines)
└── collection.log    # Metrics collection
```

## Environment Variables

```bash
# Required
TELEGRAM_BOT_TOKEN=<bot_token>
TELEGRAM_CHAT_ID=<chat_id>

# Optional
TELEGRAM_ENABLED=true
LOG_LEVEL=info
```

## Quick Health Check

Run this to verify everything:

```bash
#!/bin/bash
echo "=== Telegram Bot Health Check ==="

echo "1. Backend container running?"
docker ps | grep backend

echo "2. Python installed?"
docker exec mining-stack-backend-1 python3 --version

echo "3. Recent telegram logs (last 10):"
docker logs mining-stack-backend-1 --tail 10 | grep -i telegram

echo "4. Script permissions OK?"
ls -la /opt/mining-stack/bin/collect_all_metrics.sh | grep rwx

echo "5. Telegram log size:"
du -h /opt/mining-stack/logs/telegram.log

echo "=== Check Complete ==="
```

## Support

If issues persist:
1. Check all logs: `docker logs mining-stack-backend-1`
2. Verify environment variables: `docker exec mining-stack-backend-1 env | grep TELEGRAM`
3. Test bot manually: `curl -X POST http://localhost:5000/api/telegram/test`
4. Review this guide for matching error patterns

## Recent Fixes

- **2025-11-01**: Fixed telegram.log empty lines (commit 031d357)
- **2025-11-01**: Fixed script permissions (commit b2a7592)
- **2025-11-01**: Added Python to Dockerfile (commit e10b474)
- **2025-11-01**: Enhanced button navigation (commit 1cc8b1f)
- **2025-11-01**: Comprehensive logging (commit 2f52446)
