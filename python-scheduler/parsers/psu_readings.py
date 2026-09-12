"""
PSU input readings from a WhatsMiner `get_psu` response.

DMI-94: the scheduler published no voltage metric at all. A mains sag at the
site left no time series behind, so the only surviving trace of one was the
`reason` string on error code 206 -- history from `get_error_code`, not state,
and not graphable.

`get_psu` answers on port 4028, the port this collector already speaks, on 20
of the 21 machines here (the DG1+ has its own protocol and refuses 4028). It
returns the whole PSU in one response: input voltage, input current, input
power, temperature, fan speed and the PSU model.

`iin` is not a bonus field. Measured across the fleet on 2026-08-28 the two
dead machines drew 0.75 A and 1.00 A against 13.2-16.5 A on the nineteen live
ones -- an order of magnitude, and a sharper "this machine sends no power to
its boards" signal than hashrate, because a hashrate of 0 is also what a
rebooting machine looks like.

Kept here rather than in the collector so it can be tested without pyasic
installed, the same way parsers/board_readings.py and parsers/pool_status.py
are.


The scale trap
--------------
This API states no units and does not use one scale. In the v2 form every
value is a string, and each field is encoded differently:

    vin "22200"   -> 222.00 V   (centivolts)
    iin "15000"   ->  15.000 A  (milliamps)
    pin "3328"    -> 3328 W     (as-is)
    temp0 "32.0"  ->   32.0 C   (as-is)
    fan_speed "9936" -> 9936 RPM (as-is)

while the v3 form puts a plain float in the same place (`vin: 225.5`). This is
the DMI-77 class (a unit suffix stripped without rescaling) and the DMI-91
class (`MHS av` carrying two different units across one fleet), so the scale is
*derived* per entry rather than assumed, and where it does not resolve nothing
is published -- never a zero.

The scale is anchored on `vin`, the one field whose two encodings cannot
overlap: centivolts land in [9000, 30000] and volts in [90, 300]. Resolving
each field independently against a plausibility range would not work for `iin`,
which is genuinely ambiguous on its own -- a raw `15` is 15 A in the v3 form
and would be 0.015 A in the milliamp form, and both pass a [0, 40] A range
test. Anchoring on `vin` removes that ambiguity instead of guessing at it.

A raw token containing `.` is always taken as already being in engineering
units, whatever the entry scale says. That is how v2 `temp0: "32.0"` sits in
the same response as `vin: "22200"`.


What is deliberately NOT checked here
-------------------------------------
`vin * iin ~= pin` looks like free validation, and it holds to within 0.35% on
38 of the 40 real readings we have. It is not used, because of the two it does
not hold for: `192.168.2.58`, in both independent sweeps of 2026-08-28
(221.75 V x 0.998 A = 221 VA against a reported 153 W, out by 44%). That is a
real power factor at near-zero load on an idle, faulty PSU, not a scale error.

Gating publication on that identity would suppress PSU readings on precisely
the dead machine this parser exists to find -- a check that fires hardest
exactly where the answer matters (DMI-87). The identity is asserted in the
tests, on a healthy fixture and with `.58` as the counterexample, and nowhere
else.
"""

from typing import Dict, Optional

# Entry scales.
SCALE_CENTI = 'centi'   # v2/4028: centivolts and milliamps
SCALE_PLAIN = 'plain'   # v3-shaped: already in engineering units

# `vin` bands that pick the entry scale. They cannot overlap: no mains supply
# reads between 300 V and 9000 V.
_VIN_CENTI_MIN, _VIN_CENTI_MAX = 9000.0, 30000.0
_VIN_PLAIN_MIN, _VIN_PLAIN_MAX = 90.0, 300.0

# Divisor per field per entry scale.
_DIVISORS = {
    SCALE_CENTI: {'vin': 100.0, 'iin': 1000.0, 'pin': 1.0, 'temp': 1.0, 'fan': 1.0},
    SCALE_PLAIN: {'vin': 1.0, 'iin': 1.0, 'pin': 1.0, 'temp': 1.0, 'fan': 1.0},
}

