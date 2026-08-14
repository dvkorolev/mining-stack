"""
Prometheus metrics definitions for mining monitoring.
"""

from prometheus_client import Gauge, Counter

# ============================================================================
# PROMETHEUS METRICS DEFINITIONS (In-Memory)
# ============================================================================

# Miner General Metrics
miner_hashrate = Gauge('miner_hashrate_ths', 'Miner hashrate in TH/s (SHA-256 only)', ['ip', 'name', 'model', 'algorithm'])
miner_power = Gauge('miner_power_watts', 'Miner power consumption in watts', ['ip', 'name', 'model', 'algorithm'])
miner_temp_max = Gauge('miner_temp_max_c', 'Maximum temperature in Celsius', ['ip', 'name', 'model', 'algorithm'])
miner_is_mining = Gauge('miner_is_mining', 'Mining status (1=mining, 0=not mining)', ['ip', 'name', 'model', 'algorithm'])
miner_uptime = Gauge('miner_uptime_seconds', 'Miner uptime in seconds', ['ip', 'name', 'model', 'algorithm'])
miner_efficiency = Gauge('miner_efficiency_j_th', 'Miner efficiency in J/TH', ['ip', 'name', 'model', 'algorithm'])
miner_fault_light = Gauge('miner_fault_light_on', 'Fault light status (1=on, 0=off)', ['ip', 'name', 'model', 'algorithm'])
miner_errors_count = Gauge('miner_errors_count', 'Number of errors', ['ip', 'name', 'model', 'algorithm'])
miner_scrape_status = Gauge('miner_scrape_status', 'Scrape status (2=success, 1=partial, 0=timeout, -1=refused, -2=error)', ['ip', 'name', 'model', 'algorithm'])

# Miner Board Metrics
miner_board_hashrate = Gauge('miner_board_hashrate_ths', 'Board hashrate in TH/s', ['ip', 'name', 'model', 'slot'])
miner_board_temp = Gauge('miner_board_temp_c', 'Board temperature in Celsius', ['ip', 'name', 'model', 'slot'])
miner_board_chips_count = Gauge('miner_board_chips_count', 'Number of chips detected', ['ip', 'name', 'model', 'slot'])
miner_board_chips_expected = Gauge('miner_board_chips_expected', 'Expected number of chips', ['ip', 'name', 'model', 'slot'])

# Miner Fan Metrics
miner_fan_speed = Gauge('miner_fan_speed_rpm', 'Fan speed in RPM', ['ip', 'name', 'model', 'fan_id'])

# Miner Pool Metrics
miner_pool_accepted = Gauge('miner_pool_accepted_total', 'Total accepted shares', ['ip', 'name', 'model', 'algorithm'])
miner_pool_rejected = Gauge('miner_pool_rejected_total', 'Total rejected shares', ['ip', 'name', 'model', 'algorithm'])

# Per-pool status as the miner itself reports it (DMI-56). The `url` label is
# the fleet's ground truth for which pools are actually in use — the blackbox
# target list was hand-maintained, watched seven pools the farm does not mine
# on, and produced no signal when a real pool went Dead.
miner_pool_alive = Gauge('miner_pool_alive', 'Pool status reported by the miner (1=alive, 0=dead)', ['ip', 'name', 'url', 'pool_index'])

# Pool Network Quality Metrics
pool_network_reachable = Gauge('pool_network_reachable', 'Pool reachability (1=reachable, 0=unreachable)', ['pool', 'port'])
pool_network_dns_resolved = Gauge('pool_network_dns_resolved', 'DNS resolution status (1=success, 0=failure)', ['pool', 'port'])
pool_network_connect_time = Gauge('pool_network_connect_time_ms', 'TCP connection time in milliseconds', ['pool', 'port'])
pool_network_ping_avg = Gauge('pool_network_ping_avg_ms', 'Average ping latency in milliseconds', ['pool', 'port'])
pool_network_ping_min = Gauge('pool_network_ping_min_ms', 'Minimum ping latency in milliseconds', ['pool', 'port'])
pool_network_ping_max = Gauge('pool_network_ping_max_ms', 'Maximum ping latency in milliseconds', ['pool', 'port'])
pool_network_packet_loss = Gauge('pool_network_packet_loss_percent', 'Packet loss percentage', ['pool', 'port'])

