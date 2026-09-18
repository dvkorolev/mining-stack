"""
Unit tests for parsers/reading_compare.py.

DMI-136's acceptance rests on this module: if it is too permissive, a real
change in a published value passes the parallel window unnoticed; if it is too
strict, every window drowns in noise and gets ignored. So the tolerances are
tested from both sides — a difference inside the band is not a finding, a
difference outside it is, and "absent" is never equal to "zero".

Run standalone (no pytest, no pyasic):
    python python-scheduler/test_reading_compare.py
"""

import unittest

from parsers.reading_compare import (RESULT_EXPECTED, RESULT_MISMATCH,
                                     RESULT_ONLY_OURS, RESULT_ONLY_PYASIC,
                                     RESULT_SOURCE, compare,
                                     split_results, summarise)


def base():
    return {
        'hashrate_ths': 102.4, 'power_watts': 3301.0, 'temp_max_c': 74.7,
        'uptime_seconds': 250000, 'efficiency': 32.0, 'state': 2, 'is_mining': 1,
        'fault_light_on': 0, 'errors_count': 2, 'scrape_status': 2,
        'pool_accepted': 5444, 'pool_rejected': 15,
        'fan:0': 6328, 'fan:1': 6217, 'psu:watts': 3400.0,
        'board_temp:0': 67.06, 'board_chip_temp:0': 83.54,
        'board_hashrate:0': 34.33, 'board_chips:0': 78,
        'pool_alive:stratum+tcp://pool.example:3333#1': 1,
    }


def fields(findings):
    return sorted(f['field'] for f in findings)


class Agreement(unittest.TestCase):
    def test_identical_readings_agree(self):
        self.assertEqual(compare(base(), base()), [])

    def test_ordinary_drift_is_not_a_finding(self):
        ours = base()
        ours['hashrate_ths'] = 102.4 * 1.005      # +0.5%
        ours['power_watts'] = 3301.0 * 1.005
        ours['fan:0'] = 6328 * 1.01
        ours['board_temp:0'] = 67.06 + 0.3
        self.assertEqual(compare(base(), ours), [])

    def test_counters_may_advance(self):
        ours = base()
        ours['uptime_seconds'] += 12        # two reads, seconds apart
        ours['pool_accepted'] += 3
        self.assertEqual(compare(base(), ours), [])


class Disagreement(unittest.TestCase):
    def test_a_hashrate_outside_the_band_is_a_finding(self):
        ours = base()
        ours['hashrate_ths'] = 112.9        # the MHS av vs MHS 1m difference
        findings = compare(base(), ours)
        self.assertEqual(fields(findings), ['hashrate_ths'])
        self.assertEqual(findings[0]['result'], RESULT_MISMATCH)

    def test_a_counter_slightly_lower_is_not_a_finding(self):
        # Which read happened first is arbitrary, so a counter a little lower on
        # one side is the clock, not a disagreement. Measured on `.74`/`.101`:
        # uptime differed by exactly the 2 s between the reads.
        ours = base()
        ours['uptime_seconds'] -= 2
        ours['pool_accepted'] -= 1
        self.assertEqual(compare(base(), ours), [])

    def test_a_counter_that_resets_is_a_finding(self):
        ours = base()
        ours['pool_accepted'] -= 5000       # a different quantity, or a reboot
        ours['uptime_seconds'] = 30         # the machine restarted between reads
        self.assertEqual(fields(compare(base(), ours)),
                         ['pool_accepted', 'uptime_seconds'])

    def test_state_and_mining_are_exact(self):
        ours = base()
        ours['state'] = 1
        ours['is_mining'] = 0
        self.assertEqual(fields(compare(base(), ours)), ['is_mining', 'state'])

    def test_a_series_only_one_side_publishes_is_a_finding(self):
        # The fan case: pyasic publishes no fans for a Msg-shaped machine, so a
        # fan series on our side is a value change even though no value differs.
        theirs = base()
        theirs.pop('fan:0')
        theirs.pop('fan:1')
        findings = compare(theirs, base())
        self.assertEqual(fields(findings), ['fan:0', 'fan:1'])
        self.assertTrue(all(f['result'] == RESULT_ONLY_OURS for f in findings))

        findings = compare(base(), {k: v for k, v in base().items()
                                    if not k.startswith('board_temp')})
        self.assertEqual(fields(findings), ['board_temp:0'])
        self.assertEqual(findings[0]['result'], RESULT_ONLY_PYASIC)

    def test_absent_is_not_zero(self):
        theirs = base()
        theirs['temp_max_c'] = None
        ours = base()
        ours['temp_max_c'] = 0.0
        self.assertEqual(fields(compare(theirs, ours)), ['temp_max_c'])

    def test_an_unlisted_field_is_compared_exactly(self):
        ours = base()
        ours['something_new'] = 1
        self.assertEqual(fields(compare(base(), ours)), ['something_new'])


class ExpectedDifferences(unittest.TestCase):
    def test_an_expected_difference_is_reported_not_hidden(self):
        ours = base()
        ours['hashrate_ths'] = 0.0
        findings = compare(base(), ours, expected_reason='stopped for maintenance')
        self.assertEqual(len(findings), 1)
        self.assertEqual(findings[0]['result'], RESULT_EXPECTED)
        self.assertEqual(findings[0]['reason'], 'stopped for maintenance')

    def test_unexplained_and_explained_are_counted_apart(self):
        ours = base()
        ours['hashrate_ths'] = 0.0
        ours['state'] = 1
        findings = compare(base(), ours, expected_reason='stopped')
        self.assertEqual(split_results(findings), (0, 2))

        findings = compare(base(), ours)
        self.assertEqual(split_results(findings), (2, 0))


class Reporting(unittest.TestCase):
    def test_the_line_names_the_machine_the_shape_and_every_field(self):
        ours = base()
        ours['hashrate_ths'] = 112.9
        findings = compare(base(), ours, {'hashrate_ths': 'summary.mhs_1m'},
                           {'hashrate_ths': 'msg.mhs_av'})
        line = summarise('m30s', '192.0.2.10', findings, len(base()), shape='msg')
        self.assertIn('192.0.2.10', line)
        self.assertIn('shape=msg', line)
        self.assertIn('hashrate_ths', line)
        self.assertIn('summary.mhs_1m vs msg.mhs_av', line)
        self.assertIn('disagreements=1', line)

    def test_the_same_value_from_a_different_field_is_a_finding(self):
        # `MHS 1m` and `MHS av` differ by 0.35% on this fleet -- inside the
        # value tolerance, and a different quantity. Only the source names can
        # say so, which is why a source difference is its own result.
        ours = base()
        ours['hashrate_ths'] = base()['hashrate_ths'] * 1.003
        findings = compare(base(), ours,
                           {'hashrate_ths': 'pyasic.hashrate'},
                           {'hashrate_ths': 'msg.mhs_av'})
        self.assertEqual(fields(findings), ['hashrate_ths'])
        self.assertEqual(findings[0]['result'], RESULT_SOURCE)

    def test_equivalent_source_names_are_not_a_finding(self):
        ours = base()
        self.assertEqual(compare(base(), ours,
                                 {'hashrate_ths': 'summary.mhs_1m'},
                                 {'hashrate_ths': 'summary.mhs_1m'}), [])

    def test_agreement_says_so_without_an_empty_list(self):
        line = summarise('m30s', '192.0.2.10', [], len(base()), shape='summary')
        self.assertIn('disagreements=0', line)
        self.assertNotIn('::', line)


if __name__ == '__main__':
    unittest.main(verbosity=2)