# Plausibility band per field, applied after scaling. Wide on purpose: these
# only have to separate a reading from a value that is a thousand times off,
# not to judge the health of the supply. 90-300 V covers a 110 V site as well
# as this one; measured here 2026-08-28: 218.5-225.75 V, 0.48-16.53 A,
# 107-3632 W, 32-49.8 C, 6504-10352 RPM.
_RANGES = {
    'vin': (_VIN_PLAIN_MIN, _VIN_PLAIN_MAX),
    'iin': (0.0, 40.0),
    'pin': (0.0, 10000.0),
    'temp': (-20.0, 150.0),
    'fan': (0.0, 30000.0),
}

# Record field -> the keys it may arrive under. `fanspeed` is the v3 spelling.
_SOURCE_KEYS = {
    'vin': ('vin',),
    'iin': ('iin',),
    'pin': ('pin',),
    'temp': ('temp0',),
    'fan': ('fan_speed', 'fanspeed'),
}


def _number(raw):
    """
    (value, dotted) for a raw field, or None if it is not a number at all.

    `dotted` says the miner wrote a decimal point, which means the value is
    already in engineering units and must not be rescaled.
    """
    if raw is None or isinstance(raw, bool):
        return None
    if isinstance(raw, str):
        raw = raw.strip()
        if not raw:
            return None
        try:
            return float(raw), ('.' in raw)
        except ValueError:
            return None
    if isinstance(raw, (int, float)):
        value = float(raw)
        return value, (value != int(value))
    return None


def _first_present(payload: Dict, field: str):
    """The raw value for a record field, under whichever key it arrived."""
    for key in _SOURCE_KEYS[field]:
        if key in payload:
            return payload[key]
    return None


def payload_of(response) -> Optional[Dict]:
    """
    The PSU payload inside a `get_psu` response, or None.

    Three shapes are accepted, because this API does not answer in one. The
    2026-08-28 sweep parsed only `{"STATUS":"S","Msg":{...}}` and five healthy
    machines -- which answer with the payload wrapped in a list -- read as
    unreachable. A parser here that knew one shape would repeat that silently,
    once per cycle, forever.
    """
    if not isinstance(response, dict):
        return None
    payload = response.get('Msg', response)
    if isinstance(payload, (list, tuple)):
        payload = next((item for item in payload if isinstance(item, dict)), None)
    if not isinstance(payload, dict):
        return None
    return payload


def entry_scale(payload: Dict) -> Optional[str]:
    """
    Which encoding this response uses, decided by `vin`. None if neither fits.

    None is a refusal, not a default: every reading in the response is then
    withheld. A response whose voltage we cannot place is a response whose
    current and power we cannot place either.
    """
    number = _number(_first_present(payload, 'vin'))
    if number is None:
        return None
    value, dotted = number
    if not dotted and _VIN_CENTI_MIN <= value <= _VIN_CENTI_MAX:
        return SCALE_CENTI
    if _VIN_PLAIN_MIN <= value <= _VIN_PLAIN_MAX:
        return SCALE_PLAIN
    return None


def _resolve(raw, field: str, scale: str) -> Optional[float]:
    """One field, scaled and range-checked. None when it does not resolve."""
    number = _number(raw)
    if number is None:
        return None
    value, dotted = number
    value = value if dotted else value / _DIVISORS[scale][field]
    low, high = _RANGES[field]
    return value if low <= value <= high else None


def psu_from_get_psu(response) -> Optional[Dict]:
    """
    Normalised PSU readings from a `get_psu` response.

    Args:
        response: the decoded JSON, in any of the shapes payload_of() accepts.

    Returns:
        {'vin': volts, 'iin': amps, 'pin': watts, 'temp': celsius,
         'fan': rpm, 'psu_model': str} -- each value None if that field was
        absent or did not resolve -- or None if the response carries no PSU
        payload or its scale cannot be established.

        A field is judged on its own: a PSU that reports a voltage but no
        temperature publishes the voltage and stays silent about the
        temperature. `192.168.2.74` is exactly that case, and its silence is
        the correct reading -- absent is not zero (DMI-62).

    Never raises: a miner answering with anything unexpected must cost one
    absent reading, not a collection cycle.
    """
    payload = payload_of(response)
    if payload is None:
        return None
    scale = entry_scale(payload)
    if scale is None:
        return None

    readings = {
        field: _resolve(_first_present(payload, field), field, scale)
        for field in _SOURCE_KEYS
    }

    model = payload.get('model') or payload.get('name')
    readings['psu_model'] = model.strip() if isinstance(model, str) and model.strip() else None
    return readings
