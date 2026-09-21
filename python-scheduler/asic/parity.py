"""
Our driver's field-selection layer: the values `asic/drivers/whatsminer.py`
publishes, and the source field each is read from.

**This module used to say it reproduced "pyasic 0.60.0's field selection,
reproduced exactly". That was a stronger claim than its evidence supports, and
closing that gap is DMI-201.** What is true: mirroring pyasic is a *design
intent*, because phase 1's rule (DMI-136) is that no published value changes,
and the only way "the primary path is ours" and "no published value changes"
can both hold is for our path to choose the same *source field* pyasic chose —
not the better field, the same one. What is not true is that the mirroring was
verified everywhere: part of it was measured against live pyasic on this fleet
and the rest was read out of pyasic's source, and **those two were
indistinguishable**. Each function now carries an `Evidence:` line saying
which one it is.

The distinction is not academic — reading pyasic's source has produced a wrong
model of it **three times** on this fleet: the two-shape finding,
`uptime_seconds` (the source says Msg-shaped machines publish 0; they publish a
real 172 450 s), and the fans (`fan_speeds()`). Every correction came from the
fleet, never from the source.

**What an `Evidence:` line means.** Both marks describe *this repository*,
not a measurement taken when the line was written:

  `Evidence: measured on the fleet` — a dated record of an observation of this
      function's claim exists in the records listed below. It does **not** mean
      the claim was re-checked then, and it does not make the record correct;
      it makes the record *findable* where it previously was not, and findable
      is all it claims. The weakest instance of it is marked `self-attested`,
      where the only record is this file's own comment rather than an
      independent one.
  `Evidence: source-only — not observed on a machine` — the claim rests on
      reading pyasic's or our own collector's source. That is not a defect in
      itself; it is the part of the emulation nobody has checked, and therefore
      the population any future correction will come from.

Where the marks were derived from:

  * `parsers/fixtures/whatsminer_*.json` — raw 4028 captures from the farm,
    2026-09-18, sanitised (each file's `source` field says so): the SUMMARY
    shape, the Msg shape, and `.74`'s parseable `devs`. They record what a
    *machine* answered and say nothing about what pyasic does with it, so on
    their own they are not evidence about pyasic.
  * `PROJECT_STATE.md` — the DMI-136 status block and the DMI-192 entry, which
    record the live window's per-machine findings.
  * `CLAUDE.md`, section "Collection path (`COLLECTION_PRIMARY`, DMI-136)".
  * This file's own "Measured …" comments, where nothing else records the
    observation — the weakest of the four, and named as such in the mark.

A mark belongs to the *function's* claim. Where one branch was measured and
another only read, the function takes the mark of the measured part and the
unmeasured part is named in the line. The marks are enforced by
`test_parity_evidence.py`, which discovers the functions from this file's
syntax rather than from a list: every public function must carry an `Evidence:`
line, and a new function cannot be added without one. Module-private helpers
(leading underscore) are exempt, because they carry no claim about pyasic's
behaviour.

**This module exists for phase 1 only (DMI-136) and is meant to be deleted or
rewritten in DMI-138.** The one place the phase-1 rule is knowingly broken is
the fan reading, `fan_speeds()` — a decision (DMI-192), not drift, whose
docstring says why: a fan series is the one published value this phase is
allowed to change. Each function below names the pyasic method it mirrors so
the difference is visible rather than folklore.

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
    """
    Which of the two shapes a `summary` response uses.

    Evidence: measured on the fleet — 13 SUMMARY / 7 Msg of 20 answering
    WhatsMiners, 2026-09-18 (module header, `CLAUDE.md`, `PROJECT_STATE.md`);
    the two shapes are the fixtures `whatsminer_summary_shape.json` /
    `whatsminer_msg_shape.json`. This function's claim is about the machine's
    answer, so a machine capture is sufficient evidence for it.
    """
    if not isinstance(response, dict):
        return SHAPE_NONE
    if isinstance(response.get('SUMMARY'), list) and response['SUMMARY']:
        return SHAPE_SUMMARY
    if isinstance(response.get('Msg'), dict):
        return SHAPE_MSG
    return SHAPE_NONE


def summary_view(response: Optional[Dict]) -> Dict:
    """
    `SUMMARY[0]` — the view pyasic's native path reads. {} when absent.

    Evidence: measured on the fleet — 2026-09-18: on the 7 Msg-shaped machines
    pyasic's *published* hashrate and wattage come from the collector's own
    gap-filler (`PROJECT_STATE.md`). That is what "pyasic read `SUMMARY[0]` and
    got nothing" predicts, and what a native read of the `Msg` view would
    contradict, so the observation discriminates between the two. The view name
    and the `[0]` are read from pyasic's source.
    """
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

    Evidence: source-only — not observed on a machine. The view name comes from
    our own collector's gap-filler (`collectors/pyasic_collector.py`), and no
    record dates the firmware case where `Msg` is the string "Summary".
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

    Evidence: measured on the fleet — 2026-09-18: on the 7 Msg-shaped machines
    the published hashrate comes from this gap-filler (`Msg["MHS av"]`,
    `PROJECT_STATE.md`), and `MHS av` was measured as MH/s on a machine rated
    102.5 TH/s (DMI-188). The `SUMMARY[0]["MHS 1m"]` branch, and that field's
    name, are read from pyasic's source.
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

    Evidence: measured on the fleet — 2026-09-18: the same window records the
    gap-filler supplying *wattage* on the 7 Msg-shaped machines
    (`PROJECT_STATE.md`). The `SUMMARY[0]["Power"]` branch and pyasic's `-1`
    convention are read from pyasic's source.
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
    Uptime in seconds, from whichever shape of the response carries `Elapsed`.

    pyasic's `BTMiner._get_uptime` reads `SUMMARY[0]["Elapsed"]`, and reading its
    source suggests the Msg-shaped machines therefore publish 0. The parallel run
    measured the opposite on 2026-09-18: their published uptime is real
    (172 450 s on `.53`, 252 633 s on `.70`), so pyasic's client is seeing an
    `Elapsed` our single `summary` request does not. The fleet decides, so both
    shapes are read here.

    `.117`'s pre-flash firmware reports `Uptime` and no `Elapsed`, so 0 is
    correct there.

    Evidence: measured on the fleet — 2026-09-18: the parallel run published
    172 450 s on `.53` and 252 633 s on `.70` (172 533 s in the window record,
    `PROJECT_STATE.md`) where reading pyasic's source predicts 0. The strongest
    mark in this file, because the fleet *refuted* the source rather than
    agreeing with it.
    """
    native = _number(summary_view(response).get('Elapsed'))
    if native is not None:
        return int(native), 'summary.elapsed'
    # Measured 2026-09-18, and it contradicts what reading pyasic's source
    # suggests: on the Msg-shaped machines the *published* uptime is real
    # (172 450 s on `.53`), so pyasic's client reads an `Elapsed` that a plain
    # `summary` request from us does not see. The fleet is the authority, so the
    # same field is used here; the mechanism (pyasic's multicommand view
    # differing from a single-command one) is an open question for DMI-138.
    filler = _number(msg_view(response).get('Elapsed'))
    if filler is not None:
        return int(filler), 'msg.elapsed'
    return 0, 'none'