# Collection Metrics
collection_duration = Gauge('mining_collection_duration_seconds', 'Time taken for collection', ['collector'])
collection_success = Gauge('mining_collection_success', 'Collection success status', ['collector'])
collection_timestamp = Gauge('mining_collection_timestamp_seconds', 'Last collection timestamp', ['collector'])

# Miner State Metrics
miner_state = Gauge('miner_state', 'Miner state (0=faulty, 1=idle, 2=mining)', ['ip', 'name', 'model', 'algorithm'])
miner_hashrate_mhs = Gauge('miner_hashrate_mhs', 'Miner hashrate in MH/s (SCRYPT only)', ['ip', 'name', 'model', 'algorithm'])

# Rated hashrate for the miner's model, from asic_profiles.yaml (DMI-59).
#
# The SHA-256 hashrate alerts in docker/prometheus/rules/mining_alerts.yml compare
# against this and are gated on `miner_expected_hashrate_ths > 0`; nothing published
# it, so both rules were permanently silent. The label set must stay identical to
# miner_hashrate_ths, because the rules combine the two with `and`, which matches on
# the full label set.
#
# SHA-256 only, deliberately. The profile's expected range for a SCRYPT miner is in
# MH/s, and publishing that under a name ending in `_ths` would assert a unit the
# value does not have -- the exact conflation ALGORITHM_SEPARATION.md warns about.
miner_expected_hashrate = Gauge('miner_expected_hashrate_ths', 'Rated hashrate for the miner model in TH/s (SHA-256 only)', ['ip', 'name', 'model', 'algorithm'])

# Gap-filling observability
miner_gaps_filled_total = Counter('miner_gaps_filled_total', 'Count of gaps filled by CGMiner', ['type'])

# Fallback-collector observability
miner_fallback_trigger_total = Counter('miner_fallback_trigger_total', 'Count of fallback triggers by reason category', ['reason'])
miner_fallback_total = Counter('miner_fallback_total', 'Count of fallback collector attempts by method and result', ['method', 'result'])

# Miner-config provenance (DMI-58): which source the polled miner list came from,
# and how many miners it holds. Together these make "monitoring the wrong list"
# alertable — it used to be indistinguishable from a healthy collection.
scheduler_config_source = Gauge('scheduler_config_source', 'Active miner-config source (1=active, 0=inactive)', ['source'])
scheduler_miners_configured = Gauge('scheduler_miners_configured', 'Number of miners in the active configuration')


def publish_config_source(source: str, miner_count: int, known_sources) -> None:
    """
    Publish the active miner-config source as a complete set of series.

    Every known source gets a series so the inactive ones read 0 rather than
    vanishing — an absent series and a false one look the same in a graph, and
    alerts on `== 1` need the label to exist before the bad state occurs.

    Args:
        source: the active source (config.get_miners_config_source()).
        miner_count: miners in the active configuration.
        known_sources: every possible source value (config.CONFIG_SOURCES).
    """
    for known in known_sources:
        scheduler_config_source.labels(source=known).set(1 if known == source else 0)
    scheduler_miners_configured.set(miner_count)

# ============================================================================
# METRIC CLEANUP HELPERS
# ============================================================================

# Track miner label history to detect changes
_miner_label_cache = {}  # {ip: {'name': str, 'model': str, 'algorithm': str}}

# Pool series published per miner, so ones that disappear can be removed.
_miner_pool_label_cache = {}  # {ip: {(name, url, pool_index), ...}}

# Board and fan series published per miner, same purpose as the pool cache.
_miner_board_label_cache = {}  # {ip: {(name, model, slot), ...}}
_miner_fan_label_cache = {}    # {ip: {(name, model, fan_id), ...}}

# The board gauges all carry the same label set, so one cache serves all four.
_BOARD_METRICS = (miner_board_hashrate, miner_board_temp,
                  miner_board_chips_count, miner_board_chips_expected)

# Which board reading feeds which gauge. A key absent from a board's record --
# or present as None -- publishes nothing.
_BOARD_FIELDS = (('hashrate', miner_board_hashrate),
                 ('temp', miner_board_temp),
                 ('chips', miner_board_chips_count),
                 ('expected_chips', miner_board_chips_expected))


