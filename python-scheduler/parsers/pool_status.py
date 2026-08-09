"""
Normalise the pool list a miner reports about itself.

DMI-56: every collection cycle already receives, from each miner, the pools it
is actually configured against and whether each one is alive — and then throws
that away, keeping only summed accepted/rejected share counts. The result was a
farm monitored against a hand-maintained list of seven pools it does not use,
while `eu.emcd.network` going Dead on the miners stayed invisible.

The miners are the only ground truth for this. Pools reached the collector in
two shapes depending on the path:

- pyasic returns objects with `url` / `alive` attributes;
- the CGMiner API returns dicts (`POOL`, `URL`, `Status`, `Stratum Active`),
  parsed in parsers/cgminer_parser.py.

Both collapse to the same normalised record here so the metric layer does not
have to care which collector produced the data.
"""

from typing import Dict, List

# CGMiner reports Status as a word; only these mean the pool is usable.
_ALIVE_STATUSES = frozenset({'alive', 'active', 'normal'})


def _first_attr(pool, *names):
    """First present, non-None attribute or dict key among `names`."""
    for name in names:
        if isinstance(pool, dict):
            if name in pool and pool[name] is not None:
                return pool[name]
        else:
            value = getattr(pool, name, None)
            if value is not None:
                return value
    return None


def _is_alive(pool) -> bool:
    """
    Whether the miner considers this pool usable.

    `alive` is authoritative when the source provides it — including when it is
    False. Only when it is absent do we fall back to the status word, and then
    to whether stratum is active.
    """
    alive = _first_attr(pool, 'alive')
    if alive is not None:
        return bool(alive)

    status = _first_attr(pool, 'status', 'Status')
    if status is not None:
        return str(status).strip().lower() in _ALIVE_STATUSES

    stratum_active = _first_attr(pool, 'stratum_active', 'Stratum Active')
    if stratum_active is not None:
        return bool(stratum_active)

    # Nothing said either way. Reporting "dead" here would invent an outage on
    # every miner whose collector omits the field, so treat it as unknown-alive
    # and let the absence of a url drop the entry in extract_pool_status().
    return True


def extract_pool_status(pools) -> List[Dict]:
    """
    Normalise a miner's reported pools.

    Args:
        pools: whatever the collector put in `data['pools']` — pyasic objects,
            CGMiner dicts, or nothing at all.

    Returns:
        One record per identifiable pool: `{'index': int, 'url': str,
        'alive': bool}`, ordered as the miner reported them. Pools with no URL
        are skipped: without one there is nothing to identify the pool by, and
        an empty label would merge unrelated pools into a single series.
    """
    if not pools or not isinstance(pools, (list, tuple)):
        return []

    normalised = []
    for position, pool in enumerate(pools):
        url = _first_attr(pool, 'url', 'URL')
        if not url:
            continue

        index = _first_attr(pool, 'index', 'POOL', 'pool_index')
        try:
            index = int(index)
        except (TypeError, ValueError):
            index = position

        normalised.append({
            'index': index,
            'url': str(url).strip(),
            'alive': _is_alive(pool),
        })

    return normalised
