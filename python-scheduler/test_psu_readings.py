#!/usr/bin/env python3
"""
Tests for parsers/psu_readings.py (DMI-94).

Every fixture here is a verbatim reading taken from the fleet on 2026-08-28, in
one of the two shapes this API answers in. The point of the suite is the scale:
the same quantity arrives as `vin "22200"` from one machine and `vin: 225.5`
from another, and a parser that guessed would publish a 22200 V mains or a
0.015 A supply without anything downstream noticing.
"""

import unittest

from parsers.psu_readings import (
    SCALE_CENTI,
    SCALE_PLAIN,
    entry_scale,
    payload_of,
    psu_from_get_psu,
)


def v2(vin, iin, pin, model='P221B', **extra):
    """A v2/4028 `get_psu` response: STATUS envelope, every value a string."""
    msg = {'name': model, 'hw_version': 'WW1240201', 'sw_version': '5221.1312',
           'model': model, 'enable': '1', 'iin': iin, 'vin': vin, 'pin': pin,
           'serial_no': '21241001004', 'vendor': '6'}
    msg.update(extra)
    return {'STATUS': 'S', 'When': 1817028, 'Code': 131, 'Msg': msg, 'Description': ''}


class TestV2Responses(unittest.TestCase):
    """The canonical shape: centivolts, milliamps, watts as-is."""

    def test_117_verbatim_response(self):
        # The exact response recorded from 192.168.2.117 on 2026-08-28.
        response = {"STATUS": "S", "When": 1817028, "Code": 131, "Msg": {
            "name": "P222C", "hw_version": "WW1240201", "sw_version": "5221.1312",
            "model": "P222C", "enable": "1", "iin": "976", "vin": "21975",
            "pin": "214", "fan_speed": "9936", "serial_no": "21241001004",
            "vendor": "6", "temp0": "32.0"}, "Description": ""}
        psu = psu_from_get_psu(response)
        self.assertEqual(psu['vin'], 219.75)
        self.assertEqual(psu['iin'], 0.976)
        self.assertEqual(psu['pin'], 214.0)
        self.assertEqual(psu['temp'], 32.0)
        self.assertEqual(psu['fan'], 9936.0)
        self.assertEqual(psu['psu_model'], 'P222C')

    def test_healthy_machine(self):
        # 192.168.2.101, hashing 103 TH/s.
        psu = psu_from_get_psu(v2('22200', '15000', '3328', model='P222B',
                                  temp0='32.0', fan_speed='7768'))
        self.assertEqual((psu['vin'], psu['iin'], psu['pin']), (222.0, 15.0, 3328.0))
        self.assertEqual((psu['temp'], psu['fan']), (32.0, 7768.0))
        self.assertEqual(psu['psu_model'], 'P222B')

    def test_dead_machine_current_is_the_signal(self):
        # 192.168.2.58: idle, faulty, and drawing an order of magnitude less
        # current than the nineteen live machines (0.998 A against 13.2-16.5).
        # This reading is the whole reason the metric exists.
        psu = psu_from_get_psu(v2('22175', '998', '153', temp0='49.5', fan_speed='6688'))
        self.assertEqual(psu['iin'], 0.998)
        self.assertEqual(psu['vin'], 221.75)
        self.assertEqual(psu['pin'], 153.0)
        self.assertEqual(psu['temp'], 49.5)   # hot while doing nothing

    def test_missing_field_is_absent_not_zero(self):
        # 192.168.2.74 reports every PSU field except its temperature.
        psu = psu_from_get_psu(v2('22225', '15109', '3352', model='P222B', fan_speed='7472'))
        self.assertIsNone(psu['temp'])
        self.assertEqual(psu['vin'], 222.25)
        self.assertEqual(psu['fan'], 7472.0)

    def test_scale_is_per_field_not_per_response(self):
        # The trap in one assertion: three different encodings, one response.
        psu = psu_from_get_psu(v2('22000', '16500', '3624', temp0='40.0', fan_speed='8608'))
        self.assertEqual(psu['vin'], 220.0)     # /100
        self.assertEqual(psu['iin'], 16.5)      # /1000
        self.assertEqual(psu['pin'], 3624.0)    # as-is

    def test_entry_scale_is_centi(self):
        self.assertEqual(entry_scale(payload_of(v2('22200', '15000', '3328'))), SCALE_CENTI)


class TestV3ShapedResponses(unittest.TestCase):
    """The same fields as plain floats, which must not be rescaled."""

    def test_plain_floats(self):
        response = {'STATUS': 'S', 'Msg': {
            'model': 'P222B', 'vin': 225.5, 'iin': 14.78, 'pin': 3332,
            'temp0': 32, 'fanspeed': 7800}}
        psu = psu_from_get_psu(response)
        self.assertEqual((psu['vin'], psu['iin'], psu['pin']), (225.5, 14.78, 3332.0))
        self.assertEqual((psu['temp'], psu['fan']), (32.0, 7800.0))
        self.assertEqual(psu['psu_model'], 'P222B')

    def test_integer_current_is_amps_not_milliamps(self):
        # The ambiguity that forces the entry scale to be anchored on `vin`:
        # a bare 15 is 15 A here and would be 0.015 A in the v2 encoding, and
        # both are inside the plausible current range.
        psu = psu_from_get_psu({'Msg': {'model': 'P221B', 'vin': 225.0, 'iin': 15,
                                        'pin': 3372, 'temp0': 33, 'fanspeed': 8128}})
        self.assertEqual(psu['iin'], 15.0)

    def test_entry_scale_is_plain(self):
        payload = payload_of({'Msg': {'vin': 225.5, 'iin': 14.78}})
        self.assertEqual(entry_scale(payload), SCALE_PLAIN)


