# Telegram Bot Configuration

## Overview

The Telegram bot is fully configurable via environment variables with **no hardcoded values** in the source code. This allows for flexible multi-user setups and easy management.

## Environment Variables

### Required Variables

```bash
# Bot Token from @BotFather
TELEGRAM_BOT_TOKEN=your_bot_token_here

# Comma-separated list of authorized Telegram Chat IDs
# All users in this list can interact with the bot
TELEGRAM_CHAT_ID=123456789,987654321,555555555

# Admin Telegram Chat ID (single user)
# This user has additional privileges (ownership transfer, etc.)
ADMIN_TELEGRAM_CHAT_ID=123456789
```

## Current Configuration

### Authorized Users
The following users are currently authorized to use the bot:

1. **User 427436847** - Standard user access
2. **User 49268211** - Admin access (can transfer ownership)
3. **User 246139233** - Standard user access

### Admin User
- **Chat ID**: 49268211
- **Privileges**: 
  - All standard user commands
  - `/transfer` command for ownership management
  - System administration features

## User Roles

### Standard Users
**Access via**: `TELEGRAM_CHAT_ID` environment variable

**Capabilities**:
- View mining statistics (`/stats`, `/status`)
- Query individual miners (`/miner <ip>`)
- View their owned miners (`/myminers`)
- Reboot their owned miners (`/reboot <ip>`)
- View pool information (`/pools`)
- Receive alert notifications
- Interactive miner management via buttons

**Restrictions**:
- Cannot transfer miner ownership
- Can only control miners they own

### Admin Users
**Access via**: `ADMIN_TELEGRAM_CHAT_ID` environment variable

**Additional Capabilities**:
- Transfer miner ownership between users (`/transfer <ip> <chat_id>`)
- Full system administration
- All standard user capabilities

## Adding/Removing Users

### Adding a New User

1. Get the user's Telegram Chat ID:
   - User sends `/whoami` to the bot
   - Bot responds with their Chat ID

2. Edit `.env` file on the Raspberry Pi:
   ```bash
   ssh admin@192.168.1.66
   cd /opt/mining-stack
   nano .env
   ```

3. Add the Chat ID to `TELEGRAM_CHAT_ID`:
   ```bash
   # Before
   TELEGRAM_CHAT_ID=427436847,49268211,246139233
   
   # After (adding user 111222333)
   TELEGRAM_CHAT_ID=427436847,49268211,246139233,111222333
   ```

4. Restart the backend service:
   ```bash
   docker compose -f docker-compose.prod.yml -f docker-compose.logging.yml restart backend
   ```

### Removing a User

1. Edit `.env` and remove the Chat ID from `TELEGRAM_CHAT_ID`
2. Restart the backend service

### Changing Admin

1. Edit `.env` and update `ADMIN_TELEGRAM_CHAT_ID`:
   ```bash
   ADMIN_TELEGRAM_CHAT_ID=new_admin_chat_id
   ```

2. Restart the backend service

## Security Best Practices

### 1. Protect Environment Variables
- Never commit `.env` file to git
- Keep `.env` file permissions restricted: `chmod 600 .env`
- Store backup of `.env` securely

### 2. Limit Authorized Users
- Only add trusted users to `TELEGRAM_CHAT_ID`
- Regularly audit the authorized user list
- Remove users who no longer need access

### 3. Admin Access Control
- Only one admin should be configured
- Admin should be a trusted system administrator
- Consider rotating admin access periodically

### 4. Bot Token Security
- Never share the `TELEGRAM_BOT_TOKEN`
- If compromised, revoke and regenerate via @BotFather
- Update `.env` and restart services

## Verification

### Check Current Configuration

```bash
# On Raspberry Pi
ssh admin@192.168.1.66
cd /opt/mining-stack
grep TELEGRAM .env | grep -v "^#"
```

### Test Bot Access

Each user should:
1. Send `/start` to the bot
2. Verify they receive a welcome message
3. Try `/stats` to confirm access

### Verify Admin Privileges

Admin user should:
1. Try `/transfer` command
2. Confirm they can execute it (others should see "admin only" message)

## Troubleshooting

### User Gets "Not Authorized" Message

**Cause**: Chat ID not in `TELEGRAM_CHAT_ID`

**Solution**:
1. User sends `/whoami` to bot (if bot responds)
2. Add their Chat ID to `.env`
3. Restart backend

### Admin Commands Don't Work

**Cause**: Chat ID doesn't match `ADMIN_TELEGRAM_CHAT_ID`

**Solution**:
1. Verify admin Chat ID with `/whoami`
2. Update `ADMIN_TELEGRAM_CHAT_ID` in `.env`
3. Restart backend

### Bot Doesn't Respond

**Cause**: Bot token invalid or backend not running

**Solution**:
1. Check backend logs: `docker compose logs backend`
2. Verify `TELEGRAM_BOT_TOKEN` is correct
3. Test token with @BotFather
4. Restart backend service

## Architecture

### No Hardcoded Values
The system is designed with zero hardcoded chat IDs or tokens:

- ✅ All chat IDs from environment variables
- ✅ Bot token from environment variable
- ✅ Multi-user support via comma-separated list
- ✅ Single admin via dedicated variable
- ✅ Easy to add/remove users without code changes

### Configuration Flow

```
.env file
    ↓
Environment Variables
    ↓
Backend Service (telegram.service.ts)
    ↓
authorizedChatIds Set (runtime)
    ↓
Bot Command Authorization
```

### Code References

**Authorization Check**:
```typescript
// backend/src/services/telegram.service.ts
const isAuthorized = (chatId: number): boolean => {
  return authorizedChatIds.has(chatId.toString());
};
```

**Admin Check**:
```typescript
// backend/src/services/telegram.service.ts
const isAdmin = (chatId: string): boolean => {
  return chatId === ADMIN_TELEGRAM_CHAT_ID;
};
```

**Loading Configuration**:
```typescript
// backend/src/services/telegram.service.ts
const chatIdArray = Array.isArray(chatIds)
  ? chatIds.split(',').map(id => id.trim()).filter(id => id.length > 0)
  : chatIds;

authorizedChatIds = new Set(chatIdArray);
```

## Migration from Hardcoded Values

If you previously had hardcoded chat IDs:

1. ✅ **Already done**: All hardcoded values removed
2. ✅ **Already done**: Environment variable support added
3. ✅ **Already done**: Multi-user support implemented
4. ✅ **Already done**: Admin role separation

## Related Documentation

- `ADMIN_GUIDE.md` - Admin features and ownership management
- `README.md` - General setup and configuration
- `.env.example` - Template for environment variables

## Summary

✅ **No Hardcoded Values**: All configuration via environment variables  
✅ **Multi-User Support**: Comma-separated list of authorized users  
✅ **Admin Role**: Dedicated admin with special privileges  
✅ **Easy Management**: Add/remove users by editing `.env`  
✅ **Secure**: No sensitive data in source code  

Current users: 427436847, 49268211 (admin), 246139233
