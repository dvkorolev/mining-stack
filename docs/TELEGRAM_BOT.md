# 🤖 Telegram Bot Integration

Complete guide for setting up and using the Telegram bot to control miners and receive alerts.

---

## 📋 Table of Contents

1. [Features](#features)
2. [Setup](#setup)
3. [Commands](#commands)
4. [Configuration](#configuration)
5. [Troubleshooting](#troubleshooting)

---

## ✨ Features

### **Miner Control**
- ⛏️ List all miners with status
- 📊 View detailed statistics for any miner
- 🔄 Reboot specific miners remotely
- 📈 Real-time farm overview

### **Alert Notifications**
- 🔥 Critical alerts (miner offline, high temp, etc.)
- ⚠️ Warning alerts (elevated temp, high rejection rate)
- ✅ Auto-resolve notifications
- 📊 Alert statistics and history

### **Interactive Features**
- ⌨️ Custom keyboard for quick access
- 🔘 Inline buttons for miner selection
- ✅ Confirmation dialogs for dangerous operations
- 📱 Mobile-friendly interface

---

## 🚀 Setup

### **Step 1: Create Telegram Bot**

1. Open Telegram and search for `@BotFather`
2. Send `/newbot` command
3. Follow the prompts to create your bot
4. Save the **Bot Token** (looks like: `123456789:ABCdefGHIjklMNOpqrsTUVwxyz`)

### **Step 2: Get Your Chat ID**

1. Search for `@userinfobot` in Telegram
2. Start a conversation
3. Save your **Chat ID** (looks like: `123456789`)

### **Step 3: Configure Environment**

Create or update `.env` file in the project root:

```bash
# Telegram Configuration
TELEGRAM_BOT_TOKEN=123456789:ABCdefGHIjklMNOpqrsTUVwxyz
TELEGRAM_CHAT_ID=123456789
TELEGRAM_ENABLED=true
```

### **Step 4: Install Dependencies**

```bash
cd backend
npm install node-telegram-bot-api @types/node-telegram-bot-api
```

### **Step 5: Initialize Bot**

The bot will automatically start when the backend starts. Check logs:

```bash
docker logs backend | grep "Telegram"
```

You should see:
```
Telegram bot initialized successfully
🚀 Mining Stack Bot is online and ready!
```

---

## 📱 Commands

### **Basic Commands**

| Command | Description | Example |
|---------|-------------|---------|
| `/start` | Welcome message and help | `/start` |
| `/status` | Farm overview statistics | `/status` |
| `/miners` | List all configured miners | `/miners` |
| `/miner <name>` | Detailed stats for a miner | `/miner miner-1` |
| `/reboot <name>` | Reboot a specific miner | `/reboot miner-1` |
| `/alerts` | View active alerts | `/alerts` |
| `/help` | Show command list | `/help` |

### **Keyboard Buttons**

For easier access, use the custom keyboard:

- **📊 Status** - Quick farm overview
- **⛏️ Miners** - List all miners
- **🔔 Alerts** - View active alerts
- **❓ Help** - Show help

### **Interactive Features**

1. **Miner Selection**: When you use `/miners`, you'll see inline buttons to select a miner
2. **Reboot Confirmation**: Rebooting requires confirmation via inline buttons
3. **Navigation**: Easy back buttons to return to previous views

---

## ⚙️ Configuration

### **Environment Variables**

```bash
# Required
TELEGRAM_BOT_TOKEN=<your_bot_token>
TELEGRAM_CHAT_ID=<your_chat_id>

# Optional
TELEGRAM_ENABLED=true              # Enable/disable bot (default: false)
```

### **Alert Configuration**

Alerts are automatically sent based on Prometheus rules. Configure thresholds in:

```
docker/prometheus/rules/mining_alerts.yml
```

### **Notification Settings**

Edit `docker/alertmanager/alertmanager.yml` to customize:

- Alert grouping
- Repeat intervals
- Quiet hours
- Message templates

---

## 🔧 API Endpoints

The bot is integrated with the backend API:

### **Telegram Control**

```bash
# Initialize bot
POST /api/telegram/init
Body: { "token": "...", "chatId": "..." }

# Test connection
POST /api/telegram/test

# Get bot status
GET /api/telegram/status

# Send custom message
POST /api/telegram/send
Body: { "message": "Hello from API!" }
```

### **Miner Control**

```bash
# Get miner stats
GET /api/miners/:minerId/stats

# Reboot miner
POST /api/mining/restart/:minerId
```

### **Alerts**

```bash
# Get active alerts
GET /api/alerts/active

# Get alert history
GET /api/alerts/history?limit=100

# Get miner-specific alerts
GET /api/alerts/miner/:minerId

# Get alert statistics
GET /api/alerts/stats
```

---

## 📊 Example Usage

### **Check Farm Status**

```
You: /status

Bot: 📊 Farm Status

⚡ Total Hashrate: 450.25 TH/s
📈 24h Average: 448.10 TH/s
⛏️ Active Miners: 5 / 6
₿ Total Mined: 0.00012345 BTC

🕐 Last Update: Nov 1, 2025 2:00 PM
```

### **View Miner Details**

```
You: /miner miner-1

Bot: 🟢 Miner-1

📍 IP: 192.168.1.100
🏷️ Model: Antminer S19j Pro
📊 Status: ONLINE

⚡ Performance:
Current: 95.50 TH/s
Average: 94.80 TH/s

🎯 Shares:
Accepted: 1234
Rejected: 5

🌡️ Hardware:
Temperature: 72.5°C
Fan Speed: 4500 RPM
Power: 3250W

⏱️ Uptime: 3d 12h 45m
🕐 Last Seen: Nov 1, 2025 2:00 PM

[🔄 Reboot] [🔙 Back]
```

### **Reboot Miner**

```
You: /reboot miner-1

Bot: ⚠️ Are you sure you want to reboot Miner-1?

[✅ Confirm Reboot] [❌ Cancel]

You: [Click Confirm]

Bot: 🔄 Rebooting miner-1...
✅ Miner miner-1 restart initiated
```

### **Alert Notification**

```
Bot: 🔥 ALERT: Miner miner-3 temperature critical

Miner miner-3 temperature is 87.5°C (threshold: 85°C)

Miner: miner-3
Time: Nov 1, 2025 2:05 PM
```

---

## 🐛 Troubleshooting

### **Bot Not Responding**

1. Check bot is initialized:
   ```bash
   curl http://localhost:5000/api/telegram/status
   ```

2. Check backend logs:
   ```bash
   docker logs backend | grep -i telegram
   ```

3. Verify environment variables:
   ```bash
   docker exec backend env | grep TELEGRAM
   ```

### **"Unauthorized" Error**

- Double-check your bot token is correct
- Make sure there are no extra spaces in `.env` file
- Restart the backend container

### **Not Receiving Alerts**

1. Check Alertmanager is running:
   ```bash
   docker ps | grep alertmanager
   ```

2. Verify webhook configuration:
   ```bash
   curl http://localhost:9093/api/v1/status
   ```

3. Check alert rules are firing:
   ```bash
   curl http://localhost:9090/api/v1/alerts
   ```

### **Chat ID Issues**

- Make sure you're using YOUR chat ID, not the bot's
- Chat ID should be a number (can be negative for groups)
- For groups, add the bot to the group first

### **Commands Not Working**

- Type `/start` to initialize the bot
- Make sure you're chatting with the correct bot
- Check if the bot has been stopped:
  ```bash
  docker restart backend
  ```

---

## 🔐 Security Notes

1. **Keep tokens private**: Never commit `.env` file to git
2. **Restrict access**: Only authorized chat IDs can control the bot
3. **Use groups carefully**: Bot works best with individual chats
4. **Monitor logs**: Check for unauthorized access attempts

---

## 📚 Advanced Features

### **Custom Notifications**

Send custom notifications via API:

```bash
curl -X POST http://localhost:5000/api/telegram/send \
  -H "Content-Type: application/json" \
  -d '{"message": "Custom alert: Check miner-5"}'
```

### **Webhook Integration**

Alertmanager sends webhooks to:
```
http://backend:5000/api/alerts/webhook
```

This allows the backend to:
- Store alert history
- Forward to Telegram
- Trigger custom actions

### **Multi-User Support**

To add multiple users:
1. Create a Telegram group
2. Add all users and the bot
3. Use the group's chat ID in configuration

---

## 📞 Support

For issues or questions:
1. Check logs: `docker logs backend`
2. Review configuration: `cat .env`
3. Test API: `curl http://localhost:5000/api/telegram/status`

---

## 🎉 Next Steps

After setup:
1. Test with `/start` command
2. Configure alert thresholds in Prometheus rules
3. Customize notification templates in Alertmanager
4. Set up quiet hours if needed
5. Add more miners and test reboot functionality

Enjoy your Telegram-controlled mining operation! 🚀
