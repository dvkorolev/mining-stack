#!/usr/bin/env python3
"""
Farm Initialization Script - Robust Version
Scans network for ASIC miners and generates miners.yaml configuration.
Aligned with new modular collector structure.
"""

import asyncio
import ipaddress
import os
import sys
import yaml
from pathlib import Path
from typing import Optional, Dict, List

import netifaces
from pyasic import get_miner

# ============================================================================
# Configuration
# ============================================================================

SCAN_PORTS = [4028, 80, 8080]  # Common ports for mining software
SCAN_TIMEOUT = 0.5  # Timeout for port scanning
CONCURRENCY = 50  # Number of concurrent operations
DEFAULT_OUTPUT = "/opt/mining-stack/etc/miners.yaml"
BACKUP_SUFFIX = ".backup"

# Extra IPs to scan (even if not in detected network)
EXTRA_IPS = []


# ============================================================================
# Network Detection
# ============================================================================

def get_scan_network() -> Optional[ipaddress.IPv4Network]:
    """Automatically detect the local network for scanning."""
    try:
        gws = netifaces.gateways()
        default_gw = gws.get('default', {}).get(netifaces.AF_INET)
        
        if not default_gw:
            print("❌ Could not find default gateway", file=sys.stderr)
            return None

        iface = default_gw[1]
        ip_info = netifaces.ifaddresses(iface).get(netifaces.AF_INET, [{}])[0]
        
        if 'addr' in ip_info and 'netmask' in ip_info:
            network = ipaddress.ip_network(
                f"{ip_info['addr']}/{ip_info['netmask']}", 
                strict=False
            )
            print(f"✓ Detected network: {network} (interface: {iface})")
            return network
            
    except Exception as e:
        print(f"❌ Error detecting network: {e}", file=sys.stderr)
    
    return None


# ============================================================================
# Port Scanning
# ============================================================================

async def check_ports(ip: str, ports: List[int]) -> Optional[str]:
    """Check if any port in the list is open."""
    for port in ports:
        try:
            reader, writer = await asyncio.wait_for(
                asyncio.open_connection(ip, port), 
                timeout=SCAN_TIMEOUT
            )
            writer.close()
            await writer.wait_closed()
            return ip  # Return IP as soon as first open port is found
        except (asyncio.TimeoutError, ConnectionRefusedError, OSError):
            continue
    return None


async def scan_network(network: ipaddress.IPv4Network, extra_ips: List[str]) -> List[str]:
    """Scan network for devices with open mining ports."""
    print(f"\n[1/3] Scanning for devices with open ports {SCAN_PORTS}...")
    
    # Prepare list of IPs to scan
    all_hosts = sorted(list(set(
        [str(ip) for ip in network.hosts()] + extra_ips
    )))
    
    print(f"  Scanning {len(all_hosts)} IP addresses...")
    
    # Create scanning tasks
    tasks = [check_ports(ip, SCAN_PORTS) for ip in all_hosts]
    candidates = []
    
    # Process in batches to avoid overwhelming the network
    for i in range(0, len(tasks), CONCURRENCY):
        batch = tasks[i:i+CONCURRENCY]
        results = await asyncio.gather(*batch, return_exceptions=True)
        
        # Filter out None and exceptions
        batch_candidates = [
            res for res in results 
            if res and not isinstance(res, Exception)
        ]
        candidates.extend(batch_candidates)
        
        # Progress indicator
        progress = min(i + CONCURRENCY, len(tasks))
        print(f"  Progress: {progress}/{len(tasks)} ({len(candidates)} found)", end='\r')
    
    print()  # New line after progress
    
    unique_candidates = sorted(list(set(candidates)))
    print(f"✓ Found {len(unique_candidates)} potential miners")
    
    return unique_candidates


# ============================================================================
# Miner Identification
# ============================================================================

