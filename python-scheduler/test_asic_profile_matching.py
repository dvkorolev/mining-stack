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

import asic_profile_loader
from asic_profile_loader import ASICProfileLibrary, expected_chips_per_board

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


class ChipsPerBoardTest(unittest.TestCase):
    """
    The per-board chip expectation moved out of pyasic's registry (DMI-189).

    pyasic 0.60.0 states `expected_chips` per model class and the collector
    published it as `miner_board_chips_expected`, even though no machine reports
    the figure. It now comes from `asic_profiles.yaml`, and the values below are
    pyasic's own — measured 2026-09-19 by executing its class resolution for
    every model in this fleet — so the move is value-preserving.

    The values are the *point* of this test: if one is edited, the published
    figure for that machine changes, and that is a decision rather than a typo.
    """

    @classmethod
    def setUpClass(cls):
        cls.lib = ASICProfileLibrary(PROFILES)
        # expected_chips_per_board() resolves through the module-level singleton.
        asic_profile_loader._library = cls.lib

    def test_the_declared_maps_are_exactly_pyasics_values(self):
        self.assertEqual(self.lib.get_profile_by_id('whatsminer_m30s').get_chips_per_board(),
                         {'M30S++ VH90': 78, 'M30S++ VH95': 78, 'M30S++ VH40': 70})
        self.assertEqual(self.lib.get_profile_by_id('whatsminer_m50').get_chips_per_board(),
                         {'M50 VH50': 105, 'M50 VH80': 111})

    def test_no_other_profile_declares_a_chip_count(self):
        """pyasic states none for these, so the profiles must stay silent."""
        for pid in ('whatsminer_m50s', 'whatsminer_m60', 'whatsminer_generic',
                    'antminer_s19', 'elphapex_dg1'):
            with self.subTest(profile=pid):
                self.assertEqual(self.lib.get_profile_by_id(pid).get_chips_per_board(), {})

    def test_every_fleet_model_resolves_to_pyasics_own_figure(self):
        """
        One row per machine in the fleet, against pyasic's registry.

        13 machines carry a count and 8 do not. The 8 are not a gap: pyasic's
        M50VH70 and M50SVH50 classes declare none, and the M60s and the M50S++
        VL30 fall through to its `WhatsminerUnknown` class, so all 8 publish no
        expected-chips series today and must not start.
        """
        expected = {
            'M30S++ VH90 (Stock)': 78,    # .101 .117 .40 .64 .65 .74
            'M30S++ VH95 (Stock)': 78,    # .122 .132 -- pyasic rewrites the
                                          # model key's last char to "0", so
                                          # these resolve to its VH90 class
            'M30S++ VH40 (Stock)': 70,    # .70 .89 .53 -- the three machines the
                                          # gate does NOT protect (DMI-209)
            'M50 VH50 (Stock)': 105,      # .130
            'M50 VH80 (Stock)': 111,      # .87
            'M50 VH70 (Stock)': None,     # .137 .52 .145
            'M50S VH50 (Stock)': None,    # .98
            'M50S++ VL30 (Stock)': None,  # .126
            'M60 VK6A (Stock)': None,     # .121 .58
            'DG1+ (Stock)': None,         # .78 -- scrypt, not this driver
        }
        for model, want in expected.items():
            with self.subTest(model=model):
                self.assertEqual(expected_chips_per_board(model), want)

    def test_m50s_vh50_does_not_inherit_the_plain_m50_count(self):
        """
        The trap a bare grade marker would fall into.

        `.98` is "M50S VH50 (Stock)" and pyasic states no count for it, while
        "M50 VH50 (Stock)" gets 105. A key of just "VH50" would hand `.98` a
        fabricated 105; the full marker is why it does not.
        """
        self.assertEqual(expected_chips_per_board('M50 VH50 (Stock)'), 105)
        self.assertIsNone(expected_chips_per_board('M50S VH50 (Stock)'))
        self.assertIsNone(expected_chips_per_board('M50S++ VH50 (Stock)'))

    def test_the_underscored_label_form_resolves_the_same(self):
        """
        Model strings reach the loader in two shapes: main.py passes the miner's
        own spaced string, `_update_metrics()` may pass the label's underscored
        form. Both must resolve, or the same machine gets a count from one
        caller and none from the other.
        """
        for spaced, underscored in (
            ('M30S++ VH40 (Stock)', 'M30S++_VH40_(Stock)'),
            ('M50 VH80 (Stock)', 'M50_VH80_(Stock)'),
            ('M50S VH50 (Stock)', 'M50S_VH50_(Stock)'),
        ):
            with self.subTest(model=spaced):
                self.assertEqual(expected_chips_per_board(spaced),
                                 expected_chips_per_board(underscored))

    def test_an_unmatched_model_publishes_nothing_rather_than_zero(self):
        """Absent is not zero -- a 0 here would be an expectation of no chips."""
        for model in ('', None, 'Unknown', 'WhatsMiner (Stock)', 'S19 Pro (Stock)'):
            with self.subTest(model=model):
                self.assertIsNone(expected_chips_per_board(model))

    def test_the_placeholder_slot_count_is_not_this_fields_board_count(self):
        """
        Two different notions that must not be wired together.

        `expected.board_count` arms main.py's board-mismatch fallback, and every
        profile leaves it unset on purpose -- pinned by
        `test_no_profile_declares_board_or_fan_counts` above. The number of
        placeholder slots comes from pyasic's registry instead
        (`asic.parity.expected_hashboards`), which is unconditional and says
        nothing about the machine.
        """
        from asic import parity
        self.assertIsNone(self.lib.get_profile_by_id('whatsminer_m30s').get_expected_board_count())
        self.assertEqual(parity.expected_hashboards('M30S++ VH40 (Stock)'), 3)


if __name__ == '__main__':
    unittest.main(verbosity=2)

