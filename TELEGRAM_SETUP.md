# 🚀 Telegram Bot Setup Guide

Quick setup guide for enabling Telegram bot functionality in your mining stack.

---

## 📦 Installation Steps

### **1. Install NPM Dependencies**

```bash
cd backend
npm install node-telegram-bot-api@^0.64.0
npm install --save-dev @types/node-telegram-bot-api@^0.64.0
```

### **2. Create Telegram Bot**

1. Open Telegram app
2. Search for `@BotFather`
3. Send: `/newbot`
4. Choose a name: `My Mining Bot`
5. Choose a username: `my_mining_stack_bot`
6. **Save the token** you receive

### **3. Get Your Chat ID**

1. Search for `@userinfobot`
2. Start chat
3. **Save your ID** (the number shown)

### **4. Configure Environment**

Create `.env` file in project root (if it doesn't exist):

```bash
# Telegram Bot Configuration
TELEGRAM_BOT_TOKEN=your_bot_token_here
TELEGRAM_CHAT_ID=your_chat_id_here
TELEGRAM_ENABLED=true
```

**Example:**
```bash
TELEGRAM_BOT_TOKEN=123456789:ABCdefGHIjklMNOpqrsTUVwxyz
TELEGRAM_CHAT_ID=987654321
TELEGRAM_ENABLED=true
```

### **5. Update Docker Compose**

The environment variables are already configured in `docker-compose.yml` and `docker-compose.prod.yml`.

Verify the backend service has:
```yaml
environment:
  - TELEGRAM_BOT_TOKEN=${TELEGRAM_BOT_TOKEN:-}
  - TELEGRAM_CHAT_ID=${TELEGRAM_CHAT_ID:-}
```

### **6. Rebuild and Restart**

```bash
# For development
docker compose down
docker compose build backend
docker compose up -d

# For production
docker compose -f docker-compose.prod.yml down
docker compose -f docker-compose.prod.yml build backend
docker compose -f docker-compose.prod.yml up -d
```

### **7. Verify Installation**

Check backend logs:
```bash
docker logs backend | grep -i telegram
```

You should see:
```
Telegram bot initialized successfully
🚀 Mining Stack Bot is online and ready!
```

### **8. Test the Bot**

Open Telegram and send to your bot:
```
/start
```

You should receive a welcome message with available commands.

---

## 🧪 Testing

### **Test Bot Connection**

```bash
curl -X POST http://localhost:5000/api/telegram/test
```

Expected response:
```json
{
  "success": true,
  "message": "Connected as @my_mining_stack_bot"
}
```

### **Check Bot Status**

```bash
curl http://localhost:5000/api/telegram/status
```

Expected response:
```json
{
  "enabled": true,
  "chatId": "987654321"
}
```

### **Send Test Message**

```bash
curl -X POST http://localhost:5000/api/telegram/send \
  -H "Content-Type: application/json" \
  -d '{"message": "Test message from API"}'
```

You should receive the message in Telegram.

---

## 📱 Available Commands

Once setup is complete, you can use:

- `/start` - Initialize bot and show help
- `/status` - View farm statistics
- `/miners` - List all miners
- `/miner <name>` - Get detailed miner stats
- `/reboot <name>` - Reboot a specific miner
- `/alerts` - View active alerts
- `/help` - Show command list

---

## 🔧 Troubleshooting

### **Bot Not Responding**

1. Check token is correct in `.env`
2. Restart backend: `docker restart backend`
3. Check logs: `docker logs backend`

### **"Unauthorized" Error**

- Verify bot token has no extra spaces
- Make sure you copied the entire token
- Try creating a new bot

### **Not Receiving Messages**

- Verify chat ID is correct
- Make sure you started a conversation with the bot first
- Check if bot is blocked

### **Module Not Found Error**

```bash
cd backend
npm install
docker compose build backend
docker compose up -d
```

---

## 🎯 Next Steps

1. ✅ Test basic commands (`/status`, `/miners`)
2. ✅ Try rebooting a miner (`/reboot miner-name`)
3. ✅ Configure alert thresholds in `docker/prometheus/rules/mining_alerts.yml`
4. ✅ Customize notification templates in `docker/alertmanager/alertmanager.yml`
5. ✅ Read full documentation: `docs/TELEGRAM_BOT.md`

---

## 📚 Additional Resources

- **Full Documentation**: [docs/TELEGRAM_BOT.md](docs/TELEGRAM_BOT.md)
- **API Reference**: [docs/API.md](docs/API.md)
- **Alert Configuration**: [docs/MONITORING.md](docs/MONITORING.md)

---

## 🔐 Security Tips

1. Never commit `.env` file to git
2. Add `.env` to `.gitignore`
3. Keep bot token private
4. Only share chat ID with trusted users
5. Use groups for multi-user access

---

## ✅ Checklist

- [ ] Installed NPM dependencies
- [ ] Created Telegram bot via @BotFather
- [ ] Got chat ID from @userinfobot
- [ ] Created `.env` file with credentials
- [ ] Rebuilt backend container
- [ ] Verified bot is online in logs
- [ ] Tested `/start` command
- [ ] Tested `/status` command
- [ ] Tested miner reboot functionality

---

**Setup complete! 🎉**

Your mining stack is now controllable via Telegram!
