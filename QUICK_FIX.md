# 🔧 Quick Fix: SQLite Database Error

## Problem
Backend container fails with: `SqliteError: unable to open database file`

## Root Cause
The `./data` directory doesn't exist or has incorrect permissions, preventing SQLite from creating the database file.

---

## ✅ Quick Fix (Run on Raspberry Pi)

### **Option 1: Automated Fix Script**

```bash
cd /opt/mining-stack

# Download and run fix script
curl -O https://raw.githubusercontent.com/dvkorolev/mining-stack/main/fix-permissions.sh
chmod +x fix-permissions.sh
./fix-permissions.sh

# Restart services
docker compose -f docker-compose.prod.yml restart backend
```

### **Option 2: Manual Fix**

```bash
cd /opt/mining-stack

# Create required directories
mkdir -p ./data ./logs ./etc

# Set permissions
chmod -R 755 ./data ./logs ./etc

# Create default miners.yaml if needed
if [ ! -f ./etc/miners.yaml ]; then
  cat > ./etc/miners.yaml << 'EOF'
miners:
  - name: "miner-1"
    ip: "192.168.1.100"
    model: "Antminer S19j Pro"
    alias: "Miner 1"
    owner: "Farm Owner"
EOF
  chmod 644 ./etc/miners.yaml
fi

# Restart backend
docker compose -f docker-compose.prod.yml restart backend
```

---

## 🔍 Verify Fix

```bash
# Check if backend is healthy
docker compose -f docker-compose.prod.yml ps

# Check backend logs
docker logs mining-stack-backend-1

# Test API
curl http://localhost:5000/health
```

Expected output:
```json
{"status":"healthy","timestamp":"2025-11-01T..."}
```

---

## 📊 Check Directory Structure

```bash
cd /opt/mining-stack
ls -la ./data ./logs ./etc
```

Should show:
```
drwxr-xr-x  2 admin admin 4096 Nov  1 14:00 data
drwxr-xr-x  2 admin admin 4096 Nov  1 14:00 logs
drwxr-xr-x  2 admin admin 4096 Nov  1 14:00 etc
```

---

## 🚀 Full Restart (If needed)

```bash
cd /opt/mining-stack

# Stop all services
docker compose -f docker-compose.prod.yml down

# Fix permissions
./fix-permissions.sh

# Start services
docker compose -f docker-compose.prod.yml up -d

# Wait and check status
sleep 10
docker compose -f docker-compose.prod.yml ps
```

---

## 🔄 Prevention

This fix has been integrated into both deployment and update scripts. Future deployments and updates will automatically create the required directories with correct permissions.

To update your scripts:

```bash
cd /opt/mining-stack

# Update deployment script
curl -O https://raw.githubusercontent.com/dvkorolev/mining-stack/main/deploy-from-registry.sh
chmod +x deploy-from-registry.sh

# Update update script
curl -O https://raw.githubusercontent.com/dvkorolev/mining-stack/main/update-from-registry.sh
chmod +x update-from-registry.sh
```

---

## 📝 Related Issues

- **Memory limit warnings**: These are harmless on Raspberry Pi and can be ignored
- **Container unhealthy**: Usually resolves after backend starts successfully
- **Permission denied**: Run `sudo chown -R $(whoami):$(whoami) /opt/mining-stack`

---

## 🆘 Still Having Issues?

1. Check Docker logs: `docker logs mining-stack-backend-1`
2. Check disk space: `df -h`
3. Verify Docker is running: `docker ps`
4. See full troubleshooting: [docs/TROUBLESHOOTING.md](./docs/TROUBLESHOOTING.md)
