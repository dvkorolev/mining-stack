#!/usr/bin/env python3
"""
WAN watchdog - autonomous recovery for the site's 4G uplink.

Runs on the Raspberry Pi, inside the site LAN, and watches whether the site
still has a working path to the internet. When the uplink has been down far
longer than it ever takes to heal on its own, the watchdog escalates through
progressively heavier recovery actions, ending at cutting mains power to the
router and modem via the smart power strip.

What the recovery action actually is
------------------------------------
Restarting the router. That is the only thing that has ever worked here.

This was not obvious. KeeneticOS power-cycles the USB modem by itself whenever
the uplink fails, and the log makes that look like recovery in progress. On
2026-08-12 it ran roughly 134 times over 2 h 29 m and restored nothing: each
cycle brought the USB link back and then logged "has not completed IPv4
connection", with the dongle re-enumerating as a CD-ROM and never reaching
modem mode. The link returned within 40 seconds of the router being restarted
by hand. Re-reading the 2026-08-09 outage shows the same shape. See DMI-46.

So the first rung is `system reboot` over the router's RCI API -- no hardware,
no smart strip, and the same API this repo already uses in router-exporter.
Cutting mains power is kept as a later rung for the case where the router
itself has stopped responding.

Why the threshold is 10 minutes
-------------------------------
An earlier version of this file waited 45 minutes, reasoning that the uplink
self-heals in 21-23 minutes and that acting sooner would interrupt a recovery
already under way. That reasoning was withdrawn: those self-heal times came
from an analysis built on a mining-pool TCP probe that fails on its own, and
the outages it described were one balance-depletion event rather than a
recurring pattern (DMI-46).

Against the corrected record, no outage has ever self-healed. Two ran 1.5 h
and 2 h 29 m and both ended only when a person restarted the router. A
45-minute threshold would have saved nothing on either. Ten minutes is still
far above Keenetic's own ~90-second default -- the setting whose twitchiness
made the operator disable `ping-check` in the first place -- while cutting a
2.5-hour outage to roughly five minutes.

Safety properties
-----------------
- Dry-run by default. `--arm` is required before any action is taken.
- Actions go through pluggable backends; the defaults only log.
- The socket feeding this Pi can never be switched (guarded explicitly).
- A rolling action budget prevents the restart loop that the operator hit
  before: once the budget is spent the watchdog backs off and only alerts.
- The LAN must be demonstrably healthy first. If this Pi cannot see the miners
  either, the fault is local and rebooting the router would be both useless
  and destructive of the evidence.
- If the modem reports a healthy radio and a live registration while traffic
  is failing, the fault is upstream (an unpaid account or an exhausted data
  allowance will do this). No restart fixes that, so the watchdog alerts.

State is persisted so a restart of this process does not reset the budget.
"""

import argparse
import json
import logging
import os
import socket
import sys
import urllib.parse
import urllib.request
import time
from dataclasses import dataclass, field, asdict
from enum import Enum
from pathlib import Path
from typing import Callable, Optional

LOG = logging.getLogger("wan-watchdog")

DEFAULT_STATE_FILE = "/var/lib/mining-stack/wan_watchdog.json"

# Two independent operators, so one provider's outage is not read as ours.
DEFAULT_PROBES = ("1.1.1.1:443", "8.8.8.8:443")


# --------------------------------------------------------------------------
# Configuration
# --------------------------------------------------------------------------

@dataclass
class Thresholds:
    """All durations in seconds. Defaults derive from the 2026-08-07 profile."""

    probe_interval: int = 60
    probe_timeout: int = 5

    # Consecutive failed probe rounds before the link counts as down at all.
    # Short: this only starts the clock, it does not trigger anything.
    fail_rounds_to_declare_down: int = 3

    # No outage on the corrected record has ever self-healed; the two measured
    # ones ran 1.5 h and 2 h 29 m until a person acted. Ten minutes is still an
    # order of magnitude above Keenetic's own ~90 s default. See the module
    # docstring for why the previous 45 minutes was withdrawn.
    first_action_after: int = 10 * 60

    # Settle time after each rung before judging it and moving to the next.
    settle_after_action: int = 15 * 60

    # Rolling window and budget. Three escalations in six hours, then the
    # watchdog stops acting and only reports.
    budget_window: int = 6 * 3600
    budget_actions: int = 3

    # After the budget is spent, retry at most this often.
    backoff_interval: int = 3600


