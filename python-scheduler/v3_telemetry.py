"""
Error-code events and PSU output readings from the WhatsMiner API v3 (DMI-108).

The machine's `error-code` list holds only the LAST occurrence of each code --
proved 2026-09-18, when `.122` still carried a 233 from 09-10 next to a fresh
275 -- so the history of what happened in any gap is being lost forever. That
history is what answers "what happened while we were not looking": the third
power sag of 2026-09-17 is visible only as `205` stamps on four machines. The
same `get.device.info` reply also carries the PSU's output voltage and the
API switch state, neither of which was published anywhere.

So this module, once per collection cycle:

  * asks every configured miner `get.device.info` on 4433 (the request the
    DMI-81 nameplate read already uses, but on the 2-minute cadence -- an
    error-code timestamp only means anything at the frequency the codes are
    sampled);
  * publishes `miner_psu_vout_raw` and `miner_apiswitch` (DMI-94 already
    publishes the PSU *input* side from `get_psu` on 4028; that ground is not
    re-trodden here);
  * turns each change in a machine's `error-code` list into an append-only
    JSONL event on the scheduler's docker volume, and bumps
    `miner_error_events_total` / `miner_error_last_happened_seconds` for it.

`rated_hashrate.py` is deliberately left untouched: its hourly cache is the
right cadence for a nameplate that only changes when someone swaps a
hashboard, and sharing a cache between the two cadences would couple a proven
DMI-81 path to this one. The ~35-line length-prefixed frame transport is
copied here instead of imported, so neither module depends on the other's
internals; if the framing ever changes, both copies must change.

Lives at top level for the same reason `rated_hashrate` does: importing
`collectors.pyasic_collector` pulls in pyasic, so anything unit-testable on
its own stays out of it.

The vout unit is unstated and the metric name says so
-----------------------------------------------------
`power.vout` reads 1140-1432 across this fleet. It is not volts (a 3.3 kW
supply does not output 1.4 kV) and not millivolts (1.4 V cannot drive a
hashboard); centivolts -- 11.4-14.3 V, the standard WhatsMiner board rail --
is the only physical fit, but no source states it: pyasic parses none of the
`power` dict (its only vout trace is an error-code string, see below), and the
wm3 SDK is transport only. The strongest available evidence is that same
error-code string, code 212: "Power vout error, reach vout border. Border:
[1150, 1500]" -- the firmware's own operating range for vout, in the same raw
scale, and the fleet sits inside it.

Naming the metric `miner_psu_vout_volts` anyway would assert an unconfirmed
unit, which is the `MHS av` failure (DMI-91): a suffix nobody can vouch for
becomes a lie every dashboard repeats. It is published raw, with this note in
its help text; if the unit is ever confirmed, divide by 100 and rename.
"""

import asyncio
import json
import logging
import os
import struct
import time
from datetime import datetime, timedelta, timezone
from typing import Dict, List, NamedTuple, Optional

from metrics import (
    PSU_MODEL_UNKNOWN,
    record_miner_error_event,
    remove_miner_psu_v3_series,
    set_miner_psu_v3,
)

logger = logging.getLogger(__name__)

V3_PORT = 4433
CONNECT_TIMEOUT = 5.0
READ_TIMEOUT = 10.0

# A machine that does not answer on 4433 (.74 has the port closed, .78 speaks
# a different protocol entirely) is re-asked at most this often. Skipping it
# is absence, not an error -- the DMI-58 rule.
FAILURE_BACKOFF_SECONDS = 900

# Where the JSONL event log lives. The compose file mounts
# ./data/python-scheduler:/app/data, so this is the docker volume; overridable
# for local runs and tests.
EVENTS_DIR_ENV = 'V3_EVENTS_DIR'
DEFAULT_EVENTS_DIR = '/app/data/events'
EVENTS_FILE = 'errors.jsonl'
MAX_FILE_BYTES = 10 * 1024 * 1024
TAIL_BYTES = 256 * 1024

# The earliest machine timestamp believable in an error-code entry. Anything
# dated 1970 is a machine that lost its clock at boot and has not been stepped
# by chrony yet -- 12 of 18 machines showed such stamps before DMI-82. The
# fleet's codes were first read 2026-08-28, so nothing real predates 2026.
MIN_WHEN = datetime(2026, 1, 1)

