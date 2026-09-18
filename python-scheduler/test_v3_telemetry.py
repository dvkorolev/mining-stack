"""
Unit tests for v3_telemetry.py (DMI-108): PSU output parsing, error-code
event dedup, the JSONL event log, and the collect() pass.

Every payload below is the real thing, captured from this fleet in the
2026-08-28 v3 sweep (~/mining-stack-artifacts/20260828-miner-api/v3sweep.json
on the dev Mac) -- not an invented shape. That is the point: the `error-code`
list's odd key/value layout (the code IS the key, `reason` rides along in the
same dict) and the 1970 stamps that motivate the plausibility guard were both
learned from these captures, and a fixture written from imagination would
have gotten both wrong.

Run standalone (no pytest, no pyasic, no network needed):
    python python-scheduler/test_v3_telemetry.py
"""

import asyncio
import json
import os
import tempfile
import unittest
from datetime import datetime, timedelta, timezone

from prometheus_client import REGISTRY

import v3_telemetry
from v3_telemetry import (
    BASELINE, NEW, UNCHANGED,
    ErrorDeduper, ErrorEventLog,
    parse_apiswitch, parse_error_codes, parse_psu_output, when_is_plausible,
)
from metrics import (
    expire_miner_error_last_happened, forget_miner,
    known_miner_ips, remove_miner_error_series, remove_miner_psu_v3_series,
)


# ============================================================================
# Real captured payloads (2026-08-28 v3 sweep)
# ============================================================================

# 192.168.2.101 "003": the power dict verbatim. vout 1390 is the raw value
# whose unit no source states -- see the v3_telemetry module docstring.
POWER_101 = {
    'type': 'P222B', 'mode': '1', 'hwversion': 'HA1230929',
    'swversion': '3442.1410', 'model': 'P222B', 'iin': 14.78, 'vin': 225.5,
    'vout': 1390, 'pin': 3332, 'fanspeed': 7800, 'temp0': 32,
    'sn': '8D234000457', 'vendor': '6',
}

# 192.168.2.122 "004": two codes, both stamped 1970 by a machine that lost
# its clock -- 275 on this machine is the code that ticks on trip days.
ERRORS_122 = [
    {'233': '1970-01-05 22:37:07'},
    {'275': '1970-01-12 00:15:53'},
]

# 192.168.2.53 "m30s1103": one code with a reason string -- the text that
# never goes into labels and only lives in the JSONL.
ERRORS_53 = [
    {'206': '1970-01-22 01:01:48',
     'reason': 'Power input voltage error, vin: 199.25/0.00/0.00V'},
]

# 192.168.2.58 "m601761": five codes, all with reasons and real dates.
ERRORS_58 = [
    {'320': '2026-08-07 23:06:30', 'reason': 'Slot0 temperature reading error'},
    {'542': '2026-08-25 19:17:16', 'reason': 'Slot2 reading chip id error'},
    {'560': '2026-08-25 01:48:29', 'reason': 'Slot0 loss balance'},
    {'561': '2026-08-25 19:14:28', 'reason': 'Slot1 loss balance'},
    {'562': '2026-08-25 01:48:29', 'reason': 'Slot2 loss balance'},
]


def device_info(power=None, error_code=None, apiswitch=None):
    """A `get.device.info` reply shaped like the fleet's, with only the
    parts a test cares about."""
    msg = {'miner': {'type': 'M30S++_VH95'}}
    if power is not None:
        msg['power'] = power
    if error_code is not None:
        msg['error-code'] = error_code
    if apiswitch is not None:
        msg['apiswitch'] = apiswitch
    return {'msg': msg}


def psu_sample(metric_name, ip, name, model, psu_model):
    return REGISTRY.get_sample_value(
        metric_name, {'ip': ip, 'name': name, 'model': model,
                      'psu_model': psu_model})


def event_sample(metric_name, ip, name, code):
    return REGISTRY.get_sample_value(
        metric_name, {'ip': ip, 'name': name, 'code': code})


def run(coro):
    return asyncio.run(coro)


