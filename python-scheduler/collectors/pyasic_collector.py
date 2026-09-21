"""
PyASIC-based collector with CGMiner fallback for gap filling.
"""

import asyncio
import json
import logging
import time
from typing import Dict, Any, Optional, List

from pyasic import get_miner

from asic import parity
from asic.drivers.whatsminer import read_miner as read_whatsminer
from asic.transport.json_tcp import cgminer_command
from config import (COLLECTION_COMPARE, COLLECTION_COMPARE_EXPECTED,
                    COLLECTION_PATHS, COLLECTION_PRIMARY,
                    MAX_CONCURRENT_REQUESTS,
                    compare_enabled_for, keeps_pyasic_source)
from parsers.cgminer_parser import parse_cgminer_response
from parsers.reading_compare import compare, split_results, summarise
from asic_profile_loader import (expected_chips_per_board, expected_hashrate_ths,
                                 get_library, resolve_expected_hashrate)
from rated_hashrate import SOURCES as RATED_SOURCES, get_rated
from metrics import (
    miner_hashrate, miner_power, miner_temp_max, miner_is_mining,
    miner_uptime, miner_efficiency, miner_fault_light, miner_errors_count,
    miner_scrape_status, miner_state, miner_hashrate_mhs, miner_expected_hashrate,
    miner_pool_accepted,
    miner_pool_rejected, collection_duration, collection_success,
    collection_timestamp, miner_gaps_filled_total, update_miner_label_cache,
    set_miner_pools, set_miner_boards, set_miner_fans, set_miner_psu,
    publish_expected_hashrate_source, set_miner_expected_boards,
    publish_board_chips_source, BOARD_CHIPS_SOURCES,
    miner_compare_mismatch_total, miner_collection_routing_total,
    publish_collection_path
)
from parsers.pool_status import extract_pool_status
from parsers.board_readings import boards_from_devs
from parsers.psu_readings import psu_from_get_psu

logger = logging.getLogger(__name__)


def _is_scrypt_miner(model: str, algorithm_override: str = None) -> bool:
    """
    Detect if miner is SCRYPT-based using profile library.
    
    Args:
        model: Miner model string
        algorithm_override: Explicit algorithm from config ('sha256' or 'scrypt')
    
    Returns:
        True if SCRYPT miner, False if SHA-256
    """
    # Explicit override takes precedence
    if algorithm_override:
        return algorithm_override.lower() == 'scrypt'
    
    # Ensure model is a string
    if not model or not isinstance(model, str):
        return False
    
    # Use profile library to determine algorithm
    library = get_library()
    profile = library.get_profile(model, algorithm_override)
    
    if profile:
        return profile.algorithm == 'scrypt'
    
    # Fallback to legacy detection if no profile found
    model_lower = model.lower()
    import re
    scrypt_patterns = [
        r'\bdg1\b',
        r'\bl3\+?\b',
        r'\bl7\b',
        r'scrypt',
        r'litecoin',
        r'doge',
    ]
    
    return any(re.search(pattern, model_lower) for pattern in scrypt_patterns)


def _safe_float(value: Any, default: float = 0.0) -> float:
    """Safely convert value to float, handling PyASIC custom types"""
    if value is None:
        return default
    try:
        if hasattr(value, '__float__'):
            x = float(value)
        elif isinstance(value, (int, float)):
            x = float(value)
        else:
            x = float(value)
        return default if x != x else x
    except (TypeError, ValueError, AttributeError):
        return default


def _check_data_gaps(pyasic_data: Dict, model: str) -> Dict[str, bool]:
    """Check which metrics are missing from PyASIC data using profile library"""
    gaps = {'power': False, 'rejected': False, 'temperature': False}
    
    hashrate = _safe_float(pyasic_data.get('hashrate', 0))
    power = _safe_float(pyasic_data.get('power', 0))
    temperature = _safe_float(pyasic_data.get('temperature', 0))
    
    # Get profile to check if this miner type typically has these issues
    library = get_library()
    profile = library.get_profile(model)
    
    # Check power gap
    if not power or power == 0:
        if profile:
            # Check if profile indicates power reporting issues
            quirks = profile.get_parser_quirks()
            if quirks.get('power_field') and hashrate > 0:
                gaps['power'] = True
        else:
            # Fallback to legacy logic
            if 'antminer' in model.lower() or 's19' in model.lower() or 's17' in model.lower():
                gaps['power'] = True
            elif hashrate > 0:
                gaps['power'] = True
    
    # Check rejected shares gap
    pools = pyasic_data.get('pools', [])
    if pools:
        total_rejected = sum(getattr(p, 'rejected', 0) or 0 for p in pools)
        total_accepted = sum(getattr(p, 'accepted', 0) or 0 for p in pools)
        if total_accepted > 100 and total_rejected == 0:
            if profile and profile.manufacturer == 'MicroBT':
                gaps['rejected'] = True
            elif 'whatsminer' in model.lower() or 'm30' in model.lower() or 'm50' in model.lower():
                gaps['rejected'] = True
    
    # Check temperature gap
    if not temperature or temperature == 0:
        if hashrate > 0:
            gaps['temperature'] = True
            logger.debug(f"Temperature gap detected for {model}: temp={temperature}, hashrate={hashrate}")
    
    return gaps


def _get_max_temp(data) -> float:
    """Get max temperature from PyASIC data"""
    if not data or not hasattr(data, 'hashboards'):
        return 0.0
    hashboards = data.hashboards
    if not isinstance(hashboards, (list, tuple)) or not hashboards:
        return 0.0
    all_temps = [b.chip_temp for b in hashboards if hasattr(b, 'chip_temp') and b.chip_temp is not None] + \
                [b.temp for b in hashboards if hasattr(b, 'temp') and b.temp is not None]
    return max(all_temps) if all_temps else 0.0


# The 4028 client itself now lives in asic/transport/json_tcp.py (DMI-136) so
# that the primary path can reach a miner without importing pyasic. Behaviour
# is unchanged; that module's docstring lists the two failure-path differences
# (a classified reason instead of a swallowed None, and a socket that is always
# closed).


def _merge_data(pyasic_data: Dict, cgminer_data: Dict, gaps: Dict[str, bool], cgminer_board_temps: List[float]) -> Dict:
    """Merge PyASIC and cgminer data, using cgminer to fill gaps"""
    merged = pyasic_data.copy()
    
    if gaps.get('power') and cgminer_data.get('power', 0) > 0:
        merged['power'] = cgminer_data['power']
        miner_gaps_filled_total.labels(type='power').inc()
        logger.debug(f"Filled power gap: {cgminer_data['power']}W from cgminer")
    
    if gaps.get('rejected'):
        cgminer_pools = cgminer_data.get('pools', [])
        if cgminer_pools:
            total_rejected = sum(p.get('rejected', 0) for p in cgminer_pools)
            if total_rejected > 0:
                miner_gaps_filled_total.labels(type='rejected').inc()
            merged['pools'] = cgminer_pools
            logger.debug(f"Filled rejected shares gap: {total_rejected} from cgminer")
    
    if gaps.get('temperature') and cgminer_data.get('temperature', 0) > 0:
        merged['temperature'] = cgminer_data['temperature']
        merged['cgminer_board_temps'] = cgminer_board_temps
        miner_gaps_filled_total.labels(type='temperature').inc()
        logger.info(f"✓ Filled temperature gap: {cgminer_data['temperature']}°C from cgminer")
    elif gaps.get('temperature'):
        logger.warning(f"⚠️  Temperature gap detected but cgminer returned 0 or None")
    
    return merged