class LinkState(str, Enum):
    UP = "up"
    DOWN = "down"


class Diagnosis(str, Enum):
    """Why the link is down - decides whether power cycling can help."""

    HUNG = "hung"            # radio/session stuck: a restart may clear it
    UPSTREAM = "upstream"    # registered and healthy, fault is beyond us
    UNKNOWN = "unknown"      # no modem telemetry available


# --------------------------------------------------------------------------
# Power backends
# --------------------------------------------------------------------------

class PowerBackend:
    """Interface for whatever can switch mains power to the network gear."""

    name = "base"

    def cycle(self, socket_name: str, off_seconds: int) -> None:
        raise NotImplementedError


class LoggingBackend(PowerBackend):
    """Default backend: describes what it would do and does nothing."""

    name = "logging"

    def cycle(self, socket_name: str, off_seconds: int) -> None:
        LOG.warning("[dry-run] would power-cycle socket %r for %ds",
                    socket_name, off_seconds)


class RouterRestarter:
    """Restarts the router. The one action with a record of working here.

    Subclassed rather than folded into PowerBackend because this is not a power
    action: it asks a healthy router to reboot itself, which is a different
    failure mode from cutting its mains feed and a different thing to get wrong.
    """

    name = "base"

    def restart(self) -> None:
        raise NotImplementedError


class LoggingRestarter(RouterRestarter):
    """Default: says what it would do and does nothing."""

    name = "logging"

    def restart(self) -> None:
        LOG.warning("[dry-run] would issue `system reboot` to the router over RCI")


class RciRestarter(RouterRestarter):
    """`system reboot` over the router's own HTTP API.

    Reuses router-exporter/rci.py rather than duplicating the challenge-auth
    flow. Both live in this repo, so a checkout has them together; the import
    fails loudly if that stops being true rather than silently degrading to a
    no-op, because a watchdog that quietly cannot act is worse than none.
    """

    name = "rci"

    def __init__(self, host: str, user: str, password: str):
        sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "router-exporter"))
        import rci                                    # noqa: E402  (path-dependent)

        self._client = rci.RciClient(host, user, password)
        self._client._authenticate()

    def restart(self) -> None:
        # The router drops the connection as it goes down, so a transport error
        # here is the expected outcome rather than a failure.
        try:
            self._client.get("system/reboot")
        except Exception as exc:
            LOG.info("router closed the connection while rebooting (%s) - expected", exc)


class TuyaBackend(PowerBackend):
    """
    EKF Connect Pro strip over the Tuya LAN protocol.

    Deliberately unimplemented until the strip is physically installed and its
    local key has been extracted. Note the key is only obtainable while the
    strip is still paired to the Tuya cloud, so pair it on ordinary Wi-Fi,
    extract the key, and only then move it onto the Pi's own access point.

    The countdown datapoint is the important one: it tells the strip to switch
    a socket back on by itself after N seconds, so power returns even if the
    Pi is the thing that just lost power.
    """

    name = "tuya"

    def __init__(self, device_id: str, local_key: str, address: str):
        self.device_id = device_id
        self.local_key = local_key
        self.address = address

    def cycle(self, socket_name: str, off_seconds: int) -> None:
        raise NotImplementedError(
            "Tuya backend not wired up yet - the strip is not installed and "
            "no local key has been extracted (see DMI-49)."
        )


# --------------------------------------------------------------------------
# Probing
# --------------------------------------------------------------------------

