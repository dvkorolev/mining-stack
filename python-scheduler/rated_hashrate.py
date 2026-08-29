"""
Rated (nameplate) hashrate read from the miner itself — WhatsMiner API v3.

DMI-81. `miner_expected_hashrate_ths` has always been *inferred* from a model
string via `asic_profiles.yaml`, and a profile's `expected` band covers a whole
family: `whatsminer_m30s` is 80–120 TH/s and `get_expected_hashrate()` returns
the mean, 100, for M30S (~86), M30S+ (~100) and M30S++ (~112) alike. Every
degradation threshold is a fraction of that mean, so a mis-binned machine gets
another machine's thresholds — the DMI-45 mechanism.

Port 4433 answers the question instead of guessing at it. `get.device.info`
needs no authentication and returns `msg.miner.detect-hash-rate`, the rated
output of each hashboard separately, in GH/s:

    "detect-hash-rate": "33231:34095:34306:"

The sums match the factory figure exactly — `.117` gives 33590+33794+34396 =
101.78 TH/s against its own `Factory GHS: 101780`.

Measured across the fleet from the 2026-08-28 sweep, the profile understates
every one of the 18 machines that answer, by +5.2% in aggregate and +23.4% on
`.126` (an M50S++ that falls into the M50S profile because no M50S++ bin
exists). At a warning threshold of 0.8×expected that is ~85 TH/s of fleet
output that could vanish without an alert.

Three machines are not covered and must keep the profile: `.74` and `.78` do
not answer on 4433 at all, and `.98` answers `-1:-1:-1`, which means "not
determined". **Absent is not zero** — a `-1` must never become a published 0,
which would assert that the machine is rated to produce nothing.

Lives at top level rather than under `collectors/` for the same reason
`asic_profile_loader` does: importing `collectors.pyasic_collector` pulls in
pyasic, so anything that needs to be unit-testable on its own stays out of it.
"""

import asyncio
import json
import logging
import struct
import time
from typing import Dict, List, NamedTuple, Optional

logger = logging.getLogger(__name__)

V3_PORT = 4433

# Nameplate data does not change unless someone physically swaps a hashboard,
# so this is re-read hourly rather than every collection cycle. At the 2-minute
# cycle that is one request per miner per 30 cycles instead of 30.
CACHE_TTL_SECONDS = 3600

# A negative retry gap would hammer machines that legitimately do not answer
# (.74, .78), so a failed read is also cached, for a shorter time.
FAILURE_TTL_SECONDS = 900

CONNECT_TIMEOUT = 5.0
READ_TIMEOUT = 10.0

# Source labels for `miner_expected_hashrate_source`. Same discipline as
# DMI-58's config provenance: a fallback must never be indistinguishable from
# the intended source.
SOURCE_V3 = 'v3'                # asked the machine over API v3 (port 4433)
SOURCE_CGMINER = 'cgminer'      # `Factory GHS` from the machine's own `devs`
SOURCE_PROFILE = 'profile'      # inferred from the model string
SOURCE_NONE = 'none'            # no expectation published at all
SOURCES = (SOURCE_V3, SOURCE_CGMINER, SOURCE_PROFILE, SOURCE_NONE)


class RatedHashrate(NamedTuple):
    """Nameplate output as the machine reports it."""
    boards_ghs: List[int]   # per hashboard, in GH/s, in slot order
    total_ths: float        # their sum, in TH/s
    board_num: Optional[int]
    model: Optional[str]    # what the machine calls itself, e.g. "M30S++_VH95"


# {ip: (RatedHashrate | None, fetched_at)}. None records a machine that was
# asked and could not answer, so it is not re-asked every cycle.
_cache: Dict[str, tuple] = {}


