"""
pyasic 0.60.0's field selection, reproduced exactly.

**This module exists for phase 1 only (DMI-136) and is meant to be deleted or
rewritten in DMI-138.** Phase 1's claim is "the primary path is ours and no
published value changes", and the only way both halves of that can be true at
once is for our path to choose the same *source field* pyasic chose — not the
better field, the same one. Each function below names the pyasic method it
mirrors so the difference is visible rather than folklore.

Measured against the live fleet 2026-09-18 (raw 4028 captures, all 20 answering
WhatsMiners). The fleet answers `summary` in two shapes and pyasic only reads
one of them, which is where most of this module's oddity comes from:

  SUMMARY shape:  {"STATUS":[{"STATUS":"S",...}],"SUMMARY":[{...fields...}]}
  Msg shape:      {"STATUS":"S","When":...,"Msg":{...fields...}}

`BTMiner._get_hashrate` reads `["SUMMARY"][0]["MHS 1m"]`, and a `KeyError` *is*
a `LookupError`, so on a Msg-shaped machine it catches its own miss and returns
None. The collector's own gap-filler then reads `Msg["MHS av"]`. Measured
2026-09-18: 13 machines SUMMARY, 7 Msg (`.53 .58 .70 .89 .98 .117 .121`), plus
`.78` (DG1+, a different protocol, refused on 4028 and excluded).

`MHS av` and `MHS 1m` are both in **MH/s** on this fleet (102 406 454 / 1e6 =
102.4 TH/s, against a stated rating of 102.5). `asic_profiles.yaml` declares
`MHS av -> TH/s, scale 1.0` for WhatsMiner, which is wrong by 10^6 — noted here
rather than fixed, because fixing it is a published-value change and belongs in
its own ticket. See `parsers/board_readings.py`, which already derives the unit
per `devs` entry (DMI-91) instead of assuming one.
"""

from typing import Any, Dict, List, Optional, Tuple

SHAPE_SUMMARY = 'summary'
SHAPE_MSG = 'msg'
SHAPE_NONE = 'none'

MHS_PER_THS = 1_000_000.0

# pyasic's BTMiner backend maps `Power == -1` to "not reported".
POWER_NOT_REPORTED = -1


# ---------------------------------------------------------------------------
# Response shape
# ---------------------------------------------------------------------------

def response_shape(response: Optional[Dict]) -> str:
    """Which of the two shapes a `summary` response uses."""
    if not isinstance(response, dict):
        return SHAPE_NONE
    if isinstance(response.get('SUMMARY'), list) and response['SUMMARY']:
        return SHAPE_SUMMARY
    if isinstance(response.get('Msg'), dict):
        return SHAPE_MSG
    return SHAPE_NONE


def summary_view(response: Optional[Dict]) -> Dict:
    """`SUMMARY[0]` — the view pyasic's native path reads. {} when absent."""
    if not isinstance(response, dict):
        return {}
    summary = response.get('SUMMARY')
    if isinstance(summary, list) and summary and isinstance(summary[0], dict):
        return summary[0]
    return {}


def msg_view(response: Optional[Dict]) -> Dict:
    """
    `Msg` — the view the collector's gap-filler reads.

    `Msg` is sometimes the string "Summary" (STATUS entries carry that, and
    `summary` on the SUMMARY shape has `Msg: "Summary"` at top level in some
    firmware), so a non-dict is treated as absent.
    """
    if not isinstance(response, dict):
        return {}
    msg = response.get('Msg')
    return msg if isinstance(msg, dict) else {}


def _number(value: Any) -> Optional[float]:
    if value is None or isinstance(value, bool):
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


# ---------------------------------------------------------------------------
# Machine-level fields
# ---------------------------------------------------------------------------