def tcp_reachable(target: str, timeout: float) -> bool:
    host, _, port = target.partition(":")
    try:
        with socket.create_connection((host, int(port or 443)), timeout=timeout):
            return True
    except OSError:
        return False


def link_is_up(probes, timeout: float) -> bool:
    """Up if *any* probe answers - one dead target must not read as an outage."""
    return any(tcp_reachable(t, timeout) for t in probes)


# --------------------------------------------------------------------------
# Persisted state
# --------------------------------------------------------------------------

@dataclass
class State:
    link: str = LinkState.UP.value
    down_since: Optional[float] = None
    consecutive_failures: int = 0
    rung: int = 0                       # how far up the ladder we have climbed
    last_action_at: Optional[float] = None
    action_times: list = field(default_factory=list)   # for the rolling budget

    @classmethod
    def load(cls, path: Path) -> "State":
        try:
            return cls(**json.loads(path.read_text()))
        except (OSError, ValueError, TypeError):
            return cls()

    def save(self, path: Path) -> None:
        try:
            path.parent.mkdir(parents=True, exist_ok=True)
            tmp = path.with_suffix(".tmp")
            tmp.write_text(json.dumps(asdict(self), indent=2))
            tmp.replace(path)
        except OSError as exc:
            LOG.error("cannot persist state to %s: %s", path, exc)

    def budget_spent(self, th: Thresholds, now: float) -> bool:
        self.action_times = [t for t in self.action_times
                             if now - t < th.budget_window]
        return len(self.action_times) >= th.budget_actions


# --------------------------------------------------------------------------
# The ladder
# --------------------------------------------------------------------------

@dataclass
class Rung:
    label: str
    action: Callable[[], None]


