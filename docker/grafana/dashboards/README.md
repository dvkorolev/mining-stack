# Grafana Dashboards

This directory contains pre-configured Grafana dashboards for the mining monitoring stack.

## Available Dashboards

All of these are provisioned automatically from this directory. The list below was
rewritten 2026-08-12: it previously described dashboards "to be created" under names
that never existed, while the real files sat next to it unmentioned.

| File | UID | What it answers |
|---|---|---|
| `mining-overview.json` | `mining-farm-overview` | Fleet hashrate, active miners, power, temperature |
| `per-miner-details.json` | `per-miner-details` | One machine at a time: boards, fans, shares |
| `scrypt-miners.json` | `scrypt-miners` | The SCRYPT side of the fleet, in MH/s (see `ALGORITHM_SEPARATION.md`) |
| `pool-network-quality.json` | `pool-network-quality` | Latency, packet loss and DNS to the pools |
| `logs-overview.json` | `mining-logs` | Container logs from the stack's own services |
| `router-syslog.json` | `router-syslog` | The Keenetic's syslog: modem power cycles, connectivity events, volume |
| `network-traffic.json` | `network-traffic` | Uplink health and where the metered 4G traffic goes |

### Router Syslog

The router keeps its log in RAM and wipes it on every reboot, so it is shipped to Loki
on the Pi (DMI-44). This has been the deciding evidence in every outage investigated so
far. Two things to know before reading it:

- **Modem power cycles are not a recovery in progress.** KeeneticOS power-cycles the USB
  modem by itself when the uplink fails, and it has never restored service — on
  2026-08-12 it ran ~134 times over 2 h 29 m and the link only returned once the router
  itself was restarted. A sustained bar on that panel means an outage is ongoing.
- **`InternetChecker` is unreliable.** It has missed both a recovery and an entire
  outage. Corroborate against the fleet share rate.
- Blind spot: promtail runs on the Pi, so if the Pi is down these lines are lost.

### Network Traffic

Fed by `router-exporter` (DMI-47), which polls the router over SNMP for byte counters
and over its RCI API for signal and session state. It exists because the site could not
answer "where does the traffic go" — the miners were assumed to be the consumers, and
on 2026-08-12 they turned out to account for ~150 MB/day out of 2.4 GB.

Caveats built into the panel descriptions, repeated here because they are easy to
misread:

- `router_uplink_up` is the **USB link to the dongle**, not the 4G session. The router
  sits behind the dongle's own NAT and cannot see the session at all.
- Per-host counters **under-report badly** — 181 MB attributed to a desktop that the AP
  interface showed receiving 4.80 GB. Use them to identify a device, not to measure one.

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