def hashrate_ths(response: Optional[Dict]) -> Tuple[Optional[float], str]:
    """
    Hashrate in TH/s, from the field pyasic would have used.

    pyasic `BTMiner._get_hashrate`: `SUMMARY[0]["MHS 1m"]` in MH/s, converted to
    the algorithm's default unit (TH/s for SHA-256) by `AlgoHashRate.into`,
    which divides and does not round.

    When that is absent or zero, `collect_pyasic_metrics`'s gap-filler runs
    (`if hashrate == 0 or power == 0`) and takes `Msg["MHS av"] / 1e6`. That is
    the branch 7 of this fleet's machines actually publish from.

    Returns (value_or_None, provenance). None means "no reading", which the
    caller publishes as 0 -- the same thing `_safe_float(None)` does.
    """
    native = _number(summary_view(response).get('MHS 1m'))
    if native:
        return native / MHS_PER_THS, 'summary.mhs_1m'
    filler = _number(msg_view(response).get('MHS av'))
    if filler:
        return filler / MHS_PER_THS, 'msg.mhs_av'
    return None, 'none'


def power_watts(response: Optional[Dict], profile_typical: Optional[float] = None) -> Tuple[float, str]:
    """
    Power in watts, from the field pyasic would have used.

    pyasic `BTMiner._get_wattage`: `SUMMARY[0]["Power"]`, with -1 meaning "not
    reported". The gap-filler then takes `Msg["Power"]`, and after that the
    collector falls back to the profile's `power_typical` -- which no
    WhatsMiner profile defines, so in this fleet the chain ends at 0.
    """
    native = _number(summary_view(response).get('Power'))
    if native is not None and native != POWER_NOT_REPORTED and native != 0:
        return native, 'summary.power'

    filler = _number(msg_view(response).get('Power'))
    if filler:
        return filler, 'msg.power'

    if profile_typical:
        return float(profile_typical), 'profile.power_typical'
    return 0.0, 'none'


def uptime_seconds(response: Optional[Dict]) -> Tuple[int, str]:
    """
    Uptime in seconds. **No gap-filling**, which is the point.

    pyasic `BTMiner._get_uptime` reads `SUMMARY[0]["Elapsed"]` and returns None
    when it is absent -- there is no `Msg` branch, so on the 7 Msg-shaped
    machines (which do carry `Elapsed` one level down) the published uptime is
    today 0. Reproduced here because the phase forbids changing it; the
    consequence is that the collector's "stuck uptime" heuristic cannot fire on
    those machines at all. Worth its own ticket.

    `.117`'s pre-flash firmware reports `Uptime` and no `Elapsed`, so 0 is
    correct there too.
    """
    native = _number(summary_view(response).get('Elapsed'))
    if native is None:
        return 0, 'none'
    return int(native), 'summary.elapsed'


# pyasic's `expected_fans` defaults to 2 (`BaseMiner.expected_fans`) and only a
# few WhatsMiner classes override it to 0. `_get_fans` returns an empty list
# when it is 0, so the fan series exist for one group and not the other — and
# the count is registry data that no machine states.
#
# Measured 2026-09-18 by resolving every machine in this fleet with
# `get_miner()` against pyasic 0.60.0's own registry: **all of them inherit the
# default of 2** (M30S++ VH90, M50 VH50/VH70/VH80, M50S, and the generic
# `WhatsminerUnknown` class `.98` resolves to). The markers below are the
# families whose classes *do* set 0; none is in this fleet, and if one arrived
# the parallel comparison would show it as a fan series on one side only.
_FANLESS_MODEL_MARKERS = ('m53', 'm56', 'm59', 'm63')
FAN_COUNT_DEFAULT = 2


def expected_fans(model: str) -> int:
    """pyasic's `expected_fans` for this model string."""
    lowered = (model or '').lower()
    if any(marker in lowered for marker in _FANLESS_MODEL_MARKERS):
        return 0
    return FAN_COUNT_DEFAULT