# ============================================================================
# Parsing
# ============================================================================

class ParsePsuOutputTest(unittest.TestCase):

    def test_the_captured_101_power_dict(self):
        output = parse_psu_output(device_info(power=POWER_101)['msg'])
        self.assertEqual(output.vout, 1390.0)
        self.assertEqual(output.psu_model, 'P222B')

    def test_model_falls_back_to_type(self):
        power = dict(POWER_101, model=None)
        output = parse_psu_output(device_info(power=power)['msg'])
        self.assertEqual(output.psu_model, 'P222B')

    def test_no_power_dict_means_no_output(self):
        # .74/.78 never answer on 4433 at all; a machine that answers without
        # a power dict is the same absence.
        self.assertIsNone(parse_psu_output(device_info()['msg']))
        self.assertIsNone(parse_psu_output(None))
        self.assertIsNone(parse_psu_output({'power': 'broken'}))

    def test_an_unparseable_vout_is_absent_not_zero(self):
        power = dict(POWER_101, vout='--')
        output = parse_psu_output(device_info(power=power)['msg'])
        self.assertIsNone(output.vout)
        self.assertEqual(output.psu_model, 'P222B')

    def test_vout_as_a_string_number_still_parses(self):
        power = dict(POWER_101, vout='1365')
        output = parse_psu_output(device_info(power=power)['msg'])
        self.assertEqual(output.vout, 1365.0)


class ParseApiswitchTest(unittest.TestCase):

    def test_the_captured_values(self):
        # .101 reports "0"; .40 reports "1".
        self.assertEqual(parse_apiswitch(device_info(apiswitch='0')['msg']), 0)
        self.assertEqual(parse_apiswitch(device_info(apiswitch='1')['msg']), 1)

    def test_numeric_and_boolean_forms(self):
        self.assertEqual(parse_apiswitch({'apiswitch': 1}), 1)
        self.assertEqual(parse_apiswitch({'apiswitch': True}), 1)
        self.assertEqual(parse_apiswitch({'apiswitch': 0}), 0)

    def test_anything_else_is_absent(self):
        self.assertIsNone(parse_apiswitch({'apiswitch': 'on'}))
        self.assertIsNone(parse_apiswitch({'apiswitch': 2}))
        self.assertIsNone(parse_apiswitch({}))
        self.assertIsNone(parse_apiswitch(None))


class ParseErrorCodesTest(unittest.TestCase):

    def test_the_captured_122_list(self):
        entries = parse_error_codes(device_info(error_code=ERRORS_122)['msg'])
        self.assertEqual(
            [(e.code, e.when_machine, e.reason) for e in entries],
            [('233', '1970-01-05 22:37:07', None),
             ('275', '1970-01-12 00:15:53', None)])

    def test_the_captured_53_entry_keeps_its_reason(self):
        entries = parse_error_codes(device_info(error_code=ERRORS_53)['msg'])
        self.assertEqual(len(entries), 1)
        self.assertEqual(entries[0].code, '206')
        self.assertIn('vin: 199.25', entries[0].reason)

    def test_the_captured_58_list(self):
        entries = parse_error_codes(device_info(error_code=ERRORS_58)['msg'])
        self.assertEqual([e.code for e in entries],
                         ['320', '542', '560', '561', '562'])
        self.assertTrue(all(e.reason for e in entries))

    def test_an_empty_list_is_valid_89_answers_so(self):
        self.assertEqual(parse_error_codes(device_info(error_code=[])['msg']), [])

    def test_absent_key_and_garbage_shapes(self):
        self.assertEqual(parse_error_codes(device_info()['msg']), [])
        self.assertEqual(parse_error_codes(None), [])
        self.assertEqual(parse_error_codes({'error-code': None}), [])
        self.assertEqual(
            parse_error_codes({'error-code': [None, 42, {'reason': 'x'}]}), [])

    def test_a_non_string_when_is_kept_as_none(self):
        entries = parse_error_codes({'error-code': [{'206': 12345}]})
        self.assertEqual(entries[0].when_machine, None)


