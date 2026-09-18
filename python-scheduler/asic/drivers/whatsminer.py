"""
WhatsMiner driver: read a machine over the 4028 API, with no pyasic.

This is the DMI-136 primary path. It issues the same commands pyasic issues,
reads the same fields pyasic reads (see `asic/parity.py` for why that is the
requirement and not an accident), and returns the collector-standard dict that
`collect_pyasic_metrics` already knows how to publish — so the metric layer, the
gap detection and the derivation below it are shared with the pyasic path
rather than duplicated for it.

What it deliberately does not do in phase 1:

- It does not decide `is_mining` on its own terms. `status` gives the machine's
  own `mineroff`; the collector's existing override rules (a live pool, or a
  hashrate above 10) are applied to the result by the caller, so both paths go
  through one implementation of them.
- It does not touch a machine that answers `devs` in the shape pyasic can parse.
  `pyasic_hashboards_parsed(devs)` is the routing gate: on such a machine
  pyasic's registry values (its chip counts, and a phantom board slot per
  `expected_hashboards`) reach published series that this driver cannot
  reproduce from the machine's own answers, so the caller keeps that machine on
  the pyasic source. Measured 2026-09-18: that is `.74`, one machine in twenty.

Read-only. Every command here is a `*.get_*` or `summary`/`devs`/`pools`/
`status` read; nothing in this module can change a machine.
"""

import asyncio
import logging
from typing import Any, Dict, Optional, Tuple

from asic import parity
from asic.transport.json_tcp import (OTHER, REFUSED, TIMEOUT, command_result)
from parsers.board_readings import boards_from_devs
from parsers.psu_readings import psu_from_get_psu

logger = logging.getLogger(__name__)

METHOD = 'cgminer_4028'

# Command -> the name the response is known by downstream.
_SUMMARY = 'summary'
_DEVS = 'devs'
_POOLS = 'pools'
_STATUS = 'status'
_MINER_INFO = 'get_miner_info'
_ERROR_CODE = 'get_error_code'
_PSU = 'get_psu'

_PER_READ_TIMEOUT = 12.0


async def read_miner(miner_config: Dict) -> Dict[str, Any]:
    """
    Read one WhatsMiner over 4028.

    Returns either `{'data': ..., 'method': ...}` — the same contract
    `_collect_via_cgminer_only` and the pyasic branch return — or
    `{'error': ..., 'error_type': ...}` with a reason from the same vocabulary
    (`timeout` / `refused` / `other` / `unsupported`), which is what the caller
    maps to `miner_scrape_status`.
    """
    ip = miner_config.get('ip')
    model = miner_config.get('model') or 'Unknown'
    port = miner_config.get('api_port') or 4028

    summary, reason = await command_result(ip, _SUMMARY, port)
    if summary is None:
        # Same classification the pyasic path produces for the same failure:
        # a refused or timed-out connection is a scrape failure with a bucket,
        # not a generic error.
        error_type = {TIMEOUT: 'timeout', REFUSED: 'refused'}.get(reason, 'other')
        return {'error': f'cgminer_{reason}', 'error_type': error_type}

    if parity.response_shape(summary) == parity.SHAPE_NONE:
        # The API answered, but not with anything a miner summary looks like.
        # Mirrors `_collect_via_cgminer_only`'s cgminer_not_available -> -2.
        return {'error': 'cgminer_not_available', 'error_type': 'unsupported'}

    responses = await _read_rest(ip, model, port)

    data, provenance = _build_reading(summary, responses, model)
    return {
        'data': data,
        'provenance': provenance,
        'method': METHOD,
        # True on a machine whose `devs` response pyasic can parse. Its board
        # readings then carry pyasic's *registry* values — chip counts per
        # model, and a placeholder slot per `expected_hashboards` beyond the
        # boards the machine reports — which cannot be derived from anything
        # the machine says. The caller keeps such a machine on the pyasic
        # source rather than changing what its board series read. Measured
        # 2026-09-18: `.74`, one machine in twenty, and on it this is not
        # cosmetic — its headline temperature is pyasic's rounded chip average.
        'pyasic_registry_tainted': parity.hashboards_parsed_by_pyasic(responses.get(_DEVS)),
    }


async def _read_rest(ip: str, model: str, port: int) -> Dict[str, Optional[Dict]]:
    """
    The remaining commands, all optional.

    One failing command must not lose the machine's other readings — and must
    not lose the *machine*, which is the property that matters: `get_psu` not
    answering is already an expected state on this fleet (DMI-94), and `devs`
    not answering costs the per-board series and nothing else.
    """
    wanted = [_DEVS, _STATUS, _MINER_INFO, _ERROR_CODE, _PSU]
    if parity.wants_cgminer_pools(model):
        wanted.append(_POOLS)

    async def one(command: str) -> Tuple[str, Optional[Dict]]:
        response, _ = await command_result(ip, command, port)
        return command, response

    results = await asyncio.gather(*(one(command) for command in wanted))
    return dict(results)


