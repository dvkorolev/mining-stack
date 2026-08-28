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
    get_stale_value_metrics,
    miner_hashrate,
    miner_scrape_status,
    miner_state,
    remove_miner_board_series,
    remove_miner_fan_series,
    remove_miner_series,
    remove_miner_pool_series,
    remove_old_miner_labels,
    forget_miner,
    forget_unconfigured_miners,
    known_miner_ips,
    set_miner_boards,
    set_miner_fans,
    set_miner_pools,
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

        # The helper touches exactly what it is handed and nothing else.
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


class ForgetMinerTest(unittest.TestCase):
    """DMI-80: a miner removed from the inventory must stop publishing."""

    NAME = 'decommissioned'
    MODEL = 'M50_VH80_(Stock)'

    def register(self, ip):
        """Publish the full set a healthy collection would: gauges, boards,
        fans and pools, so the purge has something of every kind to remove."""
        update_miner_label_cache(ip, self.NAME, self.MODEL, ALGO)
        for metric in get_all_miner_metrics():
            metric.labels(ip=ip, name=self.NAME, model=self.MODEL,
                          algorithm=ALGO).set(1)
        set_miner_boards(ip, self.NAME, self.MODEL, {'0': {'hashrate': 35.0}})
        set_miner_fans(ip, self.NAME, self.MODEL, {'0': 4200})
        set_miner_pools(ip, self.NAME, [
            {'index': 0, 'url': 'stratum+tcp://pool.example:3333', 'alive': True}])
        self.addCleanup(forget_miner, ip)
        return ip

    def test_scrape_status_goes_too(self):
        # The one difference from the failure-streak cull. A machine that is
        # gone from the inventory is not "offline" -- keeping its -2 would fire
        # MinerOffline forever for hardware that was deliberately removed.
        ip = self.register('10.0.4.1')
        self.assertEqual(sample('miner_scrape_status', ip, self.NAME, self.MODEL), 1)

        self.assertTrue(forget_miner(ip))

        self.assertIsNone(sample('miner_scrape_status', ip, self.NAME, self.MODEL))

    def test_nothing_is_left_in_the_fleet_aggregates(self):
        ip = self.register('10.0.4.2')

        forget_miner(ip)

        for metric_name in ('miner_hashrate_ths', 'miner_power_watts',
                            'miner_temp_max_c', 'miner_state'):
            self.assertIsNone(sample(metric_name, ip, self.NAME, self.MODEL))

    def test_board_fan_and_pool_series_go_with_it(self):
        # These carry slot/fan_id/url instead of `algorithm`, so they need
        # their own removal path and were missed by every earlier cleanup.
        ip = self.register('10.0.4.3')

        forget_miner(ip)

        self.assertIsNone(REGISTRY.get_sample_value(
            'miner_board_hashrate_ths',
            {'ip': ip, 'name': self.NAME, 'model': self.MODEL, 'slot': '0'}))
        self.assertIsNone(REGISTRY.get_sample_value(
            'miner_fan_speed_rpm',
            {'ip': ip, 'name': self.NAME, 'model': self.MODEL, 'fan_id': '0'}))
        self.assertIsNone(REGISTRY.get_sample_value(
            'miner_pool_alive',
            {'ip': ip, 'name': self.NAME,
             'url': 'stratum+tcp://pool.example:3333', 'pool_index': '0'}))

    def test_the_miner_is_no_longer_known(self):
        # known_miner_ips() is what the collection cycle diffs against the
        # configuration, so a forgotten miner must not reappear in it and get
        # purged again on every pass.
        ip = self.register('10.0.4.4')
        self.assertIn(ip, known_miner_ips())

        forget_miner(ip)

        self.assertNotIn(ip, known_miner_ips())

    def test_forgetting_an_unknown_miner_is_a_safe_noop(self):
        self.assertFalse(forget_miner('10.255.255.252'))

    def test_forgetting_is_repeatable(self):
        ip = self.register('10.0.4.5')

        forget_miner(ip)
        self.assertFalse(forget_miner(ip))

    def test_only_the_miners_absent_from_the_config_are_dropped(self):
        kept = self.register('10.0.5.1')
        gone = self.register('10.0.5.2')

        # Membership, not equality: the helper sweeps every miner known to the
        # shared registry, so another test's leftovers must not decide this one.
        removed = forget_unconfigured_miners({kept})

        self.assertIn(gone, removed)
        self.assertNotIn(kept, removed)
        self.assertEqual(sample('miner_scrape_status', kept, self.NAME, self.MODEL), 1)
        self.assertIsNone(sample('miner_scrape_status', gone, self.NAME, self.MODEL))

    def test_an_unchanged_config_removes_nothing(self):
        ip = self.register('10.0.5.3')

        self.assertNotIn(ip, forget_unconfigured_miners({ip}))
        self.assertEqual(sample('miner_scrape_status', ip, self.NAME, self.MODEL), 1)

    def test_a_config_naming_an_unseen_miner_is_harmless(self):
        # The list is the inventory, not the set of machines that answered.
        ip = self.register('10.0.5.4')

        self.assertNotIn(ip, forget_unconfigured_miners({ip, '10.0.5.99'}))

    def test_known_miner_ips_sees_a_board_only_miner(self):
        # A machine whose scrape failed before any gauge was set can still
        # have board series from an earlier cycle; it must still be purgeable.
        ip = '10.0.4.6'
        self.addCleanup(remove_miner_board_series, ip)
        set_miner_boards(ip, self.NAME, self.MODEL, {'0': {'temp': 70.0}})

        self.assertIn(ip, known_miner_ips())


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