class PlausibilityTest(unittest.TestCase):
    """The clock-step guard: 12 of 18 machines stamped 1970 before DMI-82."""

    def test_a_1970_stamp_is_implausible(self):
        self.assertFalse(when_is_plausible('1970-01-12 00:15:53'))

    def test_a_real_past_date_is_plausible(self):
        self.assertTrue(when_is_plausible('2026-08-16 13:34:24'))

    def test_machine_now_is_plausible(self):
        # The machine's own "now" (UTC + 3h, naive like its stamps) must
        # pass: the future bound is slack for drift, not a wall it hits.
        now = 1789700000.0
        machine_now = datetime.fromtimestamp(now, timezone.utc).replace(
            tzinfo=None) + timedelta(hours=3)
        self.assertTrue(when_is_plausible(
            machine_now.strftime('%Y-%m-%d %H:%M:%S'), now=now))

    def test_far_future_is_implausible(self):
        self.assertFalse(when_is_plausible('2027-06-01 00:00:00'))
        self.assertFalse(when_is_plausible('2026-01-01 00:00:00', now=1))

    def test_before_2026_is_implausible_even_if_not_1970(self):
        self.assertFalse(when_is_plausible('2025-12-31 23:59:59'))

    def test_unparseable_and_missing_are_implausible(self):
        self.assertFalse(when_is_plausible('16.08.2026 13:34'))
        self.assertFalse(when_is_plausible(None))
        self.assertFalse(when_is_plausible(''))


# ============================================================================
# Dedup state machine
# ============================================================================

class ErrorDeduperTest(unittest.TestCase):

    def test_first_sighting_then_repeat_then_change(self):
        deduper = ErrorDeduper()
        self.assertEqual(deduper.observe('.122', '275', '2026-09-18 11:00:00'),
                         BASELINE)
        self.assertEqual(deduper.observe('.122', '275', '2026-09-18 11:00:00'),
                         UNCHANGED)
        self.assertEqual(deduper.observe('.122', '275', '2026-09-18 12:00:00'),
                         NEW)

    def test_codes_are_independent_per_machine(self):
        deduper = ErrorDeduper()
        deduper.observe('.122', '275', '2026-09-18 11:00:00')
        self.assertEqual(deduper.observe('.101', '275', '2026-09-18 11:00:00'),
                         BASELINE)
        self.assertEqual(deduper.observe('.122', '233', '2026-09-18 11:00:00'),
                         BASELINE)

    def test_priming_from_jsonl_records(self):
        records = [
            {'ip': '.122', 'code': '275', 'when_machine': '2026-09-18 11:00:00'},
            {'ip': '.122', 'code': '233', 'when_machine': '1970-01-05 22:37:07'},
            {'ip': '.122', 'code': '275', 'when_machine': '2026-09-18 12:00:00'},
        ]
        deduper = ErrorDeduper()
        self.assertEqual(deduper.prime(records), 2)  # last occurrence wins
        self.assertEqual(deduper.observe('.122', '275', '2026-09-18 12:00:00'),
                         UNCHANGED)
        self.assertEqual(deduper.observe('.122', '275', '2026-09-18 13:00:00'),
                         NEW)
        self.assertEqual(deduper.observe('.122', '233', '1970-01-05 22:37:07'),
                         UNCHANGED)


# ============================================================================
# JSONL event log
# ============================================================================