def _derive_published(data: Dict, ip: str, name: str, model: str,
                      scrape_status: int = 2, algorithm: str = None) -> Dict[str, Any]:
    """
    Every value `_update_metrics` publishes, computed and nothing else.

    Extracted for DMI-136 so that the parallel comparison compares *published
    values* rather than a second opinion about them: the pyasic path and our own
    both project through this one function, so a disagreement it reports is a
    disagreement a dashboard would show. It also puts the derivation — the
    is_mining overrides, the state rule, the efficiency fallback, the
    three-source board merge — in exactly one place for both paths.

    Touches no gauges and no caches; `_publish_published()` does that.
    """
    # Ensure model is a plain string; a tuple here means a stale failure_streak key
    # leaked through state_manager deserialization — replace with "Unknown"
    if not isinstance(model, str):
        model = "Unknown"
    model = model.replace(" ", "_")
    is_scrypt = _is_scrypt_miner(model, algorithm)
    
    hashrate_raw = data.get('hashrate', 0) or 0
    hashrate = float(hashrate_raw) if hashrate_raw else 0.0
    
    # Determine is_mining more reliably than just trusting the data
    # PyASIC and other collectors sometimes return False even when miner is actively mining
    pyasic_is_mining = data.get('is_mining', True)
    is_mining_override = False
    
    # Check if any pool is alive and accepting shares
    pools = data.get('pools', [])
    if pools:
        for pool in pools:
            # Check for pool object with alive attribute
            if hasattr(pool, 'alive') and pool.alive:
                is_mining_override = True
                logger.info(f"{name}: Pool alive detected, overriding is_mining to True (data said {pyasic_is_mining})")
                break
            # Check for dict with status field
            elif isinstance(pool, dict):
                status = pool.get('status', '').lower()
                if status in ['alive', 'normal', 'active']:
                    is_mining_override = True
                    logger.debug(f"{name}: Pool status '{status}', overriding is_mining to True (data said {pyasic_is_mining})")
                    break
    
    # Fallback: If hashrate > 10 TH/s (or 1000 MH/s for scrypt), assume mining
    if not is_mining_override and hashrate > 10:
        is_mining_override = True
        logger.debug(f"{name}: Overriding is_mining to True based on hashrate ({hashrate:.2f}, data said {pyasic_is_mining})")
    
    # Use override if we determined miner is mining, otherwise trust the data
    is_mining = is_mining_override if is_mining_override else pyasic_is_mining
    
    if hashrate == 0 and not is_mining:
        state = 1
    elif hashrate > 0:
        state = 2
    else:
        state = 0
    
    # Determine algorithm label
    algo = 'scrypt' if is_scrypt else 'sha256'

    expected_hashrate = None
    expected_source = None
    expected_boards_ghs = None

    if not is_scrypt:
        # Publish the rated hashrate so the SHA-256 degradation alerts have
        # something to compare against (DMI-59), preferring what the machine says
        # about itself over what its model string implies (DMI-81). Only when one
        # of the two actually states a figure: whatsminer_generic covers miners
        # that report no model, and inventing one would make the alerts fire on a
        # guess.
        # `Factory GHS` from the same `devs` response the board readings come
        # from: a second, independent reading of the nameplate that reaches the
        # one machine port 4433 refuses.
        cgminer_boards = data.get('cgminer_boards') or {}
        cgminer_rated = [b['rated'] for b in cgminer_boards.values() if b.get('rated')]
        cgminer_rated_ths = sum(cgminer_rated) if cgminer_rated else None

        expected_hashrate, expected_source = resolve_expected_hashrate(
            ip, model, algorithm, cgminer_rated_ths)

        # Per-board nameplate, which only the machine knows. None when it did not
        # state one -- absent is not zero.
        rated = get_rated(ip)
        if rated:
            expected_boards_ghs = rated.boards_ghs
        elif cgminer_rated:
            # Same order as the slots they came from, so the `slot` label lines
            # up with miner_board_hashrate_ths.
            expected_boards_ghs = [
                cgminer_boards[slot]['rated'] * 1000.0
                for slot in sorted(cgminer_boards, key=lambda s: int(s))
                if cgminer_boards[slot].get('rated')
            ]
        else:
            expected_boards_ghs = None

    power = float(data.get('power', 0) or 0)
    temperature = float(data.get('temperature', 0) or 0)
    uptime = float(data.get('uptime', 0) or 0)

    efficiency_raw = data.get('efficiency', 0) or 0
    efficiency = float(efficiency_raw) if efficiency_raw else 0.0
    if is_scrypt:
        efficiency = 0.0
    elif efficiency == 0 and hashrate > 0 and power > 0:
        efficiency = power / hashrate if hashrate > 0 else 0

    errors = data.get('errors', [])

    # Fan speeds, keyed by fan_id. A speed the miner did not report is left out
    # rather than sent as 0 -- 0 RPM is a stopped fan, and that is an alert.
    fan_speeds = {}
    for i, fan in enumerate(data.get('fans', []) or []):
        if hasattr(fan, 'speed'):
            fan_speeds[str(i)] = fan.speed
        elif isinstance(fan, dict) and fan.get('speed') is not None:
            # The collector-standard format (COLLECTOR_STANDARD.md) is a dict,
            # and our own driver returns that shape. pyasic passes objects, so
            # this branch is inert for it -- without it, a fan our path reports
            # correctly would be dropped and read as "no fan series".
            fan_speeds[str(i)] = fan['speed']

    # Ordered weakest source first, so the better one overwrites it. pyasic's
    # `fan_psu` is populated on effectively no machine in this fleet, while
    # `get_psu` answers on 20 of 21 -- the same asymmetry that made `devs` the
    # real source of per-board readings in DMI-64.
    fan_psu = data.get('fan_psu', [])
    if fan_psu and isinstance(fan_psu, (list, tuple)) and len(fan_psu) > 0:
        if hasattr(fan_psu[0], 'speed'):
            fan_speeds['psu'] = fan_psu[0].speed

    psu = data.get('psu') or {}
    if psu.get('fan') is not None:
        fan_speeds['psu'] = psu['fan']

    # Share counters. None means "nothing published for this machine", which is
    # what the original did by simply not setting the gauges -- kept, because a
    # machine that reports pools without counters must not publish a 0 that
    # reads as "no shares accepted".
    total_accepted = None
    total_rejected = None
    pools = data.get('pools', [])
    if pools and isinstance(pools, (list, tuple)) and len(pools) > 0:
        first_pool = pools[0]
        if hasattr(first_pool, 'accepted'):
            total_accepted = sum(p.accepted for p in pools if hasattr(p, 'accepted') and p.accepted is not None)
            total_rejected = sum(p.rejected for p in pools if hasattr(p, 'rejected') and p.rejected is not None)
        elif isinstance(first_pool, dict):
            total_accepted = sum(p.get('accepted', 0) for p in pools if isinstance(p, dict))
            total_rejected = sum(p.get('rejected', 0) for p in pools if isinstance(p, dict))
        else:
            total_accepted = 0
            total_rejected = 0

    # Per-pool identity and status (DMI-56). Outside the block above on
    # purpose: that one needs share counters, this needs only a URL, and a
    # miner that reports pools without counters still tells us which pools it
    # uses and whether they are alive.
    pool_status = extract_pool_status(pools)

    # Per-board readings from three sources, merged by slot and published once.
    # Ordered weakest first, so a better source overwrites a poorer one and
    # never the reverse.
    boards = {}

    # 1. Legacy list of board temperatures, positional. Board (PCB) temps.
    cgminer_board_temps = data.get('cgminer_board_temps', [])
    if cgminer_board_temps and isinstance(cgminer_board_temps, list):
        for slot_idx, temp in enumerate(cgminer_board_temps):
            if temp is not None and temp > 0:
                boards.setdefault(str(slot_idx), {})['temp'] = temp

    # 2. cgminer `devs` — the only source that answers for most of the fleet,
    #    and the only one carrying chip temperature.
    for slot, readings in (data.get('cgminer_boards') or {}).items():
        boards.setdefault(slot, {}).update(readings)

    # 3. pyasic, where it has anything to say. Richest when populated, so it
    #    goes last -- but only fields it actually reported.
    hashboards = data.get('hashboards', [])
    if hashboards and isinstance(hashboards, (list, tuple)) and len(hashboards) > 0:
        if hasattr(hashboards[0], 'slot'):
            for board in hashboards:
                if not hasattr(board, 'slot'):
                    continue
                # None means the miner did not report the field. Absent keys
                # are dropped rather than passed through as None, so an empty
                # pyasic board cannot erase what `devs` already supplied
                # (DMI-62 for the not-zero half, DMI-64 for the not-erased half).
                readings = {
                    'hashrate': getattr(board, 'hashrate', None),
                    'chips': getattr(board, 'chips', None),
                    'expected_chips': getattr(board, 'expected_chips', None),
                    # Kept distinct on purpose: `temp` is the PCB, `chip_temp`
                    # is the hottest chip, and they differ by 20-30 C here.
                    # Collapsing one into the other is what made
                    # miner_board_temp_c mean different things per miner.
                    'temp': getattr(board, 'temp', None),
                    'chip_temp': getattr(board, 'chip_temp', None),
                }
                readings = {f: v for f, v in readings.items() if v is not None}
                if readings:
                    boards.setdefault(str(board.slot), {}).update(readings)

    return {
        'model': model,
        'algorithm': algo,
        'scrape_status': scrape_status,
        'state': state,
        'is_mining': 1 if is_mining else 0,
        'hashrate_ths': None if is_scrypt else hashrate,
        'hashrate_mhs': hashrate if is_scrypt else None,
        'power_watts': power,
        'temp_max_c': temperature,
        'uptime_seconds': uptime,
        'efficiency': efficiency,
        'fault_light_on': 1 if data.get('fault_light') else 0,
        'errors_count': len(errors) if errors else 0,
        'fan_speeds': fan_speeds,
        'psu': psu,
        'pool_status': pool_status,
        'pool_accepted': total_accepted,
        'pool_rejected': total_rejected,
        'boards': boards,
        'board_chips_source': _board_chips_source(data, boards),
        'expected_hashrate_ths': expected_hashrate,
        'expected_hashrate_source': expected_source,
        'expected_boards_ghs': expected_boards_ghs,
    }