def fan_speeds(response: Optional[Dict], model: str) -> Tuple[Dict[str, Any], str]:
    """
    Fan speeds keyed by fan_id, on pyasic's terms.

    pyasic `BTMiner._get_fans` returns
    `[Fan(SUMMARY[0].get("Fan Speed In", 0)), Fan(...Fan Speed Out...)]` when
    `expected_fans > 0`, and `[Fan() for _ in range(0)]` (an empty list) when it
    is 0. `Fan.speed` defaults to None, so a machine whose shape it cannot read
    yields `Fan(None)` and the metric layer drops it (DMI-62) rather than
    publishing 0 RPM, which would read as a stopped fan.

    Returns ({fan_id: rpm}, provenance). An empty dict means "publish no fan
    series" — which is what the pyasic path produces for the 7 Msg-shaped
    machines in this fleet, because it cannot read `SUMMARY` on them.
    """
    if expected_fans(model) <= 0:
        return {}, 'pyasic.expected_fans=0'
    native = summary_view(response)
    if not native:
        return {}, 'summary.absent'
    speeds = {}
    for fan_id, field in (('0', 'Fan Speed In'), ('1', 'Fan Speed Out')):
        value = _number(native.get(field))
        if value is not None:
            speeds[fan_id] = value
    return speeds, 'summary.fan_speed_in_out'


def efficiency(power: float, hashrate_ths: Optional[float], shape: str) -> Tuple[float, str]:
    """
    Efficiency in W/TH, on pyasic's terms — which differ by shape.

    `MinerData.efficiency` is `round(wattage / float(hashrate))` and returns
    None when either side is None. On a Msg-shaped machine pyasic's own
    hashrate and wattage are both None, so the property returns None, the
    collector stores 0, and `_update_metrics` then recomputes
    `power / hashrate` **unrounded**. On a SUMMARY-shaped machine pyasic's
    value is a rounded int and survives. Both are reproduced.

    Returns (value, provenance).
    """
    if shape == SHAPE_SUMMARY:
        native_hashrate = None
        native_power = None
        # Caller passes the *published* power; on the SUMMARY shape that is
        # pyasic's own wattage.
        if hashrate_ths:
            native_hashrate, native_power = hashrate_ths, power
        if native_hashrate and native_power:
            return float(round(native_power / native_hashrate)), 'pyasic.efficiency_rounded'
    if hashrate_ths:
        return power / hashrate_ths, 'update_metrics.power_over_hashrate'
    return 0.0, 'none'


# ---------------------------------------------------------------------------
# Per-board / devs
# ---------------------------------------------------------------------------

# The six keys pyasic's `BTMiner._get_hashboards` touches per `devs` entry, in
# the order it touches them. `ASC` comes first and every entry in this fleet
# omits it -- except one machine -- so the loop raises `KeyError("ASC")` on the
# first entry and the whole board parse is abandoned (caught as LookupError).
# That is why pyasic's hashboards are empty, and why the numbers pyasic
# publishes for boards on the one machine where they are not empty come from its
# registry instead of from `parsers/board_readings.py`.
_HASHBOARD_KEYS = ('ASC', 'Chip Temp Avg', 'Temperature', 'MHS 1m',
                   'Effective Chips', 'PCB SN')


def hashboards_parsed_by_pyasic(devs: Optional[Dict]) -> bool:
    """
    Whether pyasic's `_get_hashboards` would have populated anything.

    True when every `devs` entry carries all six keys. Measured 2026-09-18:
    true on `.74` only, out of 20 machines. When it is true, pyasic's registry
    values reach published board series (its `expected_chips`, and one phantom
    slot per `expected_hashboards` beyond the reported boards) and our own
    `devs` parse cannot reproduce them — see the driver's routing rule.
    """
    entries = (devs or {}).get('DEVS')
    if not isinstance(entries, list) or not entries:
        return False
    for entry in entries:
        if not isinstance(entry, dict):
            return False
        if any(key not in entry for key in _HASHBOARD_KEYS):
            return False
    return True


