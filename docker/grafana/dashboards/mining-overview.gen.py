"""Generate mining-overview.json.

Rebuilt 2026-08-29. The previous version predated DMI-56/62/64/81 and plotted
eight machine-level metrics, of which two were actively misleading:

  * "Farm Rejection Rate - Lifetime" divided cumulative counters, so it showed
    the average since each miner last booted -- a figure that cannot move when
    something goes wrong today, and that silently rebases when a miner reboots.
  * There was no notion of what the fleet is *supposed* to produce, because
    until DMI-81 the expectation was a family-wide guess. It is now read off
    each machine, so output can be shown against nameplate.

It also showed nothing about whether the monitoring itself was telling the
truth, which is the first thing to check after the 2026-08-28 repair policy
made per-machine faults un-actionable: what matters now is total output, the
uplink, the pools, and the stack's own honesty.
"""
import json

DS = {"type": "prometheus", "uid": "prometheus"}
SHA = 'algorithm="sha256"'


def ts(title, targets, unit, axis, y, x=0, w=12, h=8, extra=None, legend="bottom"):
    p = {
        "type": "timeseries", "title": title, "datasource": DS,
        "gridPos": {"h": h, "w": w, "x": x, "y": y},
        "targets": [{"datasource": DS, "expr": e, "legendFormat": l, "refId": chr(65 + i)}
                    for i, (e, l) in enumerate(targets)],
        "fieldConfig": {"defaults": {
            "custom": {"drawStyle": "line", "lineInterpolation": "smooth", "lineWidth": 2,
                       "fillOpacity": 8, "showPoints": "never", "spanNulls": True,
                       "axisPlacement": "auto", "axisLabel": axis,
                       "scaleDistribution": {"type": "linear"}},
            "unit": unit, "color": {"mode": "palette-classic"}}, "overrides": []},
        "options": {"tooltip": {"mode": "multi", "sort": "desc"},
                    "legend": {"displayMode": "list", "placement": legend,
                               "calcs": ["lastNotNull", "mean"]}},
    }
    if extra:
        p["fieldConfig"]["defaults"].update(extra)
    return p


def stat(title, expr, unit, x, y, w=4, h=4, dec=None, thresholds=None, mappings=None,
         legend=None, text_mode="auto"):
    d = {"unit": unit, "color": {"mode": "thresholds"},
         "thresholds": thresholds or {"mode": "absolute",
                                      "steps": [{"color": "text", "value": None}]},
         "mappings": mappings or []}
    if dec is not None:
        d["decimals"] = dec
    return {
        "type": "stat", "title": title, "datasource": DS,
        "gridPos": {"h": h, "w": w, "x": x, "y": y},
        "targets": [{"datasource": DS, "expr": expr, "refId": "A", "instant": True,
                     **({"legendFormat": legend} if legend else {})}],
        "fieldConfig": {"defaults": d, "overrides": []},
        "options": {"reduceOptions": {"calcs": ["lastNotNull"], "fields": "", "values": False},
                    "textMode": text_mode, "colorMode": "value", "graphMode": "none",
                    "justifyMode": "auto"},
    }


def row(title, y):
    return {"type": "row", "title": title, "collapsed": False,
            "gridPos": {"h": 1, "w": 24, "x": 0, "y": y}, "panels": []}


GREEN_HIGH = {"mode": "absolute", "steps": [
    {"color": "red", "value": None}, {"color": "orange", "value": 50}, {"color": "green", "value": 80}]}
RED_HIGH = {"mode": "absolute", "steps": [
    {"color": "green", "value": None}, {"color": "orange", "value": 1}, {"color": "red", "value": 3}]}

panels = []
y = 0