def _board_chips_source(data: Dict, boards: Dict) -> str:
    """
    Which producer supplied the per-board chip expectation (DMI-189).

    Measured off the data rather than assumed from the configured path, so the
    label states what actually happened:

    - our driver tags its own output (`expected_chips_source`), and only when the
      profile stated a figure — so `profile` means the expectation came from
      `asic_profiles.yaml`;
    - otherwise, an expectation present in the merged boards can only have come
      from pyasic's board objects, which carry `expected_chips` from its registry;
    - otherwise nothing stated one, which is a real answer for the M50 VH70,
      M50S VH50 and M60 models.

    `none` is published rather than withheld: an absent source series and a
    machine whose figure is simply unknown look identical in a graph.
    """
    if data.get('expected_chips_source') == 'profile':
        return 'profile'
    if any(record.get('expected_chips') is not None for record in boards.values()):
        return 'pyasic'
    return 'none'


def _publish_published(published: Dict[str, Any], ip: str, name: str) -> None:
    """
    Write a derived projection to the gauges, in the order this collector has
    always written them (the label cache first, so a label change still clears
    the previous series before the new ones are written).

    Side effects only: every value here was computed by `_derive_published()`.
    """
    model = published['model']
    algo = published['algorithm']
    scrape_status = published['scrape_status']

    # Clean up old metrics if miner labels changed (name/model/algorithm)
    update_miner_label_cache(ip, name, model, algo)

    miner_scrape_status.labels(ip=ip, name=name, model=model, algorithm=algo).set(scrape_status)
    miner_state.labels(ip=ip, name=name, model=model, algorithm=algo).set(published['state'])

    if published['hashrate_mhs'] is not None:
        # SCRYPT: hashrate is in MH/s, only report in MH/s metric
        miner_hashrate_mhs.labels(ip=ip, name=name, model=model, algorithm=algo).set(published['hashrate_mhs'])
    if published['hashrate_ths'] is not None:
        # SHA-256: hashrate is in TH/s
        miner_hashrate.labels(ip=ip, name=name, model=model, algorithm=algo).set(published['hashrate_ths'])
        if published['expected_hashrate_ths']:
            miner_expected_hashrate.labels(ip=ip, name=name, model=model, algorithm=algo).set(
                published['expected_hashrate_ths'])
        publish_expected_hashrate_source(ip, name, published['expected_hashrate_source'], RATED_SOURCES)
        set_miner_expected_boards(ip, name, model, published['expected_boards_ghs'])

    miner_power.labels(ip=ip, name=name, model=model, algorithm=algo).set(published['power_watts'])
    miner_temp_max.labels(ip=ip, name=name, model=model, algorithm=algo).set(published['temp_max_c'])
    miner_is_mining.labels(ip=ip, name=name, model=model, algorithm=algo).set(published['is_mining'])
    miner_uptime.labels(ip=ip, name=name, model=model, algorithm=algo).set(published['uptime_seconds'])
    miner_efficiency.labels(ip=ip, name=name, model=model, algorithm=algo).set(published['efficiency'])
    miner_fault_light.labels(ip=ip, name=name, model=model, algorithm=algo).set(published['fault_light_on'])
    miner_errors_count.labels(ip=ip, name=name, model=model, algorithm=algo).set(published['errors_count'])

    set_miner_fans(ip, name, model, published['fan_speeds'])

    # Unconditional, including with nothing: a machine that stops answering
    # `get_psu` must lose its PSU series rather than keep the last mains
    # voltage it reported (DMI-94). The DG1+ never answers it at all and so
    # publishes no PSU series, which is the correct reading for a machine with
    # a different protocol -- not a set of zeroes.
    set_miner_psu(ip, name, model, published['psu'])

    if published['pool_accepted'] is not None:
        miner_pool_accepted.labels(ip=ip, name=name, model=model, algorithm=algo).set(published['pool_accepted'])
        miner_pool_rejected.labels(ip=ip, name=name, model=model, algorithm=algo).set(published['pool_rejected'])

    set_miner_pools(ip, name, published['pool_status'])
    set_miner_boards(ip, name, model, published['boards'])
    publish_board_chips_source(ip, name, published['board_chips_source'],
                               BOARD_CHIPS_SOURCES)