# Machine clocks run +03 against the scheduler's UTC and drift a little, so
# "in the future" gets a day of slack before it is called implausible.
FUTURE_SLACK = timedelta(days=1, hours=3)

# Observation outcomes for one (ip, code) at one cycle.
BASELINE = 'baseline'   # first sighting ever: recorded, never counted (plan 8.4)
NEW = 'new'             # when_machine changed since the last recorded event
UNCHANGED = 'unchanged' # same when_machine as recorded: not an event at all


class PsuOutput(NamedTuple):
    """What the v3 reply's `power` dict says that DMI-94 does not cover."""
    vout: Optional[float]      # RAW units -- see the module docstring
    psu_model: Optional[str]


class ErrorEntry(NamedTuple):
    """One code in the machine's `error-code` list."""
    code: str
    when_machine: Optional[str]  # machine-local (+03) naive stamp, stored as-is
    reason: Optional[str]


def _number(raw) -> Optional[float]:
    """float(raw) for a genuine number, else None. Booleans are not numbers."""
    if raw is None or isinstance(raw, bool):
        return None
    if isinstance(raw, str):
        raw = raw.strip()
        if not raw:
            return None
    try:
        return float(raw)
    except (TypeError, ValueError):
        return None


def parse_psu_output(msg) -> Optional[PsuOutput]:
    """
    The output-side PSU readings from a `get.device.info` reply's `msg`.

    None when the reply carries no `power` dict at all: the input-side
    readings come from `get_psu` (DMI-94) and are not this module's business.
    A present-but-unparseable `vout` yields None for the value and still
    returns the model, because each field is judged on its own.
    """
    if not isinstance(msg, dict):
        return None
    power = msg.get('power')
    if not isinstance(power, dict):
        return None

    model = power.get('model') or power.get('type')
    model = model.strip() if isinstance(model, str) and model.strip() else None
    return PsuOutput(vout=_number(power.get('vout')), psu_model=model)


def parse_apiswitch(msg) -> Optional[int]:
    """
    The API switch state: 1 enabled, 0 disabled, None when not reported.

    Interesting precisely because it changes without the machine breaking --
    it is how "the owners flipped it" becomes visible (plan section 2).

    The field lives at msg.system.apiswitch -- the 2026-08-28 sweep artifact
    flattened it to a top-level 'apisw', and a parser built against that
    stand-in shape read the wrong path and published nothing on every live
    machine (found live 2026-09-18; the same lesson as rule 7 -- a check run
    against a reduced copy proves the copy, not the wire). Both spellings
    are accepted so the recorded payloads stay valid fixtures.
    """
    if not isinstance(msg, dict):
        return None
    raw = msg.get('apiswitch')
    if raw is None and isinstance(msg.get('system'), dict):
        raw = msg['system'].get('apiswitch')
    if isinstance(raw, bool):
        return int(raw)
    number = _number(raw)
    if number in (0.0, 1.0):
        return int(number)
    return None


def parse_error_codes(msg) -> List[ErrorEntry]:
    """
    The `error-code` list, as the machine states it.

    Real shape (2026-08-28 sweep): a list of one dict per code, `{"<code>":
    "<when>", "reason": "<text>"}` -- the code is the key, `reason` optional
    and present on some codes only. Entries that are not dicts, or dicts with
    no code key, are skipped rather than raising: one malformed entry must
    cost one absent code, not the whole cycle (the DMI-54 rule).
    """
    if not isinstance(msg, dict):
        return []
    codes = msg.get('error-code')
    if not isinstance(codes, list):
        return []

    entries = []
    for item in codes:
        if not isinstance(item, dict):
            continue
        reason = item.get('reason')
        reason = reason if isinstance(reason, str) and reason.strip() else None
        for key, value in item.items():
            if key == 'reason':
                continue
            when = value if isinstance(value, str) and value.strip() else None
            entries.append(ErrorEntry(code=str(key), when_machine=when,
                                      reason=reason))
    return entries