class StaleValueMetricsTest(unittest.TestCase):
    """DMI-55: what a failed miner leaves behind, and what it must not."""

    def test_scrape_status_is_the_one_gauge_that_survives(self):
        stale = get_stale_value_metrics()

        self.assertNotIn(miner_scrape_status, stale)
        self.assertIn(miner_hashrate, stale)
        self.assertIn(miner_state, stale)
        # Everything else in the miner set is fair game.
        self.assertEqual(len(stale), len(get_all_miner_metrics()) - 1)

    def test_a_failed_miner_keeps_its_tombstone_and_loses_its_readings(self):
        # The shape main.py produces once a miner crosses FAILURE_THRESHOLD.
        ip, name, model = '10.0.1.1', 'gone', 'M30S++_VH90_(Stock)'
        update_miner_label_cache(ip, name, model, ALGO)
        self.addCleanup(_miner_label_cache.pop, ip, None)
        self.addCleanup(remove_miner_series, ip)
        for metric in get_all_miner_metrics():
            metric.labels(ip=ip, name=name, model=model, algorithm=ALGO).set(105)
        miner_scrape_status.labels(
            ip=ip, name=name, model=model, algorithm=ALGO
        ).set(-2)

        remove_miner_series(ip, get_stale_value_metrics())

        # The dead miner stops inflating every fleet aggregate...
        self.assertIsNone(sample('miner_hashrate_ths', ip, name, model))
        self.assertIsNone(sample('miner_power_watts', ip, name, model))
        self.assertIsNone(sample('miner_state', ip, name, model))
        # ...while still announcing itself as unreachable, which is what
        # MinerOffline alerts on. Removing this was why that alert, whose
        # entire job is "this miner is gone", never fired.
        self.assertEqual(sample('miner_scrape_status', ip, name, model), -2)


def board_sample(metric_name, ip, name, model, slot):
    return REGISTRY.get_sample_value(
        metric_name, {'ip': ip, 'name': name, 'model': model, 'slot': slot})


def fan_sample(ip, name, model, fan_id):
    return REGISTRY.get_sample_value(
        'miner_fan_speed_rpm',
        {'ip': ip, 'name': name, 'model': model, 'fan_id': fan_id})


