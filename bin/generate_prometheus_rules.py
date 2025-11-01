#!/usr/bin/env python3
"""
Generate Prometheus Alert Rules from Miner Thresholds

Reads miners.yaml and global config, generates mining_alerts.yml
with per-miner thresholds.
"""

import yaml
import os
from pathlib import Path

# Paths
BASE_PATH = Path(__file__).parent.parent
MINERS_CONFIG = BASE_PATH / 'etc' / 'miners.yaml'
RULES_OUTPUT = BASE_PATH / 'docker' / 'prometheus' / 'rules' / 'mining_alerts.yml'

# Global defaults (from backend config)
GLOBAL_DEFAULTS = {
    'temperature': {
        'warning': int(os.getenv('THRESHOLD_TEMP_WARNING', '75')),
        'critical': int(os.getenv('THRESHOLD_TEMP_CRITICAL', '85')),
        'shutdown': int(os.getenv('THRESHOLD_TEMP_SHUTDOWN', '90')),
    },
    'hashrate': {
        'warningPercent': int(os.getenv('THRESHOLD_HASHRATE_WARNING_PCT', '20')),
        'criticalPercent': int(os.getenv('THRESHOLD_HASHRATE_CRITICAL_PCT', '50')),
    },
    'power': {
        'warningPercent': int(os.getenv('THRESHOLD_POWER_WARNING_PCT', '15')),
    },
    'rejectionRate': {
        'warning': float(os.getenv('THRESHOLD_REJECTION_WARNING', '2.0')),
        'critical': float(os.getenv('THRESHOLD_REJECTION_CRITICAL', '5.0')),
    },
    'fanSpeed': {
        'warning': int(os.getenv('THRESHOLD_FAN_WARNING', '3000')),
        'critical': int(os.getenv('THRESHOLD_FAN_CRITICAL', '2000')),
    },
}

def get_effective_thresholds(miner):
    """Get effective thresholds for a miner (global + per-miner overrides)"""
    thresholds = miner.get('thresholds', {})
    
    return {
        'temperature': {
            'warning': thresholds.get('temperature', {}).get('warning', GLOBAL_DEFAULTS['temperature']['warning']),
            'critical': thresholds.get('temperature', {}).get('critical', GLOBAL_DEFAULTS['temperature']['critical']),
            'shutdown': thresholds.get('temperature', {}).get('shutdown', GLOBAL_DEFAULTS['temperature']['shutdown']),
        },
        'hashrate': {
            'expected': thresholds.get('hashrate', {}).get('expected', 0),
            'warningPercent': thresholds.get('hashrate', {}).get('warningPercent', GLOBAL_DEFAULTS['hashrate']['warningPercent']),
            'criticalPercent': thresholds.get('hashrate', {}).get('criticalPercent', GLOBAL_DEFAULTS['hashrate']['criticalPercent']),
        },
        'power': {
            'expected': thresholds.get('power', {}).get('expected', 0),
            'warningPercent': thresholds.get('power', {}).get('warningPercent', GLOBAL_DEFAULTS['power']['warningPercent']),
        },
        'rejectionRate': {
            'warning': thresholds.get('rejectionRate', {}).get('warning', GLOBAL_DEFAULTS['rejectionRate']['warning']),
            'critical': thresholds.get('rejectionRate', {}).get('critical', GLOBAL_DEFAULTS['rejectionRate']['critical']),
        },
        'fanSpeed': {
            'warning': thresholds.get('fanSpeed', {}).get('warning', GLOBAL_DEFAULTS['fanSpeed']['warning']),
            'critical': thresholds.get('fanSpeed', {}).get('critical', GLOBAL_DEFAULTS['fanSpeed']['critical']),
        },
    }