# The two fan speeds a `summary` view states, keyed by the fan_id pyasic's
# `Fan` list position becomes. Read from whichever view carries them (DMI-192).
_FAN_FIELDS = (('0', 'Fan Speed In'), ('1', 'Fan Speed Out'))


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
    """
    pyasic's `expected_fans` for this model string.

    Evidence: measured on the fleet — self-attested: recorded 2026-09-18 in the
    comment above, by resolving every machine in this fleet with `get_miner()`
    against pyasic 0.60.0's own registry (all inherit the default of 2). No
    independent record repeats it, hence `self-attested`. The fanless markers
    are read from pyasic's source, and no such model is in this fleet.
    """
    lowered = (model or '').lower()
    if any(marker in lowered for marker in _FANLESS_MODEL_MARKERS):
        return 0
    return FAN_COUNT_DEFAULT


# pyasic's `expected_hashboards` (`BaseMiner.expected_hashboards`, default 3) —
# the number of *placeholder* board slots its registry fills, not a statement
# about the machine.
#
# `BaseMiner.get_data` seeds its board list with this many `HashBoard` objects,
# each already carrying `expected_chips`, and `BTMiner._get_hashboards` only ever
# *fills* those entries in. So the chip count reaches slots 0..N-1 whether or not
# the machine reported that board: the `LookupError` on a missing `ASC` (every
# machine here but `.74`) leaves the placeholders untouched, and a `devs` error
# never enters the loop at all. Reproducing pyasic's series set therefore means
# emitting those slots deliberately — see `drivers/whatsminer.py`.
#
# Measured 2026-09-19 by executing pyasic 0.60.0's own class resolution for every
# model in this fleet: all 21 resolve with `expected_hashboards = 3`, including
# the ones that fall through to the `WhatsminerUnknown` class. A class that
# overrode it would appear as a slot-count difference in the parallel
# comparison, which is where a fleet-wide change to this constant would have to
# be re-measured.
#
# Deliberately NOT `asic_profiles.yaml`'s `expected.board_count`: that one arms
# main.py's board-mismatch fallback, and every profile leaves it unset on purpose
# (pinned by test_asic_profile_matching.test_no_profile_declares_board_or_fan_counts).
EXPECTED_HASHBOARDS_DEFAULT = 3