# --------------------------------------------------------------- fleet output
panels.append(row("Fleet output", y)); y += 1
panels += [
    stat("Hashrate (SHA-256)", f'sum(max by (ip) (miner_hashrate_ths{{{SHA}}}))', "TH/s", 0, y, dec=1),
    # DMI-81: the fleet's nameplate, read off the machines rather than guessed
    # from model strings. Before that this number could not be shown honestly.
    stat("Fleet nameplate", 'sum(max by (ip) (miner_expected_hashrate_ths))', "TH/s", 4, y, dec=1),
    stat("% of nameplate",
         f'100 * sum(max by (ip) (miner_hashrate_ths{{{SHA}}})) / sum(max by (ip) (miner_expected_hashrate_ths))',
         "percent", 8, y, dec=1, thresholds=GREEN_HIGH),
    stat("Mining now", 'count(max by (ip) (miner_state) == 2)', "none", 12, y),
    stat("Total power", 'sum(max by (ip) (miner_power_watts)) / 1000', "kwatt", 16, y, dec=2),
    stat("Avg efficiency", 'avg(max by (ip) (miner_efficiency_j_th))', "none", 20, y, dec=1),
]
y += 4
panels += [
    # The SCRYPT side stays on its own scale and its own metric, never folded
    # into the SHA-256 total -- see ALGORITHM_SEPARATION.md. One machine today.
    stat("Hashrate (SCRYPT)", 'sum(max by (ip) (miner_hashrate_mhs{algorithm="scrypt"}))',
         "none", 0, y, w=4, h=4, dec=0, legend="MH/s"),
    stat("SCRYPT miners", 'count(max by (ip) (miner_hashrate_mhs{algorithm="scrypt"}))',
         "none", 4, y, w=4, h=4),
    stat("Offline", 'count(max by (ip) (miner_scrape_status) <= 0) or vector(0)',
         "none", 8, y, w=4, h=4, thresholds=RED_HIGH),
    stat("Faulty", 'count(max by (ip) (miner_state) == 0) or vector(0)',
         "none", 12, y, w=4, h=4, thresholds=RED_HIGH),
    stat("Idle", 'count(max by (ip) (miner_state) == 1) or vector(0)',
         "none", 16, y, w=4, h=4),
    stat("Total miners", 'count(max by (ip) (miner_scrape_status))', "none", 20, y, w=4, h=4),
]
y += 4
panels += [
    # The headline panel this dashboard did not have: what the fleet produces
    # against what it is rated to produce.
    ts("Fleet output vs nameplate",
       [(f'sum(max by (ip) (miner_hashrate_ths{{{SHA}}}))', "actual"),
        ('sum(max by (ip) (miner_expected_hashrate_ths))', "nameplate")],
       "TH/s", "TH/s", y, x=0, w=16),
    ts("Power", [('sum(max by (ip) (miner_power_watts)) / 1000', "kW")],
       "kwatt", "kW", y, x=16, w=8),
]
y += 8

# ------------------------------------------------------------- uplink & pools
panels.append(row("Uplink and pools", y)); y += 1
panels += [
    # The one signal this project has found trustworthy: real share submission
    # across ~20 devices, riding the production path (DMI-46/56). Do not use
    # probe_success or any pool probe for this.
    stat("Shares accepted /s", 'sum(rate(miner_pool_accepted_total[5m]))', "none", 0, y, dec=2,
         thresholds={"mode": "absolute", "steps": [
             {"color": "red", "value": None}, {"color": "orange", "value": 0.05},
             {"color": "green", "value": 0.3}]}),
    stat("Miners with no live pool", 'count(max by (ip) (miner_pool_alive) == 0) or vector(0)',
         "none", 4, y, thresholds=RED_HIGH),
    stat("Dead pool entries", 'count(miner_pool_alive == 0) or vector(0)', "none", 8, y,
         thresholds={"mode": "absolute", "steps": [
             {"color": "green", "value": None}, {"color": "orange", "value": 1}]}),
    # Windowed, not lifetime. The previous panel divided cumulative counters,
    # so it reported the average since each miner last booted and could not
    # move when something went wrong today.
    stat("Rejection rate (1h)",
         '100 * sum(rate(miner_pool_rejected_total[1h])) / '
         '(sum(rate(miner_pool_accepted_total[1h])) + sum(rate(miner_pool_rejected_total[1h])))',
         "percent", 12, y, dec=2, thresholds=RED_HIGH),
]
y += 4
panels += [
    ts("Uplink availability: fleet share rate",
       [('sum(rate(miner_pool_accepted_total[5m]))', "accepted/s")],
       "none", "shares/s", y, x=0, w=12),
    ts("Fleet rejection rate (1h window)",
       [('100 * sum(rate(miner_pool_rejected_total[1h])) / '
         '(sum(rate(miner_pool_accepted_total[1h])) + sum(rate(miner_pool_rejected_total[1h])))',
         "rejected %")],
       "percent", "%", y, x=12, w=12),
]
y += 8