def generate_miner_name(ip: str, model: str) -> str:
    """Generate a unique miner name from IP and model."""
    # Extract model prefix (e.g., "S19" from "Antminer S19j Pro")
    model_parts = model.split()
    model_prefix = ""
    
    for part in model_parts:
        if any(c.isdigit() for c in part):
            model_prefix = part.replace("+", "p").replace(" ", "")
            break
    
    if not model_prefix:
        model_prefix = model.replace(" ", "")[:10]
    
    # Use last octet of IP
    last_octet = ip.split(".")[-1].zfill(3)
    
    return f"{model_prefix.lower()}-{last_octet}"


def detect_miner_credentials(model: str) -> Dict[str, str]:
    """Detect default credentials based on miner model."""
    model_lower = model.lower()
    
    # Whatsminer uses admin/admin
    if any(x in model_lower for x in ['whatsminer', 'm30', 'm50', 'm20', 'm60']):
        return {'username': 'admin', 'password': 'admin'}
    
    # Antminer uses root/root
    if any(x in model_lower for x in ['antminer', 's19', 's17', 't19', 'l3', 'l7']):
        return {'username': 'root', 'password': 'root'}
    
    # AvalonMiner uses root/root
    if 'avalon' in model_lower:
        return {'username': 'root', 'password': 'root'}
    
    # Default to root/root
    return {'username': 'root', 'password': 'root'}


async def identify_miner(ip: str) -> Optional[Dict]:
    """Identify a miner and generate configuration entry."""
    try:
        # Get miner object
        miner = await asyncio.wait_for(get_miner(ip), timeout=10)
        
        if not miner or not miner.model:
            print(f"  ⚠️  {ip}: Could not identify model", file=sys.stderr)
            return None
        
        # Generate name
        name = generate_miner_name(ip, miner.model)
        
        # Detect credentials
        credentials = detect_miner_credentials(miner.model)
        
        # Try to get additional data (non-blocking)
        alias = None
        try:
            data = await asyncio.wait_for(miner.get_data(), timeout=5)
            if data:
                # Use MAC address or serial if available for alias
                if hasattr(data, 'mac'):
                    alias = f"{miner.model} ({data.mac})"
                else:
                    alias = miner.model
        except:
            alias = miner.model
        
        # Build configuration entry (aligned with collectors)
        entry = {
            'ip': ip,
            'name': name,
            'model': miner.model,
            'alias': alias or miner.model,
            'username': credentials['username'],
            'password': credentials['password'],
        }
        
        print(f"  ✓ {ip}: {miner.model} → {name}")
        return entry
        
    except asyncio.TimeoutError:
        print(f"  ⏱️  {ip}: Timeout during identification", file=sys.stderr)
    except Exception as e:
        print(f"  ❌ {ip}: Error - {e}", file=sys.stderr)
    
    return None


async def identify_miners(candidates: List[str]) -> List[Dict]:
    """Identify all candidate miners."""
    print(f"\n[2/3] Identifying miners...")
    
    tasks = [identify_miner(ip) for ip in candidates]
    results = await asyncio.gather(*tasks, return_exceptions=True)
    
    # Filter out None and exceptions
    found_miners = [
        res for res in results 
        if res and not isinstance(res, Exception)
    ]
    
    print(f"✓ Successfully identified {len(found_miners)}/{len(candidates)} miners")
    
    return found_miners


# ============================================================================
# Configuration Generation
# ============================================================================

def validate_config(miners: List[Dict]) -> bool:
    """Validate generated configuration."""
    if not miners:
        print("❌ No miners to validate", file=sys.stderr)
        return False
    
    required_fields = ['ip', 'name', 'model']
    
    for i, miner in enumerate(miners):
        for field in required_fields:
            if field not in miner:
                print(f"❌ Miner {i+1} missing required field: {field}", file=sys.stderr)
                return False
        
        # Check for duplicate names
        names = [m['name'] for m in miners]
        if len(names) != len(set(names)):
            print(f"❌ Duplicate miner names found", file=sys.stderr)
            return False
        
        # Check for duplicate IPs
        ips = [m['ip'] for m in miners]
        if len(ips) != len(set(ips)):
            print(f"❌ Duplicate IP addresses found", file=sys.stderr)
            return False
    
    print(f"✓ Configuration validated: {len(miners)} miners")
    return True