class ErrorEventLogTest(unittest.TestCase):

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.log = ErrorEventLog(self.tmp.name, max_bytes=4096)

    def lines(self, path=None):
        path = path or self.log.path
        if not os.path.exists(path):
            return []
        with open(path, encoding='utf-8') as handle:
            return [l for l in handle.read().splitlines() if l]

    def test_append_then_tail_round_trip(self):
        self.log.append({'ts': 1789700000, 'ip': '192.168.2.53',
                         'code': '207', 'when_machine': '2026-09-18 11:24:59',
                         'reason': 'Power input current protecting',
                         'baseline': False, 'counted': True})
        records = self.log.tail()
        self.assertEqual(len(records), 1)
        self.assertEqual(records[0]['code'], '207')
        self.assertIn('reason', records[0])

    def test_rotation_moves_old_lines_out_and_keeps_appending(self):
        for i in range(60):
            self.log.append({'ts': i, 'ip': '.122', 'code': '275',
                             'when_machine': '2026-09-18 11:%02d:00' % i,
                             'baseline': False, 'counted': True})

        rotated = [f for f in os.listdir(self.tmp.name)
                   if f.startswith('errors-')]
        self.assertTrue(rotated, 'a rotated file must exist')
        self.assertTrue(self.lines(os.path.join(self.tmp.name, rotated[0])))
        # The live file has only what came after rotation, and tail() reads it.
        current_records = self.log.tail()
        self.assertTrue(current_records)
        self.assertEqual(current_records[-1]['ts'], 59)

    def test_append_never_raises_on_an_unwritable_directory(self):
        log = ErrorEventLog(os.path.join(self.tmp.name, 'nope', 'deeper'))
        # Directory does not exist and was never ensure_dir()'d.
        self.assertFalse(log.append({'ts': 1, 'ip': 'x', 'code': '1',
                                     'when_machine': None,
                                     'baseline': True, 'counted': False}))
        self.assertEqual(log.append_failures, 1)

    def test_tail_skips_garbage_and_partial_lines(self):
        with open(self.log.path, 'w', encoding='utf-8') as handle:
            handle.write('{"ts": 1, "ip": "a", "code": "1", '
                         '"when_machine": "w1"}\n')
            handle.write('not json at all\n')
            handle.write('{"ts": 2, "ip": "b"')  # truncated, no newline
        records = self.log.tail()
        self.assertEqual([r['ip'] for r in records], ['a'])

    def test_ensure_dir_creates_nested_directories(self):
        log = ErrorEventLog(os.path.join(self.tmp.name, 'events', 'deep'))
        log.ensure_dir()
        self.assertTrue(os.path.isdir(log.directory))


# ============================================================================
# The collect() pass, over fake transports
# ============================================================================

