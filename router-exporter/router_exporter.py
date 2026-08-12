"""
Prometheus exporter for the Keenetic router: uplink health and traffic accounting.

Why this exists (DMI-47). The site's uplink was invisible to monitoring, so every
outage had to be reconstructed afterwards from logs. Two questions in particular
could not be answered live:

- Is the 4G link healthy? Signal, registration and session state live only in the
  router's own CLI.
- Where does the traffic go? The miners were assumed to be the consumers. Measured
  on 2026-08-12: of 5.81 GB pulled over the WAN in 2.7 days, 4.80 GB went out over
  the 2.4 GHz Wi-Fi AP, while all twenty miners together accounted for ~150 MB/day.

Two data sources, because neither alone is enough:

- **SNMP** (mini_snmpd on the router, IF-MIB) for byte counters. The RCI API exposes
  no counters at all -- `show interface` carries signal and state but nothing to
  measure volume with.
- **RCI** (the router's HTTP JSON API) for uplink state and per-host traffic. See
  CLAUDE.local.md for the challenge-auth scheme; it is not Basic or Digest.

Counters are exposed as counters, with the router's own values passed through
unchanged. Prometheus handles the resets that follow a router reboot.
"""

import logging
import os
import re
import subprocess
import time
from typing import Dict, List, Optional, Tuple

from prometheus_client import REGISTRY, start_http_server
from prometheus_client.core import CounterMetricFamily, GaugeMetricFamily

import rci

logging.basicConfig(
    level=os.environ.get("LOG_LEVEL", "INFO"),
    format="%(asctime)s %(levelname)s %(name)s %(message)s",
)
logger = logging.getLogger("router-exporter")

ROUTER_HOST = os.environ.get("ROUTER_HOST", "192.168.2.1")
SNMP_COMMUNITY = os.environ.get("ROUTER_SNMP_COMMUNITY", "public")
SNMP_TIMEOUT = int(os.environ.get("ROUTER_SNMP_TIMEOUT", "5"))
LISTEN_PORT = int(os.environ.get("EXPORTER_PORT", "9101"))

# Interfaces worth series of their own. Everything else on this router is a
# permanently-down remembered profile or an internal bridge member, and exporting
# all 32 would bury the four that carry the site's traffic.
INTERFACES_OF_INTEREST = re.compile(
    os.environ.get(
        "ROUTER_INTERFACE_FILTER",
        r"^(CdcEthernet\d+|UsbLte\d+|Bridge0|WifiMaster\d+/AccessPoint0|GigabitEthernet[01](/\d+)?)$",
    )
)

# Signal fields on a mobile interface, as reported by RCI `show interface <name>`.
SIGNAL_FIELDS = {
    "rsrp": ("router_uplink_rsrp_dbm", "Reference signal received power, dBm"),
    "rsrq": ("router_uplink_rsrq_db", "Reference signal received quality, dB"),
    "rssi": ("router_uplink_rssi_dbm", "Received signal strength indicator, dBm"),
    "cinr": ("router_uplink_cinr_db", "Carrier to interference-plus-noise ratio, dB"),
    "signal-level": ("router_uplink_signal_level", "Signal level as reported by the router, 0-5"),
}


def snmp_walk(oid: str) -> Dict[str, str]:
    """Walk one OID, returning {index: value}.

    Shells out to net-snmp rather than taking a Python SNMP dependency: the
    parsing surface is one line per row, and `-Oqvn`-style output is stable.
    """
    cmd = [
        "snmpwalk", "-v2c", "-c", SNMP_COMMUNITY, "-t", str(SNMP_TIMEOUT), "-r", "1",
        "-Oqn", ROUTER_HOST, oid,
    ]
    out = subprocess.run(cmd, capture_output=True, text=True, timeout=SNMP_TIMEOUT * 4 + 10)
    if out.returncode != 0:
        raise RuntimeError(f"snmpwalk {oid} failed: {out.stderr.strip()[:200]}")
    return parse_snmp_walk(out.stdout)


def parse_snmp_walk(stdout: str) -> Dict[str, str]:
    """Parse `snmpwalk -Oqn` output into {last OID component: value}.

    Lines look like `.1.3.6.1.2.1.2.2.1.2.30 CdcEthernet2`. Values may contain
    spaces, so split only on the first one.
    """
    rows = {}
    for line in stdout.splitlines():
        line = line.strip()
        if not line or " " not in line:
            continue
        oid, value = line.split(" ", 1)
        index = oid.rsplit(".", 1)[-1]
        rows[index] = value.strip().strip('"')
    return rows


def build_interface_series(
    descriptions: Dict[str, str],
    rx: Dict[str, str],
    tx: Dict[str, str],
) -> List[Tuple[str, float, float]]:
    """Join the three walks by interface index into (name, rx_bytes, tx_bytes).

    Interfaces that fail the filter, or whose counters are missing or unparseable,
    are dropped rather than reported as zero -- a fabricated zero on a byte counter
    reads as "no traffic", which is a different claim from "not measured".
    """
    series = []
    for index, name in sorted(descriptions.items(), key=lambda kv: int(kv[0])):
        if not INTERFACES_OF_INTEREST.match(name):
            continue
        try:
            series.append((name, float(rx[index]), float(tx[index])))
        except (KeyError, ValueError):
            logger.debug("no usable counters for interface %s (index %s)", name, index)
    return series


