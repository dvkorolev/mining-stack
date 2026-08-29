# Prometheus Configuration

Prometheus monitoring configuration for the Mining Stack.

## Directory Structure

```
docker/prometheus/
├── prometheus.yml           # Main Prometheus configuration
├── rules/                   # Alert rules
│   ├── mining_alerts.yml   # Mining-specific alerts
│   └── pool_status_alerts.yml   # Pool health, as the miners report it
├── targets/                 # Service discovery targets
│   └── pools.json          # Mining pool targets for Blackbox
└── README.md               # This file
```

## Configuration Files

### prometheus.yml

Main Prometheus configuration with scrape jobs for all services.

**Scrape Jobs**:
- `prometheus` - Self-monitoring (localhost:9090)
- `python-scheduler` - Mining metrics and system metrics (python-scheduler:8000)
- `backend` - Backend API metrics (backend:5000)
- `grafana` - Grafana metrics (grafana:3000)
- `blackbox-tcp` - Pool TCP connectivity checks

**Global Settings**:
- Scrape interval: 30s
- Evaluation interval: 30s
- Scrape timeout: 10s
- External labels: cluster=mining-stack, environment=production

### rules/mining_alerts.yml

Alert rules for mining operations:
- Miner offline detection
- High temperature warnings
- Low hashrate alerts
- Fan failure detection
- Rejected shares monitoring

### rules/pool_status_alerts.yml

Pool health read from `miner_pool_alive` — each miner's own verdict on its pools
(DMI-56):
- A miner has no live pool left (critical)
- A pool is dead across the fleet (critical)
- Primary pool dead / backup pool dead (warning)

`pool_network_alerts.yml` was deleted along with the `pool_network_*` family it
read: bare-TCP probing measures the pool's tolerance of us rather than our
connectivity, and four of those gauges were written as a literal 0.0 every cycle.

### targets/pools.json

File-based service discovery for mining pool targets.

**Format**:
```json
[
  {
    "targets": [
      "stratum.slushpool.com:3333",
      "stratum.f2pool.com:3333"
    ],
    "labels": {
      "job": "pool-tcp-check",
      "monitor": "blackbox"
    }
  }
]
```

**Auto-reload**: Every 5 minutes

## Metrics Collected

### Python Scheduler Metrics

**Source**: `python-scheduler:8000/metrics`

**Miner Metrics**:
- `miner_hashrate` - Miner hashrate (TH/s)
- `miner_temperature` - Chip temperature (°C)
- `miner_fan_speed` - Fan speed (RPM)
- `miner_power` - Power consumption (W)
- `miner_online` - Online status (1=online, 0=offline)
- `miner_rejected_shares` - Rejected share count

**Pool Metrics**:
- `miner_pool_alive` - Pool status as reported by the miner (1=alive, 0=dead)
- `miner_pool_accepted_total` / `miner_pool_rejected_total` - Share counts

Uplink availability is `sum(rate(miner_pool_accepted_total[5m]))`. There is no
`pool_network_*` family; see `targets/README.md` for why pools are not probed.

**Collection Metrics**:
- `collection_duration_seconds` - Collection duration
- `collection_success` - Collection success (1=success, 0=failure)
- `collection_timestamp` - Last collection timestamp

### Backend Metrics

**Source**: `backend:5000/metrics`

**API Metrics**:
- `http_requests_total` - Total HTTP requests
- `http_request_duration_seconds` - Request duration
- `websocket_connections` - Active WebSocket connections
- `api_errors_total` - API error count

### Blackbox Metrics

**Source**: `blackbox-exporter:9115/metrics`

**Probe Metrics**:
- `probe_success` - Probe success (1=success, 0=failure)
- `probe_duration_seconds` - Probe duration
- `probe_tcp_connect_duration_seconds` - TCP connection time

## Alert Rules

### Critical Alerts

**MinerOffline**:
- Condition: `miner_online == 0`
- Duration: 5 minutes
- Action: Telegram notification

**MinerNoLivePool**:
- Condition: `max by (ip, name) (miner_pool_alive) == 0`
- Duration: 5 minutes
- Action: Telegram notification

**HighTemperature**:
- Condition: `miner_temperature > 85`
- Duration: 10 minutes
- Action: Telegram notification