class Watchdog:
    def __init__(self, th: Thresholds, backend: PowerBackend, state_file: Path,
                 armed: bool, router_socket: str, pi_socket: Optional[str],
                 diagnose: Callable[[], Diagnosis], probes=DEFAULT_PROBES,
                 restarter: Optional[RouterRestarter] = None,
                 lan_is_healthy: Optional[Callable[[], Optional[bool]]] = None):
        if pi_socket and router_socket == pi_socket:
            raise ValueError(
                "refusing to run: the router socket and the Pi's own socket are "
                "the same, so a power cycle would cut the watchdog's own feed"
            )
        self.th = th
        self.probes = tuple(probes)
        self.backend = backend
        self.state_file = state_file
        self.armed = armed
        self.router_socket = router_socket
        self.diagnose = diagnose
        self.restarter = restarter or LoggingRestarter()
        # Returns True/False, or None when it cannot tell. None must not block
        # recovery: on 2026-08-12 the whole outage happened with a perfectly
        # healthy LAN, and a watchdog that refuses to act whenever it is unsure
        # is a watchdog that never acts.
        self.lan_is_healthy = lan_is_healthy or (lambda: None)
        self.state = State.load(state_file)

    # -- ladder rungs ------------------------------------------------------

    def _ladder(self):
        return [
            # First and most important: the action with a record of working.
            # Costs nothing, needs no hardware, and on 2026-08-12 restored the
            # link within 40 seconds when done by hand.
            Rung("restart the router over RCI",
                 self.restarter.restart),
            # Only if the router itself has stopped answering. Cutting its mains
            # feed is strictly heavier: it also drops the LAN and the Pi's own
            # path to the miners.
            Rung("cut power to router and modem",
                 lambda: self.backend.cycle(self.router_socket, 45)),
        ]

    # -- main loop ---------------------------------------------------------

    def tick(self, now: Optional[float] = None) -> None:
        now = now or time.time()
        up = link_is_up(self.probes, self.th.probe_timeout)

        if up:
            if self.state.link == LinkState.DOWN.value:
                outage = now - (self.state.down_since or now)
                LOG.info("link recovered after %.1f min", outage / 60)
            self.state.link = LinkState.UP.value
            self.state.down_since = None
            self.state.consecutive_failures = 0
            self.state.rung = 0
            self.state.save(self.state_file)
            return

        self.state.consecutive_failures += 1
        if self.state.consecutive_failures < self.th.fail_rounds_to_declare_down:
            self.state.save(self.state_file)
            return

        if self.state.link != LinkState.DOWN.value:
            self.state.link = LinkState.DOWN.value
            self.state.down_since = now
            LOG.warning("link declared down")

        self._maybe_escalate(now)
        self.state.save(self.state_file)

    def _maybe_escalate(self, now: float) -> None:
        down_for = now - (self.state.down_since or now)

        if down_for < self.th.first_action_after:
            LOG.info("down for %.1f min - below the %.0f min action threshold, "
                     "leaving it to recover on its own",
                     down_for / 60, self.th.first_action_after / 60)
            return

        if self.state.last_action_at and \
                now - self.state.last_action_at < self.th.settle_after_action:
            return

        if self.state.budget_spent(self.th, now):
            if not self.state.last_action_at or \
                    now - self.state.last_action_at >= self.th.backoff_interval:
                LOG.error("action budget spent (%d in %.0fh) - backing off, "
                          "this needs a human",
                          self.th.budget_actions, self.th.budget_window / 3600)
                self.state.last_action_at = now
            return

        if self.lan_is_healthy() is False:
            LOG.error("the uplink looks down but this Pi cannot see the miners "
                      "either - the fault is on our side of the router, so "
                      "restarting it would not help and would destroy evidence. "
                      "Not acting.")
            self.state.last_action_at = now
            return

        verdict = self.diagnose()
        if verdict is Diagnosis.UPSTREAM:
            LOG.error("modem is registered with a healthy radio but no traffic "
                      "passes - the fault is upstream (check the account "
                      "balance). Power cycling cannot fix this; not acting.")
            self.state.last_action_at = now
            return

        ladder = self._ladder()
        if self.state.rung >= len(ladder):
            # Nothing left to try. Say so hourly rather than every tick.
            if not self.state.last_action_at or \
                    now - self.state.last_action_at >= self.th.backoff_interval:
                LOG.error("ladder exhausted and the link is still down after "
                          "%.1f min - site visit required", down_for / 60)
                self.state.last_action_at = now
            return

        rung = ladder[self.state.rung]
        LOG.warning("down for %.1f min (diagnosis: %s) - escalating: %s",
                    down_for / 60, verdict.value, rung.label)

        if not self.armed:
            LOG.warning("not armed (--arm absent): no action taken")
        else:
            rung.action()
            self.state.action_times.append(now)

        self.state.rung += 1
        self.state.last_action_at = now


# --------------------------------------------------------------------------
# Entry point
# --------------------------------------------------------------------------

def diagnose_unavailable() -> Diagnosis:
    """
    Placeholder until the modem exporter lands (DMI-47).

    Once modem telemetry exists this must distinguish a stuck radio from a
    working radio whose upstream refuses traffic, because only the former is
    worth power cycling.
    """
    return Diagnosis.UNKNOWN


