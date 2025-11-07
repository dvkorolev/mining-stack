# Deployment Guide - Multi-User Mining Stack

This guide covers deploying the mining stack with the new database-driven, multi-user architecture.

## Prerequisites

- Docker and Docker Compose installed
- Raspberry Pi or compatible ARM64 system (or x86_64 for development)
- Existing `miners.yaml` configuration (for migration)
- Telegram Bot Token (optional, for notifications)

## Quick Start (New Installation)

### 1. Clone and Configure

```bash
git clone https://github.com/dvkorolev/mining-stack.git
cd mining-stack

# Copy environment template
cp .env.example .env
```

### 2. Configure Environment Variables

Edit `.env` and set the following **required** variables:

```bash
# Generate a secure API key
SYSTEM_API_KEY=$(openssl rand -hex 32)

# Your Telegram Chat ID (get from /whoami command)
ADMIN_TELEGRAM_CHAT_ID=123456789

# Telegram Bot Configuration
TELEGRAM_BOT_TOKEN=your_bot_token_from_botfather
TELEGRAM_CHAT_ID=123456789

# Enable database mode
USE_DATABASE_CONFIG=true
```

### 3. Start Services

```bash
docker-compose -f docker-compose.prod.yml up -d
```

### 4. Migrate Existing Miners (If Applicable)

If you have an existing `etc/miners.yaml`:

```bash
# Set admin chat ID
export ADMIN_TELEGRAM_CHAT_ID="123456789"

# Run migration
docker-compose -f docker-compose.prod.yml exec backend npm run migrate
```

All existing miners will be assigned to the admin user.

### 5. Verify Deployment

```bash
# Check service health
docker-compose -f docker-compose.prod.yml ps

# Check backend logs
docker-compose -f docker-compose.prod.yml logs backend

# Test Telegram bot
# Send /whoami to your bot to verify it's working
```

## Migration from Single-User to Multi-User

If you're upgrading from an older version:

### Step 1: Backup Current Data

```bash
# Backup your current configuration
cp etc/miners.yaml etc/miners.yaml.backup
cp -r data data.backup
```

### Step 2: Update Environment

Add new environment variables to `.env`:

```bash
# Generate secure API key
echo "SYSTEM_API_KEY=$(openssl rand -hex 32)" >> .env

# Add your admin chat ID
echo "ADMIN_TELEGRAM_CHAT_ID=your_chat_id" >> .env

# Enable database mode
echo "USE_DATABASE_CONFIG=true" >> .env
```

### Step 3: Pull Latest Images

```bash
docker-compose -f docker-compose.prod.yml pull
```

### Step 4: Run Migration

```bash
# Stop services
docker compose -f docker-compose.prod.yml down

# Pull latest images (important!)
docker compose -f docker-compose.prod.yml pull

# Start backend only
docker compose -f docker-compose.prod.yml up -d backend

# Wait for backend to be healthy
sleep 10

# Run migration
export ADMIN_TELEGRAM_CHAT_ID="your_chat_id"
docker compose -f docker-compose.prod.yml exec backend npm run migrate

# Start all services
docker compose -f docker-compose.prod.yml up -d
```

**Note:** Use `docker compose` (with space) instead of `docker-compose` (with hyphen) for newer Docker versions.

### Step 5: Verify Migration

```bash
# Check database
docker-compose -f docker-compose.prod.yml exec backend sqlite3 /app/data/mining-stats.db "SELECT ip, name, owner FROM miners;"

# Test Telegram bot
# Send /miners to your bot - you should see all your miners
```

## Environment Variables Reference

### Required for Multi-User Setup

| Variable | Description | Example |
|----------|-------------|---------|
| `SYSTEM_API_KEY` | Secure key for python-scheduler authentication | `abc123...` (32 bytes hex) |
| `ADMIN_TELEGRAM_CHAT_ID` | Admin user's Telegram Chat ID | `123456789` |
| `TELEGRAM_BOT_TOKEN` | Bot token from @BotFather | `123456:ABC-DEF...` |
| `TELEGRAM_CHAT_ID` | Authorized user chat IDs (comma-separated) | `123456789,987654321` |

### Optional Configuration

| Variable | Description | Default |
|----------|-------------|---------|
| `USE_DATABASE_CONFIG` | Use database instead of YAML | `true` |
| `PUSH_TO_BACKEND` | Python scheduler pushes metrics to backend | `true` |
| `COLLECTION_INTERVAL` | Metrics collection interval (minutes) | `2` |

## Architecture Overview

```
┌─────────────────┐
│   Frontend      │ (Port 3000)
│   React App     │
└────────┬────────┘
         │
         ▼
┌─────────────────┐     ┌──────────────────┐
│   Backend       │────▶│  SQLite Database │
│   Node.js API   │     │  - miners table  │
│   Port 5000     │     │  - alerts table  │
└────────┬────────┘     │  - stats tables  │
         │              └──────────────────┘
         │
         ▼
┌─────────────────┐
│ Python Scheduler│
│ Metrics Collector│
│   Port 8000     │
└────────┬────────┘
         │
         ▼
    [Miners]
```

### Data Flow

1. **Miner Configuration:**
   - Stored in SQLite `miners` table
   - Each miner has an `owner` (Telegram Chat ID)
   - Python scheduler fetches config via API with `SYSTEM_API_KEY`