def expected_hashboards(model: str) -> int:
    """
    pyasic's `expected_hashboards` for this model string.

    Evidence: measured on the fleet — self-attested: recorded 2026-09-19 in the
    comment above, by executing pyasic 0.60.0's own class resolution for every
    model in this fleet (all 21 resolve to 3). The same class-resolution work
    is described independently in `PROJECT_STATE.md` (DMI-189, which is where
    the `VH95 -> VH90` model-string forcing was found).
    """
    return EXPECTED_HASHBOARDS_DEFAULT


def _fan_pair(view: Dict) -> Dict[str, Any]:
    """The two fan speeds a `summary` view states, keyed by fan_id."""
    speeds: Dict[str, Any] = {}
    for fan_id, field in _FAN_FIELDS:
        value = _number(view.get(field))
        if value is not None:
            speeds[fan_id] = value
    return speeds


def fan_speeds(response: Optional[Dict], model: str) -> Tuple[Dict[str, Any], str]:
    """
    Fan speeds keyed by fan_id — **our read, not pyasic's**.

    This is the one place in this module that deliberately does not reproduce
    pyasic's field selection, and it is a deliberate published-value change
    (DMI-192) rather than drift. The module's rule everywhere else is "choose
    the same *source field* pyasic chose, not the better one"; the fan reading is
    knowingly exempt, and what it now is — our own read of the machine — is what
    this docstring records. The emulation-fidelity question it raises is its own
    ticket (DMI-201), not this function's.

    pyasic `BTMiner._get_fans` builds
    `[Fan(SUMMARY[0].get("Fan Speed In", 0)), Fan(...Fan Speed Out...)]` when
    `expected_fans > 0`, and an empty list when it is 0. The `.get(..., 0)`
    default is the defect: on the machines that answer `summary` in the Msg
    shape, `SUMMARY[0]` *resolves* — its sibling `_get_uptime` reads
    `SUMMARY[0]["Elapsed"]` from the same object and publishes a real 172 533 s
    on `.53` — but carries no fan keys, so the default fires and pyasic publishes
    `fan:0 = 0` / `fan:1 = 0`. That is a fabricated zero of the DMI-62 family and
    it is not dropped downstream: `_flatten_published` skips only `None`, so a
    `0` reaches the comparison as a number, and the live window caught it
    (`compare 192.168.2.53 … fan:0(only_pyasic): theirs=0 ours=None …
    published_by=pyasic`); the window itself is recorded in
    `PROJECT_STATE.md`, and the raw log it was reconstructed from,
    `dmi136_fleet4.log`, is **not in this repository** — so the record is the
    citation, not the log.

    The RPM is real and sits one nesting level down, in `Msg`: `.53` reports
    `Fan Speed In` 6070 / `Fan Speed Out` 6217. Every Msg-shaped machine in this
    fleet does — `.53 .58 .70 .89 .98 .117 .121`. So both views are tried in the
    same order as `uptime_seconds` above, with a provenance token naming the one
    actually read: the native `SUMMARY` view first, then `Msg`.

    Repairing a fabricated value is the point; do not read the change as an
    accident of the Msg fallback.

    Returns ({fan_id: rpm}, provenance). An empty dict means "publish no fan
    series" — no placeholder is invented to stand in for a reading nobody
    supplied.

    Evidence: measured on the fleet — 2026-09-18/19: the live window published
    `fan:0`/`fan:1` = 0 on the Msg-shaped machines while the same `MinerData`
    carried a real uptime, and the per-machine before/after found 7 machines
    differing and 13 identical (`PROJECT_STATE.md`). This is the one function
    whose *behaviour* is deliberately not pyasic's, so the evidence is about
    what pyasic publishes, not about what this returns.
    """
    if expected_fans(model) <= 0:
        return {}, 'pyasic.expected_fans=0'

    native = summary_view(response)
    speeds = _fan_pair(native)
    if len(speeds) == len(_FAN_FIELDS):
        # Both fields from the view pyasic read: a SUMMARY-shaped machine's fan
        # output does not move.
        return speeds, 'summary.fan_speed_in_out'

    msg_speeds = _fan_pair(msg_view(response))
    if msg_speeds:
        return msg_speeds, 'msg.fan_speed_in_out'
    if speeds:
        # A partial native pair and nothing in `Msg`: keep the reading rather
        # than withdraw a series that is published today.
        return speeds, 'summary.fan_speed_in_out'
    return {}, ('summary.absent' if not native else 'summary.fan_speed_absent')


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

    Evidence: source-only — not observed on a machine. Both branches are read
    from source. This is a published, compared field (`miner_efficiency_j_th`;
    `parsers/reading_compare.py`'s `CONTINUOUS_KEYS`), and no record in this
    repository measures what pyasic publishes for it — the same shape as the
    fan defect, one step weaker. Filed as its own defect rather than fixed
    here; changing it would be a published-value change.
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

    Evidence: measured on the fleet — 2026-09-18: true on `.74` only, out of 20
    machines (`CLAUDE.md`, `PROJECT_STATE.md`; the
    `whatsminer_hashboards_parseable.json` fixture is that machine). The
    six-key list is read from pyasic's source.
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

    Evidence: measured on the fleet — 2026-09-18: `.74`'s headline
    `miner_temp_max_c` is pyasic's rounded chip average (90.0) rather than the
    board temperature (`CLAUDE.md`, "the pyasic-registry-tainted machine"). The
    rounding calls and the field names are read from pyasic's source.
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

    Evidence: source-only — not observed on a machine. `_get_max_temp`'s max
    over pyasic's `hashboards` is read from pyasic's source, and the
    0.0-otherwise branch has no record behind it; the parsed case belongs to
    `pyasic_board_readings` above.
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

    Evidence: measured on the fleet — self-attested: the 2026-09-18 observation
    above is the only record, and it is this docstring's own. What it measures
    is the *machine's* answer; the counting rule itself — both halves,
    including the v2.0.4 list-to-dict rewrite — is read from pyasic's source.
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

    Evidence: measured on the fleet — self-attested: the 2026-09-18 observation
    above is the only record, and it is this docstring's own; the sample is not
    named, so how many machines "every machine sampled" covers is not
    recoverable. The `!= "auto"` rule is read from pyasic's source.
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

    Evidence: measured on the fleet — self-attested: the 2026-09-18 observation
    above is the only record, and it is this docstring's own. What it measures
    is the *machine's* `status` reply; the three-branch derivation, including
    the `btmineroff` probe, is read from pyasic's source.
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
    # The same field of the same command, one nesting level apart, on machines
    # that answer in the other shape. The values agree (measured 2026-09-18:
    # 172 450 s on both sides); the value comparison is what would catch it if
    # they ever stopped agreeing.
    'msg.elapsed': 'summary.elapsed',
    # `msg.fan_speed_in_out` is deliberately **not** collapsed onto
    # `summary.fan_speed_in_out`, unlike `msg.elapsed` just above: `Elapsed` is
    # the same field of the same command in both shapes, and the fleet measured
    # the two equal, whereas pyasic's fan value is never read from `Msg` at all —
    # it is the `.get(..., 0)` default in `_get_fans` (DMI-192). Collapsing would
    # assert the very identity that change repairs.
    #
    # Note this entry cannot fire in today's comparison: the pyasic side sets no
    # `fan:*` provenance at all (`collectors/pyasic_collector.py`), and
    # `compare()` reports a source difference only when *both* sides name one, so
    # a fan difference stays value-based. It is here to keep the vocabulary
    # complete and the distinction intact for the day that provenance is added.
    'msg.fan_speed_in_out': 'msg.fan_speed_in_out',
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

    Evidence: source-only — the vocabulary is ours, and exactly one of its
    entries was ever measured: `msg.elapsed` and `summary.elapsed` held the
    same value, 172 450 s on both sides, 2026-09-18 (the comment on that entry,
    and `PROJECT_STATE.md`). Marking the whole table `measured` would claim far
    more than that — including the deliberate non-collapse of the two fan
    tokens, which rests on DMI-192's argument rather than on a measurement.
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

    Evidence: source-only — not observed on a machine. The function reproduces
    our own collector's substring test verbatim, and `.121`'s "no pool series"
    outcome was never measured (no record names a pool series for `.121`).
    """
    lowered = (model or '').lower()
    return ('whatsminer' in lowered or 'm30' in lowered or 'm50' in lowered
            or 'm20' in lowered)
