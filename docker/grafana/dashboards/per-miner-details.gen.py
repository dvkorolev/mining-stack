"""Generate per-miner-details.json.

Rebuilt 2026-08-29. The dashboard was described in the README as "One machine at
a time: boards, fans, shares" and plotted neither boards nor fans nor a single
machine -- it was six machine-level metrics across the whole fleet, the same
ones the overview dashboard already shows. Meanwhile the collector publishes
per-board temperature (PCB and chip, kept apart on purpose since DMI-62),
per-board hashrate and nameplate (DMI-64/81), chip counts, fan speeds, pool
health (DMI-56) and the provenance of the expectation the alerts compare
against -- roughly 400 series that appeared on no dashboard at all.
"""
import json

DS = {"type": "prometheus", "uid": "prometheus"}
M = 'name="$miner"'


def ts(title, targets, unit, axis, h=8, w=12, x=0, y=0, extra=None):
    """A timeseries panel matching the conventions already in this repo."""
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
                    "legend": {"displayMode": "table", "placement": "bottom",
                               "calcs": ["lastNotNull", "mean", "max"]}},
    }
    if extra:
        p["fieldConfig"]["defaults"].update(extra)
    return p


def stat(title, expr, unit, x, y, w=4, h=4, mappings=None, thresholds=None, dec=None):
    d = {"unit": unit, "color": {"mode": "thresholds"},
         "thresholds": thresholds or {"mode": "absolute",
                                      "steps": [{"color": "text", "value": None}]},
         "mappings": mappings or []}
    if dec is not None:
        d["decimals"] = dec
    return {
        "type": "stat", "title": title, "datasource": DS,
        "gridPos": {"h": h, "w": w, "x": x, "y": y},
        "targets": [{"datasource": DS, "expr": expr, "refId": "A", "instant": True}],
        "fieldConfig": {"defaults": d, "overrides": []},
        "options": {"reduceOptions": {"calcs": ["lastNotNull"], "fields": "", "values": False},
                    "textMode": "auto", "colorMode": "value", "graphMode": "none",
                    "justifyMode": "auto"},
    }


def row(title, y):
    return {"type": "row", "title": title, "collapsed": False,
            "gridPos": {"h": 1, "w": 24, "x": 0, "y": y}, "panels": []}


def table(title, targets, y, h=8, overrides=None, transformations=None):
    return {
        "type": "table", "title": title, "datasource": DS,
        "gridPos": {"h": h, "w": 24, "x": 0, "y": y},
        "targets": [{"datasource": DS, "expr": e, "refId": chr(65 + i),
                     "instant": True, "format": "table"}
                    for i, e in enumerate(targets)],
        "fieldConfig": {"defaults": {"custom": {"align": "auto", "cellOptions": {"type": "auto"}}},
                        "overrides": overrides or []},
        "options": {"showHeader": True},
        "transformations": transformations or [],
    }


panels = []
y = 0