def build_arg_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        description="Watch the site's WAN uplink and recover it autonomously.")
    p.add_argument("--arm", action="store_true",
                   help="actually perform power actions (default: describe only)")
    p.add_argument("--once", action="store_true",
                   help="run a single check and exit, for testing")
    p.add_argument("--probe", action="append", default=None, metavar="HOST:PORT",
                   help="probe target, repeatable (default: %s)"
                        % ", ".join(DEFAULT_PROBES))
    p.add_argument("--state-file", default=os.environ.get(
        "WAN_WATCHDOG_STATE", DEFAULT_STATE_FILE))
    p.add_argument("--router-socket", default=os.environ.get(
        "WAN_WATCHDOG_ROUTER_SOCKET", "router"),
        help="name of the strip socket feeding the router and modem")
    p.add_argument("--pi-socket", default=os.environ.get(
        "WAN_WATCHDOG_PI_SOCKET"),
        help="name of the socket feeding this Pi; never switched, only checked "
             "so it cannot be confused with the router socket")
    p.add_argument("--first-action-after", type=int, default=None, metavar="MIN",
                   help="minutes of continuous downtime before the first "
                        "recovery action (default: %d)"
                        % (Thresholds.first_action_after // 60))
    p.add_argument("--router-host", default=os.environ.get("ROUTER_HOST", "192.168.2.1"),
                   help="router address for the RCI restart (default: %(default)s)")
    p.add_argument("--router-user", default=os.environ.get("ROUTER_USER", "admin"))
    p.add_argument("--prometheus-url",
                   default=os.environ.get("PROMETHEUS_URL", "http://localhost:9090"),
                   help="used only to confirm the LAN is healthy before acting; "
                        "if unreachable the check abstains rather than blocking")
    p.add_argument("--verbose", action="store_true")
    return p


def lan_health_via_prometheus(base_url: str) -> Callable[[], Optional[bool]]:
    """True when this Pi is still scraping miners, None when it cannot tell.

    The point is to separate "the uplink is down" from "our own side is broken".
    During the 2026-08-12 outage the scheduler kept polling 19-20 miners without
    a single dip, which is what made it clear the fault was strictly upstream of
    the LAN. If that check itself is unavailable it must return None: an
    unanswerable question is not evidence of a local fault.
    """
    query = urllib.parse.urlencode({"query": "count(miner_scrape_status == 2)"})
    url = f"{base_url.rstrip('/')}/api/v1/query?{query}"

    def check() -> Optional[bool]:
        try:
            with urllib.request.urlopen(url, timeout=10) as response:
                payload = json.loads(response.read())
            if payload.get("status") != "success":
                return None
            result = payload["data"]["result"]
            return bool(result) and float(result[0]["value"][1]) > 0
        except Exception as exc:
            LOG.debug("LAN health check unavailable: %s", exc)
            return None

    return check


def main(argv=None) -> int:
    args = build_arg_parser().parse_args(argv)
    logging.basicConfig(
        level=logging.DEBUG if args.verbose else logging.INFO,
        format="%(asctime)s %(levelname)s %(message)s")

    th = Thresholds()
    if args.first_action_after is not None:
        th.first_action_after = args.first_action_after * 60

    # A real restarter is only built when armed. Unarmed runs must not even hold
    # a router session, so that a dry run cannot reboot anything by accident.
    restarter: RouterRestarter = LoggingRestarter()
    if args.arm:
        password = os.environ.get("ROUTER_PASSWORD", "")
        if not password:
            LOG.error("--arm requires ROUTER_PASSWORD so the router can be "
                      "restarted; refusing to run armed without a way to act")
            return 2
        try:
            restarter = RciRestarter(args.router_host, args.router_user, password)
        except Exception as exc:
            LOG.error("cannot reach the router over RCI (%s) - refusing to run "
                      "armed with an action that would fail when needed", exc)
            return 2

    try:
        wd = Watchdog(
            th=th,
            backend=LoggingBackend(),
            state_file=Path(args.state_file),
            armed=args.arm,
            router_socket=args.router_socket,
            pi_socket=args.pi_socket,
            diagnose=diagnose_unavailable,
            probes=args.probe or DEFAULT_PROBES,
            restarter=restarter,
            lan_is_healthy=lan_health_via_prometheus(args.prometheus_url),
        )
    except ValueError as exc:
        LOG.error("%s", exc)
        return 2

    if args.arm:
        LOG.warning("ARMED - the router will be restarted after %d min of downtime",
                    th.first_action_after // 60)
    else:
        LOG.info("dry-run - no action will be taken (pass --arm to enable)")

    if args.once:
        wd.tick()
        return 0

    while True:
        try:
            wd.tick()
        except Exception:                       # never die on a transient fault
            LOG.exception("tick failed, continuing")
        time.sleep(th.probe_interval)


if __name__ == "__main__":
    sys.exit(main())