def parse_uplink(interface: Dict) -> Dict[str, float]:
    """Extract numeric uplink health from an RCI `show interface <name>` object."""
    values = {}
    for field, (metric, _help) in SIGNAL_FIELDS.items():
        raw = interface.get(field)
        if raw is None:
            continue
        try:
            values[metric] = float(raw)
        except (TypeError, ValueError):
            continue
    values["router_uplink_up"] = 1.0 if interface.get("link") == "up" else 0.0
    values["router_uplink_connected"] = 1.0 if interface.get("connected") in ("yes", True) else 0.0
    try:
        values["router_uplink_uptime_seconds"] = float(interface.get("uptime", 0))
    except (TypeError, ValueError):
        pass
    return values


def parse_hosts(hotspot: Dict) -> List[Dict]:
    """Normalise RCI `show ip hotspot` into per-host traffic rows.

    The router's per-host counters are known to under-report badly -- on
    2026-08-12 they attributed 181 MB to a desktop that the AP interface showed
    receiving 4.80 GB. They are exported anyway because they are the only
    per-device attribution available, but treat them as a lower bound and trust
    the interface counters for volume.
    """
    hosts = hotspot.get("host", hotspot)
    if isinstance(hosts, dict):
        hosts = [hosts]
    rows = []
    for host in hosts:
        if not isinstance(host, dict) or not host.get("mac"):
            continue
        try:
            rx = float(host.get("rxbytes", 0) or 0)
            tx = float(host.get("txbytes", 0) or 0)
        except (TypeError, ValueError):
            continue
        rows.append({
            "mac": str(host.get("mac")),
            "name": str(host.get("hostname") or host.get("name") or ""),
            "ip": str(host.get("ip") or ""),
            "active": bool(host.get("link") == "up"),
            "rx": rx,
            "tx": tx,
        })
    return rows


class RouterCollector:
    """Collects on scrape. A failed poll reports router_up 0 and no stale values."""

    def __init__(self, uplink_interface: str = "CdcEthernet2"):
        self.uplink_interface = uplink_interface

    def collect(self):
        started = time.monotonic()
        up = 1.0

        iface_rx = CounterMetricFamily(
            "router_interface_rx_bytes",
            "Bytes received on a router interface (IF-MIB ifHCInOctets)",
            labels=["interface"])
        iface_tx = CounterMetricFamily(
            "router_interface_tx_bytes",
            "Bytes transmitted on a router interface (IF-MIB ifHCOutOctets)",
            labels=["interface"])
        host_rx = CounterMetricFamily(
            "router_host_rx_bytes",
            "Bytes received by a LAN host as counted by the router. Under-reports; "
            "use router_interface_rx_bytes for volume and this only for attribution",
            labels=["mac", "name", "ip"])
        host_tx = CounterMetricFamily(
            "router_host_tx_bytes",
            "Bytes transmitted by a LAN host as counted by the router. Under-reports",
            labels=["mac", "name", "ip"])
        host_active = GaugeMetricFamily(
            "router_host_active", "1 when the host currently holds a link",
            labels=["mac", "name", "ip"])

        try:
            descriptions = snmp_walk("1.3.6.1.2.1.2.2.1.2")       # ifDescr
            rx = snmp_walk("1.3.6.1.2.1.31.1.1.1.6")              # ifHCInOctets
            tx = snmp_walk("1.3.6.1.2.1.31.1.1.1.10")             # ifHCOutOctets
            for name, rx_bytes, tx_bytes in build_interface_series(descriptions, rx, tx):
                iface_rx.add_metric([name], rx_bytes)
                iface_tx.add_metric([name], tx_bytes)
        except Exception as exc:
            up = 0.0
            logger.warning("SNMP poll failed: %s", exc)

        uplink_values: Dict[str, float] = {}
        try:
            client = rci.client()
            interface = client.get(f"show/interface/{self.uplink_interface}")
            uplink_values = parse_uplink(interface)
            for host in parse_hosts(client.get("show/ip/hotspot")):
                labels = [host["mac"], host["name"], host["ip"]]
                host_rx.add_metric(labels, host["rx"])
                host_tx.add_metric(labels, host["tx"])
                host_active.add_metric(labels, 1.0 if host["active"] else 0.0)
        except Exception as exc:
            up = 0.0
            logger.warning("RCI poll failed: %s", exc)

        yield iface_rx
        yield iface_tx
        yield host_rx
        yield host_tx
        yield host_active

        for field, (metric, description) in SIGNAL_FIELDS.items():
            if metric in uplink_values:
                gauge = GaugeMetricFamily(metric, description, labels=["interface"])
                gauge.add_metric([self.uplink_interface], uplink_values[metric])
                yield gauge

        for metric, description in (
            ("router_uplink_up", "1 when the uplink interface link is up"),
            ("router_uplink_connected", "1 when the uplink reports an established connection"),
            ("router_uplink_uptime_seconds", "Uplink interface uptime. NOT the 4G session uptime: "
                                             "the router only sees the USB link to the dongle"),
        ):
            if metric in uplink_values:
                gauge = GaugeMetricFamily(metric, description, labels=["interface"])
                gauge.add_metric([self.uplink_interface], uplink_values[metric])
                yield gauge

        yield GaugeMetricFamily(
            "router_up", "1 when both the SNMP and RCI polls succeeded", value=up)
        yield GaugeMetricFamily(
            "router_scrape_duration_seconds", "Time taken to poll the router",
            value=time.monotonic() - started)


def main():
    REGISTRY.register(RouterCollector(os.environ.get("ROUTER_UPLINK_INTERFACE", "CdcEthernet2")))
    start_http_server(LISTEN_PORT)
    logger.info("router-exporter listening on :%s, polling %s", LISTEN_PORT, ROUTER_HOST)
    while True:
        time.sleep(3600)


if __name__ == "__main__":
    main()
