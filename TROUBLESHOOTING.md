# Troubleshooting Guide

## Update Script Issues

### Error: "untracked working tree files would be overwritten by merge"

**Symptom:**
```
error: The following untracked working tree files would be overwritten by merge:
docker/promtail/promtail-config.yml
Please move or remove them before you merge.
```

**Cause:**
Files exist on the Raspberry Pi that aren't tracked by git locally, but are tracked in the repository. Git refuses to overwrite them during merge.

**Solution:**
The update script (`update-from-registry.sh`) now automatically handles this by:
1. Detecting untracked files that would conflict
2. Backing them up to `.git/untracked-backup/`
3. Removing them before the pull
4. Allowing the repository versions to be pulled

**Manual Resolution (if needed):**
```bash
# Option 1: Let git overwrite the files
cd /opt/mining-stack
git checkout docker/promtail/promtail-config.yml

# Option 2: Backup and remove manually
mkdir -p ~/backup
cp docker/promtail/promtail-config.yml ~/backup/
rm docker/promtail/promtail-config.yml

# Then retry the update
./update-from-registry.sh
```

**Recovery:**
If you need to restore the backed-up files:
```bash
cd /opt/mining-stack
ls -la .git/untracked-backup/
# Copy files back if needed
```

## Other Common Issues

### Permission Denied

**Symptom:**
```
Permission denied when accessing /opt/mining-stack
```

**Solution:**
```bash
sudo chown -R $USER:$USER /opt/mining-stack
```

### Docker Compose Not Found

**Symptom:**
```
docker compose: command not found
```

**Solution:**
Install Docker Compose V2:
```bash
sudo apt-get update
sudo apt-get install docker-compose-plugin
```

### Port Already in Use

**Symptom:**
```
Error: bind: address already in use
```

**Solution:**
Check what's using the port:
```bash
sudo netstat -tulpn | grep :3000
# Kill the process or change the port in docker-compose.prod.yml
```
