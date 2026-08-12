"""
Unit tests for the rated-hashrate metric (DMI-59).

docker/prometheus/rules/mining_alerts.yml compares live hashrate against
`miner_expected_hashrate_ths` and gates both SHA-256 degradation rules on
`miner_expected_hashrate_ths > 0`. Nothing published that metric, so the rules
were permanently silent for the 19 SHA-256 miners in the fleet.

Run standalone (no pytest needed):
    python python-scheduler/test_expected_hashrate.py
"""

import logging
import os
import unittest

from asic_profile_loader import ASICProfileLibrary, expected_hashrate_ths
import asic_profile_loader
from metrics import get_all_miner_metrics, miner_expected_hashrate, miner_hashrate

PROFILES = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'asic_profiles.yaml')

# Live fleet readings, 2026-08-12. The two 0.0 entries are genuinely broken miners.
FLEET = {
    'M30S++ VH90 (Stock)': [102.4, 94.3, 104.5, 105.0, 101.3, 175.4, 0.0],
    'M30S++ VH40 (Stock)': [111.3, 113.3, 110.5],
    'M50 VH50 (Stock)': [122.1],
    'M50 VH70 (Stock)': [123.8, 122.3, 106.1],
    'M50 VH80 (Stock)': [104.1],
    'M50S VH50 (Stock)': [121.4],
    'M50S++ VL30 (Stock)': [157.8],
}


def setUpModule():
    logging.disable(logging.CRITICAL)
    # expected_hashrate_ths() resolves through the module-level singleton.
    asic_profile_loader._library = ASICProfileLibrary(PROFILES)


def tearDownModule():
    logging.disable(logging.NOTSET)
    asic_profile_loader._library = None


class ExpectedHashrateTest(unittest.TestCase):

    def test_sha256_models_report_their_rated_hashrate(self):
        for model in FLEET:
            with self.subTest(model=model):
                self.assertGreater(expected_hashrate_ths(model), 0)

    def test_underscored_model_resolves_the_same(self):
        """_update_metrics() rewrites spaces to underscores before looking up.

        Without normalisation the same miner would resolve differently depending
        on the caller, and silently: a miss just falls through to legacy handling.
        """
        for model in FLEET:
            with self.subTest(model=model):
                self.assertEqual(
                    expected_hashrate_ths(model.replace(' ', '_')),
                    expected_hashrate_ths(model))

    def test_scrypt_miner_reports_nothing(self):
        """DG1+ figures are MH/s; a `_ths` metric must not carry them."""
        self.assertIsNone(expected_hashrate_ths('DG1+ (Stock)'))
        self.assertIsNone(expected_hashrate_ths('DG1+_(Stock)'))

    def test_model_less_whatsminer_reports_nothing(self):
        """"WhatsMiner (Stock)" names no variant, so there is no rated figure."""
        self.assertIsNone(expected_hashrate_ths('WhatsMiner (Stock)'))
        self.assertIsNone(expected_hashrate_ths('WhatsMiner_(Stock)'))

    def test_unknown_model_reports_nothing(self):
        self.assertIsNone(expected_hashrate_ths('Totally Unknown 9000'))
        self.assertIsNone(expected_hashrate_ths(''))

    def test_algorithm_override_to_scrypt_suppresses_the_metric(self):
        """An operator-declared scrypt miner must not get a TH/s rated figure."""
        self.assertIsNone(expected_hashrate_ths('M30S++ VH90 (Stock)', 'scrypt'))


class AlertThresholdTest(unittest.TestCase):
    """The published figure drives two live rules; neither may fire on a healthy miner.

    MinerHashrateCriticalSHA256  hashrate <  expected * 0.5
    MinerHashrateWarningSHA256   hashrate <  expected * 0.8  (and >= 0.5)
    """

    def test_healthy_miners_trip_neither_rule(self):
        for model, observed in FLEET.items():
            expected = expected_hashrate_ths(model)
            for hashrate in [h for h in observed if h > 0]:
                with self.subTest(model=model, hashrate=hashrate):
                    self.assertGreaterEqual(
                        hashrate, expected * 0.8,
                        f"{model} at {hashrate} TH/s would raise a warning against "
                        f"a rated {expected} TH/s")

    def test_a_dead_miner_that_claims_to_be_mining_does_trip_critical(self):
        """192.168.2.117: 0 TH/s on all three boards while reporting is_mining=1.

        Nothing else in the rule set catches this -- MinerNotMining requires
        is_mining == 0, and the miner insists otherwise.
        """
        expected = expected_hashrate_ths('M30S++ VH90 (Stock)')

        self.assertLess(0.0, expected * 0.5)


class MetricRegistrationTest(unittest.TestCase):

    def test_label_set_matches_miner_hashrate_ths(self):
        """The rules combine the two with `and`, which matches on the full label set.

        Any divergence here makes every rule silently evaluate to nothing.
        """
        self.assertEqual(miner_expected_hashrate._labelnames, miner_hashrate._labelnames)

    def test_included_in_stale_series_cleanup(self):
        """Otherwise a decommissioned miner keeps a rated figure forever (DMI-54/55)."""
        self.assertIn(miner_expected_hashrate, get_all_miner_metrics())


if __name__ == '__main__':
    unittest.main(verbosity=2)