class CollectTest(unittest.TestCase):
    """
    collect() with an injected _fetch: no network, real payload shapes.

    Each test gets fresh module state and its own event directory, and uses
    an ip nothing else touches so the shared prometheus registry stays clean.
    """

    def setUp(self):
        v3_telemetry._reset_for_tests()
        self.addCleanup(v3_telemetry._reset_for_tests)
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        v3_telemetry.init(self.tmp.name)

    @staticmethod
    def fetch_map(responses):
        """A fake transport serving `responses` by ip, recording calls."""
        calls = []

        async def fetch(ip):
            calls.append(ip)
            reply = responses.get(ip)
            if isinstance(reply, Exception):
                raise reply
            return reply

        return fetch, calls

    def collect(self, miners, responses, concurrency=5):
        fetch, calls = self.fetch_map(responses)
        summary = run(v3_telemetry.collect(miners, concurrency, _fetch=fetch))
        return summary, calls

    def read_events(self):
        path = os.path.join(self.tmp.name, 'errors.jsonl')
        if not os.path.exists(path):
            return []
        with open(path, encoding='utf-8') as handle:
            return [json.loads(l) for l in handle if l.strip()]

    def test_baseline_pass_records_without_counting(self):
        # Plan 8.4: the first pass after deploy records the machines' current
        # error-code state as a baseline and does not manufacture events.
        miners = [{'ip': '10.0.7.1', 'name': '004', 'model': 'M30S++_VH90'}]
        summary, _ = self.collect(
            miners, {'10.0.7.1': device_info(error_code=ERRORS_122)})

        self.assertEqual(summary['answered'], 1)
        self.assertEqual(summary['events_baseline'], 2)
        self.assertEqual(summary['events_new'], 0)
        events = self.read_events()
        self.assertEqual({e['code'] for e in events}, {'233', '275'})
        self.assertTrue(all(e['baseline'] for e in events))
        self.assertTrue(all(not e['counted'] for e in events))
        self.assertIsNone(event_sample('miner_error_events_total',
                                       '10.0.7.1', '004', '275'))

    def test_unchanged_codes_produce_nothing_on_the_second_pass(self):
        miners = [{'ip': '10.0.7.2', 'name': 'm60_1', 'model': 'M60_VH30'}]
        reply = device_info(error_code=[
            {'275': '2026-08-16 13:34:24',
             'reason': 'Power over-temperature warning. code: 0x40000000000'}])
        self.collect(miners, {'10.0.7.2': reply})
        before = self.read_events()
        summary, _ = self.collect(miners, {'10.0.7.2': reply})

        self.assertEqual(summary['events_new'], 0)
        self.assertEqual(summary['events_baseline'], 0)
        self.assertEqual(self.read_events(), before)
        self.assertIsNone(event_sample('miner_error_events_total',
                                       '10.0.7.2', 'm60_1', '275'))

    def test_a_new_plausible_stamp_counts(self):
        miners = [{'ip': '10.0.7.3', 'name': 'm60_1', 'model': 'M60_VH30'}]
        self.collect(miners, {'10.0.7.3': device_info(error_code=[
            {'275': '2026-09-17 10:05:00'}])})
        summary, _ = self.collect(miners, {'10.0.7.3': device_info(error_code=[
            {'275': '2026-09-18 09:40:00'}])})

        self.assertEqual(summary['events_new'], 1)
        events = self.read_events()
        self.assertEqual(events[-1]['counted'], True)
        self.assertEqual(events[-1]['baseline'], False)
        self.assertEqual(event_sample('miner_error_events_total',
                                      '10.0.7.3', 'm60_1', '275'), 1.0)
        self.assertIsNotNone(event_sample('miner_error_last_happened_seconds',
                                          '10.0.7.3', 'm60_1', '275'))

    def test_a_restamped_1970_code_is_recorded_but_not_counted(self):
        # The clock-step shape: the when changes, so it IS a new record, but
        # the date is implausible and the counter must not move.
        miners = [{'ip': '10.0.7.4', 'name': '004', 'model': 'M30S++_VH90'}]
        self.collect(miners, {'10.0.7.4': device_info(error_code=ERRORS_122)})
        summary, _ = self.collect(miners, {'10.0.7.4': device_info(error_code=[
            {'233': '1970-01-05 22:37:07'},
            {'275': '1970-02-01 08:00:00'}])})

        self.assertEqual(summary['events_new'], 1)
        self.assertEqual(summary['events_implausible'], 1)
        events = self.read_events()
        self.assertEqual(events[-1]['counted'], False)
        self.assertIsNone(event_sample('miner_error_events_total',
                                       '10.0.7.4', '004', '275'))

    def test_psu_output_and_apiswitch_are_published_with_the_psu_model(self):
        miners = [{'ip': '10.0.7.5', 'name': '003', 'model': 'M30S++_VH90'}]
        self.collect(miners, {'10.0.7.5': device_info(
            power=POWER_101, apiswitch='0')})
        self.addCleanup(remove_miner_psu_v3_series, '10.0.7.5')

        self.assertEqual(
            psu_sample('miner_psu_vout_raw', '10.0.7.5', '003',
                       'M30S++_VH90', 'P222B'), 1390.0)
        self.assertEqual(
            psu_sample('miner_apiswitch', '10.0.7.5', '003',
                       'M30S++_VH90', 'P222B'), 0.0)

    def test_apiswitch_one_is_published_as_one(self):
        miners = [{'ip': '10.0.7.6', 'name': 'm301', 'model': 'M30S_VH60'}]
        self.collect(miners, {'10.0.7.6': device_info(
            power=dict(POWER_101, vout=1432), apiswitch='1')})
        self.addCleanup(remove_miner_psu_v3_series, '10.0.7.6')

        self.assertEqual(
            psu_sample('miner_apiswitch', '10.0.7.6', 'm301',
                       'M30S_VH60', 'P222B'), 1.0)

    def test_a_reply_without_power_publishes_no_psu_series(self):
        miners = [{'ip': '10.0.7.7', 'name': 'x', 'model': 'M50S'}]
        self.collect(miners, {'10.0.7.7': device_info(error_code=[])})
        self.addCleanup(remove_miner_psu_v3_series, '10.0.7.7')

        for psu_model in ('P222B', 'unknown'):
            self.assertIsNone(psu_sample(
                'miner_psu_vout_raw', '10.0.7.7', 'x', 'M50S', psu_model))

    def test_a_machine_that_stops_answering_loses_its_series_and_is_backed_off(self):
        miners = [{'ip': '10.0.7.8', 'name': '003', 'model': 'M30S++_VH90'}]
        self.collect(miners, {'10.0.7.8': device_info(power=POWER_101)})

        # Next cycle the machine is gone: no reply, series must not linger.
        summary, calls = self.collect(miners, {'10.0.7.8': None})
        self.assertIsNone(psu_sample(
            'miner_psu_vout_raw', '10.0.7.8', '003', 'M30S++_VH90', 'P222B'))

        # And the failure bought it a backoff: the next pass skips it.
        summary, calls = self.collect(miners, {'10.0.7.8': None})
        self.assertEqual(summary['backoff_skipped'], 1)
        self.assertEqual(calls, [])

    def test_one_machine_raising_does_not_abort_the_cycle(self):
        # The DMI-54 rule: one bad anything costs one machine's readings.
        miners = [{'ip': '10.0.7.9', 'name': 'bad', 'model': 'M30S'},
                  {'ip': '10.0.7.10', 'name': 'good', 'model': 'M30S++_VH90'}]
        summary, _ = self.collect(miners, {
            '10.0.7.9': RuntimeError('transport exploded'),
            '10.0.7.10': device_info(power=POWER_101),
        })
        self.addCleanup(remove_miner_psu_v3_series, '10.0.7.10')

        self.assertEqual(summary['answered'], 1)
        self.assertEqual(
            psu_sample('miner_psu_vout_raw', '10.0.7.10', 'good',
                       'M30S++_VH90', 'P222B'), 1390.0)

    def test_primed_state_survives_a_restart_without_duplicates(self):
        # The acceptance shape from the plan: restart the "container" (fresh
        # module state, same event directory) and the codes already on disk
        # must neither re-fire nor duplicate.
        miners = [{'ip': '10.0.7.11', 'name': '004', 'model': 'M30S++_VH90'}]
        reply = device_info(error_code=ERRORS_122)
        self.collect(miners, {'10.0.7.11': reply})
        before = self.read_events()

        v3_telemetry._reset_for_tests()
        primed = v3_telemetry.init(self.tmp.name)
        self.assertEqual(primed['primed'], 2)

        summary, _ = self.collect(miners, {'10.0.7.11': reply})
        self.assertEqual(summary['events_new'], 0)
        self.assertEqual(summary['events_baseline'], 0)
        self.assertEqual(self.read_events(), before)

    def test_an_event_that_happened_while_down_is_recorded_after_restart(self):
        miners = [{'ip': '10.0.7.12', 'name': '004', 'model': 'M30S++_VH90'}]
        self.collect(miners, {'10.0.7.12': device_info(
            error_code=[{'275': '2026-09-16 20:00:00'}])})

        v3_telemetry._reset_for_tests()
        v3_telemetry.init(self.tmp.name)
        summary, _ = self.collect(miners, {'10.0.7.12': device_info(
            error_code=[{'275': '2026-09-18 04:00:00'}])})

        self.assertEqual(summary['events_new'], 1)
        self.assertEqual(
            event_sample('miner_error_events_total', '10.0.7.12', '004', '275'),
            1.0)

    def test_forget_dedup_state_and_series(self):
        miners = [{'ip': '10.0.7.13', 'name': 'gone', 'model': 'M30S'}]
        self.collect(miners, {'10.0.7.13': device_info(
            power=POWER_101,
            error_code=[{'275': '2026-09-18 01:00:00'}])})
        self.collect(miners, {'10.0.7.13': device_info(
            power=POWER_101,
            error_code=[{'275': '2026-09-18 02:00:00'}])})
        self.assertIn('10.0.7.13', known_miner_ips())

        forget_miner('10.0.7.13')
        v3_telemetry.forget('10.0.7.13')

        self.assertIsNone(psu_sample(
            'miner_psu_vout_raw', '10.0.7.13', 'gone', 'M30S', 'P222B'))
        self.assertIsNone(event_sample(
            'miner_error_events_total', '10.0.7.13', 'gone', '275'))
        self.assertNotIn('10.0.7.13', known_miner_ips())

        # And if it ever comes back, it starts from a baseline again rather
        # than manufacturing an event against the forgotten state.
        summary, _ = self.collect(miners, {'10.0.7.13': device_info(
            power=POWER_101,
            error_code=[{'275': '2026-09-18 02:00:00'}])})
        self.assertEqual(summary['events_baseline'], 1)
        self.assertEqual(summary['events_new'], 0)


