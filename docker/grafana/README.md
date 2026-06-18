# Grafana Configuration

Grafana visualization and monitoring configuration for the Mining Stack.

## Directory Structure

```
docker/grafana/
├── provisioning/
│   ├── datasources/
│   │   ├── datasource.yml    # Prometheus datasource
│   │   └── loki.yml          # Loki datasource (logging)
│   └── dashboards/
│       └── dashboard.yml     # Dashboard provider config
├── dashboards/
│   ├── mining-overview.json       # Main mining dashboard
│   ├── per-miner-details.json     # Individual miner details
│   ├── pool-network-quality.json  # Pool network monitoring
│   └── README.md                  # Dashboard documentation
└── README.md                      # This file
```

## Configuration Files

### Datasources

#### datasources/datasource.yml

Prometheus datasource configuration:

```yaml
apiVersion: 1
datasources:
  - name: Prometheus
    type: prometheus
    access: proxy
    url: http://prometheus:9090
    isDefault: true
    editable: true
    jsonData:
      timeInterval: "30s"
```

**Features**:
- Default datasource for all dashboards
- 30-second scrape interval
- Proxy access mode
- Editable in UI

#### datasources/loki.yml

Loki datasource for log aggregation (optional):

```yaml
apiVersion: 1
datasources:
  - name: Loki
    type: loki
    access: proxy
    url: http://loki:3100
    isDefault: false
    editable: true
```

**Note**: Only used if docker-compose.logging.yml is deployed

### Dashboard Provider

#### dashboards/dashboard.yml

Dashboard auto-provisioning configuration:

```yaml
apiVersion: 1
providers:
  - name: 'Mining Dashboards'
    orgId: 1
    folder: ''
    type: file
    disableDeletion: false
    updateIntervalSeconds: 10
    allowUiUpdates: true
    options:
      path: /etc/grafana/dashboards
      foldersFromFilesStructure: true
```

**Features**:
- Auto-loads dashboards from `/etc/grafana/dashboards`
- Updates every 10 seconds
- Allows UI modifications
- Supports folder structure

## Dashboards

### 1. Mining Overview

**File**: `dashboards/mining-overview.json`

**Panels**:
- Total Hashrate (time series)
- Active Miners Count
- Average Temperature
- Total Power Consumption
- Pool Distribution
- Rejected Shares Rate
- Miner Status Table

**Use Case**: High-level farm monitoring

### 2. Per-Miner Details

**File**: `dashboards/per-miner-details.json`

**Panels**:
- Individual miner hashrate
- Temperature by chip
- Fan speeds
- Power consumption
- Uptime
- Error rates

**Use Case**: Detailed miner diagnostics

### 3. Pool Network Quality

**File**: `dashboards/pool-network-quality.json`

**Panels**:
- Pool connectivity status
- Connection latency
- Packet loss
- DNS resolution time
- TCP connection time

**Use Case**: Pool performance monitoring

## Access

### Web UI

```
http://localhost:3001
```

### Default Credentials

- **Username**: `admin`
- **Password**: set via the `GF_SECURITY_ADMIN_PASSWORD` environment variable (production) or `admin` (development)

**⚠️ Change password on first login!**

## Docker Configuration

### Volume Mounts

From `docker-compose.prod.yml`:

```yaml
grafana:
  volumes:
    - grafana-storage:/var/lib/grafana
    - ./docker/grafana/provisioning/datasources:/etc/grafana/provisioning/datasources:ro
    - ./docker/grafana/provisioning/dashboards:/etc/grafana/provisioning/dashboards:ro
    - ./docker/grafana/dashboards:/etc/grafana/dashboards
```

**Mounts**:
- `grafana-storage` - Persistent data (users, settings, etc.)
- `provisioning/datasources` - Datasource configs (read-only)
- `provisioning/dashboards` - Dashboard provider config (read-only)
- `dashboards` - Dashboard JSON files (read-write for UI updates)

### Environment Variables

```yaml
environment:
  - GF_SECURITY_ADMIN_PASSWORD=${GF_SECURITY_ADMIN_PASSWORD:?GF_SECURITY_ADMIN_PASSWORD must be set in .env}
  - GF_USERS_ALLOW_SIGN_UP=false
  - GF_DASHBOARDS_DEFAULT_HOME_DASHBOARD_PATH=/etc/grafana/dashboards/mining-overview.json
```

**Variables**:
- `GF_SECURITY_ADMIN_PASSWORD` - Admin password
- `GF_USERS_ALLOW_SIGN_UP` - Disable public signup
- `GF_DASHBOARDS_DEFAULT_HOME_DASHBOARD_PATH` - Default dashboard

## Creating Dashboards

### Option 1: Import from Grafana.com