# ------------------------------------------------------------------ heat
panels.append(row("Heat", y)); y += 1
panels += [
    # DMI-62, at fleet level: these two run 20-30 C apart, and every temperature
    # alert reads the cooler one. A fleet topping out at 80 C had chips at 109.
    ts("Hottest chip vs hottest board, fleet-wide",
       [('max(miner_board_chip_temp_c)', "hottest chip"),
        ('max(miner_board_temp_c)', "hottest PCB"),
        ('max(miner_temp_max_c)', "what the alerts read")],
       "celsius", "C", y, x=0, w=16),
    stat("Miners with a chip over 100 C",
         'count(max by (ip) (miner_board_chip_temp_c) > 100) or vector(0)', "none", 16, y, w=4, h=8,
         thresholds=RED_HIGH),
    stat("Hottest chip now", 'max(miner_board_chip_temp_c)', "celsius", 20, y, w=4, h=8, dec=1,
         thresholds={"mode": "absolute", "steps": [
             {"color": "green", "value": None}, {"color": "orange", "value": 100},
             {"color": "red", "value": 105}]}),
]
y += 8

# ------------------------------------------------- is the monitoring honest?
panels.append(row("Is the monitoring telling the truth?", y)); y += 1
panels += [
    # DMI-58: polling the wrong miner list used to be indistinguishable from a
    # healthy collection.
    stat("Miner list source", 'max by (source) (scheduler_config_source == 1)',
         "none", 0, y, legend="{{source}}", text_mode="name"),
    stat("Miners configured", 'scheduler_miners_configured', "none", 4, y),
    stat("Collection age", 'time() - max(mining_collection_timestamp_seconds)', "s", 8, y, dec=0,
         thresholds={"mode": "absolute", "steps": [
             {"color": "green", "value": None}, {"color": "orange", "value": 300},
             {"color": "red", "value": 900}]}),
    stat("Cycle duration", 'max(mining_collection_duration_seconds)', "s", 12, y, dec=1),
    # DMI-81: how many machines were asked for their nameplate rather than
    # having it guessed from a model string.
    stat("Nameplate from the machine",
         'count(miner_expected_hashrate_source{source="v3"} == 1) + '
         'count(miner_expected_hashrate_source{source="cgminer"} == 1)', "none", 16, y),
    stat("Nameplate guessed from model",
         'count(miner_expected_hashrate_source{source="profile"} == 1) or vector(0)',
         "none", 20, y, thresholds={"mode": "absolute", "steps": [
             {"color": "green", "value": None}, {"color": "text", "value": 1}]}),
]
y += 4
panels += [
    stat("Pi CPU", '100 - (avg(irate(node_cpu_seconds_total{mode="idle"}[5m])) * 100)',
         "percent", 0, y, dec=0, thresholds={"mode": "absolute", "steps": [
             {"color": "green", "value": None}, {"color": "orange", "value": 70},
             {"color": "red", "value": 85}]}),
    stat("Pi memory used",
         '100 * (1 - node_memory_MemAvailable_bytes / node_memory_MemTotal_bytes)',
         "percent", 4, y, dec=0, thresholds={"mode": "absolute", "steps": [
             {"color": "green", "value": None}, {"color": "orange", "value": 80},
             {"color": "red", "value": 90}]}),
    # Added with node-exporter on 2026-08-29 (DMI-91). Retention went to 90d
    # the same morning on the strength of free space nothing was watching.
    stat("Pi disk free",
         '100 * node_filesystem_avail_bytes{mountpoint="/"} / node_filesystem_size_bytes{mountpoint="/"}',
         "percent", 8, y, dec=0, thresholds={"mode": "absolute", "steps": [
             {"color": "red", "value": None}, {"color": "orange", "value": 15},
             {"color": "green", "value": 25}]}),
    stat("Prometheus series", 'prometheus_tsdb_head_series', "none", 12, y, dec=0),
    # DMI-87: a fallback that keeps failing is switched off, and the suppression
    # is counted rather than hidden.
    stat("Fallbacks suppressed",
         'sum(miner_fallback_total{result="skipped"}) or vector(0)', "none", 16, y),
    stat("Scrape failures",
         'count(max by (ip) (miner_scrape_status) <= 0) or vector(0)', "none", 20, y,
         thresholds=RED_HIGH),
]
y += 4