class BoardAndFanPublishingTest(unittest.TestCase):
    """DMI-62: a reading the miner never gave must not be published as zero."""

    NAME = 'worker'
    MODEL = 'M30S++_VH90_(Stock)'

    def publish(self, ip, boards):
        self.addCleanup(remove_miner_board_series, ip)
        set_miner_boards(ip, self.NAME, self.MODEL, boards)

    def test_a_board_that_reports_nothing_gets_no_series(self):
        # The live fleet's shape: pyasic identifies three hashboards but fills
        # none of the fields. 18 of 19 miners looked exactly like this while
        # hashing at or above their rated speed.
        ip = '10.0.2.1'
        self.publish(ip, {str(s): {'hashrate': None, 'temp': None,
                                   'chips': None, 'expected_chips': None}
                          for s in range(3)})

        for slot in ('0', '1', '2'):
            self.assertIsNone(board_sample('miner_board_chips_count', ip,
                                           self.NAME, self.MODEL, slot))
            self.assertIsNone(board_sample('miner_board_hashrate_ths', ip,
                                           self.NAME, self.MODEL, slot))
            self.assertIsNone(board_sample('miner_board_temp_c', ip,
                                           self.NAME, self.MODEL, slot))

    def test_a_real_zero_is_still_published(self):
        # The distinction the whole change rests on: a board that answers
        # "zero chips" is a fault worth alerting on and must survive.
        ip = '10.0.2.2'
        self.publish(ip, {'0': {'chips': 0, 'expected_chips': 78}})

        self.assertEqual(
            board_sample('miner_board_chips_count', ip, self.NAME, self.MODEL, '0'), 0)
        self.assertEqual(
            board_sample('miner_board_chips_expected', ip, self.NAME, self.MODEL, '0'), 78)

    def test_fields_are_judged_one_by_one(self):
        # A miner that reports temperature but not chips publishes the
        # temperature and stays silent about the chips.
        ip = '10.0.2.3'
        self.publish(ip, {'0': {'temp': 71.5, 'chips': None}})

        self.assertEqual(
            board_sample('miner_board_temp_c', ip, self.NAME, self.MODEL, '0'), 71.5)
        self.assertIsNone(
            board_sample('miner_board_chips_count', ip, self.NAME, self.MODEL, '0'))

    def test_a_slot_that_stops_being_reported_is_removed(self):
        ip = '10.0.2.4'
        self.publish(ip, {'0': {'hashrate': 35.0}, '1': {'hashrate': 35.0}})

        set_miner_boards(ip, self.NAME, self.MODEL, {'0': {'hashrate': 35.0}})

        self.assertEqual(
            board_sample('miner_board_hashrate_ths', ip, self.NAME, self.MODEL, '0'), 35.0)
        self.assertIsNone(
            board_sample('miner_board_hashrate_ths', ip, self.NAME, self.MODEL, '1'))

    def test_removal_clears_every_board_gauge(self):
        ip = '10.0.2.5'
        set_miner_boards(ip, self.NAME, self.MODEL,
                         {'0': {'hashrate': 35.0, 'temp': 70.0, 'chip_temp': 93.3,
                                'chips': 78, 'expected_chips': 78}})

        remove_miner_board_series(ip)

        for metric_name in ('miner_board_hashrate_ths', 'miner_board_temp_c',
                            'miner_board_chip_temp_c', 'miner_board_chips_count',
                            'miner_board_chips_expected'):
            self.assertIsNone(
                board_sample(metric_name, ip, self.NAME, self.MODEL, '0'))

    def test_board_and_chip_temperature_are_separate_series(self):
        # They differ by 20-30 C on this fleet, and every temperature alert was
        # built on the cooler one. Publishing them into one gauge is what made
        # miner_board_temp_c mean the PCB on some miners and the chips on
        # others (DMI-64).
        ip = '10.0.2.6'
        self.publish(ip, {'0': {'temp': 76.0, 'chip_temp': 97.15}})

        self.assertEqual(
            board_sample('miner_board_temp_c', ip, self.NAME, self.MODEL, '0'), 76.0)
        self.assertEqual(
            board_sample('miner_board_chip_temp_c', ip, self.NAME, self.MODEL, '0'), 97.15)

    def test_a_firmware_reporting_only_board_temp_publishes_only_that(self):
        ip = '10.0.2.7'
        self.publish(ip, {'0': {'temp': 69.12}})

        self.assertEqual(
            board_sample('miner_board_temp_c', ip, self.NAME, self.MODEL, '0'), 69.12)
        self.assertIsNone(
            board_sample('miner_board_chip_temp_c', ip, self.NAME, self.MODEL, '0'))

    def test_an_unreported_fan_speed_is_not_a_stopped_fan(self):
        ip = '10.0.3.1'
        self.addCleanup(remove_miner_fan_series, ip)

        set_miner_fans(ip, self.NAME, self.MODEL, {'0': 4200, '1': None})

        self.assertEqual(fan_sample(ip, self.NAME, self.MODEL, '0'), 4200)
        # 0 RPM would read as a stopped fan and raise MinerFanSpeedCritical.
        self.assertIsNone(fan_sample(ip, self.NAME, self.MODEL, '1'))

    def test_fan_removal_clears_the_series(self):
        ip = '10.0.3.2'
        set_miner_fans(ip, self.NAME, self.MODEL, {'0': 4200, 'psu': 3100})

        remove_miner_fan_series(ip)

        self.assertIsNone(fan_sample(ip, self.NAME, self.MODEL, '0'))
        self.assertIsNone(fan_sample(ip, self.NAME, self.MODEL, 'psu'))

    def test_cleanup_of_an_unknown_miner_is_a_safe_noop(self):
        remove_miner_board_series('10.255.255.253')
        remove_miner_fan_series('10.255.255.253')


if __name__ == '__main__':
    unittest.main(verbosity=2)
