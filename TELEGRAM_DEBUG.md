# Telegram Connection Debugging Guide

## Enable Debug Logging

### 1. Update docker-compose.prod.yml

Add debug log level to backend service:

```bash
cd /opt/mining-stack

# Edit docker-compose file
nano docker-compose.prod.yml
```

Find the `backend` service and change `LOG_LEVEL`:

```yaml
backend:
  environment:
    - NODE_ENV=production
    - LOG_LEVEL=debug  # Change from 'info' to 'debug'
```

### 2. Restart Backend

```bash
docker compose -f docker-compose.prod.yml restart backend
```

## Watch Logs in Real-Time

### Terminal 1: All Backend Logs
```bash
docker logs -f mining-stack-backend-1
```

### Terminal 2: Telegram-Specific Logs
```bash
# Watch telegram.log file
docker exec mining-stack-backend-1 tail -f /app/logs/telegram.log
```

### Terminal 3: Error Logs
```bash
docker exec mining-stack-backend-1 tail -f /app/logs/error.log
```

## Step-by-Step Debugging

### Step 1: Configure via Web UI

1. Open: `http://raspberrypi:3000/settings`

2. Enter your credentials:
   - **Bot Token:** `8347489072:AAExNTHdS4IWhwKsYRaN4seSG1_rrN05XZw`
   - **Chat ID:** `-1001234567890`

3. Click **"Save Configuration"**

4. **Watch the logs** for:
   ```
   [info]: Telegram bot initialized successfully
   [info]: Telegram startup notification sent
   ```

### Step 2: Check for Errors

Common error patterns to look for:

#### Error: "Chat not found"
```json
{
  "error_code": 400,
  "description": "Bad Request: chat not found"
}
```

**Solution:**
- Bot not added to group
- Wrong chat ID
- Bot was removed from group

**Fix:**
1. Add `@pimineralerterbot` to your Telegram group
2. Send `/start` in the group
3. Restart backend

#### Error: "409 Conflict"
```json
{
  "error_code": 409,
  "description": "Conflict: terminated by other getUpdates request"
}
```

**Solution:**
- Multiple bot instances running
- Old polling connection not closed

**Fix:**
```bash
# Stop all containers
docker compose -f docker-compose.prod.yml down

# Start fresh
docker compose -f docker-compose.prod.yml up -d

# Verify only one backend
docker ps | grep backend
```

#### Error: "Unauthorized"
```json
{
  "error_code": 401,
  "description": "Unauthorized"
}
```

**Solution:**
- Invalid bot token
- Token revoked

**Fix:**
1. Go to @BotFather
2. Send `/mybots`
3. Select your bot
4. Get new token if needed

### Step 3: Test Connection

```bash
# Test via API
curl -X POST http://localhost:5000/api/telegram/test

# Expected response:
{
  "success": true,
  "message": "Connected as @pimineralerterbot"
}
```

**Watch logs for:**
```
[info]: Telegram: Testing connection
[info]: Telegram: Connection test successful
[info]: Telegram: Message sent
```

### Step 4: Verify Bot Status

```bash
# Get bot status
curl http://localhost:5000/api/telegram/status

# Expected response:
{
  "enabled": true,
  "chatId": "-1001234567890"
}
```

### Step 5: Test Commands in Telegram

Send these commands in your Telegram group:

1. `/start` - Should show welcome message
2. `/status` - Should show farm status
3. `/help` - Should show command list

**Watch logs for each command:**
```
[info]: Telegram: Sending farm status
[info]: Telegram: Farm status sent successfully
```

## Detailed Log Analysis

### Successful Initialization
```
[info]: Telegram bot initialized successfully { service: 'telegram', chatId: '-100***' }
[info]: Telegram startup notification sent { service: 'telegram' }
[info]: Telegram: Message sent { service: 'telegram', messagePreview: '🚀 Mining Stack Bot is online and ready!' }
```

### Successful Command Execution
```
[info]: Telegram: Sending farm status { service: 'telegram', chatId: -1001234567890 }
[info]: Telegram: Farm status sent successfully { service: 'telegram', chatId: -1001234567890 }
```

### Failed Connection
```
[error]: Failed to initialize Telegram bot: { service: 'telegram', error: {...} }
[warn]: Telegram bot not initialized or disabled { service: 'telegram' }
```

## Manual Testing Commands

### 1. Check Bot Token Validity
```bash
curl "https://api.telegram.org/bot8347489072:AAExNTHdS4IWhwKsYRaN4seSG1_rrN05XZw/getMe"

# Should return bot info
```

### 2. Get Updates (See Recent Messages)
```bash
curl "https://api.telegram.org/bot8347489072:AAExNTHdS4IWhwKsYRaN4seSG1_rrN05XZw/getUpdates"

# Look for your chat_id in the response
```

### 3. Send Test Message Directly
```bash
curl -X POST "https://api.telegram.org/bot8347489072:AAExNTHdS4IWhwKsYRaN4seSG1_rrN05XZw/sendMessage" \
  -H "Content-Type: application/json" \
  -d '{
    "chat_id": "-1001234567890",
    "text": "Direct API test message"
  }'

# Should send message to your group
```

