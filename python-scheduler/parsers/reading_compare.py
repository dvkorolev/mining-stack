"""
Compare two published-value projections of the same machine (DMI-136).

Phase 1 runs both collection paths against the same miner seconds apart and
publishes only one of them. This module answers the only question that matters
for that: *do the two readings produce the same published values?* — per field,
per machine, with a reason for every difference.

Two things it deliberately does not do:

- It does not reduce a machine to a single "match / no match". A machine with a
  3% hashrate drift and a machine whose temperature comes from a different
  quantity need different responses, so a difference carries its field, both
  values and both provenances.
- It does not silently excuse a machine. An expected difference (a stopped
  miner, a machine on another collector) is a *result*, not a filter: it is
  reported with its reason and counted separately from an unexplained one. Same
  rule as `SIMULATION_MODE` and `miners_config_source` — a fallback must never
  be indistinguishable from success.

The projections being compared are the values the collector would publish,
which is what "no behaviour change" is a claim about; `_derive_published()` in
the collector builds them for both paths, so this module never re-implements
the derivation.
"""

from typing import Any, Dict, Iterable, List, Optional, Tuple

# Result labels, used as the `result` dimension of the mismatch counter.
RESULT_MISMATCH = 'mismatch'    # unexplained
RESULT_EXPECTED = 'expected'    # explained by COLLECTION_COMPARE_EXPECTED
RESULT_ONLY_OURS = 'only_ours'  # a series/value only our path produced
RESULT_ONLY_PYASIC = 'only_pyasic'  # a series/value only pyasic produced
RESULT_SOURCE = 'source'        # same-ish value, but a different field behind it

# Relative tolerance for a continuously-moving measurement read twice, seconds
# apart. Two reads of the same machine legitimately differ by more than
# nothing: hashrate and fan RPM move within seconds, and the site is reached
# over Tailscale at ~2 s RTT, so the two reads are not the same instant.
DEFAULT_RELATIVE = 0.02
DEFAULT_ABSOLUTE = 0.0

# Per-field absolute floors, so a relative tolerance does not become an
# infinitely tight test around a small number.
ABSOLUTE_FLOORS = {
    'temp_max_c': 1.0,          # +/- 1 C
    'power_watts': 50.0,        # +/- 50 W
    'hashrate_ths': 0.5,        # +/- 0.5 TH/s
    'hashrate_mhs': 500.0,      # +/- 500 MH/s (scrypt)
    'efficiency': 1.0,          # W/TH, published as an int by the pyasic path
    'expected_hashrate_ths': 0.5,
}

# Counters advance between the two reads; a decrease is never just drift --
# it means the two paths are summing different things.
COUNTER_KEYS = ('uptime_seconds', 'pool_accepted', 'pool_rejected', 'errors_total')
COUNTER_MAX_ADVANCE = {
    'uptime_seconds': 120.0,
    'pool_accepted': 50.0,
    'pool_rejected': 5.0,
}

# Values compared with exact equality, plus the key-set comparison itself.
EXACT_KEYS = (
    'state', 'is_mining', 'fault_light_on', 'errors_count', 'scrape_status',
    'expected_hashrate_source',
)

# Continuous keys, matched by exact name or by prefix pattern.
CONTINUOUS_KEYS = ('hashrate_ths', 'hashrate_mhs', 'power_watts', 'temp_max_c', 'efficiency')
CONTINUOUS_PREFIXES = ('fan:', 'psu:', 'board_hashrate:', 'board_temp:', 'board_chip_temp:',
                       'board_expected_hashrate:')


def _kind(key: str) -> str:
    """Which comparison rule a key gets."""
    if key in EXACT_KEYS or key.startswith('pool_alive:'):
        return 'exact'
    if key in COUNTER_KEYS:
        return 'counter'
    if key in CONTINUOUS_KEYS or key.startswith(CONTINUOUS_PREFIXES):
        return 'continuous'
    # Anything the collector publishes that this list does not name is compared
    # exactly -- an unknown field must not slip through as "close enough".
    return 'exact'