def pyasic_board_readings(devs: Optional[Dict]) -> Dict[str, Dict]:
    """
    What pyasic's `hashboards` would carry, in the shape `_update_metrics`
    merges (it merges pyasic's last, so these win where both have a field).

    `temp` is `round(Temperature)` and `chip_temp` is `round(Chip Temp Avg)` —
    rounded to ints by pyasic, and named differently from the `Chip Temp Max`
    that `parsers/board_readings.py` publishes as chip_temp. On `.74` this
    makes the headline `miner_temp_max_c` a chip average (90.0) rather than a
    board temperature (74.69).
    """
    if not hashboards_parsed_by_pyasic(devs):
        return {}
    readings = {}
    for slot, entry in enumerate((devs or {}).get('DEVS') or []):
        slot_number = entry.get('ASC', slot)
        record = {}
        hashrate = _number(entry.get('MHS 1m'))
        if hashrate is not None:
            record['hashrate'] = hashrate / MHS_PER_THS
        temp = _number(entry.get('Temperature'))
        if temp is not None:
            record['temp'] = round(temp)
        chip_temp = _number(entry.get('Chip Temp Avg'))
        if chip_temp is not None:
            record['chip_temp'] = round(chip_temp)
        chips = _number(entry.get('Effective Chips'))
        if chips is not None:
            record['chips'] = chips
        if record:
            readings[str(slot_number)] = record
    return readings


def pyasic_temperature_c(devs: Optional[Dict]) -> Tuple[float, str]:
    """
    The machine-level temperature pyasic produces *before* the gap-filler.

    `_get_max_temp` takes the max over its hashboards of `chip_temp` and `temp`;
    with empty hashboards that is 0.0, and the collector's temperature gap then
    fills it from `max(devs[*].Temperature)` — unrounded.

    Returns (value, provenance). A 0.0 here means the caller must apply the
    gap-filler; it never means "0 degrees".
    """
    readings = pyasic_board_readings(devs)
    values: List[float] = []
    for record in readings.values():
        for field in ('chip_temp', 'temp'):
            if record.get(field) is not None:
                values.append(float(record[field]))
    if values:
        return max(values), 'pyasic.hashboards'
    return 0.0, 'none'


# ---------------------------------------------------------------------------
# Errors, LED, mining state, pools
# ---------------------------------------------------------------------------

def error_count(summary_response: Optional[Dict],
                error_code_response: Optional[Dict]) -> Tuple[int, str]:
    """
    `miner_errors_count`, counted exactly as pyasic counts it.

    pyasic `BTMiner._get_errors` takes `get_error_code()["Msg"]["error_code"]`
    and adds one error per key (the entries are single-key dicts mapping code to
    timestamp on this firmware), then adds one more per
    `SUMMARY[0][f"Error Code {i}"]` present for `i < "Error Code Count"`.

    Measured 2026-09-18: no machine in this fleet reports `Error Code Count` in
    its summary, so only the `get_error_code` half ever fires — but the second
    half is kept, because if a firmware ever starts reporting it, pyasic would
    double-count and our path has to double-count with it.
    """
    count = 0
    entries = msg_view(error_code_response).get('error_code')
    if isinstance(entries, list):
        for entry in entries:
            if isinstance(entry, dict):
                count += len(entry)
            elif _number(entry) is not None:
                count += 1
    elif isinstance(entries, dict):
        # pyasic's `_load_api_data` rewrites `"error_code":["..."]` into a dict
        # for one buggy v2.0.4 firmware; iterating it then yields the keys.
        count += len(entries)

    summary = summary_view(summary_response)
    stated = _number(summary.get('Error Code Count'))
    if stated:
        for index in range(int(stated)):
            if summary.get(f'Error Code {index}'):
                count += 1
    return count, 'get_error_code' if count else 'none'


def fault_light(miner_info_response: Optional[Dict]) -> Tuple[bool, str]:
    """
    `miner_fault_light_on`, on pyasic's terms.

    pyasic `BTMiner._get_fault_light`: `not (get_miner_info()["Msg"]["ledstat"]
    == "auto")`, and False when the call fails. Measured 2026-09-18: `ledstat`
    is "auto" on every machine sampled, so this publishes 0 fleet-wide.
    """
    ledstat = msg_view(miner_info_response).get('ledstat')
    if ledstat is None:
        return False, 'none'
    return ledstat != 'auto', 'get_miner_info.ledstat'


