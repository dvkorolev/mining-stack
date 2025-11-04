# Telegram Bot Guide

## Quick Setup

### 1. Get Bot Credentials

**Your Bot Info:**
- Token: `8347489072:AAExNTHdS4IWhwKsYRaN4seSG1_rrN05XZw`
- Username: `@pimineralerterbot`
- Chat ID: `-1001234567890`

### 2. Configure via Web UI

1. Open: `http://raspberrypi:3000/settings`
2. Enter bot token and chat ID
3. Click "Save Configuration"
4. Click "Test Connection"

### 3. Test in Telegram

Send to your group: `/start`, `/status`, `/miners`

## Commands

- `/start` - Initialize bot
- `/status` - Farm status
- `/miners` - List miners
- `/help` - Command list

## Debugging

Enable debug logs:
```bash
# Edit docker-compose.prod.yml
# Change: LOG_LEVEL=info
# To: LOG_LEVEL=debug

docker compose -f docker-compose.prod.yml restart backend
```

Watch logs:
```bash
docker logs -f mining-stack-backend-1 | grep -i telegram
```

## Common Issues

| Issue | Solution |
|-------|----------|
| Chat not found | Add bot to group |
| 409 Conflict | Restart: `docker compose down && up -d` |
| Unauthorized | Verify token |

See [docs/TELEGRAM_BOT.md](./TELEGRAM_BOT.md) for complete guide.
