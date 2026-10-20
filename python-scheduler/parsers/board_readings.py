"""
Per-board readings from a CGMiner `devs` response.

DMI-64: for most of this fleet, `devs` is the *only* source of per-board data
that answers at all. Measured across 19 machines on 2026-08-14, pyasic returns
populated `HashBoard` objects on exactly one — the sole miner still running
2022 firmware — and `missing=True` with every field `None` on the other 18.
`devs` answers on 17 of the 19.

It also carries a reading nothing in this collector exposed before:
`Chip Temp Max`, the hottest chip on the board. That is a different quantity
from the board (PCB) temperature and runs 20-30 C above it, so the two are kept
in separate metrics. The distinction is not cosmetic: `miner_temp_max_c`, which
every temperature alert is built on, reports the board figure — and a fleet
whose headline temperature topped out at 80 C had boards with chips at
102-109 C, under every threshold watching it.

Kept here rather than in the collector so it can be tested without pyasic
installed, the same way parsers/pool_status.py is.
"""

from typing import Dict, Optional

# Field in a DEVS entry -> key in the normalised board record.
#
# `Effective Chips` closes the other half of DMI-62. Per-board chip counts came
# only from pyasic, which populates them on exactly one machine in this fleet,
# so `miner_board_chips_count` had 3 series against 27 of
# `miner_board_chips_expected` -- and MinerMissingChips, which compares the two
# on (ip, name, slot), could evaluate one machine out of 21. It read as "no
# missing chips" fleet-wide, which was blindness rather than health.
#
# A reported 0 here is published as 0, deliberately. DMI-62 was about
# *fabricated* zeros -- `board.chips or 0` turning "pyasic said nothing" into a
# confident reading. A miner that answers `Effective Chips: 0` is stating that
# the board has no working chips, which is exactly the fault the metric exists
# to show.
_FIELDS = (
    ('Temperature', 'temp'),
    ('Chip Temp Max', 'chip_temp'),
    ('Effective Chips', 'chips'),
)

# Sane band for (reported hashrate / this board's rated hashrate). Wide on
# purpose: it only has to separate a plausible reading from one that is a
# million times off, not to judge performance.
_SCALE_MIN = 0.05
_SCALE_MAX = 5.0

# Above this, a per-board figure cannot be TH/s -- no hashboard produces
# 100 000 TH/s -- so it is MH/s. Used only when the entry states no rating to
# anchor against.
_MHS_MAGNITUDE = 100_000.0


def board_rated_ths(entry: Dict) -> Optional[float]:
    """
    This board's nameplate output in TH/s, from `Factory GHS`.

    A second, independent source for what DMI-81 reads over API v3 on port
    4433. Measured across the fleet 2026-08-29 the two agree exactly (+0.0% on
    17 of 19 machines), and this one reaches `.74`, which refuses 4433
    altogether. Where the machine states no rating -- `.98` answers 0, matching
    the `-1:-1:-1` it gives over v3 -- this returns None rather than 0.
    """
    ghs = optional_float(entry.get('Factory GHS'))
    if ghs is None or ghs <= 0:
        return None
    return ghs / 1000.0


def board_hashrate_ths(entry: Dict) -> Optional[float]:
    """
    This board's current output in TH/s, with the unit worked out per entry.

    `MHS av` does not carry a consistent unit across this fleet's firmware,
    despite the name. Measured 2026-08-29:

        .101 (2024 fw)   MHS av = 34 333 778     -> MH/s, i.e. 34.33 TH/s
        .70  (2025 fw)   MHS av =        37.26   -> already TH/s
        .121 (M60)       MHS av =        57.85   -> already TH/s

    Reading it as MH/s everywhere is what made five machines sum to 0.00 while
    reporting 110-176 TH/s at the machine level. That is the DMI-75 shape --
    same field name, different meaning -- so the unit is derived rather than
    assumed: the entry's own `Factory GHS` is unambiguous (GH/s on every
    machine here), and the interpretation that lands near it is the right one.

    `MHS 5s` is deliberately never used: DMI-75 was published from a 5-second
    window and over-reported by 3-4x. `MHS av` is what the machine-level
    hashrate already uses, so board sums stay comparable to the machine total --
    verified within +/-2% on the 12 machines where both are readable.
    """
    raw = optional_float(entry.get('MHS av'))
    if raw is None:
        return None
    if raw == 0:
        return 0.0  # a real reading: this board is producing nothing

    rated = board_rated_ths(entry)
    if rated:
        for candidate in (raw, raw / 1_000_000.0):
            if _SCALE_MIN <= candidate / rated <= _SCALE_MAX:
                return candidate
        # Neither interpretation is plausible against this board's own rating.
        # Publishing the wrong one would feed a degradation alert a figure off
        # by six orders of magnitude, so publish nothing.
        return None

    return raw / 1_000_000.0 if raw > _MHS_MAGNITUDE else raw


def optional_float(value) -> Optional[float]:
    """Parse a number, preserving "not reported" as None rather than 0.

    The whole point of the DMI-62 work: a fabricated 0 on a temperature reads
    as a cold board, which is a different claim from "the miner did not say".
    """
    if value is None or isinstance(value, bool):
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def boards_from_devs(devs: Optional[Dict]) -> Dict[str, Dict]:
    """Normalise a `devs` response into {slot: {field: value}}.

    The slot is the entry's position in `DEVS`, which is how CGMiner orders
    hashboards and matches pyasic's own `slot` numbering.

    Only fields the miner actually reported appear in a record, and a board
    that reported nothing usable produces no record at all — so a firmware that
    omits chip temperature (five machines here do) contributes its board
    temperature and stays silent about the rest, rather than publishing zeros.
    """
    boards: Dict[str, Dict] = {}
    for slot, dev in enumerate((devs or {}).get('DEVS') or []):
        if not isinstance(dev, dict):
            continue
        readings = {}
        for source, field in _FIELDS:
            value = optional_float(dev.get(source))
            if value is not None:
                readings[field] = value

        # Derived rather than copied, because the unit has to be worked out.
        hashrate = board_hashrate_ths(dev)
        if hashrate is not None:
            readings['hashrate'] = hashrate

        rated = board_rated_ths(dev)
        if rated is not None:
            readings['rated'] = rated

        if readings:
            boards[str(slot)] = readings
    return boards