def _number(value: Any) -> Optional[float]:
    if value is None or isinstance(value, bool):
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _differs(key: str, theirs: Any, ours: Any) -> bool:
    kind = _kind(key)
    if kind == 'exact':
        return theirs != ours

    theirs_num, ours_num = _number(theirs), _number(ours)
    if theirs_num is None or ours_num is None:
        # "not reported" and "reported as 0" are different facts (DMI-62); a
        # side that states nothing is not equal to one that states a number.
        return theirs_num is not ours_num

    if kind == 'counter':
        # Two-sided on purpose. The two reads happen seconds apart and either
        # one may be first, so a counter may legitimately be a little *lower* on
        # the side that was read first — measured on `.74` and `.101`, where
        # uptime differed by exactly the 2 s between the reads. A drop far
        # outside the window is still a finding: that is a reboot or a different
        # quantity being summed, not the clock.
        advance = abs(ours_num - theirs_num)
        limit = COUNTER_MAX_ADVANCE.get(key)
        if limit is None:
            limit = max(abs(theirs_num), 1.0) * DEFAULT_RELATIVE
        return advance > limit

    floor = ABSOLUTE_FLOORS.get(key, DEFAULT_ABSOLUTE)
    return abs(ours_num - theirs_num) > max(floor, abs(theirs_num) * DEFAULT_RELATIVE)


def compare(published_theirs: Dict[str, Any], published_ours: Dict[str, Any],
            provenance_theirs: Optional[Dict[str, str]] = None,
            provenance_ours: Optional[Dict[str, str]] = None,
            expected_reason: Optional[str] = None) -> List[Dict[str, Any]]:
    """
    Field-by-field differences between the pyasic projection and ours.

    Args:
        published_theirs: projection of the currently published path.
        published_ours: projection of our path.
        provenance_theirs, provenance_ours: optional {field: source} maps, so a
            difference can say *which command and field* produced each side.
        expected_reason: why this machine is allowed to differ, if it is.

    Returns:
        One record per difference: {field, theirs, ours, provenance, result}.
        Empty list means the two paths agree everywhere compared.
    """
    provenance_theirs = provenance_theirs or {}
    provenance_ours = provenance_ours or {}
    findings: List[Dict[str, Any]] = []

    for key in sorted(set(published_theirs) | set(published_ours)):
        in_theirs = key in published_theirs
        in_ours = key in published_ours
        their_source = (provenance_theirs.get(key) or '').strip()
        our_source = (provenance_ours.get(key) or '').strip()
        source_differs = bool(their_source and our_source and their_source != our_source)

        if in_theirs and in_ours:
            value_differs = _differs(key, published_theirs[key], published_ours[key])
            if not value_differs and not source_differs:
                continue
            if expected_reason:
                result = RESULT_EXPECTED
            else:
                # A source difference is reported even when the numbers agree:
                # `MHS 1m` and `MHS av` are 0.35% apart on this fleet, so the
                # value test alone cannot tell "the same field, read twice" from
                # "a different field with a similar number" -- and only the
                # second is a change in what the metric means.
                result = RESULT_SOURCE if source_differs else RESULT_MISMATCH
        elif in_ours:
            result = RESULT_ONLY_OURS
        else:
            result = RESULT_ONLY_PYASIC

        findings.append({
            'field': key,
            'theirs': published_theirs.get(key),
            'ours': published_ours.get(key),
            'provenance': {'theirs': their_source, 'ours': our_source},
            'result': result,
            'reason': expected_reason or '',
        })
    return findings


def summarise(name: str, ip: str, findings: Iterable[Dict[str, Any]],
              fields_compared: int, shape: str = '') -> str:
    """
    One per-machine line for the log.

    Per machine, never a fleet average: a machine that agrees and a machine
    that disagrees must not be able to cancel each other out.
    """
    findings = list(findings)
    if not findings:
        return (f'compare {ip} [{name}] shape={shape or "?"} '
                f'fields={fields_compared} disagreements=0')
    parts = []
    for finding in findings:
        theirs, ours = finding['theirs'], finding['ours']
        parts.append(
            f'{finding["field"]}({finding["result"]}): theirs={theirs!r} ours={ours!r}'
            + (f' [{finding["provenance"]["theirs"]} vs {finding["provenance"]["ours"]}]'
               if finding['provenance']['theirs'] or finding['provenance']['ours'] else '')
            + (f' reason={finding["reason"]}' if finding['reason'] else '')
        )
    return (f'compare {ip} [{name}] shape={shape or "?"} fields={fields_compared} '
            f'disagreements={len(findings)} :: ' + '; '.join(parts))


def split_results(findings: Iterable[Dict[str, Any]]) -> Tuple[int, int]:
    """(unexplained, explained) counts for the per-cycle summary."""
    unexplained = explained = 0
    for finding in findings:
        if finding['result'] == RESULT_EXPECTED:
            explained += 1
        else:
            # A source difference counts as unexplained: the numbers agreeing
            # closely is not the same fact as the numbers being the same thing.
            unexplained += 1
    return unexplained, explained