def parse_detect_hash_rate(raw: str) -> Optional[List[int]]:
    """
    Parse `detect-hash-rate` into per-board GH/s, or None when undetermined.

    The field is colon-separated and may carry a trailing colon
    ("33231:34095:34306:"). A value of -1 on any board means the machine has
    not determined its rating, and the whole reading is then unusable — a
    partial sum would silently under-report the nameplate, which is the exact
    failure this change exists to remove.
    """
    if not raw or not isinstance(raw, str):
        return None

    parts = [p for p in raw.strip().strip(':').split(':') if p != '']
    if not parts:
        return None

    try:
        values = [int(p) for p in parts]
    except ValueError:
        logger.debug('Unparseable detect-hash-rate: %r', raw)
        return None

    if any(v < 0 for v in values):
        return None  # absent, not zero
    if not any(v > 0 for v in values):
        return None  # all zeros carries no more information than absent

    return values


def parse_device_info(response: dict) -> Optional[RatedHashrate]:
    """Pull the nameplate out of a `get.device.info` reply."""
    if not isinstance(response, dict):
        return None

    miner = (response.get('msg') or {}).get('miner')
    if not isinstance(miner, dict):
        return None

    boards = parse_detect_hash_rate(miner.get('detect-hash-rate'))
    if boards is None:
        return None

    board_num = miner.get('board-num')
    try:
        board_num = int(board_num) if board_num is not None else None
    except (TypeError, ValueError):
        board_num = None

    return RatedHashrate(
        boards_ghs=boards,
        total_ths=sum(boards) / 1000.0,
        board_num=board_num,
        model=miner.get('type') or None,
    )


async def _read_device_info(ip: str) -> Optional[dict]:
    """
    One unauthenticated `get.device.info` over the length-prefixed v3 protocol.

    Frame is a 4-byte little-endian length followed by the JSON body, in both
    directions.
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


def _is_fresh(ip: str, now: float) -> bool:
    entry = _cache.get(ip)
    if entry is None:
        return False
    value, fetched_at = entry
    ttl = CACHE_TTL_SECONDS if value is not None else FAILURE_TTL_SECONDS
    return (now - fetched_at) < ttl


async def refresh(miners: List[dict], concurrency: int = 5) -> Dict[str, int]:
    """
    Re-read the nameplate for any miner whose cached value has expired.

    Safe to call every collection cycle: machines with a fresh entry are not
    contacted at all, so the steady-state cost is one request per miner per
    hour.

    Returns a small summary for logging: how many were fetched, how many of
    those answered, how many were served from cache.
    """
    now = time.time()
    stale = [m for m in miners if m.get('ip') and not _is_fresh(m['ip'], now)]
    cached = len(miners) - len(stale)

    if not stale:
        return {'fetched': 0, 'answered': 0, 'cached': cached}

    sem = asyncio.Semaphore(concurrency)

    async def one(ip: str):
        async with sem:
            response = await _read_device_info(ip)
            rated = parse_device_info(response) if response else None
            _cache[ip] = (rated, time.time())
            return rated is not None

    results = await asyncio.gather(*(one(m['ip']) for m in stale),
                                   return_exceptions=True)
    answered = sum(1 for r in results if r is True)
    return {'fetched': len(stale), 'answered': answered, 'cached': cached}


def get_rated(ip: str) -> Optional[RatedHashrate]:
    """Cached nameplate for a miner, or None when it has none."""
    entry = _cache.get(ip)
    return entry[0] if entry else None


def forget(ip: str) -> None:
    """Drop a miner that has left the inventory (the DMI-80 rule)."""
    _cache.pop(ip, None)


def forget_unconfigured(configured_ips) -> None:
    """Drop every cached miner that is no longer in the configuration."""
    for ip in [ip for ip in _cache if ip not in configured_ips]:
        del _cache[ip]


def cache_stats() -> dict:
    """Cache contents, for /status and tests."""
    return {
        'entries': len(_cache),
        'with_rating': sum(1 for v, _ in _cache.values() if v is not None),
        'without_rating': sum(1 for v, _ in _cache.values() if v is None),
    }


def _reset_for_tests() -> None:
    _cache.clear()