def _update_metrics(data: Dict, ip: str, name: str, model: str, scrape_status: int = 2, algorithm: str = None) -> Dict[str, Any]:
    """
    Update Prometheus metrics.

    Returns the projection it published, so a caller that wants to compare two
    readings compares what was actually written rather than a re-derivation.
    """
    published = _derive_published(data, ip, name, model, scrape_status, algorithm)
    _publish_published(published, ip, name)
    return published


def _flatten_published(published: Dict[str, Any]) -> Dict[str, Any]:
    """
    Flatten a projection to the `{field: value}` map the comparison diffs.

    Keys are the published quantities themselves, named the way a reader of the
    mismatches needs them (`fan:0`, `board_temp:2`, `pool_alive:<url>#<index>`),
    so a line of the comparison report can be traced to one series.
    """
    flat: Dict[str, Any] = {
        'scrape_status': published['scrape_status'],
        'state': published['state'],
        'is_mining': published['is_mining'],
        'power_watts': published['power_watts'],
        'temp_max_c': published['temp_max_c'],
        'uptime_seconds': published['uptime_seconds'],
        'efficiency': published['efficiency'],
        'fault_light_on': published['fault_light_on'],
        'errors_count': published['errors_count'],
    }
    if published['hashrate_ths'] is not None:
        flat['hashrate_ths'] = published['hashrate_ths']
    if published['hashrate_mhs'] is not None:
        flat['hashrate_mhs'] = published['hashrate_mhs']
    if published['expected_hashrate_ths']:
        flat['expected_hashrate_ths'] = published['expected_hashrate_ths']
        flat['expected_hashrate_source'] = published['expected_hashrate_source']
    if published['pool_accepted'] is not None:
        flat['pool_accepted'] = published['pool_accepted']
        flat['pool_rejected'] = published['pool_rejected']

    for fan_id, rpm in published['fan_speeds'].items():
        if rpm is None:
            # `set_miner_fans` does not publish a None speed, and one must not
            # reach the comparison either: it would report a series on both
            # sides with no value, which is a difference in nothing.
            continue
        flat[f'fan:{fan_id}'] = rpm
    for field, value in (published['psu'] or {}).items():
        if value is not None:
            flat[f'psu:{field}'] = value
    for pool in published['pool_status']:
        flat[f"pool_alive:{pool['url']}#{pool['index']}"] = 1 if pool['alive'] else 0
    for slot, readings in published['boards'].items():
        for field, value in readings.items():
            flat[f'board_{field}:{slot}'] = value
    for slot, ghs in enumerate(published['expected_boards_ghs'] or []):
        flat[f'board_expected_hashrate:{slot}'] = ghs

    return flat


def _uses_our_path(model: str, algorithm: str = None) -> bool:
    """
    Whether our WhatsMiner driver is the right reader for this machine.

    Decided by the profile library's manufacturer, not by a regex over the
    model string: an unknown machine, an Antminer or the DG1+ all keep the path
    they have today, and a new WhatsMiner profile picks this path up without a
    code change. Scrypt machines are excluded because the driver is SHA-256.
    """
    try:
        profile = get_library().get_profile(model, algorithm)
    except Exception as exc:  # noqa: BLE001 - a lookup failure must not decide a path
        logger.warning(f"Profile lookup failed for {model!r}: {exc}")
        return False
    if profile is None:
        return False
    return profile.manufacturer == 'MicroBT' and profile.algorithm != 'scrypt'


async def _read_with_our_driver(miner_config: Dict, chips_per_board: int = None) -> Dict:
    """
    Our path, with the same failure contract the pyasic path returns.

    `chips_per_board` is resolved by the caller and handed through, so the driver
    keeps no profile/YAML dependency of its own (DMI-189).
    """
    try:
        return await read_whatsminer(miner_config, chips_per_board)
    except Exception as exc:  # noqa: BLE001 - one machine must not abort the cycle
        logger.warning(f"own-path read failed for {miner_config.get('ip')}: "
                       f"{type(exc).__name__}: {exc}")
        return {'error': str(exc), 'error_type': 'other'}


def _scrape_status_for(result: Dict) -> float:
    """
    The scrape_status a result will be published with.

    One implementation for both paths: the numbers only mean anything if a
    failure is bucketed the same way whoever produced it.
    """
    if result.get('data'):
        return 1 if result.get('has_gaps') else 2
    error_type = result.get('error_type', 'other')
    if error_type == 'timeout':
        return 0
    if error_type == 'refused':
        return -1
    return -2


_compare_stats = {'machines': 0, 'fields': 0, 'mismatches': 0, 'expected': 0,
                  'unreadable': 0, 'published_by': {}}

# Cycles the comparison has run for, so COLLECTION_COMPARE_CYCLES can end a
# bounded window. A list rather than an int because the inner coroutines close
# over it, and rebinding a module global from inside a function does not do
# what it looks like it does.
_compare_cycles_run = [0]


def _reset_compare_stats() -> None:
    _compare_stats.update({'machines': 0, 'fields': 0, 'mismatches': 0,
                           'expected': 0, 'unreadable': 0, 'published_by': {}})