class ErrorEventSeriesCleanupTest(unittest.TestCase):
    """The cull paths for the new series, mirroring the DMI-94 test set."""

    NAME = 'worker'
    MODEL = 'M30S++_VH90_(Stock)'

    def setUp(self):
        v3_telemetry._reset_for_tests()
        self.addCleanup(v3_telemetry._reset_for_tests)

    def record(self, ip, code='275'):
        from metrics import record_miner_error_event
        record_miner_error_event(ip, self.NAME, code, 1789700000.0)

    def test_the_failure_streak_cull_expires_last_happened_but_keeps_the_counter(self):
        ip = '10.0.8.1'
        self.record(ip)
        self.addCleanup(remove_miner_error_series, ip)

        expire_miner_error_last_happened(ip)

        self.assertIsNone(event_sample('miner_error_last_happened_seconds',
                                       ip, self.NAME, '275'))
        self.assertEqual(event_sample('miner_error_events_total',
                                      ip, self.NAME, '275'), 1.0)

    def test_forget_miner_removes_counter_and_gauge(self):
        ip = '10.0.8.2'
        self.record(ip)

        forget_miner(ip)

        self.assertIsNone(event_sample('miner_error_events_total',
                                       ip, self.NAME, '275'))
        self.assertIsNone(event_sample('miner_error_last_happened_seconds',
                                       ip, self.NAME, '275'))

    def test_v3_psu_series_reach_the_streak_cull_and_forget(self):
        from metrics import set_miner_psu_v3
        ip = '10.0.8.3'
        set_miner_psu_v3(ip, self.NAME, self.MODEL,
                         {'vout': 1390.0, 'apiswitch': 0, 'psu_model': 'P222B'})

        remove_miner_psu_v3_series(ip)
        self.assertIsNone(psu_sample('miner_psu_vout_raw', ip, self.NAME,
                                     self.MODEL, 'P222B'))

        set_miner_psu_v3(ip, self.NAME, self.MODEL,
                         {'vout': 1390.0, 'apiswitch': 0, 'psu_model': 'P222B'})
        forget_miner(ip)
        self.assertIsNone(psu_sample('miner_psu_vout_raw', ip, self.NAME,
                                     self.MODEL, 'P222B'))
        self.assertIsNone(psu_sample('miner_apiswitch', ip, self.NAME,
                                     self.MODEL, 'P222B'))

    def test_new_series_stay_out_of_get_all_miner_metrics(self):
        # Same reason as DMI-94's PSU gauges: that list feeds positional
        # four-label removals; these carry psu_model/code instead.
        from metrics import get_all_miner_metrics
        from metrics import miner_psu_vout_raw, miner_apiswitch
        registered = set(get_all_miner_metrics())
        for metric in (miner_psu_vout_raw, miner_apiswitch):
            self.assertNotIn(metric, registered)


if __name__ == '__main__':
    unittest.main(verbosity=2)