# ---------------------------------------------------------------- at a glance
panels.append(row("At a glance", y)); y += 1
panels += [
    stat("Hashrate", f'max(miner_hashrate_ths{{{M}}})', "TH/s", 0, y, dec=2),
    stat("Rated (nameplate)", f'max(miner_expected_hashrate_ths{{{M}}})', "TH/s", 4, y, dec=2),
    # The ratio every degradation alert is built on. Warning fires below 80%,
    # critical below 50% -- the same fractions, made visible.
    stat("% of nameplate", f'100 * max(miner_hashrate_ths{{{M}}}) / max(miner_expected_hashrate_ths{{{M}}})',
         "percent", 8, y, dec=1,
         thresholds={"mode": "absolute", "steps": [
             {"color": "red", "value": None}, {"color": "orange", "value": 50},
             {"color": "green", "value": 80}]}),
    stat("Power", f'max(miner_power_watts{{{M}}})', "watt", 12, y, dec=0),
    stat("Efficiency", f'max(miner_efficiency_j_th{{{M}}})', "none", 16, y, dec=1),
    stat("Hottest chip", f'max(miner_board_chip_temp_c{{{M}}})', "celsius", 20, y, dec=1,
         thresholds={"mode": "absolute", "steps": [
             {"color": "green", "value": None}, {"color": "orange", "value": 100},
             {"color": "red", "value": 105}]}),
]
y += 4
panels += [
    stat("State", f'max(miner_state{{{M}}})', "none", 0, y,
         mappings=[{"type": "value", "options": {
             "0": {"text": "faulty", "color": "red", "index": 0},
             "1": {"text": "idle", "color": "orange", "index": 1},
             "2": {"text": "mining", "color": "green", "index": 2}}}]),
    stat("Scrape", f'max(miner_scrape_status{{{M}}})', "none", 4, y,
         mappings=[{"type": "value", "options": {
             "2": {"text": "ok", "color": "green", "index": 0},
             "1": {"text": "partial", "color": "orange", "index": 1},
             "0.5": {"text": "cgi fallback", "color": "orange", "index": 2},
             "0": {"text": "timeout", "color": "red", "index": 3},
             "-1": {"text": "refused", "color": "red", "index": 4},
             "-2": {"text": "error", "color": "red", "index": 5}}}]),
    # DMI-81: where the nameplate came from. A machine served from the model
    # string rather than asked must not look identical to one that was asked.
    stat("Nameplate source", f'max by (source) (miner_expected_hashrate_source{{{M}}} == 1)',
         "none", 8, y),
    stat("Uptime", f'max(miner_uptime_seconds{{{M}}})', "s", 12, y),
    stat("Errors", f'max(miner_errors_count{{{M}}})', "none", 16, y,
         thresholds={"mode": "absolute", "steps": [
             {"color": "green", "value": None}, {"color": "orange", "value": 1}]}),
    stat("Fault light", f'max(miner_fault_light_on{{{M}}})', "none", 20, y,
         mappings=[{"type": "value", "options": {
             "0": {"text": "off", "color": "green", "index": 0},
             "1": {"text": "ON", "color": "red", "index": 1}}}]),
]
y += 4

# ------------------------------------------------------------------ hashboards
panels.append(row("Hashboards", y)); y += 1
panels += [
    ts("Board hashrate vs its own nameplate",
       [(f'miner_board_hashrate_ths{{{M}}}', "slot {{slot}} actual"),
        (f'miner_board_expected_hashrate_ths{{{M}}}', "slot {{slot}} rated")],
       "TH/s", "Hashrate (TH/s)", y=y, x=0, w=12),
    # The DMI-62 distinction, drawn: these run 20-30 C apart, and
    # miner_temp_max_c -- which every temperature alert reads -- reports the
    # cooler one. A fleet topping out at 80 C had chips at 102-109 C.
    ts("Board (PCB) vs chip temperature",
       [(f'miner_board_temp_c{{{M}}}', "slot {{slot}} PCB"),
        (f'miner_board_chip_temp_c{{{M}}}', "slot {{slot}} chip")],
       "celsius", "Temperature (C)", y=y, x=12, w=12),
]
y += 8
panels.append(table(
    "Per-board detail",
    [f'miner_board_hashrate_ths{{{M}}}',
     f'miner_board_expected_hashrate_ths{{{M}}}',
     f'100 * miner_board_hashrate_ths{{{M}}} / miner_board_expected_hashrate_ths{{{M}}}',
     f'miner_board_chips_count{{{M}}}',
     f'miner_board_chips_expected{{{M}}}',
     f'miner_board_temp_c{{{M}}}',
     f'miner_board_chip_temp_c{{{M}}}'],
    y, h=7,
    transformations=[
        {"id": "joinByField", "options": {"byField": "slot", "mode": "outer"}},
        {"id": "organize", "options": {
            "excludeByName": {"Time": True, "Time 1": True, "Time 2": True, "Time 3": True,
                              "Time 4": True, "Time 5": True, "Time 6": True, "Time 7": True,
                              "ip": True, "ip 1": True, "ip 2": True, "ip 3": True, "ip 4": True,
                              "ip 5": True, "ip 6": True, "ip 7": True,
                              "name": True, "name 1": True, "name 2": True, "name 3": True,
                              "name 4": True, "name 5": True, "name 6": True, "name 7": True,
                              "model": True, "model 1": True, "model 2": True, "model 3": True,
                              "model 4": True, "model 5": True, "model 6": True, "model 7": True,
                              "__name__": True, "__name__ 1": True, "__name__ 2": True,
                              "__name__ 3": True, "__name__ 4": True, "__name__ 5": True,
                              "__name__ 6": True, "__name__ 7": True},
            "renameByName": {
                "slot": "Slot", "Value #A": "Hashrate TH/s", "Value #B": "Rated TH/s",
                "Value #C": "% of rated", "Value #D": "Chips", "Value #E": "Chips expected",
                "Value #F": "PCB C", "Value #G": "Chip C"}}}],
    overrides=[
        {"matcher": {"id": "byName", "options": "% of rated"},
         "properties": [{"id": "unit", "value": "percent"}, {"id": "decimals", "value": 1},
                        {"id": "custom.cellOptions",
                         "value": {"type": "color-background", "mode": "gradient"}},
                        {"id": "thresholds", "value": {"mode": "absolute", "steps": [
                            {"color": "red", "value": None}, {"color": "orange", "value": 50},
                            {"color": "green", "value": 80}]}}]},
        {"matcher": {"id": "byName", "options": "Chip C"},
         "properties": [{"id": "unit", "value": "celsius"},
                        {"id": "custom.cellOptions",
                         "value": {"type": "color-text"}},
                        {"id": "thresholds", "value": {"mode": "absolute", "steps": [
                            {"color": "green", "value": None}, {"color": "orange", "value": 100},
                            {"color": "red", "value": 105}]}}]},
        {"matcher": {"id": "byName", "options": "PCB C"},
         "properties": [{"id": "unit", "value": "celsius"}]},
    ]))
