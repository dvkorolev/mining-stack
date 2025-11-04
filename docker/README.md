# Docker Configuration

Docker configuration files for the Mining Stack monitoring system.

## Overview

This directory contains all Docker-related configuration for the monitoring stack including Prometheus, Grafana, Alertmanager, and Blackbox Exporter.

## Directory Structure

```
docker/
├── prometheus/          # Prometheus configuration
│   ├── prometheus.yml  # Main Prometheus config
│   ├── rules/          # Alert rules
│   ├── targets/        # Service discovery targets
│   └── README.md       # Prometheus documentation
├── alertmanager/        # Alertmanager configuration
│   └── alertmanager.yml # Alert routing and receivers
├── grafana/            # Grafana configuration
│   ├── provisioning/   # Auto-provisioning configs
│   ├── dashboards/     # Dashboard JSON files
│   └── README.md       # Grafana documentation
├── blackbox/           # Blackbox Exporter configuration
│   └── blackbox.yml    # Probe modules
└── README.md           # This file
```

## Prometheus

### Configuration

**File**: `prometheus/prometheus.yml`

**Features**:
- Scrapes python-scheduler metrics
- Scrapes backend API metrics
- Blackbox TCP probes for pools
- File-based service discovery
- Alert rules integration

### Scrape Jobs

| Job Name | Target | Interval | Purpose |
|----------|--------|----------|---------|
| `prometheus` | Self | 15s | Prometheus metrics |
| `python-scheduler` | python-scheduler:8000 | 30s | Scheduler metrics |
| `backend` | backend:5000 | 30s | Backend metrics |
| `blackbox-tcp` | blackbox-exporter:9115 | 30s | Pool TCP probes |

### Alert Rules

**File**: `prometheus/rules/alerts.yml`

**Example Rules**:
- Miner offline detection
- High temperature alerts
- Low hashrate warnings
- Pool connectivity issues
- Service health checks

### Pool Targets

**File**: `prometheus/targets/pools.json`

Format:
```json
[
  {
    "targets": [
      "stratum.slushpool.com:3333",
      "stratum.f2pool.com:3333",
      "stratum.antpool.com:3333"
    ]
  }
]
```

**Auto-reload**: Every 5 minutes

## Alertmanager

### Configuration

**File**: `alertmanager/alertmanager.yml`

**Features**:
- Telegram notifications for critical alerts
- Webhook to backend for all alerts
- Alert grouping and routing
- Repeat interval configuration

### Receivers

#### Telegram Receiver
Sends critical alerts to Telegram:

```yaml
receivers:
  - name: 'telegram'
    telegram_configs:
      - bot_token: '${TELEGRAM_BOT_TOKEN}'
        chat_id: '${TELEGRAM_CHAT_ID}'
        parse_mode: 'HTML'
```

#### Webhook Receiver
Sends all alerts to backend:

```yaml
receivers:
  - name: 'webhook'
    webhook_configs:
      - url: 'http://backend:5000/api/alerts/webhook'
```

### Routing

```yaml
route:
  receiver: 'webhook'
  routes:
    - match:
        severity: critical
      receiver: 'telegram'
      continue: true  # Also send to webhook
```

### Environment Variables

- `TELEGRAM_BOT_TOKEN` - Bot token from @BotFather
- `TELEGRAM_CHAT_ID` - Your Telegram chat ID

## Grafana

### Datasources

**File**: `grafana/provisioning/datasources/datasource.yml`

**Configured Datasources**:
- Prometheus (default)
- Loki (logs)

### Dashboards

**Directory**: `grafana/dashboards/`

See [dashboards/README.md](grafana/dashboards/README.md) for:
- Dashboard creation guide
- Recommended dashboard IDs
- Example PromQL queries
- Auto-provisioning setup

### Default Credentials

- Username: `admin`
- Password: `admin` (change on first login)

## Blackbox Exporter

### Configuration

**File**: `blackbox/blackbox.yml`

**Modules**:

#### TCP Connect
Tests TCP connectivity to pools:

```yaml
modules:
  tcp_connect:
    prober: tcp
    timeout: 5s
```

### Usage

Prometheus scrapes Blackbox Exporter which probes pool targets:

```
Prometheus → Blackbox Exporter → Pool (TCP probe)
           ← Metrics (probe_success, probe_duration_seconds)
```

## Docker Compose Integration

### Volume Mounts

```yaml
prometheus:
  volumes:
    - ./docker/prometheus/prometheus.yml:/etc/prometheus/prometheus.yml
    - ./docker/prometheus/rules:/etc/prometheus/rules
    - ./docker/prometheus/targets:/etc/prometheus/targets

alertmanager:
  volumes:
    - ./docker/alertmanager/alertmanager.yml:/etc/alertmanager/alertmanager.yml

grafana:
  volumes:
    - ./docker/grafana/provisioning:/etc/grafana/provisioning
    - ./docker/grafana/dashboards:/var/lib/grafana/dashboards

blackbox-exporter:
  volumes:
    - ./docker/blackbox/blackbox.yml:/etc/blackbox/blackbox.yml
```