### Warning Alerts

**PrimaryPoolDead**:
- Condition: `miner_pool_alive{pool_index="0"} == 0`
- Duration: 10 minutes
- Action: Log and dashboard

**LowHashrate**:
- Condition: `miner_hashrate < threshold`
- Duration: 15 minutes
- Action: Log and dashboard

## PromQL Examples

### Miner Queries

```promql
# Total hashrate across all miners
sum(miner_hashrate)

# Average temperature
avg(miner_temperature)

# Miners offline
count(miner_online == 0)

# High temperature miners
count(miner_temperature > 80)

# Hashrate by miner
sum(miner_hashrate) by (miner_ip)
```

### Pool Queries

```promql
# Pool connectivity
probe_success{job="blackbox-tcp"}

# Pool connection time
probe_duration_seconds{job="blackbox-tcp"}

# Miners with no live pool
count(max by (ip, name) (miner_pool_alive) == 0)

# Uplink availability: real share submission across the fleet
sum(rate(miner_pool_accepted_total[5m]))
```

### System Queries

```promql
# Collection success rate
rate(collection_success[5m])

# API request rate
rate(http_requests_total[5m])

# Error rate
rate(api_errors_total[5m])
```

## Configuration Updates

### Reload Prometheus

```bash
# Send SIGHUP to reload configuration
docker exec mining-stack-prometheus kill -HUP 1

# Or restart container
docker compose -f docker-compose.prod.yml restart prometheus
```

### Update Pool Targets

Edit `targets/pools.json` and wait 5 minutes for auto-reload, or reload Prometheus manually.

### Add New Alert Rules

1. Create/edit YAML file in `rules/`
2. Reload Prometheus configuration
3. Verify in Prometheus UI: http://localhost:9090/alerts

## Accessing Prometheus

### Web UI

```
http://localhost:9090
```

### API Endpoints

```bash
# Query API
curl 'http://localhost:9090/api/v1/query?query=up'

# Query range
curl 'http://localhost:9090/api/v1/query_range?query=miner_hashrate&start=...'

# Targets
curl 'http://localhost:9090/api/v1/targets'

# Alerts
curl 'http://localhost:9090/api/v1/alerts'
```

## Troubleshooting

### Targets Not Showing

1. Check Prometheus logs: `docker compose logs prometheus`
2. Verify service is running: `docker compose ps`
3. Check network connectivity: `docker exec prometheus ping python-scheduler`
4. Verify metrics endpoint: `curl http://python-scheduler:8000/metrics`

### Alerts Not Firing

1. Check alert rules: http://localhost:9090/alerts
2. Verify rule syntax: `promtool check rules rules/*.yml`
3. Check Alertmanager: http://localhost:9093
4. Review Prometheus logs

### High Memory Usage

1. Reduce retention period in docker-compose.yml
2. Decrease scrape frequency
3. Limit metric cardinality
4. Add recording rules for expensive queries

## Best Practices

### Scrape Intervals

- **High-frequency** (15-30s): Critical metrics (miner status, pool connectivity)
- **Medium-frequency** (30-60s): Standard metrics (API, system)
- **Low-frequency** (60-300s): Slow-changing metrics (configuration)

### Alert Thresholds

- Set `for` duration to avoid flapping
- Use appropriate severity levels
- Include helpful annotations
- Test before deploying

### Metric Naming

- Follow Prometheus naming conventions
- Use consistent labels
- Document custom metrics
- Avoid high cardinality

## Retention

Default retention: **15 days**

Configure in docker-compose.yml:
```yaml
prometheus:
  command:
    - '--storage.tsdb.retention.time=15d'
    - '--storage.tsdb.retention.size=10GB'
```

## Related Documentation

- [Prometheus Documentation](https://prometheus.io/docs/)
- [PromQL Guide](https://prometheus.io/docs/prometheus/latest/querying/basics/)
- [Alert Rules](https://prometheus.io/docs/prometheus/latest/configuration/alerting_rules/)
- [Blackbox Exporter](https://github.com/prometheus/blackbox_exporter)

## See Also

- [Monitoring Guide](../../docs/operations/MONITORING.md)
- [Grafana Dashboards](../grafana/dashboards/README.md)
- [Alertmanager Config](../alertmanager/alertmanager.yml)