class TestResponseShapes(unittest.TestCase):
    """
    One API, several envelopes. The 2026-08-28 sweep parsed a single shape and
    five healthy machines read as unreachable; a collector doing that would
    repeat it every cycle, silently.
    """

    def test_msg_as_list(self):
        psu = psu_from_get_psu({'STATUS': 'S', 'Msg': [
            {'model': 'P221A', 'vin': '22025', 'iin': '15703', 'pin': '3456'}]})
        self.assertEqual(psu['vin'], 220.25)
        self.assertEqual(psu['psu_model'], 'P221A')

    def test_bare_payload(self):
        psu = psu_from_get_psu({'model': 'P221B', 'vin': '22000', 'iin': '16500', 'pin': '3624'})
        self.assertEqual(psu['vin'], 220.0)

    def test_model_falls_back_to_name(self):
        response = v2('22000', '16500', '3624')
        del response['Msg']['model']
        self.assertEqual(psu_from_get_psu(response)['psu_model'], 'P221B')

    def test_missing_model_is_none(self):
        response = v2('22000', '16500', '3624')
        del response['Msg']['model']
        del response['Msg']['name']
        self.assertIsNone(psu_from_get_psu(response)['psu_model'])


class TestPublishesNothing(unittest.TestCase):
    """
    Every path that must produce no series at all rather than a zero. The DG1+
    at 192.168.2.78 speaks its own protocol and refuses 4028; a fleet-wide
    voltage aggregate containing a fabricated 0 V for it would be wrong in the
    direction that looks like an outage.
    """

    def test_no_answer(self):
        for response in (None, {}, [], 'nope', 0):
            self.assertIsNone(psu_from_get_psu(response), response)

    def test_error_response(self):
        self.assertIsNone(psu_from_get_psu({'STATUS': 'E', 'Msg': 'unknown command'}))

    def test_payload_without_voltage(self):
        self.assertIsNone(psu_from_get_psu({'Msg': {'model': 'P221B', 'iin': '15000'}}))

    def test_unresolvable_voltage_withholds_the_whole_record(self):
        # Neither a centivolt nor a volt reading. Nothing in the response can
        # be placed on a scale, so nothing is published -- including the
        # current and power, which on their own would have looked plausible.
        for vin in ('999999', 'abc', '', '42', None, True):
            self.assertIsNone(
                psu_from_get_psu(v2(vin, '15000', '3328')), f'vin={vin!r}')

    def test_out_of_range_field_only_drops_that_field(self):
        psu = psu_from_get_psu(v2('22000', '16500', '3624', temp0='999', fan_speed='8608'))
        self.assertIsNone(psu['temp'])
        self.assertEqual(psu['vin'], 220.0)
        self.assertEqual(psu['fan'], 8608.0)

    def test_garbage_fields_do_not_raise(self):
        psu = psu_from_get_psu(v2('22000', {'a': 1}, ['x'], temp0=None, fan_speed='abc'))
        self.assertEqual(psu['vin'], 220.0)
        self.assertIsNone(psu['iin'])
        self.assertIsNone(psu['pin'])
        self.assertIsNone(psu['fan'])


class TestPowerIdentityIsNotAGate(unittest.TestCase):
    """
    vin * iin ~= pin holds on 38 of the 40 readings we have, and using it to
    validate them is the mistake this test exists to prevent.
    """

    def test_identity_holds_on_a_healthy_psu(self):
        psu = psu_from_get_psu(v2('22200', '15000', '3328', model='P222B'))
        self.assertLess(abs(psu['vin'] * psu['iin'] - psu['pin']) / psu['pin'], 0.01)

    def test_failing_the_identity_does_not_withhold_anything(self):
        # 192.168.2.58 again, in both independent sweeps: 221.75 V x 0.998 A
        # is 221 VA against a reported 153 W, out by 44%. That is a real power
        # factor at near-zero load on an idle, faulty supply -- not a scale
        # error. Gating on the identity would blind the metric on precisely the
        # dead machine it is for (the DMI-87 shape), so every field must still
        # be published here.
        psu = psu_from_get_psu(v2('22175', '998', '153', temp0='49.5', fan_speed='6688'))
        deviation = abs(psu['vin'] * psu['iin'] - psu['pin']) / psu['pin']
        self.assertGreater(deviation, 0.4)
        for field in ('vin', 'iin', 'pin', 'temp', 'fan'):
            self.assertIsNotNone(psu[field], field)


if __name__ == '__main__':
    unittest.main()