def generate_rules():
    """Generate Prometheus alert rules from miner configuration"""
    
    # Load miners config
    with open(MINERS_CONFIG, 'r') as f:
        config = yaml.safe_load(f)
    
    miners = config.get('miners', [])
    
    # Build rules
    rules = {
        'groups': [
            {
                'name': 'mining_critical',
                'interval': '30s',
                'rules': []
            },
            {
                'name': 'mining_warning',
                'interval': '30s',
                'rules': []
            }
        ]
    }
    
    critical_rules = rules['groups'][0]['rules']
    warning_rules = rules['groups'][1]['rules']
    
    # Global rules (apply to all miners)
    
    # Miner offline
    critical_rules.append({
        'alert': 'MinerOffline',
        'expr': 'miner_scrape_success == 0',
        'for': '5m',
        'labels': {
            'severity': 'critical',
            'component': 'miner'
        },
        'annotations': {
            'summary': 'Miner {{ $labels.name }} is offline',
            'description': 'Miner {{ $labels.name }} ({{ $labels.ip }}) has been unreachable for 5 minutes.'
        }
    })
    
    # Miner stopped mining
    critical_rules.append({
        'alert': 'MinerNotMining',
        'expr': 'miner_is_mining == 0 and miner_scrape_success == 1',
        'for': '5m',
        'labels': {
            'severity': 'critical',
            'component': 'miner'
        },
        'annotations': {
            'summary': 'Miner {{ $labels.name }} stopped mining',
            'description': 'Miner {{ $labels.name }} is online but not mining for 5 minutes.'
        }
    })
    
    # Per-miner threshold rules
    for miner in miners:
        name = miner.get('alias', miner.get('name', miner['ip']))
        ip = miner['ip']
        thresholds = get_effective_thresholds(miner)
        
        # Temperature critical
        temp_critical = thresholds['temperature']['critical']
        critical_rules.append({
            'alert': 'MinerHighTemperature',
            'expr': f'miner_temp_max_c{{name="{name}"}} > {temp_critical}',
            'for': '2m',
            'labels': {
                'severity': 'critical',
                'component': 'miner',
                'miner': name
            },
            'annotations': {
                'summary': f'Miner {name} temperature critical',
                'description': f'Miner {name} temperature is {{{{ $value }}}}°C (threshold: {temp_critical}°C)'
            }
        })
        
        # Temperature warning
        temp_warning = thresholds['temperature']['warning']
        warning_rules.append({
            'alert': 'MinerTemperatureHigh',
            'expr': f'miner_temp_max_c{{name="{name}"}} > {temp_warning} and miner_temp_max_c{{name="{name}"}} <= {temp_critical}',
            'for': '5m',
            'labels': {
                'severity': 'warning',
                'component': 'miner',
                'miner': name
            },
            'annotations': {
                'summary': f'Miner {name} temperature elevated',
                'description': f'Miner {name} temperature is {{{{ $value }}}}°C (warning threshold: {temp_warning}°C)'
            }
        })
        
        # Hashrate critical (if expected is set)
        if thresholds['hashrate']['expected'] > 0:
            expected = thresholds['hashrate']['expected']
            critical_percent = thresholds['hashrate']['criticalPercent']
            critical_threshold = expected * (1 - critical_percent / 100)
            
            critical_rules.append({
                'alert': 'MinerHashrateCritical',
                'expr': f'miner_hashrate_ths{{name="{name}"}} < {critical_threshold} and miner_is_mining == 1',
                'for': '10m',
                'labels': {
                    'severity': 'critical',
                    'component': 'miner',
                    'miner': name
                },
                'annotations': {
                    'summary': f'Miner {name} hashrate critically low',
                    'description': f'Miner {name} hashrate is {{{{ $value }}}} TH/s (expected: {expected} TH/s, threshold: {critical_threshold:.1f} TH/s)'
                }
            })
            
            # Hashrate warning
            warning_percent = thresholds['hashrate']['warningPercent']
            warning_threshold = expected * (1 - warning_percent / 100)
            
            warning_rules.append({
                'alert': 'MinerHashrateWarning',
                'expr': f'miner_hashrate_ths{{name="{name}"}} < {warning_threshold} and miner_hashrate_ths{{name="{name}"}} >= {critical_threshold} and miner_is_mining == 1',
                'for': '15m',
                'labels': {
                    'severity': 'warning',
                    'component': 'miner',
                    'miner': name
                },
                'annotations': {
                    'summary': f'Miner {name} hashrate low',
                    'description': f'Miner {name} hashrate is {{{{ $value }}}} TH/s (expected: {expected} TH/s, warning: {warning_threshold:.1f} TH/s)'
                }
            })
        
        # Fan speed critical
        fan_critical = thresholds['fanSpeed']['critical']
        critical_rules.append({
            'alert': 'MinerFanFailure',
            'expr': f'miner_fan_speed_rpm{{name="{name}"}} < {fan_critical} and miner_fan_speed_rpm{{name="{name}"}} > 0',
            'for': '2m',
            'labels': {
                'severity': 'critical',
                'component': 'miner',
                'miner': name
            },
            'annotations': {
                'summary': f'Miner {name} fan failure',
                'description': f'Miner {name} fan speed is {{{{ $value }}}} RPM (critical threshold: {fan_critical} RPM)'
            }
        })
    
    # Global rejection rate alert
    rejection_critical = GLOBAL_DEFAULTS['rejectionRate']['critical'] / 100
    warning_rules.append({
        'alert': 'MinerHighRejectionRate',
        'expr': f'(rate(miner_pool_rejected_total[5m]) / (rate(miner_pool_accepted_total[5m]) + rate(miner_pool_rejected_total[5m]))) > {rejection_critical}',
        'for': '10m',
        'labels': {
            'severity': 'warning',
            'component': 'miner'
        },
        'annotations': {
            'summary': 'Miner {{ $labels.name }} high rejection rate',
            'description': 'Miner {{ $labels.name }} rejection rate is {{ $value | humanizePercentage }} (threshold: ' + str(int(rejection_critical * 100)) + '%)'
        }
    })
    
    # Fault light
    warning_rules.append({
        'alert': 'MinerFaultLight',
        'expr': 'miner_fault_light_on == 1',
        'for': '2m',
        'labels': {
            'severity': 'warning',
            'component': 'miner'
        },
        'annotations': {
            'summary': 'Miner {{ $labels.name }} fault light active',
            'description': 'Miner {{ $labels.name }} has fault light indicator on.'
        }
    })
    
    # Write rules file
    RULES_OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    with open(RULES_OUTPUT, 'w') as f:
        yaml.dump(rules, f, default_flow_style=False, sort_keys=False, width=120)
    
    print(f"✓ Generated {len(critical_rules)} critical rules")
    print(f"✓ Generated {len(warning_rules)} warning rules")
    print(f"✓ Written to {RULES_OUTPUT}")
    print(f"\nReload Prometheus to apply:")
    print(f"  docker exec mining-stack-prometheus-1 kill -HUP 1")

if __name__ == '__main__':
    generate_rules()
