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

# Gap-filling observability
miner_gaps_filled_total = Counter('miner_gaps_filled_total', 'Count of gaps filled by CGMiner', ['type'])

# ============================================================================
# METRIC CLEANUP HELPERS
# ============================================================================

# Track miner label history to detect changes
_miner_label_cache = {}  # {ip: {'name': str, 'model': str, 'algorithm': str}}

def get_all_miner_metrics():
    """Return all Gauge metrics that track miners"""
    return [
        miner_hashrate,
        miner_hashrate_mhs,
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

def remove_old_miner_labels(ip: str, old_name: str, old_model: str, old_algorithm: str):
    """Remove metrics with old labels when a miner's name/model changes"""
    for metric in get_all_miner_metrics():
        try:
            metric.remove(ip, old_name, old_model, old_algorithm)
        except KeyError:
            # Label combination doesn't exist, that's fine
            pass

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