def backup_existing_config(output_file: str) -> bool:
    """Backup existing configuration file."""
    if not os.path.exists(output_file):
        return True
    
    backup_file = output_file + BACKUP_SUFFIX
    try:
        import shutil
        shutil.copy2(output_file, backup_file)
        print(f"✓ Backed up existing config to: {backup_file}")
        return True
    except Exception as e:
        print(f"⚠️  Could not backup existing config: {e}", file=sys.stderr)
        return False


def write_config(miners: List[Dict], output_file: str) -> bool:
    """Write configuration to YAML file."""
    print(f"\n[3/3] Writing configuration to: {output_file}")
    
    # Sort miners by IP address
    sorted_miners = sorted(miners, key=lambda x: ipaddress.ip_address(x['ip']))
    
    config_data = {'miners': sorted_miners}
    
    try:
        # Create directory if it doesn't exist
        os.makedirs(os.path.dirname(output_file), exist_ok=True)
        
        # Backup existing config
        backup_existing_config(output_file)
        
        # Write new config
        with open(output_file, 'w') as f:
            # Add header comment
            f.write("# Auto-generated miners configuration\n")
            f.write("# Generated by farm_init.py\n")
            f.write("#\n")
            f.write("# Required fields: ip, name, model\n")
            f.write("# Optional fields: alias, username, password, api_port\n")
            f.write("#\n\n")
            
            yaml.dump(
                config_data,
                f,
                sort_keys=False,
                indent=2,
                allow_unicode=True,
                default_flow_style=False
            )
        
        print(f"✓ Configuration written successfully")
        return True
        
    except Exception as e:
        print(f"❌ Error writing configuration: {e}", file=sys.stderr)
        return False


# ============================================================================
# Main
# ============================================================================

async def main():
    """Main entry point."""
    print("=" * 60)
    print("Mining Farm Initialization - Robust Version")
    print("=" * 60)
    
    # Detect network
    network = get_scan_network()
    if not network:
        print("\n❌ Could not determine network to scan", file=sys.stderr)
        print("Please check your network connection", file=sys.stderr)
        sys.exit(1)
    
    # Scan for candidates
    candidates = await scan_network(network, EXTRA_IPS)
    
    if not candidates:
        print("\n⚠️  No devices found with open mining ports")
        print("Possible reasons:")
        print("  - No miners on this network")
        print("  - Miners are offline")
        print("  - Firewall blocking connections")
        sys.exit(0)
    
    # Identify miners
    miners = await identify_miners(candidates)
    
    if not miners:
        print("\n⚠️  Could not identify any miners")
        print("Possible reasons:")
        print("  - Devices are not ASIC miners")
        print("  - PyASIC doesn't support these models")
        print("  - Miners are not responding correctly")
        sys.exit(0)
    
    # Validate configuration
    if not validate_config(miners):
        print("\n❌ Configuration validation failed")
        sys.exit(1)
    
    # Write configuration
    output_file = os.getenv('MINERS_CONFIG', DEFAULT_OUTPUT)
    
    if not write_config(miners, output_file):
        print("\n❌ Failed to write configuration")
        sys.exit(1)
    
    # Success summary
    print("\n" + "=" * 60)
    print("✅ SUCCESS!")
    print("=" * 60)
    print(f"Found and configured {len(miners)} miners:")
    for miner in miners:
        print(f"  • {miner['name']}: {miner['model']} ({miner['ip']})")
    
    print(f"\nConfiguration file: {output_file}")
    print("\nNext steps:")
    print(f"  1. Review configuration: nano {output_file}")
    print(f"  2. Update credentials if needed")
    print(f"  3. Restart python-scheduler service")
    print()


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print("\n\n⚠️  Interrupted by user")
        sys.exit(130)
    except Exception as e:
        print(f"\n❌ Unexpected error: {e}", file=sys.stderr)
        sys.exit(1)