def when_is_plausible(when_machine: Optional[str], now: Optional[float] = None) -> bool:
    """
    Whether a machine-local stamp could be a real moment in the past.

    Guards the event counter against clock steps (the pre-DMI-82 pattern: a
    machine whose clock resets re-stamps its codes with 1970 dates, and every
    re-stamp would otherwise count as a new event). The stamp is naive and the
    fleet runs +03, so "now" is taken as UTC plus three hours before the
    future bound is applied -- a comparison at day precision, not tz science.
    """
    if not when_machine:
        return False
    try:
        stamp = datetime.strptime(when_machine.strip(), '%Y-%m-%d %H:%M:%S')
    except ValueError:
        return False
    machine_now = datetime.fromtimestamp(
        time.time() if now is None else now, timezone.utc
    ).replace(tzinfo=None) + timedelta(hours=3)
    return MIN_WHEN <= stamp <= machine_now + FUTURE_SLACK


class ErrorDeduper:
    """
    "New event" detection over the machine's last-occurrence-per-code memory.

    The machine only ever shows the newest stamp per code, so a code counts as
    a new event exactly when its `when_machine` differs from the last one
    recorded. State is a dict of {(ip, code): when_machine}; on restart it is
    primed from the JSONL tail so pairs already on disk do not re-fire (plan
    section 5: a container restart must not lose or duplicate events).
    """

    def __init__(self):
        self._last_when = {}  # {(ip, code): when_machine}

    def prime(self, records) -> int:
        """Load state from parsed JSONL records; returns pairs loaded."""
        for record in records:
            ip, code = record.get('ip'), record.get('code')
            if ip and code is not None:
                self._last_when[(ip, str(code))] = record.get('when_machine')
        return len(self._last_when)

    def observe(self, ip: str, code: str, when_machine: Optional[str]) -> str:
        """Classify one (ip, code, when) and advance the state. Never raises."""
        key = (ip, str(code))
        previous = self._last_when.get(key)
        self._last_when[key] = when_machine
        if previous is None:
            return BASELINE
        if previous == when_machine:
            return UNCHANGED
        return NEW

    def pairs(self) -> int:
        return len(self._last_when)

    def ips(self) -> set:
        """Every address with state, for forget_unconfigured()."""
        return {ip for ip, _ in self._last_when}

    def drop(self, ip: str) -> None:
        """Forget every code of one address (the DMI-80 rule)."""
        for key in [k for k in self._last_when if k[0] == ip]:
            del self._last_when[key]


class ErrorEventLog:
    """
    Append-only JSONL with size rotation (plan section 4).

    One line per recorded event, `{"ts": <poll unixts>, "ip", "name", "code",
    "when_machine", "reason"?, "baseline": bool, "counted": bool}`. Rotation
    renames the live file to `errors-<stamp>.jsonl` once it would pass
    max_bytes and starts a fresh one; old files are left in place for the
    90-day retention the volume already has. Every method absorbs OSError:
    an unwritable volume must degrade the log, not the collection cycle.
    """

    def __init__(self, directory: str, max_bytes: int = MAX_FILE_BYTES):
        self.directory = directory
        self.path = os.path.join(directory, EVENTS_FILE)
        self.max_bytes = max_bytes
        self.append_failures = 0

    def ensure_dir(self) -> None:
        """Create the directory; raises OSError if truly unwritable."""
        os.makedirs(self.directory, exist_ok=True)

    def append(self, record: dict) -> bool:
        """One event to disk, rotating first if needed. Never raises."""
        try:
            line = json.dumps(record, ensure_ascii=False)
            self._rotate_if_needed(len(line) + 1)
            with open(self.path, 'a', encoding='utf-8') as handle:
                handle.write(line + '\n')
            return True
        except OSError as e:
            self.append_failures += 1
            logger.warning('Cannot append error event to %s: %s', self.path, e)
            return False

    def _rotate_if_needed(self, incoming: int) -> None:
        try:
            size = os.path.getsize(self.path)
        except OSError:
            return  # nothing to rotate yet
        if size + incoming <= self.max_bytes:
            return
        stamp = time.strftime('%Y%m%d-%H%M%S', time.gmtime())
        rotated = os.path.join(self.directory, 'errors-%s.jsonl' % stamp)
        while os.path.exists(rotated):  # same-second double rotation
            rotated += '.1'
        os.replace(self.path, rotated)
        logger.info('Rotated error event log to %s at %d bytes',
                    rotated, size)

    def tail(self, max_bytes: int = TAIL_BYTES) -> List[dict]:
        """
        The parsed records from the end of the log, oldest first.

        Reads a bounded chunk from the end rather than the whole file: the
        file may be 10 MB and only the last occurrence per (ip, code) matters
        for priming. A truncated first line (the seek can land mid-line) and
        unparsable lines are skipped.
        """
        try:
            size = os.path.getsize(self.path)
            with open(self.path, 'rb') as handle:
                if size > max_bytes:
                    handle.seek(-max_bytes, os.SEEK_END)
                    handle.readline()  # drop the partial line
                chunk = handle.read()
        except OSError:
            return []

        records = []
        for line in chunk.decode('utf-8', 'replace').splitlines():
            line = line.strip()
            if not line:
                continue
            try:
                record = json.loads(line)
            except json.JSONDecodeError:
                continue
            if isinstance(record, dict):
                records.append(record)
        return records


