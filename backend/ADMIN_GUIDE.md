# Admin Guide - Multi-User Mining Stack

## How to Become an Admin

### 1. Get Your Telegram Chat ID

Send `/whoami` to your Telegram bot. You'll receive a message like:

```
🆔 Your Chat Information

Chat ID: `123456789`
Chat Type: private
Username: @yourname

💡 Use this Chat ID in the Settings page to configure the bot.
```

Copy the Chat ID (e.g., `123456789`).

### 2. Set Admin Environment Variable

Set the `ADMIN_TELEGRAM_CHAT_ID` environment variable to your Telegram chat ID:

**Option A: Docker Compose (Recommended)**

Edit `docker-compose.yml`:

```yaml
services:
  backend:
    environment:
      - ADMIN_TELEGRAM_CHAT_ID=123456789  # Your chat ID
      - SYSTEM_API_KEY=your_secure_random_key_here
```

**Option B: Environment File**

Create or edit `.env`:

```bash
ADMIN_TELEGRAM_CHAT_ID=123456789
SYSTEM_API_KEY=your_secure_random_key_here
```

**Option C: Direct Export (Development)**

```bash
export ADMIN_TELEGRAM_CHAT_ID="123456789"
export SYSTEM_API_KEY="your_secure_random_key_here"
```

### 3. Restart Services

```bash
docker-compose restart backend
# or
npm run dev  # if running locally
```

### 4. Verify Admin Access

Send `/start` to your Telegram bot. As an admin, you will:
- See all miners in the system (not just your own)
- Have access to admin-only commands
- Be able to transfer miner ownership

## Admin vs Regular User

| Feature | Admin | Regular User |
|---------|-------|--------------|
| View all miners | ✅ Yes | ❌ No (only their own) |
| Add miners | ✅ Yes | ✅ Yes |
| Edit own miners | ✅ Yes | ✅ Yes |
| Edit other users' miners | ✅ Yes | ❌ No |
| Transfer ownership | ✅ Yes | ❌ No |
| Delete any miner | ✅ Yes | ❌ No (only their own) |
| System-wide stats | ✅ Yes | ❌ No (only their miners) |

## Admin Commands

### Transfer Miner Ownership

**Via Telegram Bot:**

```
/transfer <miner_name_or_ip> <new_owner_chat_id>
```

Example:
```
/transfer miner-01 987654321
```

**Via API:**

```bash
curl -X POST http://localhost:5000/api/mining/miners/miner-01/transfer \
  -H "X-Telegram-Chat-ID: 123456789" \
  -H "Content-Type: application/json" \
  -d '{"newOwner": "987654321"}'
```

### View All Miners (Admin Only)

When you use `/miners` or view the miners list, you'll see ALL miners in the system, with owner information:

```
⛏️ All Miners (15 total)

📋 Page 1 of 2

1. ✅ miner-01 (192.168.1.100)
   Owner: 123456789
   Model: Antminer S19
   Hashrate: 95.2 TH/s

2. ✅ miner-02 (192.168.1.101)
   Owner: 987654321
   Model: Whatsminer M30S
   Hashrate: 88.5 TH/s
```

## Security Best Practices

1. **Keep Your Chat ID Private**
   - Your Telegram chat ID is your identity in the system
   - Don't share it publicly

2. **Secure the System API Key**
   - Generate a strong random key: `openssl rand -hex 32`
   - Never commit it to version control
   - Rotate it periodically

3. **Limit Admin Access**
   - Only set `ADMIN_TELEGRAM_CHAT_ID` for trusted administrators
   - Consider using multiple admin chat IDs (comma-separated)

4. **Monitor Ownership Changes**
   - All ownership transfers are logged
   - Review logs regularly: `docker-compose logs backend | grep "ownership"`

## Multi-Admin Setup (Future Enhancement)

Currently, only one admin is supported via `ADMIN_TELEGRAM_CHAT_ID`. To support multiple admins:

```yaml
# Future feature - not yet implemented
ADMIN_TELEGRAM_CHAT_IDS=123456789,987654321,555555555
```

## Troubleshooting

### "You are not authorized" Error

**Cause:** Your chat ID doesn't match `ADMIN_TELEGRAM_CHAT_ID`

**Solution:**
1. Verify your chat ID with `/whoami`
2. Check the environment variable is set correctly
3. Restart the backend service

### Can't See All Miners

**Cause:** You're not recognized as admin

**Solution:**
1. Ensure `ADMIN_TELEGRAM_CHAT_ID` matches your chat ID exactly
2. Check backend logs: `docker-compose logs backend | grep "authenticated"`
3. Verify the environment variable is loaded: `docker-compose exec backend env | grep ADMIN`

### Ownership Transfer Fails

**Cause:** Target user doesn't exist or invalid chat ID

**Solution:**
1. Verify the new owner's chat ID is correct
2. Ensure the new owner has interacted with the bot at least once
3. Check backend logs for specific error messages

## API Reference

### Admin Endpoints

All admin endpoints require `X-Telegram-Chat-ID` header with admin's chat ID.

#### Transfer Miner Ownership

```http
POST /api/mining/miners/:minerId/transfer
X-Telegram-Chat-ID: <admin_chat_id>
Content-Type: application/json

{
  "newOwner": "<new_owner_chat_id>"
}
```

**Response:**
```json
{
  "success": true,
  "message": "Ownership transferred successfully",
  "miner": {
    "ip": "192.168.1.100",
    "name": "miner-01",
    "owner": "987654321"
  }
}
```

#### Get All Miners (Admin View)

```http
GET /api/mining/miners
X-Telegram-Chat-ID: <admin_chat_id>
```

**Response:**
```json
{
  "miners": [
    {
      "ip": "192.168.1.100",
      "name": "miner-01",
      "model": "Antminer S19",
      "owner": "123456789",
      ...
    }
  ]
}
```

## Migration from Single-User to Multi-User

If you're migrating from a single-user setup:

1. **Run the migration script** to import YAML miners:
   ```bash
   export ADMIN_TELEGRAM_CHAT_ID="your_chat_id"
   cd backend
   npm run migrate
   ```

2. **All existing miners** will be assigned to the admin

3. **Transfer miners** to other users as needed:
   ```
   /transfer miner-01 <user_chat_id>
   /transfer miner-02 <user_chat_id>
   ```

## Support

For issues or questions:
1. Check logs: `docker-compose logs backend`
2. Review this guide
3. Check the main README.md
4. Open an issue on GitHub