1. Go to Grafana UI (http://localhost:3001)
2. Click **+** → **Import Dashboard**
3. Enter dashboard ID or upload JSON
4. Select **Prometheus** as the data source

**Recommended Dashboard IDs**:
- **1860**: Node Exporter Full
- **7362**: Prometheus 2.0 Stats
- **3662**: Prometheus 2.0 Overview

### Option 2: Create Custom Dashboard

1. Click **+** → **Create Dashboard**
2. Add panels with PromQL queries
3. Configure visualization
4. Save dashboard
5. Export JSON to `dashboards/` directory

### Option 3: Edit Existing Dashboard

1. Open dashboard in UI
2. Click **Dashboard settings** (gear icon)
3. Make changes
4. Save
5. Export JSON to update file

## PromQL Examples

### Miner Metrics

```promql
# Total hashrate
sum(miner_hashrate)

# Average temperature
avg(miner_temperature)

# Miners offline
count(miner_online == 0)

# Hashrate by miner
sum(miner_hashrate) by (miner_ip)

# Temperature heatmap
miner_temperature
```

### Pool Metrics

```promql
# Pool connectivity
probe_success{job="blackbox-tcp"}

# Average latency
avg(pool_network_ping_avg_ms)

# Packet loss
pool_network_packet_loss_percent

# Connection time
pool_network_connect_time_ms
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

## Dashboard Variables

### Common Variables

```
$miner_ip - Miner IP address
$pool - Pool hostname
$interval - Time interval
$__rate_interval - Auto rate interval
```

### Creating Variables

1. Dashboard Settings → Variables
2. Click **Add variable**
3. Configure:
   - **Name**: `miner_ip`
   - **Type**: Query
   - **Query**: `label_values(miner_hashrate, miner_ip)`
4. Save

## Alerting

### Alert Rules

Grafana can create alerts based on panel queries:

1. Edit panel
2. Click **Alert** tab
3. Create alert rule
4. Configure conditions
5. Set notification channel

### Notification Channels

Configure in **Alerting** → **Notification channels**:
- Email
- Slack
- Telegram
- Webhook
- PagerDuty

## Troubleshooting

### Dashboards Not Loading

1. Check Grafana logs: `docker compose logs grafana`
2. Verify datasource: Configuration → Data Sources
3. Test Prometheus connection
4. Check dashboard JSON syntax

### Datasource Connection Failed

1. Verify Prometheus is running: `docker compose ps prometheus`
2. Test connectivity: `docker exec grafana curl http://prometheus:9090`
3. Check network: `docker network inspect mining-network`
4. Review Prometheus logs

### Panels Showing "No Data"

1. Verify metrics exist: Query Prometheus directly
2. Check time range
3. Verify PromQL syntax
4. Check datasource selection

### Permission Denied

1. Check file permissions: `ls -la docker/grafana/`
2. Fix ownership: `chown -R 472:472 docker/grafana/`
3. Restart Grafana: `docker compose restart grafana`

## Best Practices

### Dashboard Design

- **Keep it simple**: Focus on key metrics
- **Use variables**: Make dashboards reusable
- **Organize panels**: Group related metrics
- **Add descriptions**: Help users understand metrics
- **Set appropriate refresh**: Balance freshness vs load

### Performance

- **Limit time range**: Don't query years of data
- **Use recording rules**: Pre-calculate expensive queries
- **Optimize queries**: Use efficient PromQL
- **Set max data points**: Prevent overload
- **Use caching**: Enable query caching

### Maintenance

- **Export dashboards**: Keep JSON files in git
- **Document changes**: Add version comments
- **Test before deploy**: Verify in dev environment
- **Monitor usage**: Check dashboard performance
- **Clean up old**: Remove unused dashboards

## Plugins

### Installing Plugins

Add to docker-compose.yml:

```yaml
environment:
  - GF_INSTALL_PLUGINS=grafana-clock-panel,grafana-simple-json-datasource
```

### Recommended Plugins

- **grafana-piechart-panel**: Pie charts
- **grafana-worldmap-panel**: Geographic visualization
- **grafana-clock-panel**: Clock display
- **grafana-polystat-panel**: Multi-stat visualization

## Backup and Restore

### Backup

```bash
# Backup Grafana data
docker run --rm -v grafana-storage:/data -v $(pwd):/backup alpine tar czf /backup/grafana-backup.tar.gz /data

# Backup dashboards
cp -r docker/grafana/dashboards /backup/
```

### Restore

```bash
# Restore Grafana data
docker run --rm -v grafana-storage:/data -v $(pwd):/backup alpine tar xzf /backup/grafana-backup.tar.gz -C /

# Restore dashboards
cp -r /backup/dashboards docker/grafana/
```

## Configuration Updates

### Reload Datasources

Datasources are auto-reloaded when files change. Or restart:

```bash
docker compose restart grafana
```

### Update Dashboards

1. Edit JSON file in `dashboards/`
2. Wait 10 seconds for auto-reload
3. Or restart Grafana

### Change Admin Password

```bash
# Via environment variable
docker compose down
# Edit docker-compose.prod.yml: GF_SECURITY_ADMIN_PASSWORD
docker compose up -d

# Via CLI
docker exec -it grafana grafana-cli admin reset-admin-password newpassword
```

## Related Documentation

- [Grafana Documentation](https://grafana.com/docs/)
- [Prometheus Datasource](https://grafana.com/docs/grafana/latest/datasources/prometheus/)
- [Dashboard Best Practices](https://grafana.com/docs/grafana/latest/best-practices/best-practices-for-creating-dashboards/)
- [Alerting Guide](https://grafana.com/docs/grafana/latest/alerting/)

## See Also

- [Prometheus Configuration](../prometheus/README.md)
- [Dashboard Documentation](dashboards/README.md)
- [Monitoring Guide](../../docs/operations/MONITORING.md)