# ============================================================================
# Module state
# ============================================================================

_deduper = ErrorDeduper()
_event_log = None            # ErrorEventLog once init() has run
_backoff_until = {}          # {ip: ts} -- do not re-ask before this


async def _read_device_info(ip: str) -> Optional[dict]:
    """
    One unauthenticated `get.device.info` over the length-prefixed v3 protocol.

    Copied from rated_hashrate.py (4-byte little-endian length + JSON body,
    both directions) rather than imported, so that proven module stays
    untouched -- see the module docstring.
    """
    writer = None
    try:
        reader, writer = await asyncio.wait_for(
            asyncio.open_connection(ip, V3_PORT), timeout=CONNECT_TIMEOUT)

        body = json.dumps({'cmd': 'get.device.info', 'param': None}).encode()
        writer.write(struct.pack('<I', len(body)) + body)
        await writer.drain()

        header = await asyncio.wait_for(reader.readexactly(4), timeout=READ_TIMEOUT)
        length = struct.unpack('<I', header)[0]
        if length <= 0 or length > 1_000_000:
            logger.debug('%s: implausible v3 frame length %d', ip, length)
            return None

        payload = await asyncio.wait_for(reader.readexactly(length), timeout=READ_TIMEOUT)
        return json.loads(payload.decode('utf-8', 'replace'))
    except (asyncio.TimeoutError, asyncio.IncompleteReadError, OSError,
            json.JSONDecodeError, struct.error) as e:
        logger.debug('%s: v3 read failed: %s', ip, e)
        return None
    finally:
        if writer is not None:
            try:
                writer.close()
                await writer.wait_closed()
            except Exception:
                pass


def init(events_dir: Optional[str] = None) -> dict:
    """
    Prepare the event log and prime the dedup state from its tail.

    Called once at startup, before the first collection, so an event that
    happened while the scheduler was down is recorded (its `when_machine`
    differs from the primed state) but a code already on disk does not
    re-fire. Priming from the tail also means the JSONL is the surviving
    copy of the state: the file can outlive any number of restarts.

    An unwritable directory disables file persistence (visible as
    `writable: False` here and as append failures in the collect summary)
    but leaves the metrics and in-memory dedup running -- a monitoring
    degradation, not a crash.
    """
    global _event_log
    directory = events_dir or os.environ.get(EVENTS_DIR_ENV, DEFAULT_EVENTS_DIR)
    log = ErrorEventLog(directory)
    summary = {'path': log.path, 'primed': 0, 'writable': True}
    try:
        log.ensure_dir()
    except OSError as e:
        summary['writable'] = False
        logger.warning('Error event directory %s unusable: %s -- events will '
                       'not be persisted', directory, e)
    _event_log = log
    summary['primed'] = _deduper.prime(log.tail())
    return summary


def forget(ip: str) -> None:
    """Drop a decommissioned miner's dedup and backoff state (the DMI-80 rule)."""
    _backoff_until.pop(ip, None)
    _deduper.drop(ip)


def forget_unconfigured(configured_ips) -> None:
    """Drop every miner that is no longer in the configuration."""
    for ip in _deduper.ips() - set(configured_ips):
        forget(ip)
    for ip in [ip for ip in _backoff_until if ip not in configured_ips]:
        del _backoff_until[ip]