# ----------------------------------------------------------------- fleet table
panels.append(row("Every miner", y)); y += 1
panels.append({
    "type": "table", "title": "Fleet", "datasource": DS,
    "gridPos": {"h": 12, "w": 24, "x": 0, "y": y},
    "targets": [{"datasource": DS, "expr": e, "refId": chr(65 + i),
                 "instant": True, "format": "table"} for i, e in enumerate([
        f'max by (name) (miner_hashrate_ths{{{SHA}}})',
        'max by (name) (miner_expected_hashrate_ths)',
        f'100 * max by (name) (miner_hashrate_ths{{{SHA}}}) / max by (name) (miner_expected_hashrate_ths)',
        'max by (name) (miner_power_watts)',
        'max by (name) (miner_efficiency_j_th)',
        'max by (name) (miner_temp_max_c)',
        'max by (name) (miner_board_chip_temp_c)',
        'max by (name) (miner_state)',
        'count by (name) (miner_pool_alive == 1)',
    ])],
    "fieldConfig": {"defaults": {"custom": {"align": "auto", "cellOptions": {"type": "auto"},
                                            "filterable": True}},
                    "overrides": [
        {"matcher": {"id": "byName", "options": "% of nameplate"},
         "properties": [{"id": "unit", "value": "percent"}, {"id": "decimals", "value": 1},
                        {"id": "custom.cellOptions",
                         "value": {"type": "color-background", "mode": "gradient"}},
                        {"id": "thresholds", "value": GREEN_HIGH}]},
        {"matcher": {"id": "byName", "options": "Chip C"},
         "properties": [{"id": "unit", "value": "celsius"}, {"id": "decimals", "value": 1},
                        {"id": "custom.cellOptions", "value": {"type": "color-text"}},
                        {"id": "thresholds", "value": {"mode": "absolute", "steps": [
                            {"color": "green", "value": None}, {"color": "orange", "value": 100},
                            {"color": "red", "value": 105}]}}]},
        {"matcher": {"id": "byName", "options": "Max C"},
         "properties": [{"id": "unit", "value": "celsius"}, {"id": "decimals", "value": 1}]},
        {"matcher": {"id": "byName", "options": "Watts"},
         "properties": [{"id": "unit", "value": "watt"}, {"id": "decimals", "value": 0}]},
        {"matcher": {"id": "byName", "options": "State"},
         "properties": [{"id": "mappings", "value": [{"type": "value", "options": {
             "0": {"text": "faulty", "color": "red", "index": 0},
             "1": {"text": "idle", "color": "orange", "index": 1},
             "2": {"text": "mining", "color": "green", "index": 2}}}]},
             {"id": "custom.cellOptions", "value": {"type": "color-text"}}]},
        {"matcher": {"id": "byName", "options": "Live pools"},
         "properties": [{"id": "custom.cellOptions", "value": {"type": "color-text"}},
                        {"id": "thresholds", "value": {"mode": "absolute", "steps": [
                            {"color": "red", "value": None}, {"color": "green", "value": 1}]}}]},
    ]},
    "options": {"showHeader": True, "sortBy": [{"displayName": "% of nameplate", "desc": False}]},
    "transformations": [
        {"id": "joinByField", "options": {"byField": "name", "mode": "outer"}},
        {"id": "organize", "options": {
            "excludeByName": {f"Time {i}": True for i in range(1, 10)} | {"Time": True},
            "renameByName": {
                "name": "Miner", "Value #A": "TH/s", "Value #B": "Nameplate",
                "Value #C": "% of nameplate", "Value #D": "Watts", "Value #E": "J/TH",
                "Value #F": "Max C", "Value #G": "Chip C", "Value #H": "State",
                "Value #I": "Live pools"}}},
    ],
})
y += 12

dashboard = {
    "uid": "mining-farm-overview",
    "title": "Mining Farm Overview",
    "tags": ["mining", "overview"],
    "timezone": "browser",
    "schemaVersion": 38,
    "version": 2,
    "refresh": "30s",
    "time": {"from": "now-6h", "to": "now"},
    "editable": True,
    "graphTooltip": 1,
    "templating": {"list": []},
    "panels": panels,
}

with open('docker/grafana/dashboards/mining-overview.json', 'w') as f:
    json.dump(dashboard, f, indent=2)
    f.write('\n')
print(f"wrote {len(panels)} panels")
