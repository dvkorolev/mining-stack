#!/usr/bin/env python3
"""
DMI-81: rated hashrate read from the machine over API v3.

The load-bearing rule under test is "absent is not zero". A miner that will not
state its nameplate must publish no expectation at all, never a 0 -- a published
0 asserts the machine is rated to produce nothing, which would make every
degradation alert either meaningless or permanently firing. Real fleet data:
`.98` answers `-1:-1:-1`, and `.74`/`.78` do not answer on 4433 at all.
"""

import time
import unittest

import rated_hashrate
from rated_hashrate import (
    SOURCE_NONE, SOURCE_PROFILE, SOURCE_V3,
    RatedHashrate, parse_detect_hash_rate, parse_device_info,
)


def device_info(detect, board_num='3', model='M30S++_VH95'):
    """A get.device.info reply shaped like the real one from .101."""
    return {
        'code': 0, 'when': 1, 'desc': 'ok',
        'msg': {
            'network': {'ip': '192.168.2.101'},
            'miner': {
                'working': 'true', 'type': model, 'hash-board': 'H95',
                'detect-hash-rate': detect, 'board-num': board_num,
                'chipdata0': 'H35A07-23102801', 'pcbsn0': 'BHM1EK4E953C27K44465',
            },
            'system': {'fwversion': '20241108.22.Rel', 'apiswitch': '0'},
            'salt': 'BQ5hoXV9',
        },
    }


class TestParseDetectHashRate(unittest.TestCase):

    def test_real_fleet_string_with_trailing_colon(self):
        # Exactly what .101 returns.
        self.assertEqual(parse_detect_hash_rate('33231:34095:34306:'),
                         [33231, 34095, 34306])

    def test_without_trailing_colon(self):
        # .121 (M60) returns this shape instead.
        self.assertEqual(parse_detect_hash_rate('58402:58165:59839'),
                         [58402, 58165, 59839])

    def test_sum_matches_the_factory_figure(self):
        # .117: 33590+33794+34396 = 101780 GH/s = its own "Factory GHS: 101780".
        boards = parse_detect_hash_rate('33590:33794:34396:')
        self.assertEqual(sum(boards), 101780)
        self.assertAlmostEqual(sum(boards) / 1000.0, 101.78, places=2)

    def test_minus_one_is_absent_not_zero(self):
        # .98 answers this. It must not become a published 0.
        self.assertIsNone(parse_detect_hash_rate('-1:-1:-1'))

    def test_a_single_negative_board_invalidates_the_whole_reading(self):
        # A partial sum would silently understate the nameplate, which is the
        # exact failure this change exists to remove.
        self.assertIsNone(parse_detect_hash_rate('33231:-1:34306'))

    def test_all_zeros_is_absent(self):
        self.assertIsNone(parse_detect_hash_rate('0:0:0'))

    def test_empty_and_malformed(self):
        for raw in ('', ':', '::', None, 'abc:def', 12345, '33231:oops'):
            self.assertIsNone(parse_detect_hash_rate(raw), raw)

    def test_single_board_machine(self):
        self.assertEqual(parse_detect_hash_rate('34306'), [34306])


class TestParseDeviceInfo(unittest.TestCase):

    def test_full_reply(self):
        r = parse_device_info(device_info('33231:34095:34306:'))
        self.assertEqual(r.boards_ghs, [33231, 34095, 34306])
        self.assertAlmostEqual(r.total_ths, 101.632, places=3)
        self.assertEqual(r.board_num, 3)
        self.assertEqual(r.model, 'M30S++_VH95')

    def test_undetermined_rating_yields_nothing(self):
        self.assertIsNone(parse_device_info(device_info('-1:-1:-1')))

    def test_missing_sections(self):
        for bad in ({}, {'msg': {}}, {'msg': {'miner': None}},
                    {'msg': {'miner': {}}}, None, 'not a dict'):
            self.assertIsNone(parse_device_info(bad), bad)

    def test_unparseable_board_num_does_not_lose_the_rating(self):
        r = parse_device_info(device_info('33231:34095:34306:', board_num='n/a'))
        self.assertIsNotNone(r)
        self.assertIsNone(r.board_num)
        self.assertEqual(r.boards_ghs, [33231, 34095, 34306])


class TestCache(unittest.TestCase):

    def setUp(self):
        rated_hashrate._reset_for_tests()

    def test_unknown_miner_has_no_rating(self):
        self.assertIsNone(rated_hashrate.get_rated('192.168.2.101'))

    def test_a_stored_rating_is_returned(self):
        value = RatedHashrate([33231, 34095, 34306], 101.632, 3, 'M30S++_VH95')
        rated_hashrate._cache['192.168.2.101'] = (value, time.time())
        self.assertEqual(rated_hashrate.get_rated('192.168.2.101'), value)

    def test_freshness_uses_a_shorter_ttl_for_failures(self):
        now = time.time()
        value = RatedHashrate([1], 0.001, 1, 'x')
        # A success stays fresh well past the failure TTL.
        rated_hashrate._cache['ok'] = (value, now - rated_hashrate.FAILURE_TTL_SECONDS - 60)
        self.assertTrue(rated_hashrate._is_fresh('ok', now))
        # A failure recorded at the same moment has already expired.
        rated_hashrate._cache['bad'] = (None, now - rated_hashrate.FAILURE_TTL_SECONDS - 60)
        self.assertFalse(rated_hashrate._is_fresh('bad', now))

    def test_a_success_expires_after_the_cache_ttl(self):
        now = time.time()
        value = RatedHashrate([1], 0.001, 1, 'x')
        rated_hashrate._cache['ok'] = (value, now - rated_hashrate.CACHE_TTL_SECONDS - 1)
        self.assertFalse(rated_hashrate._is_fresh('ok', now))

    def test_forget_drops_one_miner(self):
        rated_hashrate._cache['a'] = (None, time.time())
        rated_hashrate._cache['b'] = (None, time.time())
        rated_hashrate.forget('a')
        self.assertNotIn('a', rated_hashrate._cache)
        self.assertIn('b', rated_hashrate._cache)

    def test_forget_unconfigured_drops_departed_miners(self):
        for ip in ('a', 'b', 'c'):
            rated_hashrate._cache[ip] = (None, time.time())
        rated_hashrate.forget_unconfigured({'a', 'c'})
        self.assertEqual(set(rated_hashrate._cache), {'a', 'c'})


