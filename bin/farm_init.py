#!/usr/bin/env python3
"""
Farm Initialization Script - Robust Version
Scans network for ASIC miners and generates miners.yaml configuration.
Aligned with new modular collector structure.

Subcommands:
  init       Scan the LAN and write a fresh inventory (default).
  reconcile  Match an existing inventory to currently-live miners by MAC/IP.
"""

import argparse
import asyncio
import copy
import ipaddress
import json
import os
import sys
import yaml
from pathlib import Path
from typing import Optional, Dict, List

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
# MAC handling
# ============================================================================

def normalize_mac(mac: Optional[str]) -> Optional[str]:
    """
    Normalize a MAC address to uppercase, colon-separated form.

    Accepts common separators (:, -, spaces) and bare 12-character hex strings.
    Returns None for empty/invalid input.
    """
    if mac is None:
        return None

    s = str(mac).strip().upper()
    if not s:
        return None

    # Normalize separators to colons
    s = s.replace("-", ":").replace(" ", ":")

    # Handle bare 12-character hex, e.g. "CC0C0C000217"
    if ":" not in s and len(s) == 12:
        s = ":".join(s[i : i + 2] for i in range(0, 12, 2))

    parts = [p.strip() for p in s.split(":") if p.strip()]
    if len(parts) != 6:
        return None

    try:
        normalized = ":".join(f"{int(p, 16):02X}" for p in parts)
    except ValueError:
        return None

    return normalized


# ============================================================================
# Network Detection
# ============================================================================