def is_mining(status_response: Optional[Dict]) -> Tuple[Optional[bool], str]:
    """
    `is_mining` as pyasic derives it, including the case where pyasic derives
    nothing.

    pyasic `BTMiner._is_mining`:
      - `Msg["btmineroff"]` truthy -> probe `devdetails`; APIError means False,
        otherwise True;
      - else `True if Msg["mineroff"] == "false" else False`;
      - a missing `mineroff` key raises `KeyError`, caught as LookupError, so
        the function returns **None**.

    None is a real outcome and is reproduced: `collect_pyasic_metrics` stores
    `1 if data.get('is_mining', True) else 0` on the merged value, and None is
    falsy, so a machine that answers `status` without `mineroff` publishes
    `is_mining = 0` today. Measured 2026-09-18: `.74` is exactly that machine.

    Returns (value, provenance).
    """
    msg = msg_view(status_response)
    if not msg:
        return None, 'none'
    if msg.get('btmineroff'):
        return True, 'status.btmineroff'
    if 'mineroff' in msg:
        return msg.get('mineroff') == 'false', 'status.mineroff'
    return None, 'status.mineroff_absent'


# Provenance tokens that mean the same thing on both paths, so the parallel
# comparison can tell "the same field, read twice" from "a different field that
# happens to hold a similar number". It needs that distinction because the
# interesting failures here are *small*: `MHS 1m` and `MHS av` differ by 0.35%
# on this fleet, well inside any sane tolerance, and only the source names say
# they are not the same quantity.
SOURCE_CANON = {
    # the pyasic path's own labels
    'pyasic.hashrate': 'summary.mhs_1m',
    'pyasic.wattage': 'summary.power',
    'pyasic.uptime': 'summary.elapsed',
    'pyasic.hashboards': 'pyasic.boards',
    'pyasic.pools': 'pyasic.pools',
    # Same commands we issue, so the same source. pyasic's error list is
    # `get_error_code` plus the summary's `Error Code i` entries, and the second
    # half is empty on every machine here (measured 2026-09-18); if a firmware
    # starts reporting it, the *value* comparison catches the difference.
    'pyasic.errors': 'get_error_code',
    'pyasic.is_mining': 'status.mineroff',
    'pyasic.fault_light': 'get_miner_info.ledstat',
    # the collector's gap-filler, which is where 7 of these machines really come from
    'cdc.msg_mhs_av': 'msg.mhs_av',
    'cdc.msg_power': 'msg.power',
    'cdc.devs_temperature': 'devs.temperature',
    # our driver's labels already name the command and the field
    'summary.mhs_1m': 'summary.mhs_1m',
    'msg.mhs_av': 'msg.mhs_av',
    'summary.power': 'summary.power',
    'msg.power': 'msg.power',
    'summary.elapsed': 'summary.elapsed',
    'devs.temperature': 'devs.temperature',
    'collector.pools': 'collector.pools',
    'get_psu': 'get_psu',
    'devs': 'devs',
}


def canonical_source(token: str) -> str:
    """
    Normalise a provenance token to a path-independent source name.

    `none` and the empty string mean "this path did not state where the value
    came from" — the collector's hardcoded defaults and a field nobody read.
    They are normalised to '' so the source test stays quiet there: a path
    admitting it has no source is not a claim that differs from another one.
    """
    if not token or token == 'none':
        return ''
    return SOURCE_CANON.get(token, token)


def wants_cgminer_pools(model: str) -> bool:
    """
    Whether `collect_pyasic_metrics` replaces the pool list from the `pools`
    command for this model.

    Verbatim reproduction of the collector's own test, including its gap: the
    M60 at `.121` does not match any of these substrings, so its pools stay as
    pyasic's (which, for a BTMiner, are empty — `BaseMiner._get_pools` returns
    None and no BTMiner backend overrides it). `.121` therefore publishes no
    pool series today, and must not start.
    """
    lowered = (model or '').lower()
    return ('whatsminer' in lowered or 'm30' in lowered or 'm50' in lowered
            or 'm20' in lowered)