class TestResolveExpectedHashrate(unittest.TestCase):
    """The whole point: prefer the machine, fall back visibly, never invent."""

    def setUp(self):
        rated_hashrate._reset_for_tests()

    def resolve(self, *args, **kwargs):
        from asic_profile_loader import resolve_expected_hashrate
        return resolve_expected_hashrate(*args, **kwargs)

    def test_v3_wins_over_the_profile(self):
        # .126 is the extreme case: an M50S++ that falls into the M50S profile,
        # whose mean is 130 while the machine is rated 160.37.
        rated_hashrate._cache['192.168.2.126'] = (
            RatedHashrate([53456, 53456, 53456], 160.368, 3, 'M50S++_VL30'), time.time())
        value, source = self.resolve('192.168.2.126', 'M50S++ VL30 (Stock)')
        self.assertEqual(source, SOURCE_V3)
        self.assertAlmostEqual(value, 160.368, places=3)

    def test_profile_is_used_when_the_machine_does_not_answer(self):
        # .74 does not answer on 4433 at all.
        value, source = self.resolve('192.168.2.74', 'M30S++ VH90 (Stock)')
        self.assertEqual(source, SOURCE_PROFILE)
        self.assertEqual(value, 100)

    def test_an_undetermined_rating_falls_back_rather_than_publishing_zero(self):
        # .98 answers -1:-1:-1, which parse_device_info turns into None, which
        # is cached as "asked, no answer".
        rated_hashrate._cache['192.168.2.98'] = (None, time.time())
        value, source = self.resolve('192.168.2.98', 'M50S VH50 (Stock)')
        self.assertEqual(source, SOURCE_PROFILE)
        self.assertEqual(value, 130)
        self.assertNotEqual(value, 0)

    def test_no_source_at_all_publishes_nothing(self):
        value, source = self.resolve('192.168.2.1', 'Some Unknown Machine')
        self.assertIsNone(value)
        self.assertEqual(source, SOURCE_NONE)

    def test_scrypt_is_excluded_even_when_v3_answered(self):
        # A _ths metric must never carry a SCRYPT figure (ALGORITHM_SEPARATION).
        rated_hashrate._cache['192.168.2.78'] = (
            RatedHashrate([13000], 13.0, 1, 'DG1+'), time.time())
        value, source = self.resolve('192.168.2.78', 'DG1+ (Stock)', 'scrypt')
        self.assertIsNone(value)
        self.assertEqual(source, SOURCE_NONE)


class TestFleetRegression(unittest.TestCase):
    """
    The 2026-08-28 sweep, as a table. Guards the direction of the change: the
    profile understated every machine that answered, so a future edit that
    silently reverts to the profile shows up here as a drop.
    """

    FLEET = [
        # ip, db model, profile TH/s, hardware TH/s
        ('192.168.2.126', 'M50S++ VL30 (Stock)', 130, 160.37),
        ('192.168.2.70',  'M30S++ VH40 (Stock)', 100, 110.81),
        ('192.168.2.53',  'M30S++ VH40 (Stock)', 100, 110.13),
        ('192.168.2.89',  'M30S++ VH40 (Stock)', 100, 109.85),
        ('192.168.2.52',  'M50 VH70 (Stock)',    113, 118.89),
        ('192.168.2.121', 'M60 VK6A (Stock)',    172, 176.41),
        ('192.168.2.101', 'M30S++ VH90 (Stock)', 100, 101.63),
        ('192.168.2.64',  'M30S++ VH90 (Stock)', 100, 100.38),
    ]

    def setUp(self):
        rated_hashrate._reset_for_tests()

    def test_profile_understates_every_machine(self):
        from asic_profile_loader import expected_hashrate_ths
        for ip, model, profile_ths, hw_ths in self.FLEET:
            self.assertEqual(expected_hashrate_ths(model), profile_ths,
                             f'{ip}: profile expectation moved')
            self.assertGreater(hw_ths, profile_ths,
                               f'{ip}: hardware should exceed the profile')

    def test_v3_raises_the_warning_threshold_for_every_machine(self):
        from asic_profile_loader import resolve_expected_hashrate
        for ip, model, profile_ths, hw_ths in self.FLEET:
            rated_hashrate._cache[ip] = (
                RatedHashrate([int(hw_ths * 1000)], hw_ths, 1, 'x'), time.time())
            value, source = resolve_expected_hashrate(ip, model)
            self.assertEqual(source, SOURCE_V3)
            # MinerHashrateWarningSHA256 fires below 0.8 * expected.
            self.assertGreater(value * 0.8, profile_ths * 0.8,
                               f'{ip}: threshold should rise, not fall')


if __name__ == '__main__':
    unittest.main(verbosity=2)
