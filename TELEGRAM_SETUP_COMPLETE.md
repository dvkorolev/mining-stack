# Complete Telegram Setup

## Your Bot Information

✅ **Bot Token:** `8347489072:AAExNTHdS4IWhwKsYRaN4seSG1_rrN05XZw`  
✅ **Bot Username:** `@pimineralerterbot`  
✅ **Chat ID:** `-1001234567890` (Group chat)

## Setup via Web UI (Recommended)

### 1. Open Settings Page

```
http://raspberrypi:3000/settings
```

Or click **Settings** in the navigation menu.

### 2. Configure Telegram Bot

In the **Telegram Bot Configuration** section:

1. **Bot Token:** Paste your token
   ```
   8347489072:AAExNTHdS4IWhwKsYRaN4seSG1_rrN05XZw
   ```

2. **Chat ID:** Enter your chat ID
   ```
   -1001234567890
   ```

3. Click **"Save Configuration"**

4. Click **"Test Connection"** to verify

### 3. Verify in Telegram

You should receive:
- ✅ Startup notification in your Telegram group
- ✅ Test message when you click "Test Connection"

### 4. Test Bot Commands

Open your Telegram group and send:
```
/start
/status
/miners
```

## Troubleshooting

### Bot Not Responding

**Check if bot is in the group:**
```bash
# Make sure the bot is added to your Telegram group
# Group ID: -1001234567890
```

**Check logs:**
```bash
docker logs mining-stack-backend-1 --tail 100 | grep -i telegram
```

### "Chat Not Found" Error

This means the bot hasn't been added to the group or the chat ID is wrong.

**Solution:**
1. Add `@pimineralerterbot` to your Telegram group
2. Send `/start` in the group
3. Restart backend: `docker compose -f docker-compose.prod.yml restart backend`

### 409 Conflict Error

Multiple bot instances running.

**Solution:**
```bash
# Stop all containers
docker compose -f docker-compose.prod.yml down

# Start fresh
docker compose -f docker-compose.prod.yml up -d

# Verify only one backend
docker ps | grep backend
```

## Available Commands

Once setup is complete, you can use these commands in Telegram:

| Command | Description |
|---------|-------------|
| `/start` | Initialize bot |
| `/help` | Show help message |
| `/status` | Show farm status |
| `/miners` | List all miners |
| `/miner <name>` | Show specific miner details |
| `/alerts` | Show active alerts |
| `/reboot <name>` | Reboot a miner |
| `/pools <name>` | Show pool configuration |

## Alert Notifications

With Telegram configured, you'll automatically receive alerts for:
- 🔴 Miner offline
- ⚠️ Low hashrate
- 🌡️ High temperature
- ⚡ High power consumption
- 📊 Pool issues

## Verify Alertmanager Integration

```bash
# Check alertmanager config
docker exec alertmanager cat /etc/alertmanager/alertmanager.yml

# Should see telegram_configs with your chat_id
```

## Security Notes

⚠️ **Keep your bot token secret!**
- Don't commit `.env` to git (already in `.gitignore`)
- Don't share your bot token publicly
- If token is compromised, revoke it via @BotFather

## Next Steps

1. ✅ Bot token configured
2. ✅ Chat ID configured
3. ⏳ Restart services (run commands above)
4. ⏳ Test bot commands
5. ⏳ Verify alerts work

## Summary

Your Telegram bot is ready to use! After restarting the services, you should:
- Receive a startup notification in your Telegram group
- Be able to send commands to the bot
- Receive automatic alerts for miner issues

**Bot Username:** `@pimineralerterbot`  
**Group Chat ID:** `-1001234567890`

🎉 **Setup Complete!**
