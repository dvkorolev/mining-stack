"""
Unit tests for asic/parity.py — pyasic 0.60.0's field selection, reproduced.

DMI-136: our CGMiner path becomes primary, and the phase's rule is that no
published value changes, so the tests pin the *source field* each published
value comes from, not just a plausible number.

The fixtures are real 4028 responses captured from the farm on 2026-09-18
(worker accounts, serials and addresses stripped), one per response shape:

    whatsminer_summary_shape.json           `.101`, SUMMARY nested shape
    whatsminer_msg_shape.json               `.53`,  Msg shape
    whatsminer_hashboards_parseable.json    `.74`,  the one machine whose
                                            `devs` pyasic can parse at all

Run standalone (no pytest, no pyasic):
    python python-scheduler/test_asic_parity.py
"""

import json
import os
import unittest

from asic import parity

FIXTURES = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'parsers', 'fixtures')


def fixture(name: str) -> dict:
    with open(os.path.join(FIXTURES, name)) as handle:
        return json.load(handle)


SUMMARY_SHAPE = fixture('whatsminer_summary_shape.json')
MSG_SHAPE = fixture('whatsminer_msg_shape.json')
HASHBOARDS_PARSEABLE = fixture('whatsminer_hashboards_parseable.json')


class ResponseShape(unittest.TestCase):
    def test_summary_shape_is_detected(self):
        self.assertEqual(parity.response_shape(SUMMARY_SHAPE['summary']),
                         parity.SHAPE_SUMMARY)

    def test_msg_shape_is_detected(self):
        self.assertEqual(parity.response_shape(MSG_SHAPE['summary']),
                         parity.SHAPE_MSG)

    def test_both_shapes_are_not_the_same_view(self):
        # The whole reason this module exists: pyasic reads SUMMARY[0] and the
        # gap-filler reads Msg, and on a Msg-shaped machine SUMMARY is missing.
        self.assertEqual(parity.summary_view(MSG_SHAPE['summary']), {})
        self.assertEqual(parity.msg_view(SUMMARY_SHAPE['summary']), {})

    def test_garbage_is_no_shape(self):
        for value in (None, {}, {'Msg': 'Summary'}, 'nonsense'):
            self.assertEqual(parity.response_shape(value), parity.SHAPE_NONE)


class Hashrate(unittest.TestCase):
    def test_summary_shape_uses_mhs_1m(self):
        value, source = parity.hashrate_ths(SUMMARY_SHAPE['summary'])
        raw = SUMMARY_SHAPE['summary']['SUMMARY'][0]['MHS 1m']
        self.assertEqual(source, 'summary.mhs_1m')
        self.assertAlmostEqual(value, raw / 1e6, places=6)

    def test_msg_shape_falls_back_to_mhs_av(self):
        # pyasic's own lookup raises KeyError here, and KeyError is a
        # LookupError, so the collector's gap-filler supplies the value.
        value, source = parity.hashrate_ths(MSG_SHAPE['summary'])
        raw = MSG_SHAPE['summary']['Msg']['MHS av']
        self.assertEqual(source, 'msg.mhs_av')
        self.assertAlmostEqual(value, raw / 1e6, places=6)

    def test_mhs_is_not_read_as_th(self):
        # The unit bug asic_profiles.yaml asserts (TH/s, scale 1.0). Reading it
        # that way would publish ~112 million TH/s for this machine.
        value, _ = parity.hashrate_ths(MSG_SHAPE['summary'])
        self.assertLess(value, 1000)

    def test_nothing_reported_is_none_not_zero(self):
        value, source = parity.hashrate_ths({'Msg': {}})
        self.assertIsNone(value)
        self.assertEqual(source, 'none')


class Power(unittest.TestCase):
    def test_summary_shape_uses_summary_power(self):
        value, source = parity.power_watts(SUMMARY_SHAPE['summary'])
        self.assertEqual(source, 'summary.power')
        self.assertEqual(value, SUMMARY_SHAPE['summary']['SUMMARY'][0]['Power'])

    def test_msg_shape_uses_msg_power(self):
        value, source = parity.power_watts(MSG_SHAPE['summary'])
        self.assertEqual(source, 'msg.power')
        self.assertEqual(value, MSG_SHAPE['summary']['Msg']['Power'])

    def test_minus_one_means_not_reported(self):
        value, source = parity.power_watts({'SUMMARY': [{'Power': -1}]})
        self.assertEqual(value, 0.0)
        self.assertEqual(source, 'none')


class Uptime(unittest.TestCase):
    def test_summary_shape_reads_elapsed(self):
        value, source = parity.uptime_seconds(SUMMARY_SHAPE['summary'])
        self.assertEqual(source, 'summary.elapsed')
        self.assertEqual(value, int(SUMMARY_SHAPE['summary']['SUMMARY'][0]['Elapsed']))

    def test_msg_shape_uses_msg_elapsed(self):
        # Measured 2026-09-18, against what pyasic's source suggests: the
        # published uptime on the Msg-shaped machines is real, so the Msg's
        # `Elapsed` is what the value has to come from.
        self.assertIn('Elapsed', MSG_SHAPE['summary']['Msg'])
        value, source = parity.uptime_seconds(MSG_SHAPE['summary'])
        self.assertEqual(source, 'msg.elapsed')
        self.assertEqual(value, int(MSG_SHAPE['summary']['Msg']['Elapsed']))

    def test_no_elapsed_anywhere_is_zero(self):
        self.assertEqual(parity.uptime_seconds({'Msg': {'Power': 1}}), (0, 'none'))


