# Grafana Dashboards

This directory contains pre-configured Grafana dashboards for the mining monitoring stack.

## Available Dashboards

### 1. Mining Overview Dashboard
**File**: `mining-overview.json` (to be created)

**Panels**:
- Total Hashrate (time series)
- Active Miners Count
- Pool Distribution
- Temperature Heatmap
- Rejected Shares Rate
- Power Consumption

**Recommended**: Set as the default home dashboard in Grafana settings.

### 2. System Health Dashboard
**File**: `system-health.json` (to be created)

**Panels**:
- Service Status (python-scheduler, backend, prometheus)
- Collection Success Rate
- API Response Times
- Memory Usage
- CPU Usage
- Alert Summary

### 3. Logs Dashboard
**File**: `logs-dashboard.json` (to be created)

**Panels**:
- Recent Logs (Loki)
- Error Rate
- Log Volume by Service
- Critical Events Timeline

## Creating Dashboards

### Option 1: Import from Grafana.com

1. Go to Grafana UI (http://localhost:3001)
2. Click **+** → **Import Dashboard**
3. Enter dashboard ID or upload JSON
4. Select **Prometheus** as the data source

**Recommended Dashboard IDs**:
- **1860**: Node Exporter Full
- **3662**: Prometheus 2.0 Overview
- **13639**: Blackbox Exporter

### Option 2: Create Custom Dashboards

1. Go to Grafana UI
2. Click **+** → **Create Dashboard**
3. Add panels with PromQL queries
4. Save dashboard
5. Export JSON: **Dashboard Settings** → **JSON Model** → Copy
6. Save to this directory

### Option 3: Use Pre-built Templates

Download pre-built dashboards from:
- https://grafana.com/grafana/dashboards/
- https://github.com/rfmoz/grafana-dashboards

## Auto-Provisioning

Dashboards in this directory are automatically loaded by Grafana on startup.

**Provisioning Config**: `../provisioning/dashboards/dashboard.yml`

To add a new dashboard:
1. Place the JSON file in this directory
2. Restart Grafana: `docker-compose restart grafana`
3. Dashboard will appear in Grafana UI

## Example PromQL Queries

### Total Hashrate
```promql
sum(miner_hashrate_ths)
```

### Active Miners
```promql
count(miner_state == 2)
```

### Pool Reachability
```promql
avg(pool_network_reachable) by (pool)
```

### Temperature Alert
```promql
max(miner_temp_max_celsius) > 85
```

### Rejected Shares Rate
```promql
rate(miner_shares_rejected_total[5m]) / rate(miner_shares_accepted_total[5m])
```

## Dashboard Best Practices

1. **Use Variables**: Create dashboard variables for miner selection
2. **Set Time Ranges**: Default to last 6 hours for mining dashboards
3. **Add Annotations**: Mark important events (reboots, config changes)
4. **Use Thresholds**: Color-code panels (green/yellow/red)
5. **Add Descriptions**: Document what each panel shows

## Troubleshooting

### Dashboard Not Appearing

**Check**:
1. JSON file is valid: `cat dashboard.json | jq`
2. Grafana logs: `docker logs grafana`
3. Provisioning config: `cat ../provisioning/dashboards/dashboard.yml`

### No Data in Panels

**Check**:
1. Prometheus is scraping: http://localhost:9090/targets
2. Metrics exist: http://localhost:9090/graph
3. Data source is correct in dashboard JSON

### Dashboard Permissions

**Fix**:
```bash
chmod 644 *.json
chown 472:472 *.json  # Grafana user
```

## Contributing

When creating new dashboards:
1. Test thoroughly with real data
2. Add clear panel titles and descriptions
3. Use consistent color schemes
4. Export with "Export for sharing externally" option
5. Document any custom variables or settings