y += 7

# ---------------------------------------------------------------------- cooling
panels.append(row("Cooling", y)); y += 1
panels.append(ts("Fan speed",
                 [(f'miner_fan_speed_rpm{{{M}}}', "fan {{fan_id}}")],
                 "rotrpm", "RPM", y=y, x=0, w=12))
panels.append(ts("Temperature the alerts actually read (miner_temp_max_c)",
                 [(f'miner_temp_max_c{{{M}}}', "max temp")],
                 "celsius", "Temperature (C)", y=y, x=12, w=12))
y += 8

# ------------------------------------------------------------------------ pools
panels.append(row("Pools and shares", y)); y += 1
panels += [
    # DMI-56: pool health as the miner itself reports it. This replaces the
    # deleted pool-network-quality dashboard, which plotted constants.
    ts("Pool alive, as the miner reports it",
       [(f'miner_pool_alive{{{M}}}', "{{pool_index}} {{url}}")],
       "none", "1 = alive", y=y, x=0, w=12,
       extra={"max": 1.2, "min": -0.2,
              "custom": {"drawStyle": "line", "lineInterpolation": "stepAfter",
                         "lineWidth": 2, "fillOpacity": 15, "showPoints": "never",
                         "spanNulls": True, "axisPlacement": "auto",
                         "axisLabel": "1 = alive",
                         "scaleDistribution": {"type": "linear"}}}),
    ts("Share rate (accepted / rejected per second)",
       [(f'rate(miner_pool_accepted_total{{{M}}}[10m])', "accepted/s"),
        (f'rate(miner_pool_rejected_total{{{M}}}[10m])', "rejected/s")],
       "none", "shares/s", y=y, x=12, w=12),
]
y += 8

dashboard = {
    "uid": "per-miner-details",
    "title": "Per-Miner Details (SHA-256)",
    "tags": ["mining", "per-miner", "sha256"],
    "timezone": "browser",
    "schemaVersion": 38,
    "version": 2,
    "refresh": "30s",
    "time": {"from": "now-6h", "to": "now"},
    "editable": True,
    "graphTooltip": 1,
    "templating": {"list": [{
        "name": "miner", "type": "query", "label": "Miner",
        "datasource": DS,
        "query": {"query": "label_values(miner_scrape_status, name)", "refId": "miner"},
        "definition": "label_values(miner_scrape_status, name)",
        # 2 = refresh on time-range change, which makes Grafana scope the
        # label lookup to the dashboard's window. Without it the list is
        # whatever the TSDB has ever seen: on 2026-08-29 that was 28 names for
        # 21 machines, the extra seven being pre-DMI-74/80 renames still in
        # retention. Raising retention to 90d that morning turned a two-week
        # annoyance into a three-month one. Measured: a 6h window returns
        # exactly the 21 live miners, a 7d window returns 28.
        "refresh": 2, "sort": 1, "multi": False, "includeAll": False,
        "current": {}, "options": [],
    }]},
    "panels": panels,
}

with open('docker/grafana/dashboards/per-miner-details.json', 'w') as f:
    json.dump(dashboard, f, indent=2)
    f.write('\n')
print(f"wrote {len(panels)} panels")