class Fans(unittest.TestCase):
    def test_summary_shape_publishes_fan_in_and_out(self):
        # DMI-192 must not move this: the native view carries the pair, so a
        # SUMMARY-shaped machine reads exactly the view pyasic read.
        speeds, source = parity.fan_speeds(SUMMARY_SHAPE['summary'], 'M30S++ VH90 (Stock)')
        self.assertEqual(source, 'summary.fan_speed_in_out')
        self.assertEqual(speeds['0'], SUMMARY_SHAPE['summary']['SUMMARY'][0]['Fan Speed In'])
        self.assertEqual(speeds['1'], SUMMARY_SHAPE['summary']['SUMMARY'][0]['Fan Speed Out'])

    def test_msg_shape_reads_fans_from_msg(self):
        # DMI-192, and a deliberate published-value change: pyasic's
        # `SUMMARY[0].get("Fan Speed In", 0)` default fires on this machine and
        # publishes a fabricated 0 RPM, while the real speeds sit one level down
        # in `Msg`. Ours reads them, and says which view they came from.
        speeds, source = parity.fan_speeds(MSG_SHAPE['summary'], 'M30S++ VH40 (Stock)')
        msg = MSG_SHAPE['summary']['Msg']
        self.assertEqual(source, 'msg.fan_speed_in_out')
        self.assertEqual(speeds['0'], msg['Fan Speed In'])
        self.assertEqual(speeds['1'], msg['Fan Speed Out'])
        self.assertGreater(speeds['0'], 0)

    def test_the_native_view_wins_when_it_can_supply_the_pair(self):
        # Precedence, not just presence: a response carrying both views is still
        # read from `SUMMARY`, so the fallback cannot silently take over.
        both = dict(SUMMARY_SHAPE['summary'])
        both['Msg'] = dict(MSG_SHAPE['summary']['Msg'])
        speeds, source = parity.fan_speeds(both, 'M30S++ VH90 (Stock)')
        self.assertEqual(source, 'summary.fan_speed_in_out')
        self.assertEqual(speeds['0'], SUMMARY_SHAPE['summary']['SUMMARY'][0]['Fan Speed In'])

    def test_a_native_view_without_fan_fields_falls_back_to_msg(self):
        response = {'SUMMARY': [{'Power': 3301}],
                    'Msg': {'Fan Speed In': 1000, 'Fan Speed Out': 1100}}
        speeds, source = parity.fan_speeds(response, 'M30S++ VH90 (Stock)')
        self.assertEqual(source, 'msg.fan_speed_in_out')
        self.assertEqual(speeds, {'0': 1000.0, '1': 1100.0})

    def test_nothing_reported_publishes_no_series(self):
        # No fan series, and no invented value standing in for one. The native
        # view being absent is what `summary.absent` names.
        self.assertEqual(parity.fan_speeds({'Msg': {'Power': 1}}, 'M30S++ VH90 (Stock)'),
                         ({}, 'summary.absent'))
        self.assertEqual(parity.fan_speeds({'SUMMARY': [{'Power': 1}]}, 'M30S++ VH90 (Stock)'),
                         ({}, 'summary.fan_speed_absent'))

    def test_the_two_fan_tokens_do_not_canonicalise_together(self):
        # Contrast `msg.elapsed`, which *does* collapse onto `summary.elapsed`
        # because both shapes carry the same `Elapsed` field. pyasic's fan value
        # never comes from `Msg`, so this pair must stay distinct (DMI-192).
        self.assertEqual(parity.canonical_source('msg.fan_speed_in_out'),
                         'msg.fan_speed_in_out')
        self.assertNotEqual(parity.canonical_source('msg.fan_speed_in_out'),
                            parity.canonical_source('summary.fan_speed_in_out'))

    def test_expected_fans_is_two_for_the_fleet(self):
        # Measured against pyasic 0.60.0's registry on 2026-09-18: every class
        # this fleet resolves to inherits BaseMiner.expected_fans = 2.
        for model in ('M30S++ VH90 (Stock)', 'M50 VH70 (Stock)', 'M60 VK6A (Stock)',
                      'WhatsMiner (Stock)'):
            self.assertEqual(parity.expected_fans(model), 2, model)

    def test_a_class_pyasic_declares_fanless_publishes_nothing(self):
        speeds, source = parity.fan_speeds(SUMMARY_SHAPE['summary'], 'M63S')
        self.assertEqual(speeds, {})
        self.assertEqual(source, 'pyasic.expected_fans=0')


