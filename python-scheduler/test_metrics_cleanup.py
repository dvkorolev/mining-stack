"""
Unit tests for the miner metric cleanup helpers in metrics.py.

Regression cover for DMI-54: stale-series removal used to pass three label
values to gauges declared with four, which raises ValueError in
prometheus_client and aborted the whole collection cycle.

Run standalone (no pytest needed):
    python python-scheduler/test_metrics_cleanup.py
"""

import unittest

from prometheus_client import REGISTRY

from metrics import (
    _miner_label_cache,
    get_all_miner_metrics,
    miner_hashrate,
    miner_scrape_status,
    miner_state,
    remove_miner_series,
    remove_old_miner_labels,
    update_miner_label_cache,
)

ALGO = 'sha256'


def sample(metric_name, ip, name, model, algorithm=ALGO):
    """Current value of a miner series, or None when it does not exist."""
    return REGISTRY.get_sample_value(
        metric_name,
        {'ip': ip, 'name': name, 'model': model, 'algorithm': algorithm},
    )


class RemoveMinerSeriesTest(unittest.TestCase):
    """Each test uses its own ip so the shared default registry stays isolated."""

    def register(self, ip, name='worker', model='M50_VH80_(Stock)'):
        """Register a miner the way a successful collection would."""
        update_miner_label_cache(ip, name, model, ALGO)
        for metric in get_all_miner_metrics():
            metric.labels(ip=ip, name=name, model=model, algorithm=ALGO).set(1)
        self.addCleanup(_miner_label_cache.pop, ip, None)
        self.addCleanup(remove_miner_series, ip)
        return ip, name, model

    def test_removes_series_using_the_cached_algorithm_label(self):
        ip, name, model = self.register('10.0.0.1')
        self.assertEqual(sample('miner_scrape_status', ip, name, model), 1)

        removed = remove_miner_series(ip, [miner_scrape_status, miner_state])

        self.assertTrue(removed)
        self.assertIsNone(sample('miner_scrape_status', ip, name, model))
        self.assertIsNone(sample('miner_state', ip, name, model))

    def test_only_the_requested_metrics_are_removed(self):
        ip, name, model = self.register('10.0.0.2')

        remove_miner_series(ip, [miner_scrape_status, miner_state])

        # main.py deliberately clears only these two; the value gauges stay put.
        self.assertEqual(sample('miner_hashrate_ths', ip, name, model), 1)

    def test_defaults_to_every_miner_gauge(self):
        ip, name, model = self.register('10.0.0.3')

        self.assertTrue(remove_miner_series(ip))

        self.assertIsNone(sample('miner_hashrate_ths', ip, name, model))
        self.assertIsNone(sample('miner_power_watts', ip, name, model))
        self.assertIsNone(sample('miner_scrape_status', ip, name, model))

    def test_label_cache_entry_survives_removal(self):
        # Kept on purpose: remove_old_miner_labels() needs it to clean up the
        # remaining gauges if the miner returns under a new name or model.
        ip, _, _ = self.register('10.0.0.4')

        remove_miner_series(ip, [miner_scrape_status, miner_state])

        self.assertIn(ip, _miner_label_cache)

    def test_unknown_ip_is_a_safe_noop(self):
        self.assertFalse(remove_miner_series('10.255.255.254'))

    def test_removal_is_repeatable(self):
        ip, _, _ = self.register('10.0.0.5')

        remove_miner_series(ip, [miner_scrape_status])
        # Second pass hits KeyError internally and must stay silent.
        self.assertTrue(remove_miner_series(ip, [miner_scrape_status]))


class LabelCountRegressionTest(unittest.TestCase):
    """DMI-54: the exact failure the helper exists to prevent."""

    def test_three_label_values_still_raise_on_a_four_label_gauge(self):
        # Pins the underlying prometheus_client behaviour the bug relied on,
        # so this test fails loudly if that contract ever changes.
        with self.assertRaises(ValueError):
            miner_scrape_status.remove('10.0.0.6', 'worker', 'M50_VH80_(Stock)')

    def test_helper_does_not_raise_where_the_old_call_did(self):
        ip, name, model = '10.0.0.7', 'worker', 'M50_VH80_(Stock)'
        update_miner_label_cache(ip, name, model, ALGO)
        self.addCleanup(_miner_label_cache.pop, ip, None)
        miner_scrape_status.labels(
            ip=ip, name=name, model=model, algorithm=ALGO
        ).set(-2)

        remove_miner_series(ip, [miner_scrape_status, miner_state])

        self.assertIsNone(sample('miner_scrape_status', ip, name, model))

    def test_a_miner_that_never_scraped_successfully_can_be_cleaned_up(self):
        # Shape produced by the failure branch of pyasic_collector: only
        # scrape_status/state exist, and the labels are cached there rather than
        # by _update_metrics. Without that cache entry the removal is a no-op and
        # the series would linger forever.
        ip, name, model = '10.0.0.10', 'unreachable', 'S19_(Stock)'
        update_miner_label_cache(ip, name, model, ALGO)
        self.addCleanup(_miner_label_cache.pop, ip, None)
        miner_scrape_status.labels(
            ip=ip, name=name, model=model, algorithm=ALGO
        ).set(-2)
        miner_state.labels(ip=ip, name=name, model=model, algorithm=ALGO).set(0)

        self.assertTrue(remove_miner_series(ip, [miner_scrape_status, miner_state]))

        self.assertIsNone(sample('miner_scrape_status', ip, name, model))
        self.assertIsNone(sample('miner_state', ip, name, model))


class RemoveOldMinerLabelsTest(unittest.TestCase):
    def test_tolerates_labels_that_were_never_set(self):
        remove_old_miner_labels('10.0.0.8', 'ghost', 'M50_VH80_(Stock)', ALGO)

    def test_label_change_clears_the_previous_series(self):
        ip, model = '10.0.0.9', 'M50_VH80_(Stock)'
        update_miner_label_cache(ip, 'old-name', model, ALGO)
        self.addCleanup(_miner_label_cache.pop, ip, None)
        self.addCleanup(remove_miner_series, ip)
        miner_hashrate.labels(
            ip=ip, name='old-name', model=model, algorithm=ALGO
        ).set(100)

        # A rename triggers cleanup of the old label set.
        update_miner_label_cache(ip, 'new-name', model, ALGO)

        self.assertIsNone(sample('miner_hashrate_ths', ip, 'old-name', model))


if __name__ == '__main__':
    unittest.main(verbosity=2)