### Environment Variables

Set in `docker-compose.prod.yml`:

```yaml
alertmanager:
  environment:
    - TELEGRAM_BOT_TOKEN=${TELEGRAM_BOT_TOKEN}
    - TELEGRAM_CHAT_ID=${TELEGRAM_CHAT_ID}
```

## Metrics

### Python-Scheduler Metrics

Exposed at `http://python-scheduler:8000/metrics`

**Key Metrics**:
- `miner_hashrate` - Miner hashrate
- `miner_temperature` - Miner temperature
- `miner_fan_speed` - Fan speed
- `pool_network_reachable` - Pool connectivity
- `pool_network_connect_time` - Pool connection time
- `collection_duration_seconds` - Collection duration
- `collection_success` - Collection success rate

### Backend Metrics

Exposed at `http://backend:5000/metrics`

**Key Metrics**:
- `http_requests_total` - HTTP request count
- `http_request_duration_seconds` - Request duration
- `websocket_connections` - Active WebSocket connections
- `api_errors_total` - API error count

### Blackbox Metrics

Exposed at `http://blackbox-exporter:9115/metrics`

**Key Metrics**:
- `probe_success` - Probe success (1=success, 0=failure)
- `probe_duration_seconds` - Probe duration
- `probe_tcp_connect_duration_seconds` - TCP connection time

## PromQL Examples

### Miner Metrics

```promql
# Total hashrate
sum(miner_hashrate)

# Average temperature
avg(miner_temperature)

# Miners offline
count(miner_online == 0)

# High temperature miners
count(miner_temperature > 80)
```

### Pool Metrics

```promql
# Pool connectivity
probe_success{job="blackbox-tcp"}

# Pool connection time
probe_duration_seconds{job="blackbox-tcp"}

# Pools offline
count(probe_success{job="blackbox-tcp"} == 0)
```

### System Metrics

```promql
# Collection success rate
rate(collection_success[5m])

# API request rate
rate(http_requests_total[5m])

# Error rate
rate(api_errors_total[5m])
```

## Alert Examples

### Miner Offline

```yaml
- alert: MinerOffline
  expr: miner_online == 0
  for: 5m
  labels:
    severity: critical
  annotations:
    summary: "Miner {{ $labels.miner_ip }} is offline"
```

### High Temperature

```yaml
- alert: HighTemperature
  expr: miner_temperature > 85
  for: 10m
  labels:
    severity: warning
  annotations:
    summary: "Miner {{ $labels.miner_ip }} temperature is {{ $value }}°C"
```

### Pool Unreachable

```yaml
- alert: PoolUnreachable
  expr: probe_success{job="blackbox-tcp"} == 0
  for: 5m
  labels:
    severity: critical
  annotations:
    summary: "Pool {{ $labels.instance }} is unreachable"
```

## Configuration Updates

### Reload Prometheus

```bash
# Send SIGHUP to reload configuration
docker exec mining-stack-prometheus kill -HUP 1

# Or restart container
docker-compose -f docker-compose.prod.yml restart prometheus
```

### Reload Alertmanager

```bash
# Send SIGHUP to reload configuration
docker exec mining-stack-alertmanager kill -HUP 1

# Or restart container
docker-compose -f docker-compose.prod.yml restart alertmanager
```

### Update Pool Targets

Edit `prometheus/targets/pools.json` and wait 5 minutes for auto-reload, or reload Prometheus manually.

## Troubleshooting

### Prometheus Not Scraping

1. Check targets: `http://localhost:9090/targets`
2. Verify service is running
3. Check network connectivity
4. Review Prometheus logs

### Alerts Not Firing

1. Check alert rules: `http://localhost:9090/alerts`
2. Verify Alertmanager config
3. Check Alertmanager logs
4. Test alert expression in Prometheus

### Telegram Alerts Not Working

1. Verify `TELEGRAM_BOT_TOKEN` is set
2. Check `TELEGRAM_CHAT_ID` is correct
3. Test bot with `/start` command
4. Review Alertmanager logs

### Grafana Dashboards Not Loading

1. Check datasource configuration
2. Verify Prometheus is accessible
3. Review Grafana logs
4. Check dashboard JSON syntax

## Best Practices

### Alert Rules

- Use appropriate `for` duration to avoid flapping
- Set meaningful severity levels
- Include helpful annotations
- Test alerts before deploying

### Metrics

- Use consistent naming conventions
- Add relevant labels
- Document custom metrics
- Monitor cardinality

### Configuration

- Use environment variables for secrets
- Comment complex configurations
- Version control all configs
- Test changes before deploying

## See Also

- [Monitoring Improvements](../docs/features/MONITORING_IMPROVEMENTS.md)
- [Deployment Guide](../docs/DEPLOYMENT.md)
- [Troubleshooting](../docs/TROUBLESHOOTING.md)
- [Grafana Dashboards](grafana/dashboards/README.md)
