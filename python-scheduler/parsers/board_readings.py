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
_FIELDS = (
    ('Temperature', 'temp'),
    ('Chip Temp Max', 'chip_temp'),
)


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
        if readings:
            boards[str(slot)] = readings
    return boards