def set_miner_pools(ip: str, name: str, pools) -> None:
    """
    Publish the pools a miner reports, and drop the ones it no longer reports.

    Cleanup matters more here than for the fixed miner gauges: a pool that is
    reconfigured away keeps its last value forever otherwise, and a stale
    `miner_pool_alive == 0` is indistinguishable from a pool that is genuinely
    down right now — the same "a leftover looks like a live signal" trap as
    DMI-54/55.

    Args:
        ip: miner address, the cache key.
        name: miner name, part of the series labels.
        pools: normalised records from pool_status.extract_pool_status().
    """
    published = set()
    for pool in pools:
        pool_index = str(pool['index'])
        miner_pool_alive.labels(
            ip=ip, name=name, url=pool['url'], pool_index=pool_index
        ).set(1 if pool['alive'] else 0)
        published.add((name, pool['url'], pool_index))

    for stale in _miner_pool_label_cache.get(ip, set()) - published:
        _remove_pool_series(ip, stale)

    if published:
        _miner_pool_label_cache[ip] = published
    else:
        _miner_pool_label_cache.pop(ip, None)


def _remove_pool_series(ip: str, labels) -> None:
    """Remove one pool series; missing combinations are not an error."""
    name, url, pool_index = labels
    try:
        miner_pool_alive.remove(ip, name, url, pool_index)
    except (KeyError, ValueError):
        pass


def remove_miner_pool_series(ip: str) -> None:
    """Drop every pool series for a miner that is gone or unreachable."""
    for labels in _miner_pool_label_cache.pop(ip, set()):
        _remove_pool_series(ip, labels)


def set_miner_boards(ip: str, name: str, model: str, boards) -> None:
    """
    Publish per-board gauges — and only the readings the miner actually gave.

    Args:
        ip: miner address, the cache key.
        name, model: the remaining board labels.
        boards: {slot: {'hashrate': …, 'temp': …, 'chips': …,
                 'expected_chips': …}}. Any field may be missing or None,
                 and each is judged on its own: a board that reports a
                 temperature but not a chip count publishes the temperature
                 and stays silent about the chips.

    A missing value is not published at all. The collector used to write
    `board.chips or 0`, which turned "pyasic told us nothing" into a
    confident zero — so 18 healthy machines reported every hashboard at zero
    chips, zero hashrate and zero temperature, indistinguishable from a
    genuinely dead board, and 21 MinerMissingChips alerts fired permanently
    against miners hashing above their rated speed (DMI-62).

    Absent is not zero. A board the miner does not describe gets no series,
    which reads as "not reported" everywhere downstream, and the chip-count
    rule compares only boards that actually answered.
    """
    published = set()
    for slot, readings in boards.items():
        slot = str(slot)
        for field, metric in _BOARD_FIELDS:
            value = readings.get(field)
            if value is None:
                continue
            metric.labels(ip=ip, name=name, model=model, slot=slot).set(value)
            published.add((name, model, slot))

    for stale in _miner_board_label_cache.get(ip, set()) - published:
        _remove_board_series(ip, stale)

    if published:
        _miner_board_label_cache[ip] = published
    else:
        _miner_board_label_cache.pop(ip, None)


def set_miner_fans(ip: str, name: str, model: str, fans) -> None:
    """
    Publish fan speeds the miner reported, dropping fans it no longer reports.

    Args:
        ip: miner address, the cache key.
        name, model: the remaining fan labels.
        fans: {fan_id: rpm}. A None rpm is not published.

    Same rule as set_miner_boards, and it matters more here: 0 RPM is a
    stopped fan, which MinerFanSpeedCritical treats as an emergency. A fan
    whose speed the miner did not report must not raise that alarm.
    """
    published = set()
    for fan_id, rpm in fans.items():
        if rpm is None:
            continue
        fan_id = str(fan_id)
        miner_fan_speed.labels(ip=ip, name=name, model=model, fan_id=fan_id).set(rpm)
        published.add((name, model, fan_id))

    for stale in _miner_fan_label_cache.get(ip, set()) - published:
        _remove_fan_series(ip, stale)

    if published:
        _miner_fan_label_cache[ip] = published
    else:
        _miner_fan_label_cache.pop(ip, None)


def _remove_board_series(ip: str, labels) -> None:
    """Remove one board's series from every board gauge."""
    name, model, slot = labels
    for metric in _BOARD_METRICS:
        try:
            metric.remove(ip, name, model, slot)
        except (KeyError, ValueError):
            pass


