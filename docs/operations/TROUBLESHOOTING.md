# Troubleshooting Guide

## Common Issues

### Miner Not Detected

**Symptoms:**
- Miner shows as "offline" in the dashboard
- No statistics are being collected

**Solutions:**

1. **Check network connectivity**
   ```bash
   ping 192.168.1.100  # Replace with your miner's IP
   ```

2. **Verify miner IP in configuration**
   - Check `etc/miners.yaml` for correct IP addresses
   - Ensure miners are on the same network

3. **Check if the miner's API is enabled**
   - Access the miner's web interface
   - Verify API access is enabled
   - Check firewall settings on the miner

4. **Verify miner configuration is loaded**
   ```bash
   docker compose logs backend | grep "Loaded configuration"
   ```

### High CPU Usage

**Symptoms:**
- System becomes slow
- High CPU usage by Docker containers

**Solutions:**

1. **Check for too many WebSocket connections**
   ```bash
   docker compose logs backend | grep "Client connected"
   ```

2. **Increase update interval**
   - Edit `.env` file:
   ```bash
   MINING_UPDATE_INTERVAL=10000  # Increase from 5000 to 10000ms
   ```

3. **Reduce resource limits**
   - Edit `docker-compose.yml`:
   ```yaml
   deploy:
     resources:
       limits:
         cpus: '0.5'  # Reduce from 1
   ```

### Database/Storage Issues

**Symptoms:**
- Data not persisting
- Disk space warnings

**Solutions:**

1. **Check disk space**
   ```bash
   df -h
   ```

2. **Verify volume permissions**
   ```bash
   ls -la /opt/mining-monitor/logs
   sudo chown -R $USER:$USER /opt/mining-monitor
   ```

3. **Clean up Docker volumes**
   ```bash
   docker system prune -a --volumes
   ```

### WebSocket Connection Failed

**Symptoms:**
- Real-time updates not working
- Console errors about WebSocket

**Solutions:**

1. **Check backend is running**
   ```bash
   docker compose ps
   ```

2. **Verify WebSocket port is accessible**
   ```bash
   curl http://localhost:5000/health
   ```

3. **Check browser console for errors**
   - Open browser DevTools (F12)
   - Look for WebSocket connection errors

4. **Verify CORS settings**
   - Check `backend/.env`:
   ```bash
   CORS_ORIGIN=*  # Or specific origin
   ```

### Docker Container Won't Start

**Symptoms:**
- Container exits immediately
- Error messages in logs

**Solutions:**

1. **Check container logs**
   ```bash
   docker compose logs backend
   docker compose logs frontend
   ```

2. **Verify Docker is running**
   ```bash
   docker info
   ```

3. **Check for port conflicts**
   ```bash
   lsof -i :5000  # Check if port 5000 is in use
   lsof -i :3000  # Check if port 3000 is in use
   ```

4. **Rebuild containers**
   ```bash
   docker compose down
   docker compose build --no-cache
   docker compose up -d
   ```

### Grafana Dashboard Not Loading

**Symptoms:**
- Grafana shows "No data"
- Dashboards are empty

**Solutions:**

1. **Check Prometheus is scraping data**
   - Visit http://localhost:9090/targets
   - Verify all targets are "UP"

2. **Verify Grafana data source**
   - Login to Grafana
   - Go to Configuration > Data Sources
   - Test the Prometheus connection

3. **Check Prometheus configuration**
   ```bash
   cat docker/prometheus/prometheus.yml
   ```

### Permission Denied Errors

**Symptoms:**
- Cannot write to logs
- Cannot access configuration files

**Solutions:**

1. **Fix ownership**
   ```bash
   sudo chown -R $USER:$USER /opt/mining-monitor
   ```

2. **Fix permissions**
   ```bash
   chmod -R 755 /opt/mining-monitor
   chmod 600 /opt/mining-monitor/backend/.env
   ```

3. **Check Docker user**
   ```bash
   docker compose exec backend whoami
   ```

## Viewing Logs

### View all logs
```bash
docker compose logs -f
```

### View specific service logs
```bash
# Backend logs
docker compose logs -f backend

# Frontend logs
docker compose logs -f frontend

# Prometheus logs
docker compose logs -f prometheus

# Grafana logs
docker compose logs -f grafana
```

### View last N lines
```bash
docker compose logs --tail=100 backend
```

### Search logs
```bash
docker compose logs backend | grep "error"
```

## Resetting the System

### Soft Reset (Restart Services)
```bash
docker compose restart
```

### Hard Reset (Rebuild Everything)
```bash
# Stop all containers
docker compose down

# Remove all containers and volumes
docker compose down -v

# Rebuild and start
docker compose up -d --build
```

### Complete Reset (Remove All Docker Data)
```bash
# Stop all containers
docker compose down

# Remove all Docker resources
docker system prune -a --volumes

# Rebuild from scratch
docker compose up -d --build
```

## Performance Monitoring

### Check container resource usage
```bash
docker stats
```

### Check system resources
```bash
# CPU and memory
top

# Disk usage
df -h

# Network connections
netstat -tulpn
```

### Monitor logs in real-time
```bash
# All services
docker compose logs -f

# Specific service with timestamps
docker compose logs -f --timestamps backend
```

## Getting Help

If you're still having issues after trying these solutions:

1. **Check the GitHub Issues**
   - Visit: https://github.com/yourusername/mining-stack/issues
   - Search for similar problems

2. **Create a new issue** with:
   - **Description**: Clear description of the problem
   - **Steps to reproduce**: Exact steps to recreate the issue
   - **Logs**: Relevant error messages and logs
   - **Environment**: 
     - OS version
     - Docker version
     - Hardware specs
   - **Configuration**: Your setup (redact sensitive info)

3. **Provide diagnostic information**
   ```bash
   # System info
   uname -a
   docker version
   docker compose version
   
   # Container status
   docker compose ps
   
   # Recent logs
   docker compose logs --tail=50
   ```

## Debug Mode

Enable debug logging for more detailed information:

1. **Edit backend/.env**
   ```bash
   LOG_LEVEL=debug
   ```

2. **Restart backend**
   ```bash
   docker compose restart backend
   ```

3. **View debug logs**
   ```bash
   docker compose logs -f backend
   ```