class Boards(unittest.TestCase):
    def test_only_the_parseable_machine_is_flagged(self):
        self.assertTrue(parity.hashboards_parsed_by_pyasic(HASHBOARDS_PARSEABLE['devs']))
        self.assertFalse(parity.hashboards_parsed_by_pyasic(SUMMARY_SHAPE['devs']))
        self.assertFalse(parity.hashboards_parsed_by_pyasic(MSG_SHAPE['devs']))

    def test_temperature_is_pyasics_rounded_chip_average_when_boards_parse(self):
        value, source = parity.pyasic_temperature_c(HASHBOARDS_PARSEABLE['devs'])
        self.assertEqual(source, 'pyasic.hashboards')
        # Every entry has `ASC`, so pyasic's board parse completes and the
        # headline temperature is the rounded Chip Temp Avg, not the board
        # temperature -- measured 90.0 against a board of 74.69 on this machine.
        self.assertEqual(value, 90)
        self.assertGreater(value, max(e['Temperature'] for e in HASHBOARDS_PARSEABLE['devs']['DEVS']))

    def test_temperature_is_zero_when_pyasic_cannot_parse_boards(self):
        # Zero here means "apply the gap-filler", never "0 degrees".
        self.assertEqual(parity.pyasic_temperature_c(SUMMARY_SHAPE['devs']), (0.0, 'none'))
        self.assertEqual(parity.pyasic_temperature_c(MSG_SHAPE['devs']), (0.0, 'none'))

    def test_pyasic_board_readings_round_and_use_chip_average(self):
        readings = parity.pyasic_board_readings(HASHBOARDS_PARSEABLE['devs'])
        first = HASHBOARDS_PARSEABLE['devs']['DEVS'][0]
        self.assertEqual(readings['0']['temp'], round(first['Temperature']))
        self.assertEqual(readings['0']['chip_temp'], round(first['Chip Temp Avg']))
        self.assertAlmostEqual(readings['0']['hashrate'], first['MHS 1m'] / 1e6, places=6)


class ErrorsLedAndMining(unittest.TestCase):
    def test_error_count_counts_the_codes_not_the_response(self):
        count, source = parity.error_count(SUMMARY_SHAPE['summary'], SUMMARY_SHAPE['get_error_code'])
        codes = SUMMARY_SHAPE['get_error_code']['Msg']['error_code']
        self.assertEqual(source, 'get_error_code')
        self.assertEqual(count, len(codes))

    def test_no_codes_counts_zero(self):
        self.assertEqual(parity.error_count({'Msg': {}}, {'Msg': {'error_code': []}}),
                         (0, 'none'))

    def test_summary_error_code_count_is_added_too(self):
        # pyasic adds one error per `Error Code i` present. No machine in this
        # fleet reports the field, but a firmware that starts to must be
        # double-counted with it, because pyasic would be.
        count, _ = parity.error_count(
            {'SUMMARY': [{'Error Code Count': 2, 'Error Code 0': 205, 'Error Code 1': 206}]},
            {'Msg': {'error_code': [{'205': 'ts'}]}})
        self.assertEqual(count, 3)

    def test_fault_light_is_off_when_ledstat_is_auto(self):
        self.assertEqual(parity.fault_light(SUMMARY_SHAPE['get_miner_info']), (False, 'get_miner_info.ledstat'))

    def test_fault_light_is_on_for_anything_else(self):
        self.assertEqual(parity.fault_light({'Msg': {'ledstat': 'on'}}), (True, 'get_miner_info.ledstat'))

    def test_fault_light_is_false_when_the_call_failed(self):
        self.assertEqual(parity.fault_light(None), (False, 'none'))

    def test_mineroff_false_is_mining(self):
        self.assertEqual(parity.is_mining(SUMMARY_SHAPE['status']), (True, 'status.mineroff'))

    def test_mineroff_true_is_not_mining(self):
        self.assertEqual(parity.is_mining({'Msg': {'mineroff': 'true'}}), (False, 'status.mineroff'))

    def test_absent_mineroff_is_neither(self):
        # pyasic returns None here, and None is falsy downstream, so the
        # machine publishes is_mining = 0. `.74` is that machine today.
        value, source = parity.is_mining({'Msg': {'other': 1}})
        self.assertIsNone(value)
        self.assertEqual(source, 'status.mineroff_absent')

    def test_btmineroff_is_mining(self):
        self.assertEqual(parity.is_mining({'Msg': {'btmineroff': True}}), (True, 'status.btmineroff'))


class PoolsRouting(unittest.TestCase):
    def test_the_fleet_models_keep_their_pool_parsing(self):
        for model in ('M30S++ VH90 (Stock)', 'M50 VH70 (Stock)', 'WhatsMiner (Stock)'):
            self.assertTrue(parity.wants_cgminer_pools(model), model)

    def test_the_m60_is_left_out(self):
        # Verbatim the collector's own test, gap included: `.121` (M60) matches
        # none of its substrings, so its pool list stays pyasic's -- which for a
        # BTminer is empty -- and it publishes no pool series. It must not start.
        self.assertFalse(parity.wants_cgminer_pools('M60 VK6A (Stock)'))


if __name__ == '__main__':
    unittest.main(verbosity=2)