def _remove_fan_series(ip: str, labels) -> None:
    """Remove one fan series; a missing combination is not an error."""
    name, model, fan_id = labels
    try:
        miner_fan_speed.remove(ip, name, model, fan_id)
    except (KeyError, ValueError):
        pass


def remove_miner_board_series(ip: str) -> None:
    """Drop every board series for a miner that is gone or unreachable."""
    for labels in _miner_board_label_cache.pop(ip, set()):
        _remove_board_series(ip, labels)


def remove_miner_fan_series(ip: str) -> None:
    """Drop every fan series for a miner that is gone or unreachable."""
    for labels in _miner_fan_label_cache.pop(ip, set()):
        _remove_fan_series(ip, labels)


def get_all_miner_metrics():
    """Return all Gauge metrics that track miners"""
    return [
        miner_hashrate,
        miner_hashrate_mhs,
        miner_expected_hashrate,
        miner_power,
        miner_temp_max,
        miner_is_mining,
        miner_uptime,
        miner_efficiency,
        miner_fault_light,
        miner_errors_count,
        miner_scrape_status,
        miner_state,
        miner_pool_accepted,
        miner_pool_rejected,
    ]


def get_stale_value_metrics():
    """
    Miner gauges whose value means nothing once the scrape that produced it failed.

    Everything except `miner_scrape_status`, which is deliberately kept: it is
    the record that we know this miner and it is not answering, and it is the
    only series that says so.

    The cleanup used to do exactly the opposite — remove `miner_scrape_status`
    and `miner_state`, keep the eleven value-carrying gauges. That inverted the
    intent twice over (DMI-55):

      * a miner dead for weeks kept contributing its last hashrate, power and
        temperature to every fleet aggregate, and the error grew with each
        machine that dropped off;
      * MinerOffline (`miner_scrape_status <= 0`, for 5m) never fired at all.
        The collector republishes the -2 each cycle and the cleanup removed it
        again moments later, so the `for` timer reset forever. The one alert
        whose entire job is "this miner is gone" was silenced by the cleanup
        meant to protect it — and the appearing/disappearing series is also
        what made the scraped miner count oscillate between 20 and 25.
    """
    return [m for m in get_all_miner_metrics() if m is not miner_scrape_status]

def remove_old_miner_labels(ip: str, old_name: str, old_model: str, old_algorithm: str):
    """Remove metrics with old labels when a miner's name/model changes"""
    for metric in get_all_miner_metrics():
        try:
            metric.remove(ip, old_name, old_model, old_algorithm)
        except (KeyError, ValueError):
            # Label combination doesn't exist, that's fine
            pass


def remove_miner_series(ip: str, metrics=None) -> bool:
    """
    Remove a miner's series using the label set recorded for it.

    Callers generally know only ip/name/model; the `algorithm` label is
    recovered from the cache that update_miner_label_cache() fills on every
    successful collection. Passing fewer label values than a metric declares
    raises ValueError in prometheus_client, so the full set matters.

    An ip that was never collected has no series to remove, so this is a no-op.
    The cache entry is deliberately kept: if the miner later returns under a
    different name or model, remove_old_miner_labels() still needs it to clean
    up the remaining gauges.

    Args:
        ip: miner address, the cache key.
        metrics: metrics to clear; defaults to every miner gauge.

    Returns:
        True if a label set was known for `ip`, False if there was nothing to do.
    """
    labels = _miner_label_cache.get(ip)
    if labels is None:
        return False

    for metric in (get_all_miner_metrics() if metrics is None else metrics):
        try:
            metric.remove(ip, labels['name'], labels['model'], labels['algorithm'])
        except (KeyError, ValueError):
            # Label combination doesn't exist on this metric, that's fine
            pass
    return True

def update_miner_label_cache(ip: str, name: str, model: str, algorithm: str):
    """
    Track miner labels and remove old metrics if labels changed.
    Call this BEFORE setting new metrics.
    """
    if ip in _miner_label_cache:
        old_labels = _miner_label_cache[ip]
        # Check if any labels changed
        if (old_labels['name'] != name or 
            old_labels['model'] != model or 
            old_labels['algorithm'] != algorithm):
            # Labels changed - remove old metrics
            remove_old_miner_labels(
                ip,
                old_labels['name'],
                old_labels['model'],
                old_labels['algorithm']
            )
    
    # Update cache with new labels
    _miner_label_cache[ip] = {
        'name': name,
        'model': model,
        'algorithm': algorithm
    }
