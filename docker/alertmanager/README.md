# Alertmanager Configuration

Alertmanager handles alerts from Prometheus and routes them to various receivers.

## Files

- `alertmanager.yml` - Main configuration (webhook only by default)
- `alertmanager.telegram.yml.example` - Example with Telegram notifications

## Configuration Methods

### Method 1: Via Frontend UI (Recommended)

The Mining Stack includes a **Settings page** in the frontend where you can configure Telegram notifications:

1. Open the web UI: `http://localhost:3000`
2. Navigate to **Settings**
3. Enter your **Bot Token** and **Chat ID**
4. Click **Save** and **Test**

The backend will automatically update the Alertmanager configuration.

### Method 2: Manual Configuration

Edit `alertmanager.yml` directly (see below).

## Current Configuration

### Default Setup

The default configuration sends all alerts to the backend webhook:

```yaml
receivers:
- name: 'default-receiver'
  webhook_configs:
  - url: 'http://backend:5000/api/alerts/webhook'
```

### Alert Routing

- **Critical alerts** → `critical-receiver` (webhook, + Telegram if configured)
- **All alerts** → `webhook-receiver` (webhook)

## Enabling Telegram Notifications

### Step 1: Create Telegram Bot

1. Open Telegram and search for `@BotFather`
2. Send `/newbot`
3. Follow instructions to create your bot
4. Copy the **bot token** (looks like `123456789:ABCdefGHIjklMNOpqrsTUVwxyz`)

### Step 2: Get Your Chat ID

1. Search for `@userinfobot` in Telegram
2. Start a chat and send any message
3. The bot will reply with your **chat ID** (numeric, e.g., `123456789`)

### Step 3: Configure Alertmanager

```bash
# Copy the example file
cp docker/alertmanager/alertmanager.telegram.yml.example docker/alertmanager/alertmanager.yml

# Edit the file
nano docker/alertmanager/alertmanager.yml
```

Replace:
- `YOUR_BOT_TOKEN` with your bot token
- `123456789` with your numeric chat ID

**Important**: `chat_id` must be a **number**, not a string:
```yaml
# ✅ Correct
chat_id: 123456789

# ❌ Wrong (causes YAML error)
chat_id: '123456789'
chat_id: '${TELEGRAM_CHAT_ID}'
```

### Step 4: Restart Alertmanager

```bash
docker compose -f docker-compose.prod.yml restart alertmanager

# Check logs
docker compose -f docker-compose.prod.yml logs alertmanager
```

## Alert Message Format

Telegram messages use HTML formatting:

```
🚨 CRITICAL ALERT

Alert: MinerOffline
Severity: critical
Instance: 192.168.1.100

Summary: Miner is offline
Description: Miner has been offline for 5 minutes

Status: firing
Time: 2025-11-04 16:30:00
```

## Testing

### Test Alert

```bash
# Send test alert to Prometheus
curl -X POST http://localhost:9090/-/reload

# Or trigger a real alert by stopping a service
docker compose -f docker-compose.prod.yml stop python-scheduler
```

### Check Alertmanager

```bash
# View active alerts
curl http://localhost:9093/api/v2/alerts

# View Alertmanager status
curl http://localhost:9093/api/v2/status
```

## Troubleshooting

### Error: "cannot unmarshal !!str into int64"

**Problem**: `chat_id` is a string instead of a number

**Solution**: Remove quotes around chat_id:
```yaml
# Wrong
chat_id: '123456789'

# Correct
chat_id: 123456789
```

### Telegram Not Receiving Alerts

1. **Check bot token**: Make sure it's correct
2. **Check chat ID**: Must be numeric, no quotes
3. **Start bot**: Send `/start` to your bot in Telegram
4. **Check logs**: `docker compose logs alertmanager`

### Webhook Not Working

1. **Check backend**: `curl http://localhost:5000/health`
2. **Check route**: Verify `/api/alerts/webhook` exists
3. **Check logs**: `docker compose logs backend`

## Environment Variables

Alertmanager **does not support** environment variable substitution in the config file.

**Don't use**:
```yaml
chat_id: '${TELEGRAM_CHAT_ID}'  # ❌ Won't work
```

**Instead**:
```yaml
chat_id: 123456789  # ✅ Use actual value
```

## Alert Receivers

### Webhook Receiver

Sends alerts to backend API:
- URL: `http://backend:5000/api/alerts/webhook`
- Format: JSON
- Includes: Alert details, labels, annotations

### Telegram Receiver

Sends formatted messages to Telegram:
- Format: HTML
- Includes: Alert name, severity, description
- Only for critical alerts

## Configuration Reference

### Global Settings

```yaml
global:
  resolve_timeout: 5m  # How long to wait before marking alert as resolved
```

### Routing

```yaml
route:
  group_by: ['alertname', 'job']  # Group alerts by these labels
  group_wait: 30s                 # Wait before sending first alert
  group_interval: 5m              # Wait before sending grouped alerts
  repeat_interval: 4h             # Wait before repeating alert
```

### Receivers

```yaml
receivers:
- name: 'my-receiver'
  telegram_configs:
  - bot_token: 'YOUR_TOKEN'
    chat_id: 123456789
    parse_mode: 'HTML'
  webhook_configs:
  - url: 'http://backend:5000/api/alerts/webhook'
```

## Related Documentation

- [Alertmanager Documentation](https://prometheus.io/docs/alerting/latest/alertmanager/)
- [Telegram Receiver](https://prometheus.io/docs/alerting/latest/configuration/#telegram_config)
- [Webhook Receiver](https://prometheus.io/docs/alerting/latest/configuration/#webhook_config)

## See Also

- [Prometheus Configuration](../prometheus/README.md)
- [Alert Rules](../prometheus/rules/)
- [Backend Alerts API](../../backend/README.md)