def _publish_psu(ip: str, name: str, model: str, msg: dict) -> None:
    """vout and apiswitch, and only what the machine reported."""
    output = parse_psu_output(msg)
    readings = {
        'vout': output.vout if output else None,
        'apiswitch': parse_apiswitch(msg),
        'psu_model': (output.psu_model if output else None) or PSU_MODEL_UNKNOWN,
    }
    set_miner_psu_v3(ip, name, model, readings)


def _process_errors(ip: str, name: str, msg: dict, poll_ts: float) -> Dict[str, int]:
    """Dedup the machine's error codes, log and count what changed."""
    counts = {'events_new': 0, 'events_baseline': 0, 'events_implausible': 0}
    for entry in parse_error_codes(msg):
        outcome = _deduper.observe(ip, entry.code, entry.when_machine)
        if outcome == UNCHANGED:
            continue

        # First sighting is the deploy baseline, not an event: the machine's
        # whole error history predates the collector (plan 8.4). An
        # implausible date is recorded for forensics but never counted: a
        # clock step re-stamps the codes and must not manufacture events
        # (the pre-DMI-82 pattern, 1970 stamps fleet-wide).
        is_baseline = outcome == BASELINE
        plausible = when_is_plausible(entry.when_machine, poll_ts)
        counted = not is_baseline and plausible

        record = {
            'ts': int(poll_ts),
            'ip': ip,
            'name': name,
            'code': entry.code,
            'when_machine': entry.when_machine,
            'baseline': is_baseline,
            'counted': counted,
        }
        if entry.reason:
            record['reason'] = entry.reason
        if _event_log is not None:
            _event_log.append(record)

        counts['events_baseline' if is_baseline else 'events_new'] += 1
        if not plausible:
            counts['events_implausible'] += 1
        if counted:
            record_miner_error_event(ip, name, entry.code, poll_ts)
    return counts


async def collect(miners: List[dict], concurrency: int = 5,
                  _fetch=None) -> dict:
    """
    One v3 pass over the fleet: PSU output, error codes, events.

    Per-miner isolation is the point (DMI-54): every machine is processed
    inside its own try/except, so one bad reply -- or one bad anything --
    costs that machine's readings for this cycle and nothing else. A machine
    that fails the transport is backed off for FAILURE_BACKOFF_SECONDS and
    its v3 PSU series dropped: absent is not zero and not last-known either.

    Returns a summary for logging, never raises.
    """
    fetch = _fetch or _read_device_info
    now = time.time()
    summary = {'asked': 0, 'answered': 0, 'backoff_skipped': 0,
               'events_new': 0, 'events_baseline': 0,
               'events_implausible': 0, 'append_failures': 0}

    targets = []
    for miner in miners:
        ip = miner.get('ip')
        if not ip:
            continue
        if _backoff_until.get(ip, 0) > now:
            summary['backoff_skipped'] += 1
            continue
        targets.append(miner)

    sem = asyncio.Semaphore(concurrency)

    async def one(miner: dict):
        ip = miner['ip']
        name = miner.get('name') or ip
        model = miner.get('model') or 'Unknown'
        async with sem:
            try:
                response = await fetch(ip)
                msg = response.get('msg') if isinstance(response, dict) else None
                if not isinstance(msg, dict):
                    _backoff_until[ip] = time.time() + FAILURE_BACKOFF_SECONDS
                    remove_miner_psu_v3_series(ip)
                    return
                _publish_psu(ip, name, model, msg)
                counts = _process_errors(ip, name, msg, now)
                for key in counts:
                    summary[key] += counts[key]
                summary['answered'] += 1
            except Exception as e:
                _backoff_until[ip] = time.time() + FAILURE_BACKOFF_SECONDS
                logger.warning('%s: v3 telemetry failed: %s', ip, e)

    if targets:
        await asyncio.gather(*(one(m) for m in targets), return_exceptions=True)
    summary['asked'] = len(targets)
    if _event_log is not None:
        summary['append_failures'] = _event_log.append_failures
    return summary


def _reset_for_tests() -> None:
    """Fresh module state, so tests do not share dedup or backoff memory."""
    global _event_log
    _deduper._last_when.clear()
    _backoff_until.clear()
    _event_log = None
