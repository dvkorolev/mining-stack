# Configuration Guide

## Environment Variables

### Backend Configuration

Create a `.env` file in the `backend/` directory with the following variables:

| Variable | Description | Default | Required |
|----------|-------------|---------|----------|
| `NODE_ENV` | Application environment (`development`, `production`) | `development` | No |
| `PORT` | Port to run the API server | `5000` | No |
| `CORS_ORIGIN` | Allowed CORS origins | `*` | No |
| `LOG_LEVEL` | Logging level (`error`, `warn`, `info`, `debug`) | `info` | No |
| `LOGS_DIR` | Directory for log files | `./logs` | No |
| `WS_PATH` | WebSocket endpoint path | `/ws` | No |
| `WS_PING_INTERVAL` | WebSocket ping interval in milliseconds | `30000` | No |
| `MINING_UPDATE_INTERVAL` | Stats update interval in milliseconds | `5000` | No |
| `MINING_MAX_HISTORY` | Maximum number of history points to keep | `60` | No |
| `MINER_CONFIG_PATH` | Path to miners configuration file | `/opt/mining-monitor/etc/miners.yaml` | No |
| `SIM_ONLINE_PROBABILITY` | Probability that a miner is online (0.0-1.0) | `0.9` | No |
| `SIM_ERROR_PROBABILITY` | Probability of error when online (0.0-1.0) | `0.2` | No |
| `SIM_HASHRATE_VARIANCE` | Hashrate variance as a fraction | `0.1` | No |
| `SIM_TEMP_MIN` | Minimum simulated temperature (°C) | `60` | No |
| `SIM_TEMP_MAX` | Maximum simulated temperature (°C) | `90` | No |
| `SIM_FAN_MIN` | Minimum simulated fan speed (RPM) | `3000` | No |
| `SIM_FAN_MAX` | Maximum simulated fan speed (RPM) | `5000` | No |
| `SIM_POWER_MIN` | Minimum simulated power usage (W) | `2000` | No |
| `SIM_POWER_MAX` | Maximum simulated power usage (W) | `3000` | No |

### Example .env File

```bash
# Application Environment
NODE_ENV=production
PORT=5000

# CORS Configuration
CORS_ORIGIN=http://localhost:3000

# Logging
LOG_LEVEL=info
LOGS_DIR=/app/logs

# WebSocket Configuration
WS_PATH=/ws
WS_PING_INTERVAL=30000

# Mining Configuration
MINING_UPDATE_INTERVAL=5000
MINING_MAX_HISTORY=60

# Miner Configuration Path
MINER_CONFIG_PATH=/opt/mining-monitor/etc/miners.yaml

# Simulation Configuration (for demo/testing)
SIM_ONLINE_PROBABILITY=0.9
SIM_ERROR_PROBABILITY=0.2
SIM_HASHRATE_VARIANCE=0.1
SIM_TEMP_MIN=60
SIM_TEMP_MAX=90
SIM_FAN_MIN=3000
SIM_FAN_MAX=5000
SIM_POWER_MIN=2000
SIM_POWER_MAX=3000
```

## Miner Configuration

Miners are configured in the `etc/miners.yaml` file. This file defines all the miners that the system will monitor.

### Configuration File Location

The system looks for the configuration file in the following locations (in order):
1. `/opt/mining-monitor/etc/miners.yaml` (production deployment)
2. `./etc/miners.yaml` (local development)

### Configuration Format

```yaml
miners:
  - ip: "192.168.1.100"
    name: "miner-01"
    model: "Antminer S19j Pro"
    alias: "Main Mining Rig"
    
  - ip: "192.168.1.101"
    name: "miner-02"
    model: "Antminer S19"
    alias: "Backup Miner"
    
  - ip: "192.168.1.102"
    name: "miner-03"
    model: "Whatsminer M30S"
    alias: "Test Rig"
```

### Miner Configuration Fields