def _build_reading(summary: Optional[Dict], responses: Dict[str, Optional[Dict]],
                   model: str) -> Tuple[Dict[str, Any], Dict[str, str]]:
    """Assemble the collector-standard dict and the provenance of each field."""
    devs = responses.get(_DEVS)
    status = responses.get(_STATUS)
    miner_info = responses.get(_MINER_INFO)
    error_code = responses.get(_ERROR_CODE)
    psu_response = responses.get(_PSU)
    pools_response = responses.get(_POOLS)

    hashrate_ths, hashrate_source = parity.hashrate_ths(summary)
    power, power_source = parity.power_watts(summary)
    uptime, uptime_source = parity.uptime_seconds(summary)

    # pyasic's own temperature is 0.0 whenever its board parse failed, which is
    # every machine but one; the collector's temperature gap-filler then takes
    # the hottest `devs` board temperature, unrounded.
    temperature, temperature_source = parity.pyasic_temperature_c(devs)
    if temperature == 0:
        temperature, temperature_source = _devs_temperature(devs)

    fans, fans_source = parity.fan_speeds(summary, model)
    errors_count, errors_source = parity.error_count(summary, error_code)
    fault_light, fault_source = parity.fault_light(miner_info)
    mining, mining_source = parity.is_mining(status)

    hashrate_ths = hashrate_ths or 0.0
    shape = parity.response_shape(summary)

    data: Dict[str, Any] = {
        'hashrate': hashrate_ths,
        'power': power,
        'temperature': temperature,
        'is_mining': mining,
        'uptime': uptime,
        # `_update_metrics` recomputes efficiency from power/hashrate when this
        # is 0, so the parity of the published value is decided there.
        'efficiency': parity.efficiency(power, hashrate_ths, shape)[0],
        'fault_light': fault_light,
        'errors': [None] * errors_count,
        'hashboards': [],
        'fans': [{'speed': rpm} for rpm in fans.values()],
        'fan_psu': [],
        'pools': _pools(pools_response, model),
        'cgminer_boards': boards_from_devs(devs),
        'psu': psu_from_get_psu(psu_response),
    }

    provenance = {
        'shape': shape,
        'hashrate_ths': hashrate_source,
        'power_watts': power_source,
        'temp_max_c': temperature_source,
        'uptime_seconds': uptime_source,
        'efficiency': parity.efficiency(power, hashrate_ths, shape)[1],
        'errors_count': errors_source,
        'fault_light_on': fault_source,
        'is_mining': mining_source,
        'pools': 'pools' if data['pools'] else 'none',
        'boards': 'devs' if data['cgminer_boards'] else 'none',
        'psu': 'get_psu' if data['psu'] else 'none',
    }
    for fan_id in fans:
        provenance[f'fan:{fan_id}'] = fans_source
    return data, provenance


def _devs_temperature(devs: Optional[Dict]) -> Tuple[float, str]:
    """
    The collector's temperature gap-filler: `max(devs[*].Temperature)`.

    Unrounded, unlike pyasic's board path — measured 2026-09-18 that is worth
    up to 0.5 C against `round()` on a machine whose boards pyasic can parse,
    which is exactly why such a machine is routed to pyasic instead.
    """
    temperatures = []
    for entry in (devs or {}).get('DEVS') or []:
        if not isinstance(entry, dict):
            continue
        value = entry.get('Temperature')
        if isinstance(value, (int, float)) and value:
            temperatures.append(float(value))
    if not temperatures:
        return 0.0, 'none'
    return max(temperatures), 'devs.temperature'


def _pools(pools_response: Optional[Dict], model: str) -> list:
    """
    Pool records, on the terms `collect_pyasic_metrics` already uses.

    pyasic contributes **no** pool data for a WhatsMiner — `BaseMiner._get_pools`
    returns None and no BTMiner backend overrides it — so every published pool
    value in this fleet already comes from this `pools` command, for the models
    the collector's own model test selects. Models it does not select (the M60
    at `.121`) publish no pool series at all today, and must keep not doing so.
    """
    if not parity.wants_cgminer_pools(model):
        return []
    entries = (pools_response or {}).get('POOLS')
    if not isinstance(entries, list):
        return []
    return [
        {
            'url': pool.get('URL', ''),
            'user': pool.get('User', ''),
            'accepted': pool.get('Accepted', 0),
            'rejected': pool.get('Rejected', 0),
            'status': pool.get('Status', 'Unknown'),
            'priority': pool.get('Priority', 0),
        }
        for pool in entries
        if isinstance(pool, dict)
    ]
