"""
Prometheus metrics definitions for mining monitoring.
"""

from prometheus_client import Gauge, Counter

# ============================================================================
# PROMETHEUS METRICS DEFINITIONS (In-Memory)
# ============================================================================

# Miner General Metrics
miner_hashrate = Gauge('miner_hashrate_ths', 'Miner hashrate in TH/s', ['ip', 'name', 'model'])
miner_power = Gauge('miner_power_watts', 'Miner power consumption in watts', ['ip', 'name', 'model'])
miner_temp_max = Gauge('miner_temp_max_c', 'Maximum temperature in Celsius', ['ip', 'name', 'model'])
miner_is_mining = Gauge('miner_is_mining', 'Mining status (1=mining, 0=not mining)', ['ip', 'name', 'model'])
miner_uptime = Gauge('miner_uptime_seconds', 'Miner uptime in seconds', ['ip', 'name', 'model'])
miner_efficiency = Gauge('miner_efficiency_j_th', 'Miner efficiency in J/TH', ['ip', 'name', 'model'])
miner_fault_light = Gauge('miner_fault_light_on', 'Fault light status (1=on, 0=off)', ['ip', 'name', 'model'])
miner_errors_count = Gauge('miner_errors_count', 'Number of errors', ['ip', 'name', 'model'])
miner_scrape_status = Gauge('miner_scrape_status', 'Scrape status (2=success, 1=partial, 0=timeout, -1=refused, -2=error)', ['ip', 'name', 'model'])

# Miner Board Metrics
miner_board_hashrate = Gauge('miner_board_hashrate_ths', 'Board hashrate in TH/s', ['ip', 'name', 'model', 'slot'])
miner_board_temp = Gauge('miner_board_temp_c', 'Board temperature in Celsius', ['ip', 'name', 'model', 'slot'])
miner_board_chips_count = Gauge('miner_board_chips_count', 'Number of chips detected', ['ip', 'name', 'model', 'slot'])
miner_board_chips_expected = Gauge('miner_board_chips_expected', 'Expected number of chips', ['ip', 'name', 'model', 'slot'])

# Miner Fan Metrics
miner_fan_speed = Gauge('miner_fan_speed_rpm', 'Fan speed in RPM', ['ip', 'name', 'model', 'fan_id'])

# Miner Pool Metrics
miner_pool_accepted = Gauge('miner_pool_accepted_total', 'Total accepted shares', ['ip', 'name', 'model'])
miner_pool_rejected = Gauge('miner_pool_rejected_total', 'Total rejected shares', ['ip', 'name', 'model'])

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
miner_state = Gauge('miner_state', 'Miner state (0=faulty, 1=idle, 2=mining)', ['ip', 'name', 'model'])
miner_hashrate_mhs = Gauge('miner_hashrate_mhs', 'Miner hashrate in MH/s (SCRYPT)', ['ip', 'name', 'model'])

# Gap-filling observability
miner_gaps_filled_total = Counter('miner_gaps_filled_total', 'Count of gaps filled by CGMiner', ['type'])