| Field | Type | Description | Required |
|-------|------|-------------|----------|
| `ip` | string | IP address of the miner | Yes |
| `name` | string | Unique identifier for the miner | Yes |
| `model` | string | Model name of the miner | Yes |
| `alias` | string | Friendly display name | No |

## Docker Configuration

### docker-compose.yml

The main configuration for Docker services. Key sections:

#### Backend Service

```yaml
backend:
  build:
    context: ./backend
    dockerfile: Dockerfile.arm64
  platform: linux/arm64
  ports:
    - "5000:5000"
  environment:
    - NODE_ENV=production
    - PORT=5000
  volumes:
    - ./logs:/app/logs
  deploy:
    resources:
      limits:
        cpus: '1'
        memory: 512M
```

#### Frontend Service

```yaml
frontend:
  build:
    context: ./frontend
    dockerfile: Dockerfile
  ports:
    - "3000:3000"
  environment:
    - NODE_ENV=production
    - REACT_APP_API_URL=/api
  depends_on:
    - backend
```

#### Prometheus Service

```yaml
prometheus:
  image: prom/prometheus:latest
  platform: linux/arm64
  ports:
    - "9090:9090"
  volumes:
    - ./docker/prometheus:/etc/prometheus
    - prometheus_data:/prometheus
  command:
    - '--config.file=/etc/prometheus/prometheus.yml'
    - '--storage.tsdb.path=/prometheus'
```

#### Grafana Service

```yaml
grafana:
  image: grafana/grafana:latest
  platform: linux/arm64
  ports:
    - "3001:3000"
  volumes:
    - grafana-storage:/var/lib/grafana
  environment:
    - GF_SECURITY_ADMIN_PASSWORD=mining123
    - GF_USERS_ALLOW_SIGN_UP=false
```

## Logging Configuration

Logs are managed by Winston and stored in the directory specified by `LOGS_DIR`.

### Log Files

- `error.log` - Contains only error-level logs
- `combined.log` - Contains all logs (info, warn, error, debug)

### Log Format

Logs are stored in JSON format with the following structure:

```json
{
  "level": "info",
  "message": "Server started",
  "timestamp": "2023-10-31 10:30:00",
  "service": "mining-dashboard"
}
```

## Prometheus Configuration

Prometheus configuration is located in `docker/prometheus/prometheus.yml`.

### Example Configuration

```yaml
global:
  scrape_interval: 15s
  evaluation_interval: 15s

scrape_configs:
  - job_name: 'prometheus'
    static_configs:
      - targets: ['localhost:9090']

  - job_name: 'node-exporter'
    static_configs:
      - targets: ['node-exporter:9100']

  - job_name: 'backend'
    static_configs:
      - targets: ['backend:5000']
```

## Security Considerations

1. **Change Default Passwords**: Update the Grafana admin password in production
2. **CORS Configuration**: Restrict CORS origins in production
3. **API Authentication**: Consider implementing API authentication
4. **HTTPS**: Use a reverse proxy with SSL/TLS certificates
5. **Firewall**: Restrict access to monitoring ports
6. **Environment Variables**: Never commit `.env` files to version control

## Performance Tuning

### Resource Limits

Adjust Docker resource limits based on your hardware:

```yaml
deploy:
  resources:
    limits:
      cpus: '1'
      memory: 512M
    reservations:
      cpus: '0.5'
      memory: 256M
```

### Update Intervals

Adjust the mining update interval based on your needs:

```bash
MINING_UPDATE_INTERVAL=5000  # 5 seconds (default)
MINING_UPDATE_INTERVAL=10000 # 10 seconds (lower CPU usage)
MINING_UPDATE_INTERVAL=1000  # 1 second (higher CPU usage)
```

### History Points

Control how much historical data is kept in memory:

```bash
MINING_MAX_HISTORY=60   # 60 points (default, ~5 minutes at 5s interval)
MINING_MAX_HISTORY=120  # 120 points (~10 minutes)
MINING_MAX_HISTORY=720  # 720 points (~1 hour)
```