## Common Issues & Solutions

### Issue 1: Bot Not Responding to Commands

**Debug:**
```bash
# Check if bot is polling
docker logs mining-stack-backend-1 | grep -i "polling"

# Check for authorization issues
docker logs mining-stack-backend-1 | grep -i "authorized"
```

**Solution:**
- Verify chat ID matches
- Check bot is in the group
- Ensure polling is active

### Issue 2: Messages Not Sent

**Debug:**
```bash
# Check sendMessage calls
docker logs mining-stack-backend-1 | grep -i "sendMessage"

# Check for rate limiting
docker logs mining-stack-backend-1 | grep -i "429"
```

**Solution:**
- Check network connectivity
- Verify chat ID is correct
- Check for Telegram API rate limits

### Issue 3: Multiple Bot Instances

**Debug:**
```bash
# Check running containers
docker ps | grep backend

# Check for conflict errors
docker logs mining-stack-backend-1 | grep -i "409"
```

**Solution:**
```bash
# Stop all
docker compose -f docker-compose.prod.yml down

# Remove orphans
docker compose -f docker-compose.prod.yml down --remove-orphans

# Start fresh
docker compose -f docker-compose.prod.yml up -d
```

## Verification Checklist

- [ ] Bot token is valid (test with curl)
- [ ] Chat ID is correct (verify with getUpdates)
- [ ] Bot is added to the group
- [ ] Only one backend container running
- [ ] LOG_LEVEL=debug in docker-compose
- [ ] Backend logs show "initialized successfully"
- [ ] Test connection returns success
- [ ] Bot responds to /start command
- [ ] telegram.log file is being written
- [ ] No 409 Conflict errors in logs

## Log File Locations

Inside backend container:
```
/app/logs/telegram.log   - Telegram-specific logs
/app/logs/combined.log   - All application logs
/app/logs/error.log      - Error logs only
```

View logs:
```bash
# Telegram logs
docker exec mining-stack-backend-1 cat /app/logs/telegram.log

# Last 50 lines
docker exec mining-stack-backend-1 tail -50 /app/logs/telegram.log

# Follow in real-time
docker exec mining-stack-backend-1 tail -f /app/logs/telegram.log
```

## Advanced Debugging

### Enable Node.js Debug Mode

```yaml
# docker-compose.prod.yml
backend:
  environment:
    - NODE_ENV=production
    - LOG_LEVEL=debug
    - DEBUG=telegram:*  # Enable debug for telegram module
```

### Check Telegram API Status

```bash
# Check if Telegram API is accessible
curl -I https://api.telegram.org

# Should return: HTTP/2 200
```

### Network Connectivity Test

```bash
# From inside backend container
docker exec mining-stack-backend-1 ping -c 3 api.telegram.org

# DNS resolution
docker exec mining-stack-backend-1 nslookup api.telegram.org
```

## Expected Successful Flow

```
1. User enters token/chatId in Settings page
   ↓
2. Frontend: POST /api/telegram/init
   ↓
3. Backend: initTelegramBot(token, chatId)
   ↓
4. Log: "Telegram bot initialized successfully"
   ↓
5. Bot starts polling
   ↓
6. Startup message sent to group
   ↓
7. Log: "Telegram startup notification sent"
   ↓
8. Bot ready to receive commands
```

## Quick Debug Script

Save this as `debug-telegram.sh`:

```bash
#!/bin/bash

echo "=== Telegram Bot Debug ==="
echo ""

echo "1. Backend Status:"
docker ps | grep backend
echo ""

echo "2. Recent Telegram Logs:"
docker logs mining-stack-backend-1 --tail 20 | grep -i telegram
echo ""

echo "3. Bot Status API:"
curl -s http://localhost:5000/api/telegram/status | jq
echo ""

echo "4. Test Connection:"
curl -s -X POST http://localhost:5000/api/telegram/test | jq
echo ""

echo "5. Telegram Log File:"
docker exec mining-stack-backend-1 tail -10 /app/logs/telegram.log
echo ""

echo "=== Debug Complete ==="
```

Run it:
```bash
chmod +x debug-telegram.sh
./debug-telegram.sh
```

## Summary

**To debug Telegram connection:**

1. ✅ Enable debug logging (LOG_LEVEL=debug)
2. ✅ Watch logs in real-time
3. ✅ Configure via web UI
4. ✅ Check for error patterns
5. ✅ Test connection via API
6. ✅ Verify bot responds to commands
7. ✅ Review telegram.log file

**Most common issues:**
- Bot not added to group → Add bot
- Wrong chat ID → Verify with getUpdates
- 409 Conflict → Restart containers
- Invalid token → Get new token from @BotFather

**Your bot info:**
- Token: `8347489072:AAExNTHdS4IWhwKsYRaN4seSG1_rrN05XZw`
- Username: `@pimineralerterbot`
- Chat ID: `-1001234567890`