def _compare_summary_line() -> str:
    published = ','.join(f'{method}={count}'
                         for method, count in sorted(_compare_stats['published_by'].items()))
    return (f"parallel comparison: machines={_compare_stats['machines']} "
            f"fields_compared={_compare_stats['fields']} "
            f"unexplained={_compare_stats['mismatches']} "
            f"expected={_compare_stats['expected']} "
            f"unreadable={_compare_stats['unreadable']} "
            f"published_by[{published}]")


def _canonical_provenance(provenance: Dict) -> Dict:
    """
    Map each side's provenance words onto one vocabulary.

    The two paths name the same field differently (`pyasic.hashrate` is
    `SUMMARY[0]["MHS 1m"]`), so without this every field would look like a
    source difference. `asic/parity.py` owns the mapping.
    """
    return {key: parity.canonical_source(value)
            for key, value in (provenance or {}).items()}


def _report_comparison(miner_config: Dict, theirs: Dict, own: Dict) -> None:
    """
    Diff the two readings and log the differences, per machine.

    Both sides go through `_derive_published`/`_flatten_published`, so what is
    compared is what each path would publish, not a second opinion about it.
    Nothing here writes a gauge other than the mismatch counter: the path that
    publishes is chosen by COLLECTION_PRIMARY and never by this function.
    """
    ip = miner_config.get('ip')
    name = miner_config.get('name')
    model = miner_config.get('model') or 'Unknown'
    algorithm = miner_config.get('algorithm')

    published_by = _compare_stats['published_by']
    method = theirs.get('method', 'error') if theirs.get('data') else f"error:{theirs.get('error_type','other')}"
    published_by[method] = published_by.get(method, 0) + 1
    _compare_stats['machines'] += 1

    theirs_data = theirs.get('data')
    ours_data = own.get('data')
    if not theirs_data or not ours_data:
        _compare_stats['unreadable'] += 1
        logger.warning(
            f'compare {ip} [{name}] one path produced no reading: '
            f'theirs={theirs.get("error") or theirs.get("method")} '
            f'ours={own.get("error") or own.get("method")} '
            f'(published by {method})')
        return

    their_projection = _flatten_published(_derive_published(
        theirs_data, ip, name, model, _scrape_status_for(theirs), algorithm))
    our_projection = _flatten_published(_derive_published(
        ours_data, ip, name, model, _scrape_status_for(own), algorithm))

    findings = compare(
        their_projection, our_projection,
        _canonical_provenance(theirs.get('provenance')),
        _canonical_provenance(own.get('provenance')),
        expected_reason=COLLECTION_COMPARE_EXPECTED.get(ip))

    for finding in findings:
        miner_compare_mismatch_total.labels(
            field=finding['field'], result=finding['result']).inc()
    mismatches, expected = split_results(findings)
    _compare_stats['fields'] += len(their_projection)
    _compare_stats['mismatches'] += mismatches
    _compare_stats['expected'] += expected

    shape = (own.get('provenance') or {}).get('shape', '')
    line = summarise(name, ip, findings, len(their_projection), shape=shape)
    logger.info(f'{line} published_by={method}')
    if mismatches:
        logger.warning(f'compare {ip} [{name}]: {mismatches} unexplained disagreement(s)')


async def _collect_via_cgminer_only(ip: str, name: str, model: str, api_port: int, miner_config: Dict = None) -> Dict:
    """Collect data using only CGMiner API or specialized collectors (for miners PyASIC can't identify)"""
    
    # Check if this is a DG1 miner - use HTTP collector instead
    if 'DG1' in model.upper():
        logger.info(f"{name}: Detected DG1 miner, using HTTP collector")
        try:
            from collectors.dg1_http_collector import collect_dg1_http
            data = await collect_dg1_http(miner_config or {'ip': ip})
            if data:
                return {
                    'data': data,
                    'has_gaps': False,
                    'gaps': {},
                    'method': 'dg1_http'
                }
            else:
                return {'error': 'dg1_http_failed', 'error_type': 'other'}
        except Exception as e:
            logger.warning(f"{name}: DG1 HTTP collector failed: {e}")
            return {'error': str(e), 'error_type': 'other'}
    
    # For other miners, try CGMiner API
    try:
        # Get all data from CGMiner API
        stats = await cgminer_command(ip, "stats", api_port)
        summary = await cgminer_command(ip, "summary", api_port)
        devs = await cgminer_command(ip, "devs", api_port)
        
        if not summary:
            # CGMiner API not available
            logger.warning(f"{name}: CGMiner API not available on port {api_port}. Miner type '{model}' may not be supported.")
            return {'error': 'cgminer_not_available', 'error_type': 'unsupported'}
        
        # PSU input readings (DMI-94). Asked for only once the API has proved
        # it answers, and only for non-DG1 miners -- the DG1 branch above has
        # already returned, and it has no `get_psu`.
        psu = psu_from_get_psu(await cgminer_command(ip, "get_psu", api_port))

        # Extract data
        msg = summary.get('Msg', {})
        if not isinstance(msg, dict):
            return {'error': 'invalid_cgminer_response', 'error_type': 'other'}
        
        hashrate = msg.get('MHS av', 0) / 1_000_000 if 'MHS av' in msg else 0  # Convert MH/s to TH/s
        power = msg.get('Power', 0)
        uptime = msg.get('Elapsed', 0)
        
        # Get temperature from devs
        chip_temp = 0
        if devs and devs.get('DEVS'):
            temps = [d.get('Temperature') for d in devs['DEVS'] if d.get('Temperature')]
            if temps:
                chip_temp = max(temps)
        
        logger.info(f"{name}: Collected via CGMiner only - hashrate={hashrate:.2f} TH/s, power={power}W, temp={chip_temp}°C")
        
        return {
            'provenance': {
                'hashrate_ths': 'msg.mhs_av',
                'power_watts': 'msg.power',
                'temp_max_c': 'devs.temperature',
                'uptime_seconds': 'msg.elapsed',
                'is_mining': 'hardcoded_true',
                'fault_light_on': 'hardcoded_false',
                'errors_count': 'hardcoded_zero',
                'pools': 'none',
                'boards': 'devs',
                'psu': 'get_psu',
            },
            'data': {
                'hashrate': hashrate,
                'power': power,
                'temperature': chip_temp,
                'is_mining': True,
                'uptime': uptime,
                'efficiency': 0,
                'fault_light': False,
                'errors': [],
                'cgminer_boards': boards_from_devs(devs),
                'psu': psu,
                'hashboards': [],
                'fans': [],
                'fan_psu': [],
                'pools': [],
            },
            'has_gaps': False,
            'gaps': {},
            'method': 'cgminer_only'
        }
    except Exception as e:
        logger.warning(f"{name}: CGMiner-only collection failed: {e}")
        return {'error': str(e), 'error_type': 'other'}