2. **Metrics Collection:**
   - Python scheduler collects metrics from miners
   - Pushes to backend via `/api/internal/metrics`
   - Backend stores in database and broadcasts via WebSocket

3. **User Access:**
   - Users authenticate via Telegram Chat ID
   - Admin identified by `ADMIN_TELEGRAM_CHAT_ID`
   - Users see only their own miners
   - Admin sees all miners

## Multi-User Features

### Admin Capabilities

- View all miners in the system
- Transfer miner ownership
- Delete any miner
- Access system-wide statistics

### Regular User Capabilities

- View only their own miners
- Add new miners (assigned to them)
- Edit their own miners
- Delete their own miners
- Receive alerts for their miners

## Telegram Bot Commands

### Available to All Users

- `/start` - Initialize bot and show main menu
- `/whoami` - Get your Telegram Chat ID
- `/status` - View your farm statistics
- `/miners` - List your miners
- `/miner <name>` - Get specific miner details
- `/alerts` - View active alerts
- `/help` - Show help message

### Admin Only Commands

- `/transfer <miner> <new_owner_chat_id>` - Transfer miner ownership

Example:
```
/transfer miner-01 987654321
```

## Troubleshooting

### Migration Issues

**Problem:** Migration fails with "ADMIN_TELEGRAM_CHAT_ID not set"

**Solution:**
```bash
export ADMIN_TELEGRAM_CHAT_ID="your_chat_id"
docker-compose -f docker-compose.prod.yml exec backend npm run migrate
```

**Problem:** Miners not showing in Telegram bot

**Solution:**
1. Check database: `docker-compose exec backend sqlite3 /app/data/mining-stats.db "SELECT * FROM miners;"`
2. Verify owner matches your chat ID
3. Restart backend: `docker-compose restart backend`

### Python Scheduler Issues

**Problem:** Python scheduler can't fetch miners

**Solution:**
1. Check `SYSTEM_API_KEY` is set in both backend and python-scheduler
2. Verify backend is healthy: `curl http://localhost:5000/health`
3. Check logs: `docker-compose logs python-scheduler`

**Problem:** Falling back to YAML

**Solution:**
1. Set `USE_DATABASE_CONFIG=true` in python-scheduler environment
2. Ensure `SYSTEM_API_KEY` is configured
3. Restart: `docker-compose restart python-scheduler`

### Authentication Issues

**Problem:** "Unauthorized" errors in frontend

**Solution:**
1. Go to Settings page
2. Enter your Admin Chat ID
3. Click "Save Admin Chat ID"
4. Refresh the page

**Problem:** Can't transfer ownership

**Solution:**
1. Verify you're logged in as admin (Settings > Admin Chat ID)
2. Check `ADMIN_TELEGRAM_CHAT_ID` matches your chat ID
3. Ensure backend has the environment variable set

## Security Best Practices

1. **Generate Strong API Key:**
   ```bash
   openssl rand -hex 32
   ```

2. **Protect Environment Variables:**
   - Never commit `.env` to git
   - Use `.env.example` as template
   - Rotate `SYSTEM_API_KEY` periodically

3. **Limit Admin Access:**
   - Only set `ADMIN_TELEGRAM_CHAT_ID` for trusted users
   - Monitor ownership transfers in logs

4. **Network Security:**
   - Use firewall to restrict port access
   - Consider VPN for remote access
   - Enable HTTPS in production

## Monitoring

### Health Checks

```bash
# Backend health
curl http://localhost:5000/health

# Python scheduler health
curl http://localhost:8000/health

# Prometheus metrics
curl http://localhost:9090/-/healthy

# Frontend
curl http://localhost:3000
```

### Logs

```bash
# All services
docker-compose -f docker-compose.prod.yml logs -f

# Specific service
docker-compose -f docker-compose.prod.yml logs -f backend

# Last 100 lines
docker-compose -f docker-compose.prod.yml logs --tail=100 backend
```

### Database Inspection

```bash
# Connect to database
docker-compose -f docker-compose.prod.yml exec backend sqlite3 /app/data/mining-stats.db

# View miners
SELECT ip, name, model, owner FROM miners;

# View alerts
SELECT * FROM alerts ORDER BY fired_at DESC LIMIT 10;

# Exit
.quit
```

## Backup and Restore

### Backup

```bash
# Backup database
docker-compose -f docker-compose.prod.yml exec backend cp /app/data/mining-stats.db /app/data/mining-stats.db.backup

# Copy to host
docker cp $(docker-compose ps -q backend):/app/data/mining-stats.db ./backup-$(date +%Y%m%d).db

# Backup volumes
docker run --rm -v mining-stack_prometheus_data:/data -v $(pwd):/backup alpine tar czf /backup/prometheus-backup.tar.gz /data
```

### Restore

```bash
# Stop services
docker-compose -f docker-compose.prod.yml down

# Restore database
docker cp ./backup-20231107.db $(docker-compose ps -q backend):/app/data/mining-stats.db

# Start services
docker-compose -f docker-compose.prod.yml up -d
```

## Support

For issues or questions:
1. Check logs: `docker-compose logs`
2. Review [ADMIN_GUIDE.md](backend/ADMIN_GUIDE.md)
3. Review [MIGRATION_README.md](backend/MIGRATION_README.md)
4. Open an issue on GitHub
