#!/usr/bin/env python3
import asyncio
import ipaddress
import socket
import sys
import yaml
from concurrent.futures import ThreadPoolExecutor

import netifaces
from pyasic import get_miner

# --- Configuration ---
SCAN_PORTS = [4028, 80]  # Common ports for mining software
SCAN_TIMEOUT = 0.2  # Shorter timeout for faster scanning
CONCURRENCY = 100  # Number of concurrent port scans
INVENTORY_FILE = "/opt/mining-monitor/etc/miners.yaml"
# Add known IPs that might not respond to standard ports
EXTRA_IPS = ["192.168.1.78"]

def get_scan_network():
    """Automatically detect the local network for scanning."""
    try:
        gws = netifaces.gateways()
        default_gw = gws.get('default', {}).get(netifaces.AF_INET)
        if not default_gw:
            print("Could not find default gateway.", file=sys.stderr)
            return None

        iface = default_gw[1]
        ip_info = netifaces.ifaddresses(iface).get(netifaces.AF_INET, [{}])[0]
        
        if 'addr' in ip_info and 'netmask' in ip_info:
            network = ipaddress.ip_network(f"{ip_info['addr']}/{ip_info['netmask']}", strict=False)
            print(f"Found network: {network} (interface: {iface})")
            return network
    except Exception as e:
        print(f"Error detecting network: {e}", file=sys.stderr)
    return None

async def check_ports(ip: str, ports: list):
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

def generate_alias(owner, model, ip):
    """Generate a standardized alias for the miner."""
    if not all([owner, model, ip]):
        return ""
    # Clean up model string
    model_clean = (model
                  .replace(" (Stock)", "")
                  .replace(" ", "")
                  .replace("S+", "Sp")
                  .replace("S++", "Spp")
                  .replace("++", "pp")
                  .replace("+", "p"))
    last_octet = ip.split(".")[-1].zfill(3)
    return f"{owner}-{model_clean}-{last_octet}"

async def identify_miner(ip: str, default_owner: str):
    """Identify a miner and generate an inventory entry."""
    try:
        miner = await get_miner(ip)
        if miner and miner.model:
            alias = generate_alias(default_owner, miner.model, ip)
            return {
                "ip": ip, 
                "model": miner.model, 
                "alias": alias, 
                "owner": default_owner, 
                "status": "active"
            }
    except Exception as e:
        print(f"  - Error identifying {ip}: {e}", file=sys.stderr)
    return None

async def main():
    # Detect network to scan
    network_to_scan = get_scan_network()
    if not network_to_scan:
        print("Could not determine network to scan. Exiting.", file=sys.stderr)
        sys.exit(1)

    # Prepare list of IPs to scan (network hosts + extra IPs)
    all_hosts = sorted(list(set(
        [str(ip) for ip in network_to_scan.hosts()] + EXTRA_IPS
    )))
    
    # Step 1: Port scanning
    print(f"\n[1/3] Scanning ports {SCAN_PORTS} in network {network_to_scan}...")
    port_scan_tasks = [check_ports(ip, SCAN_PORTS) for ip in all_hosts]
    candidates = []
    
    # Process in batches to avoid overwhelming the network
    for i in range(0, len(port_scan_tasks), CONCURRENCY):
        batch = port_scan_tasks[i:i+CONCURRENCY]
        results = await asyncio.gather(*batch)
        candidates.extend([res for res in results if res])
    
    unique_candidates = sorted(list(set(candidates)))
    if not unique_candidates:
        print("No devices found with open ports 4028 or 80.")
        sys.exit(0)
    
    print(f"Found {len(unique_candidates)} potential miners: {unique_candidates}")

    # Step 2: Miner identification
    default_owner = "EN"  # Default owner prefix
    print(f"\n[2/3] Identifying miners (default owner: {default_owner})...")
    identify_tasks = [identify_miner(ip, default_owner) for ip in unique_candidates]
    results = await asyncio.gather(*identify_tasks)
    found_miners = [res for res in results if res]

    if not found_miners:
        print("Failed to identify any miners.")
        sys.exit(0)

    print(f"Identified {len(found_miners)} miners.")

    # Step 3: Create inventory file
    print(f"\n[3/3] Creating inventory file: {INVENTORY_FILE}")
    inventory_data = {
        "miners": sorted(found_miners, key=lambda x: ipaddress.ip_address(x['ip']))
    }

    try:
        # Create directory if it doesn't exist
        os.makedirs(os.path.dirname(INVENTORY_FILE), exist_ok=True)
        
        # Write inventory file
        with open(INVENTORY_FILE, "w") as f:
            yaml.dump(
                inventory_data, 
                f, 
                sort_keys=False, 
                indent=2, 
                allow_unicode=True
            )
        
        print("\nSuccess! Inventory file created.")
        print("You can now review and edit the owner information if needed:")
        print(f"nano {INVENTORY_FILE}")
        
    except Exception as e:
        print(f"Error writing inventory file: {e}", file=sys.stderr)
        sys.exit(1)

if __name__ == "__main__":
    asyncio.run(main())
