"""
Unit tests for ASIC profile matching against the real fleet (DMI-60).

The profile library matched on model strings carrying a manufacturer prefix
("Whatsminer M50S++"), but the miners report bare strings with a suffix
("M50S++ VL30 (Stock)"). 18 of 20 polled miners fell through to no profile,
which silently disabled zombie-board detection for them.

Run standalone (no pytest needed):
    python python-scheduler/test_asic_profile_matching.py
"""

import logging
import os
import unittest

from asic_profile_loader import ASICProfileLibrary

PROFILES = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'asic_profiles.yaml')

# Model strings exactly as the live fleet reports them, with the hashrates observed
# on 2026-08-12. Entries of 0.0 are miners that were genuinely broken at the time.
FLEET = {
    'M30S++ VH90 (Stock)': ('whatsminer_m30s', [102.4, 94.3, 104.5, 105.0, 101.3, 175.4]),
    'M30S++ VH40 (Stock)': ('whatsminer_m30s', [111.3, 113.3, 110.5]),
    'M50 VH50 (Stock)': ('whatsminer_m50', [122.1]),
    'M50 VH70 (Stock)': ('whatsminer_m50', [123.8, 122.3, 106.1]),
    'M50 VH80 (Stock)': ('whatsminer_m50', [104.1]),
    'M50S VH50 (Stock)': ('whatsminer_m50s', [121.4]),
    'M50S++ VL30 (Stock)': ('whatsminer_m50s', [157.8]),
    'WhatsMiner (Stock)': ('whatsminer_generic', [94.9]),
    'DG1+ (Stock)': ('elphapex_dg1', [40000.0]),
}

WHATSMINER_PROFILES = ('whatsminer_m50s', 'whatsminer_m30s', 'whatsminer_m50', 'whatsminer_generic')


def setUpModule():
    logging.disable(logging.CRITICAL)


def tearDownModule():
    logging.disable(logging.NOTSET)


class FleetMatchingTest(unittest.TestCase):

    @classmethod
    def setUpClass(cls):
        cls.lib = ASICProfileLibrary(PROFILES)

    def test_every_fleet_model_matches_the_right_profile(self):
        for model, (want, _) in FLEET.items():
            with self.subTest(model=model):
                profile = self.lib.get_profile(model)
                self.assertIsNotNone(profile, f"{model} matched no profile")
                self.assertEqual(profile.id, want)

    def test_m50s_is_not_swallowed_by_the_plain_m50_profile(self):
        """`^M50` would capture M50S too; the plain-M50 profile guards with (?!S)."""
        for model in ('M50S VH50 (Stock)', 'M50S++ VL30 (Stock)', 'Whatsminer M50S++'):
            with self.subTest(model=model):
                self.assertEqual(self.lib.get_profile(model).id, 'whatsminer_m50s')

    def test_previously_matching_models_still_match(self):
        """Guard against the new bare-form patterns stealing existing matches."""
        for model, want in (
            ('Whatsminer M50S++', 'whatsminer_m50s'),
            ('Whatsminer M30S++', 'whatsminer_m30s'),
            ('S19 Pro (Stock)', 'antminer_s19'),
            ('S19K Pro (Stock)', 'antminer_s19'),
            ('DG1+ (Stock)', 'elphapex_dg1'),
        ):
            with self.subTest(model=model):
                self.assertEqual(self.lib.get_profile(model).id, want)

    def test_healthy_miners_are_not_flagged_as_zombie_boards(self):
        """main.py forces a fallback below half the expected hashrate."""
        for model, (_, observed) in FLEET.items():
            profile = self.lib.get_profile(model)
            expected = profile.get_expected_hashrate()
            if not expected:
                continue
            for hashrate in observed:
                with self.subTest(model=model, hashrate=hashrate):
                    self.assertGreaterEqual(
                        hashrate, expected * 0.5,
                        f"{model} at {hashrate} TH/s would trip zombie detection")


class ProfileShapeTest(unittest.TestCase):

    @classmethod
    def setUpClass(cls):
        cls.lib = ASICProfileLibrary(PROFILES)

    def test_whatsminer_profiles_keep_the_cgi_fallback(self):
        """Without this driver the profile-driven fallback in main.py tries nothing.

        pyasic and cgminer are both skipped there (pyasic already ran, and it speaks
        the CGMiner API natively), so whatsminer_cgi is the only fallback left.
        """
        for pid in WHATSMINER_PROFILES:
            with self.subTest(profile=pid):
                types = [d.get('type') for d in self.lib.get_profile_by_id(pid).get_ordered_drivers()]
                self.assertIn('whatsminer_cgi', types)

    def test_no_profile_declares_board_or_fan_counts(self):
        """Those enable a strict equality check that forces a fallback every cycle.

        Nothing sets them today and the whole fleet reports 3 boards / 2 fans, so
        adding one is a deliberate decision that needs its own verification.
        """
        for pid in self.lib.list_profiles():
            with self.subTest(profile=pid):
                profile = self.lib.get_profile_by_id(pid)
                self.assertIsNone(profile.get_expected_board_count())
                self.assertIsNone(profile.get_expected_fan_count())

    def test_generic_whatsminer_has_no_expected_hashrate(self):
        """"WhatsMiner (Stock)" names no model, and the vendor spans 70-160 TH/s.

        Guessing a figure would make zombie detection fire on invented data, so the
        profile supplies driver/parser/algorithm only.
        """
        profile = self.lib.get_profile_by_id('whatsminer_generic')

        self.assertIsNone(profile.get_expected_hashrate())
        self.assertEqual(profile.algorithm, 'sha256')

    def test_generic_profile_matches_exactly_and_does_not_shadow_real_models(self):
        """It is exact-match only, so no pattern of its can capture a known model."""
        self.assertEqual(self.lib.get_profile('WhatsMiner (Stock)').id, 'whatsminer_generic')
        self.assertEqual(self.lib.get_profile('M30S++ VH90 (Stock)').id, 'whatsminer_m30s')

    def test_whatsminer_models_are_sha256(self):
        """A wrong algorithm would send hashrate to the wrong metric and scale."""
        for pid in WHATSMINER_PROFILES:
            with self.subTest(profile=pid):
                self.assertEqual(self.lib.get_profile_by_id(pid).algorithm, 'sha256')


if __name__ == '__main__':
    unittest.main(verbosity=2)