async def collect_pyasic_metrics(miners: List[Dict]) -> Dict[str, Any]:
    """Batch collection using PyASIC with direct CGMiner API access for temperature
    
    Args:
        miners: List of miner configurations
    
    Note: Temperature is collected directly via PyASIC's CGMiner API access.
          Power for Antminers is not available via API (hardware limitation).
    """
    logger.info(f"Starting batch collection... path={COLLECTION_PRIMARY} "
                f"compare={'on' if COLLECTION_COMPARE else 'off'}")
    start_time = time.time()

    if COLLECTION_COMPARE:
        _compare_cycles_run[0] += 1
    # Unconditional on purpose: _compare_stats['machines'] is what the path
    # gauge is published from (DMI-211), so it has to count the cycle just run
    # and not the last cycle the comparison happened to be switched on for.
    # Nothing else reads these stats except the summary line, already gated.
    _reset_compare_stats()

    sem = asyncio.Semaphore(MAX_CONCURRENT_REQUESTS)
    # Our path gets its own slot budget rather than sharing the pyasic one:
    # in comparison mode both paths run for the same machine in the same cycle,
    # and one semaphore shared by two nested readers would either deadlock or
    # silently halve the fleet's concurrency.
    own_sem = asyncio.Semaphore(MAX_CONCURRENT_REQUESTS)

    async def collect_one(miner_config: Dict) -> Dict:
        """
        Run the path(s) for one machine and return the result that publishes.

        Which path publishes is COLLECTION_PRIMARY and nothing else — the
        comparison observes, it never decides. A machine our driver does not
        speak for (unknown profile, Antminer, the DG1+) never reaches this code.
        """
        ip = miner_config.get('ip')
        name = miner_config.get('name')
        model = miner_config.get('model') or 'Unknown'

        if not _uses_our_path(model, miner_config.get('algorithm')):
            return await collect_pyasic_one(miner_config)

        comparing = compare_enabled_for(ip, _compare_cycles_run[0])

        # The per-board chip expectation, which no machine states (DMI-189).
        # Resolved here rather than in the driver because the profile library is
        # this module's dependency, and None is a real answer: pyasic states no
        # count for the M50 VH70, M50S VH50 and M60 models, and neither publishes
        # one.
        chips_per_board = expected_chips_per_board(model, miner_config.get('algorithm'))

        async with own_sem:
            own = await _read_with_our_driver(miner_config, chips_per_board)

        if COLLECTION_PRIMARY != 'cgminer':
            theirs = await collect_pyasic_one(miner_config)
            if comparing:
                _report_comparison(miner_config, theirs, own)
            return theirs

        # PRIMARY == cgminer: publish ours, except on a machine whose published
        # board values come out of pyasic's registry rather than off the machine.
        # Two ways that happens, both *stated* exceptions rather than silent
        # fallbacks: they are logged every cycle and counted, so a machine routed
        # away from our path is visible rather than merely absent from it.
        reason = ''
        if own.get('pyasic_registry_tainted'):
            reason = 'pyasic_registry'
            logger.warning(
                f"{name} ({ip}): keeping the pyasic source — its devs response is one pyasic "
                f"can parse, so its board series carry pyasic registry values "
                f"(expected chips, placeholder slots) that our driver cannot derive")
        elif keeps_pyasic_source(model):
            reason = 'registry_chips:' + keeps_pyasic_source(model)
            logger.warning(
                f"{name} ({ip}): keeping the pyasic source — pyasic's registry states a chip "
                f"count per board for this model and publishes it as "
                f"miner_board_chips_expected, which no machine reports (DMI-136)")

        if reason:
            miner_collection_routing_total.labels(reason=reason).inc()
            theirs = await collect_pyasic_one(miner_config)
            if comparing:
                _report_comparison(miner_config, theirs, own)
            return theirs

        if comparing:
            theirs = await collect_pyasic_one(miner_config)
            _report_comparison(miner_config, theirs, own)
        return own

    async def collect_pyasic_one(miner_config: Dict):
        async with sem:
            ip = miner_config['ip']
            name = miner_config['name']
            model = miner_config['model']
            
            try:
                miner_obj = await asyncio.wait_for(get_miner(ip), timeout=15)
                if not miner_obj:
                    # PyASIC couldn't identify miner (e.g., DG1+ with auth)
                    # Try to get data directly via specialized collectors
                    logger.info(f"{name}: PyASIC couldn't identify miner, trying specialized collectors")
                    return await _collect_via_cgminer_only(ip, name, model, miner_config.get('api_port', 4028), miner_config)
                
                data = await asyncio.wait_for(miner_obj.get_data(), timeout=15)
                if not data:
                    return {'error': 'no_data', 'error_type': 'other'}
                
                # For Whatsminers, get chip temperature directly from CGMiner API
                chip_temp = _safe_float(_get_max_temp(data))
                hashrate = _safe_float(data.hashrate)
                power = _safe_float(data.wattage)

                # Where each published field actually came from. Recorded for
                # both paths (DMI-136): a disagreement in the parallel run is
                # only diagnosable if it can say *which field* each side read,
                # not merely that the numbers differ.
                provenance = {
                    'hashrate_ths': 'pyasic.hashrate' if hashrate else 'none',
                    'power_watts': 'pyasic.wattage' if power else 'none',
                    'temp_max_c': 'pyasic.hashboards' if chip_temp else 'none',
                    'uptime_seconds': 'pyasic.uptime' if data.uptime is not None else 'none',
                    'is_mining': 'pyasic.is_mining',
                    'errors_count': 'pyasic.errors',
                    'fault_light_on': 'pyasic.fault_light',
                    'pools': 'pyasic.pools',
                    'boards': 'devs',
                    'psu': 'get_psu',
                }

                # If PyASIC returns None/0 for critical metrics, try CGMiner API
                if (chip_temp == 0 or hashrate == 0 or power == 0) and hasattr(miner_obj, 'api'):
                    try:
                        # Get summary for hashrate and power
                        if hashrate == 0 or power == 0:
                            summary_data = await asyncio.wait_for(miner_obj.api.summary(), timeout=5)
                            if summary_data:
                                msg = summary_data.get('Msg', {})
                                if isinstance(msg, dict):
                                    if hashrate == 0 and 'MHS av' in msg:
                                        # Convert MH/s to TH/s
                                        hashrate = msg['MHS av'] / 1_000_000
                                        provenance['hashrate_ths'] = 'cdc.msg_mhs_av'
                                        logger.debug(f"{name}: Got hashrate from CGMiner API: {hashrate:.2f} TH/s")
                                    if power == 0 and 'Power' in msg:
                                        power = msg['Power']
                                        provenance['power_watts'] = 'cdc.msg_power'
                                        logger.debug(f"{name}: Got power from CGMiner API: {power}W")
                        
                        # Get devs for temperature
                        if chip_temp == 0 and hasattr(miner_obj.api, 'devs'):
                            devs_data = await asyncio.wait_for(miner_obj.api.devs(), timeout=5)
                            if devs_data and devs_data.get('DEVS'):
                                temps = [d.get('Temperature') for d in devs_data['DEVS'] if d.get('Temperature')]
                                if temps:
                                    chip_temp = max(temps)
                                    provenance['temp_max_c'] = 'cdc.devs_temperature'
                                    logger.debug(f"{name}: Got chip temp from CGMiner API: {chip_temp}°C")
                    except Exception as e:
                        logger.debug(f"{name}: Failed to get data from CGMiner API: {e}")
                
                def _normalize_list(val):
                    if val is None:
                        return []
                    if isinstance(val, (list, tuple)):
                        return list(val)
                    return [val] if val else []
                
                # If power is still 0 after CGMiner attempt, try profile default (for Antminers)
                if power == 0:
                    logger.info(f"{name}: Power is 0, attempting to get from profile (model={model})")
                    # Try to get power from profile
                    try:
                        library = get_library()
                        profile = library.get_profile(model)
                        if profile:
                            # Use typical power from profile (Antminers don't report power via API)
                            power = profile.expected.get('power_typical', 0)
                            if power > 0:
                                logger.info(f"{name}: Using profile typical power: {power}W")
                    except Exception as e:
                        logger.debug(f"{name}: Failed to get profile power: {e}")
                
                # Determine is_mining more reliably than PyASIC
                # PyASIC sometimes returns False even when miner is actively mining
                pools = _normalize_list(data.pools if hasattr(data, 'pools') else None)
                is_mining_override = False
                pyasic_is_mining = data.is_mining if hasattr(data, 'is_mining') else True
                
                # Check if any pool is alive and accepting shares
                if pools:
                    for pool in pools:
                        if hasattr(pool, 'alive') and pool.alive:
                            is_mining_override = True
                            logger.info(f"{name}: Pool alive detected, overriding is_mining to True (PyASIC said {pyasic_is_mining})")
                            break
                        elif isinstance(pool, dict) and pool.get('status', '').lower() in ['alive', 'normal', 'active']:
                            is_mining_override = True
                            logger.debug(f"{name}: Pool status '{pool.get('status')}', overriding is_mining to True (PyASIC said {pyasic_is_mining})")
                            break
                
                # Fallback: If hashrate > 10 TH/s (or 1000 MH/s for scrypt), assume mining
                if not is_mining_override and hashrate > 10:
                    is_mining_override = True
                    logger.debug(f"{name}: Overriding is_mining to True based on hashrate ({hashrate:.2f} TH/s, PyASIC said {pyasic_is_mining})")
                
                # Use override if we determined miner is mining, otherwise trust PyASIC
                is_mining_final = is_mining_override if is_mining_override else pyasic_is_mining
                
                pyasic_data = {
                    'hashrate': hashrate,
                    'power': power,
                    'temperature': chip_temp,
                    'is_mining': is_mining_final,
                    'uptime': _safe_float(data.uptime),
                    'efficiency': _safe_float(data.efficiency),
                    'fault_light': data.fault_light if hasattr(data, 'fault_light') else False,
                    'errors': _normalize_list(data.errors if hasattr(data, 'errors') else None),
                    'hashboards': _normalize_list(data.hashboards if hasattr(data, 'hashboards') else None),
                    'fans': _normalize_list(data.fans if hasattr(data, 'fans') else None),
                    'fan_psu': _normalize_list(data.fan_psu if hasattr(data, 'fan_psu') else None),
                    'pools': pools,
                }
                
                # Per-board readings, unconditionally rather than only as a
                # gap-filler. pyasic's hashboards come back empty on every
                # firmware newer than 2022, so for 18 of 19 machines this call
                # is the only per-board data that exists (DMI-64). It is one
                # extra request per miner per cycle against an API the
                # collector already speaks.
                if hasattr(miner_obj, 'api') and hasattr(miner_obj.api, 'devs'):
                    try:
                        devs_data = await asyncio.wait_for(miner_obj.api.devs(), timeout=5)
                        pyasic_data['cgminer_boards'] = boards_from_devs(devs_data)
                    except Exception as e:
                        logger.debug(f"{name}: devs unavailable for per-board readings: {e}")

                # PSU input readings (DMI-94), on the same terms: one more
                # request per miner per cycle against an API the collector
                # already speaks, and the only source of an input voltage.
                try:
                    psu_response = await asyncio.wait_for(
                        cgminer_command(ip, "get_psu", miner_config.get('api_port', 4028)),
                        timeout=10)
                    pyasic_data['psu'] = psu_from_get_psu(psu_response)
                except Exception as e:
                    logger.debug(f"{name}: get_psu unavailable for PSU readings: {e}")

                gaps = _check_data_gaps(pyasic_data, model)

                # For Whatsminers, supplement with CGMiner data for pool stats (rejected shares)
                # PyASIC doesn't return pool rejection data for Whatsminers
                if 'whatsminer' in model.lower() or 'm30' in model.lower() or 'm50' in model.lower() or 'm20' in model.lower():
                    try:
                        pools_data = await asyncio.wait_for(miner_obj.api.pools(), timeout=5)
                        if pools_data and 'POOLS' in pools_data:
                            pools_list = []
                            for pool in pools_data['POOLS']:
                                pools_list.append({
                                    'url': pool.get('URL', ''),
                                    'user': pool.get('User', ''),
                                    'accepted': pool.get('Accepted', 0),
                                    'rejected': pool.get('Rejected', 0),
                                    'status': pool.get('Status', 'Unknown'),
                                    'priority': pool.get('Priority', 0)
                                })
                            pyasic_data['pools'] = pools_list
                            provenance['pools'] = 'collector.pools'
                            logger.debug(f"{name}: Added pool data from CGMiner API")
                    except Exception as e:
                        logger.debug(f"{name}: Failed to get pool data: {e}")

                return {
                    'data': pyasic_data,
                    'has_gaps': any(gaps.values()),
                    'gaps': gaps,
                    'provenance': provenance,
                    'method': 'pyasic'
                }
                
            except asyncio.TimeoutError:
                logger.warning(f"⏱️  Timeout collecting from {name} ({ip})")
                return {'error': 'timeout', 'error_type': 'timeout'}
            except ConnectionRefusedError:
                logger.warning(f"🚫 Connection refused by {name} ({ip})")
                return {'error': 'connection_refused', 'error_type': 'refused'}
            except OSError as e:
                if 'refused' in str(e).lower():
                    return {'error': 'connection_refused', 'error_type': 'refused'}
                return {'error': str(e), 'error_type': 'other'}
            except Exception as e:
                error_name = type(e).__name__
                if 'APIError' in error_name:
                    return {'error': str(e), 'error_type': 'api_error'}
                return {'error': str(e), 'error_type': 'other'}
    
    tasks = [collect_one(miner) for miner in miners]
    pyasic_results = await asyncio.gather(*tasks, return_exceptions=True)

    if COLLECTION_COMPARE:
        logger.info(_compare_summary_line())
    
    success_count = 0
    miners_data = []
    
    for i, result in enumerate(pyasic_results):
        miner = miners[i]
        
        # Ensure required fields have valid values
        miner_ip = miner.get('ip') or 'unknown'
        miner_name = miner.get('name') or f'miner-{miner_ip}'
        miner_model = miner.get('model') or 'Unknown'
        
        if isinstance(result, BaseException):
            # `gather(return_exceptions=True)` exists so one machine cannot take
            # the cycle with it, but the result then has to be handled as an
            # exception: it was reaching `result.get(...)` and raising
            # AttributeError out of the loop, which lost *every* machine's data
            # rather than the one that failed. Found by reading the traceback in
            # the DMI-136 parallel run.
            logger.error(f"Collection for {miner_name} ({miner_ip}) raised "
                         f"{type(result).__name__}: {result}", exc_info=result)
            result = {'error': str(result), 'error_type': 'other'}

        if result and isinstance(result, dict) and result.get('data'):
            data = result['data']
            has_gaps = result.get('has_gaps', False)
            
            # Scrape status: 2 = full data, 1 = partial data (has gaps).
            # Shared with the comparison's projection, so both sides are
            # bucketed by one rule (DMI-136).
            scrape_status = _scrape_status_for(result)

            _update_metrics(data, miner_ip, miner_name, miner_model, scrape_status, miner.get('algorithm'))
            success_count += 1
            
            hashrate_val = _safe_float(data.get('hashrate', 0))
            temp_val = _safe_float(data.get('temperature', 0))
            
            # Detect SCRYPT algorithm
            is_scrypt = _is_scrypt_miner(miner.get('algorithm'))
            
            miner_data = {
                'ip': miner_ip,
                'name': miner_name,
                'model': miner_model,
                'hashrate': hashrate_val,
                'power': _safe_float(data.get('power', 0)),
                'temp_max': temp_val,
                'is_mining': 1 if data.get('is_mining', True) else 0,
                'uptime': _safe_float(data.get('uptime', 0)),
                'efficiency': _safe_float(data.get('efficiency', 0)),
                'fault_light': 1 if data.get('fault_light') else 0,
                'errors_count': len(data.get('errors', [])) if data.get('errors') else 0,
                'scrape_status': scrape_status,
                'state': 2 if hashrate_val > 0 else (1 if not data.get('is_mining', True) else 0),
                'pool_accepted': 0,
                'pool_rejected': 0,
            }
            
            # Add hashrate_mhs for SCRYPT miners (for backend algorithm detection)
            if is_scrypt:
                miner_data['hashrate_mhs'] = hashrate_val  # Raw MH/s value
            
            pools = data.get('pools', [])
            pool_urls = []
            if pools and isinstance(pools, (list, tuple)) and len(pools) > 0:
                first_pool = pools[0]
                if hasattr(first_pool, 'accepted'):
                    miner_data['pool_accepted'] = sum(p.accepted for p in pools if hasattr(p, 'accepted') and p.accepted is not None)
                    miner_data['pool_rejected'] = sum(p.rejected for p in pools if hasattr(p, 'rejected') and p.rejected is not None)
                    # Extract pool URLs
                    for p in pools:
                        if hasattr(p, 'url') and p.url:
                            pool_urls.append(str(p.url))
                        elif hasattr(p, 'pool_url') and p.pool_url:
                            pool_urls.append(str(p.pool_url))
                elif isinstance(first_pool, dict):
                    miner_data['pool_accepted'] = sum(p.get('accepted', 0) for p in pools if isinstance(p, dict))
                    miner_data['pool_rejected'] = sum(p.get('rejected', 0) for p in pools if isinstance(p, dict))
                    # Extract pool URLs from dict
                    for p in pools:
                        if isinstance(p, dict):
                            url = p.get('url') or p.get('pool_url') or p.get('URL')
                            if url:
                                pool_urls.append(str(url))
            
            # Add pool URLs to miner data
            miner_data['pools'] = pool_urls
            
            miners_data.append(miner_data)
        else:
            error_type = result.get('error_type', 'other') if result else 'other'
            scrape_status = _scrape_status_for(result or {})

            # Detect algorithm for error case metrics
            model_normalized = miner_model.replace(" ", "_")
            is_scrypt = _is_scrypt_miner(miner_model, miner.get('algorithm'))
            algorithm = 'scrypt' if is_scrypt else 'sha256'
            
            # Record the labels here too, not just on the success path: a miner that
            # has never been reachable still gets series, and remove_miner_series()
            # needs the cached label set to clear them once it crosses the threshold.
            update_miner_label_cache(miner_ip, miner_name, model_normalized, algorithm)

            miner_scrape_status.labels(ip=miner_ip, name=miner_name, model=model_normalized, algorithm=algorithm).set(scrape_status)
            miner_state.labels(ip=miner_ip, name=miner_name, model=model_normalized, algorithm=algorithm).set(0)
            
            miners_data.append({
                'ip': miner_ip,
                'name': miner_name,
                'model': miner_model,
                'hashrate': 0,
                'power': 0,
                'temp_max': 0,
                'is_mining': 0,
                'uptime': 0,
                'efficiency': 0,
                'fault_light': 0,
                'errors_count': 0,
                'scrape_status': scrape_status,
                'state': 0,
                'pool_accepted': 0,
                'pool_rejected': 0,
                'pools': [],  # No pool data for offline miners
            })
    
    duration = time.time() - start_time
    
    collection_duration.labels(collector='hybrid').set(duration)
    collection_success.labels(collector='hybrid').set(1 if success_count > 0 else 0)
    collection_timestamp.labels(collector='hybrid').set(time.time())

    # DMI-211: the metric written to make the collection mode visible was itself
    # invisible. `publish_collection_path()` had no caller anywhere in the
    # repository, so this family went out as HELP and TYPE with no sample line.
    # Published here, beside the batch's other gauges.
    #
    # `comparing` is *counted, not configured*: _compare_stats['machines'] is
    # incremented once per machine _report_comparison() actually ran for in this
    # cycle (all three of its call sites sit under `if comparing:`), so an
    # expired COLLECTION_COMPARE_CYCLES, a COLLECTION_COMPARE_IPS list that
    # selects no machine we read, or a fresh process all read 0. Reading
    # COLLECTION_COMPARE here would be the fabricated value this ticket is
    # about, pointing the other way. This reports the configured primary; the
    # per-machine routing is miner_collection_routing_total.
    publish_collection_path(COLLECTION_PRIMARY, COLLECTION_PATHS,
                            _compare_stats['machines'] > 0)
    
    logger.info(f"✓ Batch collection: {success_count}/{len(miners)} miners in {duration:.1f}s")
    
    return {
        'success': True,
        'miners_collected': success_count,
        'duration': duration,
        'miners_data': miners_data
    }
