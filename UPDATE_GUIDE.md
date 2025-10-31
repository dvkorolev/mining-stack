# Update Scripts for Raspberry Pi

This directory contains scripts to easily update and rebuild your mining stack on the Raspberry Pi.

## Scripts

### 1. `update.sh` (Simple Version)
A minimal script that updates from git and rebuilds the project.

**Usage:**
```bash
cd /opt/mining-stack
./update.sh
```

**With specific branch:**
```bash
./update.sh develop
```

### 2. `update-and-rebuild.sh` (Detailed Version)
Same functionality but with colored output and more detailed status information.

**Usage:**
```bash
cd /opt/mining-stack
./update-and-rebuild.sh
```

**With specific branch:**
```bash
./update-and-rebuild.sh develop
```

## What These Scripts Do

1. **Pull latest changes** from git repository
2. **Stop running containers** gracefully
3. **Clean up** old Docker images and containers
4. **Rebuild** all services with latest code
5. **Start** all services in detached mode
6. **Display** service status and access URLs

## Setup on Raspberry Pi

After initial deployment, the scripts will be available at `/opt/mining-stack/`.

To make updates even easier, you can create an alias:

```bash
echo "alias mining-update='cd /opt/mining-stack && ./update.sh'" >> ~/.bashrc
source ~/.bashrc
```

Then simply run:
```bash
mining-update
```

## Automatic Updates (Optional)

To automatically update and rebuild daily at 3 AM:

```bash
crontab -e
```

Add this line:
```
0 3 * * * cd /opt/mining-stack && ./update.sh >> /opt/mining-stack/logs/update.log 2>&1
```

## Troubleshooting

### Script not executable
```bash
chmod +x /opt/mining-stack/update.sh
```

### Git pull fails
Check if you have uncommitted changes:
```bash
cd /opt/mining-stack
git status
```

Stash local changes if needed:
```bash
git stash
./update.sh
```

### Docker build fails
Check available disk space:
```bash
df -h
```

Clean up more aggressively:
```bash
docker system prune -a -f
```

### Services won't start
Check logs:
```bash
cd /opt/mining-stack
docker compose logs
```

Restart specific service:
```bash
docker compose restart [frontend|backend|prometheus|grafana]
```

## Manual Update Steps

If you prefer to update manually:

```bash
cd /opt/mining-stack

# Pull changes
git pull origin main

# Rebuild specific service
docker compose up -d --build frontend

# Or rebuild all
docker compose down
docker compose up -d --build
```

## Monitoring Updates

View real-time logs during update:
```bash
docker compose logs -f
```

View logs for specific service:
```bash
docker compose logs -f backend
```

Check service health:
```bash
docker compose ps
docker stats
```