def get_scan_network() -> Optional[ipaddress.IPv4Network]:
    """Automatically detect the local network for scanning."""
    # Lazy import: netifaces may not be installed in all environments.
    import netifaces

    try:
        gws = netifaces.gateways()
        default_gw = gws.get("default", {}).get(netifaces.AF_INET)

        if not default_gw:
            print("❌ Could not find default gateway", file=sys.stderr)
            return None

        iface = default_gw[1]
        ip_info = netifaces.ifaddresses(iface).get(netifaces.AF_INET, [{}])[0]

        if "addr" in ip_info and "netmask" in ip_info:
            network = ipaddress.ip_network(
                f"{ip_info['addr']}/{ip_info['netmask']}", strict=False
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
                asyncio.open_connection(ip, port), timeout=SCAN_TIMEOUT
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
    all_hosts = sorted(
        list(set([str(ip) for ip in network.hosts()] + extra_ips))
    )

    print(f"  Scanning {len(all_hosts)} IP addresses...")

    # Create scanning tasks
    tasks = [check_ports(ip, SCAN_PORTS) for ip in all_hosts]
    candidates = []

    # Process in batches to avoid overwhelming the network
    for i in range(0, len(tasks), CONCURRENCY):
        batch = tasks[i : i + CONCURRENCY]
        results = await asyncio.gather(*batch, return_exceptions=True)

        # Filter out None and exceptions
        batch_candidates = [
            res for res in results if res and not isinstance(res, Exception)
        ]
        candidates.extend(batch_candidates)

        # Progress indicator
        progress = min(i + CONCURRENCY, len(tasks))
        print(f"  Progress: {progress}/{len(tasks)} ({len(candidates)} found)", end="\r")

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
    if any(x in model_lower for x in ["whatsminer", "m30", "m50", "m20", "m60"]):
        return {"username": "admin", "password": "admin"}

    # Antminer uses root/root
    if any(x in model_lower for x in ["antminer", "s19", "s17", "t19", "l3", "l7"]):
        return {"username": "root", "password": "root"}

    # AvalonMiner uses root/root
    if "avalon" in model_lower:
        return {"username": "root", "password": "root"}

    # Default to root/root
    return {"username": "root", "password": "root"}


async def identify_miner(ip: str) -> Optional[Dict]:
    """Identify a miner and generate configuration entry."""
    # Lazy import: pyasic may not be installed in all environments.
    from pyasic import get_miner

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
        mac = None
        try:
            data = await asyncio.wait_for(miner.get_data(), timeout=5)
            if data:
                # Capture MAC as a first-class field and embed normalized form in alias
                if hasattr(data, "mac") and data.mac:
                    mac = normalize_mac(data.mac)
                    alias = f"{miner.model} ({mac})"
                else:
                    alias = miner.model
        except Exception:
            alias = miner.model

        # Build configuration entry (aligned with collectors)
        entry = {
            "ip": ip,
            "name": name,
            "model": miner.model,
            "alias": alias or miner.model,
            "username": credentials["username"],
            "password": credentials["password"],
        }

        if mac:
            entry["mac"] = mac

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
        res for res in results if res and not isinstance(res, Exception)
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

    required_fields = ["ip", "name", "model"]

    for i, miner in enumerate(miners):
        for field in required_fields:
            if field not in miner:
                print(
                    f"❌ Miner {i+1} missing required field: {field}",
                    file=sys.stderr,
                )
                return False

        # Check for duplicate names
        names = [m["name"] for m in miners]
        if len(names) != len(set(names)):
            print("❌ Duplicate miner names found", file=sys.stderr)
            return False

        # Check for duplicate IPs
        ips = [m["ip"] for m in miners]
        if len(ips) != len(set(ips)):
            print("❌ Duplicate IP addresses found", file=sys.stderr)
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
    sorted_miners = sorted(miners, key=lambda x: ipaddress.ip_address(x["ip"]))

    config_data = {"miners": sorted_miners}

    try:
        # Create directory if it doesn't exist
        os.makedirs(os.path.dirname(output_file), exist_ok=True)

        # Backup existing config
        backup_existing_config(output_file)

        # Write new config
        with open(output_file, "w") as f:
            # Add header comment
            f.write("# Auto-generated miners configuration\n")
            f.write("# Generated by farm_init.py\n")
            f.write("#\n")
            f.write("# Required fields: ip, name, model\n")
            f.write("# Optional fields: alias, username, password, api_port, mac\n")
            f.write("#\n\n")

            yaml.dump(
                config_data,
                f,
                sort_keys=False,
                indent=2,
                allow_unicode=True,
                default_flow_style=False,
            )

        print(f"✓ Configuration written successfully")
        return True

    except Exception as e:
        print(f"❌ Error writing configuration: {e}", file=sys.stderr)
        return False


# ============================================================================
# Reconcile logic
# ============================================================================

def reconcile_inventory(live: List[Dict], inventory: List[Dict]) -> Dict:
    """
    Pure matching between a live discovery set and the existing inventory.

    Matching priority:
      1. MAC exact (both present, normalized) -> ip_changed or unchanged.
      2. IP exact -> unchanged, or mac_enriched if inventory lacked a MAC.
      3. Last-octet + model heuristic -> suggestion only.

    Returns a dict with buckets: ip_changed, unchanged, mac_enriched,
    heuristic, new, missing, unidentified.
    """
    live = copy.deepcopy(live)
    inventory = copy.deepcopy(inventory)

    for entry in live:
        entry["_mac"] = normalize_mac(entry.get("mac"))
    for entry in inventory:
        entry["_mac"] = normalize_mac(entry.get("mac"))

    result = {
        "ip_changed": [],
        "unchanged": [],
        "mac_enriched": [],
        "heuristic": [],
        "new": [],
        "missing": [],
        "unidentified": [],
    }
    used_live = set()
    used_inv = set()

    def finalize(entry: Dict) -> Dict:
        entry.pop("_mac", None)
        return entry

    # Tier 1: MAC exact match
    for i, inv in enumerate(inventory):
        if inv["_mac"] is None or i in used_inv:
            continue
        for j, l in enumerate(live):
            if j in used_live or l["_mac"] is None:
                continue
            if l["_mac"] == inv["_mac"]:
                used_inv.add(i)
                used_live.add(j)

                new_entry = copy.deepcopy(inv)
                new_entry["ip"] = l["ip"]
                new_entry["mac"] = l["_mac"]
                new_entry.pop("_mac", None)

                old = finalize(inv)
                if l["ip"] == old["ip"]:
                    result["unchanged"].append({"old": old, "new": new_entry})
                else:
                    result["ip_changed"].append(
                        {"old": old, "new": new_entry, "mac": l["_mac"]}
                    )
                break

    # Tier 2: IP exact match (bootstrap / MAC enrichment)
    for i, inv in enumerate(inventory):
        if i in used_inv:
            continue
        for j, l in enumerate(live):
            if j in used_live:
                continue
            if l["ip"] == inv["ip"]:
                used_inv.add(i)
                used_live.add(j)

                new_entry = copy.deepcopy(inv)
                new_entry["ip"] = l["ip"]
                if l["_mac"]:
                    new_entry["mac"] = l["_mac"]
                new_entry.pop("_mac", None)

                old = finalize(inv)
                if old.get("mac") is None and l["_mac"]:
                    result["mac_enriched"].append({"old": old, "new": new_entry})
                else:
                    result["unchanged"].append({"old": old, "new": new_entry})
                break

    # Tier 3: heuristic (same last octet + same model)
    for i, inv in enumerate(inventory):
        if i in used_inv:
            continue
        for j, l in enumerate(live):
            if j in used_live:
                continue
            if (
                l["ip"].split(".")[-1] == inv["ip"].split(".")[-1]
                and l.get("model") == inv.get("model")
            ):
                used_inv.add(i)
                used_live.add(j)

                new_entry = copy.deepcopy(inv)
                new_entry["ip"] = l["ip"]
                if l["_mac"]:
                    new_entry["mac"] = l["_mac"]
                new_entry.pop("_mac", None)

                result["heuristic"].append({"old": finalize(inv), "new": new_entry})
                break

    # Remaining live entries
    for j, l in enumerate(live):
        if j in used_live:
            continue
        finalize(l)
        if l.get("mac") is None:
            result["unidentified"].append({"live": l})
        else:
            result["new"].append({"live": l})

    # Remaining inventory entries
    for i, inv in enumerate(inventory):
        if i in used_inv:
            continue
        result["missing"].append({"old": finalize(inv)})

    return result


def create_miner_from_live(live_entry: Dict) -> Dict:
    """Create a new inventory entry from a live discovery record."""
    ip = live_entry["ip"]
    model = live_entry.get("model", "Unknown")
    name = live_entry.get("name") or generate_miner_name(ip, model)
    credentials = detect_miner_credentials(model)
    mac = normalize_mac(live_entry.get("mac"))

    alias = f"{model} ({mac})" if mac else model

    entry = {
        "ip": ip,
        "name": name,
        "model": model,
        "alias": alias,
        "username": credentials["username"],
        "password": credentials["password"],
    }
    if mac:
        entry["mac"] = mac
    return entry


def apply_reconciliation(
    result: Dict, inventory: List[Dict], apply_heuristic: bool = False
) -> Dict:
    """
    Build the updated inventory from a reconcile result.

    - ip_changed, mac_enriched are always applied.
    - heuristic is applied only when apply_heuristic is True.
    - new miners are appended.
    - missing entries are kept unchanged.
    """
    updated = copy.deepcopy(inventory)

    by_name = {
        entry.get("name"): entry for entry in updated if entry.get("name")
    }
    by_ip = {entry.get("ip"): entry for entry in updated if entry.get("ip")}

    def find_entry(old_entry: Dict) -> Optional[Dict]:
        if old_entry.get("name") in by_name:
            return by_name[old_entry["name"]]
        if old_entry.get("ip") in by_ip:
            return by_ip[old_entry["ip"]]
        return None

    for item in result["ip_changed"]:
        entry = find_entry(item["old"])
        if entry:
            entry["ip"] = item["new"]["ip"]
            entry["mac"] = item["new"]["mac"]

    for item in result["mac_enriched"]:
        entry = find_entry(item["old"])
        if entry:
            entry["mac"] = item["new"]["mac"]

    if apply_heuristic:
        for item in result["heuristic"]:
            entry = find_entry(item["old"])
            if entry:
                entry["ip"] = item["new"]["ip"]
                if "mac" in item["new"]:
                    entry["mac"] = item["new"]["mac"]

    for item in result["new"]:
        new_entry = create_miner_from_live(item["live"])
        updated.append(new_entry)

    updated.sort(key=lambda x: ipaddress.ip_address(x["ip"]))
    return {"miners": updated}


def print_reconcile_summary(result: Dict) -> None:
    """Print a dry-run summary of a reconcile result."""
    print("\nReconcile plan (dry-run):")
    for key in result:
        print(f"  {key}: {len(result[key])}")

    print()
    for item in result["ip_changed"]:
        old = item["old"]
        new = item["new"]
        print(
            f"[IP_CHANGED] {old.get('name', '?')}  {item.get('mac', '?')}  "
            f"{old.get('ip', '?')} -> {new.get('ip', '?')}"
        )

    for item in result["mac_enriched"]:
        old = item["old"]
        new = item["new"]
        print(
            f"[MAC_ENRICHED] {old.get('name', '?')}  {new.get('mac', '?')}  "
            f"{old.get('ip', '?')}"
        )

    for item in result["heuristic"]:
        old = item["old"]
        new = item["new"]
        print(
            f"[HEURISTIC] {old.get('name', '?')}  {new.get('mac', '?')}  "
            f"{old.get('ip', '?')} -> {new.get('ip', '?')}"
        )

    for item in result["new"]:
        live = item["live"]
        generated = create_miner_from_live(live)
        print(
            f"[NEW] {generated.get('name', '?')}  {generated.get('mac', '?')}  "
            f"{generated.get('ip', '?')}"
        )

    for item in result["missing"]:
        old = item["old"]
        print(
            f"[MISSING] {old.get('name', '?')}  {old.get('ip', '?')} (offline)"
        )

    for item in result["unidentified"]:
        live = item["live"]
        print(
            f"[UNIDENTIFIED] {live.get('ip', '?')}  {live.get('model', '?')}"
        )


# ============================================================================
# CLI
# ============================================================================

def parse_args() -> argparse.Namespace:
    """Parse command-line arguments."""
    parser = argparse.ArgumentParser(
        description="Mining farm initialization and inventory reconciliation."
    )
    subparsers = parser.add_subparsers(dest="command")

    subparsers.add_parser("init", help="Scan network and write a fresh inventory")

    rec_parser = subparsers.add_parser(
        "reconcile",
        help="Reconcile existing inventory against live miners by MAC/IP",
    )
    rec_parser.add_argument(
        "--inventory",
        default=os.getenv("MINERS_CONFIG", DEFAULT_OUTPUT),
        help="Path to existing miners.yaml (default: MINERS_CONFIG or /opt/mining-stack/etc/miners.yaml)",
    )
    rec_parser.add_argument(
        "--live-from",
        help="Optional JSON file [{ip, mac, model, name?}] to use instead of scanning",
    )
    rec_parser.add_argument(
        "--apply",
        action="store_true",
        help="Write the updated inventory; without this flag the plan is printed and nothing is written",
    )
    rec_parser.add_argument(
        "--accept-heuristic",
        action="store_true",
        help="Also apply tier-3 heuristic (last-octet + model) matches (requires --apply)",
    )

    args = parser.parse_args()
    if args.command is None:
        args.command = "init"
    return args


# ============================================================================
# Command handlers
# ============================================================================

async def run_init(args: argparse.Namespace) -> None:
    """Run the original scan-and-write init flow."""
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
    output_file = os.getenv("MINERS_CONFIG", DEFAULT_OUTPUT)

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


async def discover_live_miners() -> List[Dict]:
    """Scan the network and identify live miners (used by reconcile)."""
    network = get_scan_network()
    if not network:
        print("❌ Could not determine network to scan", file=sys.stderr)
        sys.exit(1)

    candidates = await scan_network(network, EXTRA_IPS)
    if not candidates:
        return []

    return await identify_miners(candidates)


async def run_reconcile(args: argparse.Namespace) -> None:
    """Run the reconcile flow."""
    inventory_path = args.inventory

    if not os.path.exists(inventory_path):
        print(f"❌ Inventory not found: {inventory_path}", file=sys.stderr)
        sys.exit(1)

    with open(inventory_path, "r") as f:
        inventory_data = yaml.safe_load(f) or {}
    inventory = inventory_data.get("miners", [])

    if args.live_from:
        with open(args.live_from, "r") as f:
            live = json.load(f)
        if not isinstance(live, list):
            print("❌ --live-from JSON must contain a list", file=sys.stderr)
            sys.exit(1)
    else:
        print("[reconcile] Scanning network for live miners...")
        live = await discover_live_miners()

    result = reconcile_inventory(live, inventory)

    if args.apply:
        apply_heuristic = getattr(args, "accept_heuristic", False)
        updated_data = apply_reconciliation(result, inventory, apply_heuristic)

        if not backup_existing_config(inventory_path):
            print("❌ Failed to back up inventory", file=sys.stderr)
            sys.exit(1)

        try:
            with open(inventory_path, "w") as f:
                f.write("# Auto-generated miners configuration\n")
                f.write("# Generated by farm_init.py\n")
                f.write("#\n")
                f.write("# Required fields: ip, name, model\n")
                f.write("# Optional fields: alias, username, password, api_port, mac\n")
                f.write("#\n\n")
                yaml.dump(
                    updated_data,
                    f,
                    sort_keys=False,
                    indent=2,
                    allow_unicode=True,
                    default_flow_style=False,
                )
        except Exception as e:
            print(f"❌ Failed to write inventory: {e}", file=sys.stderr)
            sys.exit(1)

        print("\n✅ Reconciliation applied.")
        for key in result:
            print(f"  {key}: {len(result[key])}")
    else:
        print_reconcile_summary(result)


async def main():
    """Main entry point."""
    args = parse_args()

    if args.command == "init":
        await run_init(args)
    elif args.command == "reconcile":
        await run_reconcile(args)
    else:
        # Should not happen because we default to 'init', but keep for safety.
        print(f"❌ Unknown command: {args.command}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print("\n\n⚠️  Interrupted by user")
        sys.exit(130)
    except Exception as e:
        print(f"\n❌ Unexpected error: {e}", file=sys.stderr)
        sys.exit(1)
