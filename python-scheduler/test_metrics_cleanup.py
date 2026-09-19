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
    miner_psu_input_amps,
    miner_psu_input_volts,
    miner_psu_input_watts,
    miner_psu_temp_c,
    remove_miner_board_series,
    remove_miner_fan_series,
    remove_miner_psu_series,
    remove_miner_series,
    remove_miner_pool_series,
    remove_old_miner_labels,
    forget_miner,
    forget_unconfigured_miners,
    known_miner_ips,
    set_miner_boards,
    set_miner_fans,
    set_miner_pools,
    set_miner_psu,
    publish_board_chips_source,
    remove_miner_expected_series,
    BOARD_CHIPS_SOURCES,
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


def chips_source_sample(ip, name, source):
    return REGISTRY.get_sample_value(
        'miner_board_chips_expected_source',
        {'ip': ip, 'name': name, 'source': source})


class BoardChipsSourceTest(unittest.TestCase):
    """
    Where the per-board chip expectation came from (DMI-189).

    The figure used to arrive from pyasic's model registry with nothing saying
    so, which made a registry guess indistinguishable from a measurement — the
    DMI-81 shape, in a different metric. The source is now published beside it,
    as a complete set so an inactive value reads 0 rather than vanishing
    (the DMI-58 rule).
    """

    NAME = 'worker'

    def publish(self, ip, source):
        self.addCleanup(remove_miner_expected_series, ip)
        publish_board_chips_source(ip, self.NAME, source, BOARD_CHIPS_SOURCES)

    def test_every_known_source_is_published_with_exactly_one_active(self):
        ip = '10.0.3.1'
        self.publish(ip, 'profile')

        values = {source: chips_source_sample(ip, self.NAME, source)
                  for source in BOARD_CHIPS_SOURCES}
        self.assertEqual(values, {'pyasic': 0, 'profile': 1, 'none': 0})

    def test_pyasic_sourced_counts_read_pyasic(self):
        # What this fleet publishes today, and what our path has to reproduce.
        ip = '10.0.3.2'
        self.publish(ip, 'pyasic')
        self.assertEqual(chips_source_sample(ip, self.NAME, 'pyasic'), 1)
        self.assertEqual(chips_source_sample(ip, self.NAME, 'profile'), 0)

    def test_a_machine_with_no_expectation_says_none_rather_than_nothing(self):
        # M50 VH70, M50S VH50 and the M60s: no figure is published, and that is
        # a stated outcome rather than an absent series.
        ip = '10.0.3.3'
        self.publish(ip, 'none')
        self.assertEqual(chips_source_sample(ip, self.NAME, 'none'), 1)
        self.assertEqual(chips_source_sample(ip, self.NAME, 'profile'), 0)
        self.assertEqual(chips_source_sample(ip, self.NAME, 'pyasic'), 0)

    def test_switching_source_moves_the_one_rather_than_adding_one(self):
        """The set is complete every cycle, so exactly one stays active."""
        ip = '10.0.3.4'
        self.publish(ip, 'pyasic')
        self.assertEqual(chips_source_sample(ip, self.NAME, 'pyasic'), 1)

        # The miner moved onto our path, or lost its expectation.
        publish_board_chips_source(ip, self.NAME, 'profile', BOARD_CHIPS_SOURCES)

        self.assertEqual(chips_source_sample(ip, self.NAME, 'pyasic'), 0)
        self.assertEqual(chips_source_sample(ip, self.NAME, 'profile'), 1)
        self.assertEqual(chips_source_sample(ip, self.NAME, 'none'), 0)

    def test_a_renamed_miner_does_not_leave_its_old_source_behind(self):
        ip = '10.0.3.5'
        self.publish(ip, 'profile')
        self.assertEqual(chips_source_sample(ip, 'worker', 'profile'), 1)

        publish_board_chips_source(ip, 'worker-renamed', 'profile', BOARD_CHIPS_SOURCES)

        self.assertIsNone(chips_source_sample(ip, 'worker', 'profile'))
        self.assertEqual(chips_source_sample(ip, 'worker-renamed', 'profile'), 1)

    def test_forgetting_a_miner_clears_the_source_series(self):
        ip = '10.0.3.6'
        self.publish(ip, 'profile')

        remove_miner_expected_series(ip)

        for source in BOARD_CHIPS_SOURCES:
            with self.subTest(source=source):
                self.assertIsNone(chips_source_sample(ip, self.NAME, source))

    def test_the_derivation_names_the_producer_that_actually_supplied_it(self):
        """
        `_board_chips_source` decides the label off the data, not the config.

        It is the one new branch in the publish path, and a wrong label here is
        exactly the failure DMI-189 exists to prevent: a registry-supplied figure
        presented as something else. The collector imports pyasic at module
        import, so it is stubbed in the same shape `test_dockerfile_completeness`
        and the scratch harnesses use.
        """
        import sys
        import types
        stub = types.ModuleType('pyasic')
        stub.get_miner = lambda *a, **k: None
        saved = sys.modules.get('pyasic')
        sys.modules['pyasic'] = stub
        try:
            from collectors.pyasic_collector import _board_chips_source
        finally:
            if saved is None:
                sys.modules.pop('pyasic', None)
            else:
                sys.modules['pyasic'] = saved

        # Our driver tagged its own output: the figure came from the profile.
        self.assertEqual(
            _board_chips_source({'expected_chips_source': 'profile'},
                                {'0': {'expected_chips': 70}}),
            'profile')

        # No tag, but an expectation is in the merged boards: only pyasic's
        # board objects could have put it there.
        self.assertEqual(
            _board_chips_source({}, {'0': {'expected_chips': 78}, '1': {}}),
            'pyasic')

        # Nothing stated a figure -- the M50 VH70 / M50S VH50 / M60 case.
        self.assertEqual(_board_chips_source({}, {'0': {'chips': 78, 'temp': 70}}), 'none')
        self.assertEqual(_board_chips_source({}, {}), 'none')

    def test_cleaning_up_an_unknown_miner_is_a_safe_noop(self):
        # No cache entry: the series were never published, so this must not raise.
        remove_miner_expected_series('10.255.255.253')

    def test_the_family_is_not_reachable_through_get_all_miner_metrics(self):
        """
        It carries `source` where the miner gauges carry `algorithm`, so a
        blanket remove(ip, name, model, algorithm) would raise (DMI-55's gap) —
        which is why it has its own removal path and must not be added there.
        """
        self.assertNotIn('miner_board_chips_expected_source',
                         [m._name for m in get_all_miner_metrics()])


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

def psu_sample(metric_name, ip, name, model, psu_model):
    return REGISTRY.get_sample_value(
        metric_name,
        {'ip': ip, 'name': name, 'model': model, 'psu_model': psu_model})


class PsuPublishingTest(unittest.TestCase):
    """DMI-94: PSU input readings, and the series that must not exist."""

    NAME = 'worker'
    MODEL = 'M30S++_VH90_(Stock)'
    PSU = 'P222B'

    # 192.168.2.101 as it read on 2026-08-28.
    HEALTHY = {'vin': 222.0, 'iin': 15.0, 'pin': 3328.0, 'temp': 32.0,
               'fan': 7768.0, 'psu_model': PSU}

    def publish(self, ip, readings):
        self.addCleanup(remove_miner_psu_series, ip)
        set_miner_psu(ip, self.NAME, self.MODEL, readings)
        return ip

    def volts(self, ip, psu_model=None):
        return psu_sample('miner_psu_input_volts', ip, self.NAME, self.MODEL,
                          psu_model or self.PSU)

    def test_publishes_every_reading(self):
        ip = self.publish('10.0.4.1', self.HEALTHY)

        self.assertEqual(self.volts(ip), 222.0)
        self.assertEqual(
            psu_sample('miner_psu_input_amps', ip, self.NAME, self.MODEL, self.PSU), 15.0)
        self.assertEqual(
            psu_sample('miner_psu_input_watts', ip, self.NAME, self.MODEL, self.PSU), 3328.0)
        self.assertEqual(
            psu_sample('miner_psu_temp_c', ip, self.NAME, self.MODEL, self.PSU), 32.0)

    def test_psu_fan_reaches_the_existing_fan_metric(self):
        # The PSU fan has no metric of its own: `fan_id="psu"` is an existing
        # deliberate key in miner_fan_speed_rpm, and a second metric name for
        # the same quantity would be a permanent footnote.
        ip = '10.0.4.2'
        self.addCleanup(remove_miner_fan_series, ip)

        set_miner_fans(ip, self.NAME, self.MODEL, {'0': 7207, 'psu': 7768.0})

        self.assertEqual(fan_sample(ip, self.NAME, self.MODEL, 'psu'), 7768.0)

    def test_a_miner_with_no_psu_data_publishes_nothing(self):
        # The DG1+ at 192.168.2.78: its own protocol, no `get_psu`, and a
        # fabricated 0 V would read as a site-wide outage in any aggregate.
        for readings in (None, {}):
            ip = self.publish('10.0.4.3', readings)
            for metric_name in ('miner_psu_input_volts', 'miner_psu_input_amps',
                                'miner_psu_input_watts', 'miner_psu_temp_c'):
                for psu_model in (self.PSU, 'unknown'):
                    self.assertIsNone(
                        psu_sample(metric_name, ip, self.NAME, self.MODEL, psu_model),
                        '{} {!r}'.format(metric_name, readings))

    def test_an_unresolved_field_is_absent_not_zero(self):
        # 192.168.2.74 reports no temperature at all.
        ip = self.publish('10.0.4.4', dict(self.HEALTHY, temp=None))

        self.assertEqual(self.volts(ip), 222.0)
        self.assertIsNone(
            psu_sample('miner_psu_temp_c', ip, self.NAME, self.MODEL, self.PSU))

    def test_a_reading_that_stops_arriving_is_dropped(self):
        # Not held over: a stale temperature would keep a PSU that has stopped
        # measuring looking cool.
        ip = self.publish('10.0.4.5', self.HEALTHY)
        set_miner_psu(ip, self.NAME, self.MODEL, dict(self.HEALTHY, temp=None))

        self.assertIsNone(
            psu_sample('miner_psu_temp_c', ip, self.NAME, self.MODEL, self.PSU))
        self.assertEqual(self.volts(ip), 222.0)

    def test_readings_stop_when_the_psu_stops_answering(self):
        ip = self.publish('10.0.4.6', self.HEALTHY)
        set_miner_psu(ip, self.NAME, self.MODEL, None)

        self.assertIsNone(self.volts(ip))

    def test_a_psu_swap_does_not_leave_the_old_model_behind(self):
        ip = self.publish('10.0.4.7', self.HEALTHY)
        set_miner_psu(ip, self.NAME, self.MODEL, dict(self.HEALTHY, psu_model='P221B'))

        self.assertIsNone(self.volts(ip))
        self.assertEqual(self.volts(ip, psu_model='P221B'), 222.0)

    def test_a_psu_without_a_model_is_labelled_unknown(self):
        ip = self.publish('10.0.4.8', dict(self.HEALTHY, psu_model=None))

        self.assertEqual(self.volts(ip, psu_model='unknown'), 222.0)

    def test_removal_clears_every_gauge(self):
        ip = self.publish('10.0.4.9', self.HEALTHY)

        remove_miner_psu_series(ip)

        for metric_name in ('miner_psu_input_volts', 'miner_psu_input_amps',
                            'miner_psu_input_watts', 'miner_psu_temp_c'):
            self.assertIsNone(
                psu_sample(metric_name, ip, self.NAME, self.MODEL, self.PSU), metric_name)

    def test_forget_miner_removes_the_psu_series(self):
        ip = self.publish('10.0.4.10', self.HEALTHY)

        forget_miner(ip)

        self.assertIsNone(self.volts(ip))

    def test_a_psu_only_miner_is_still_known(self):
        ip = self.publish('10.0.4.11', self.HEALTHY)

        self.assertIn(ip, known_miner_ips())

    def test_cleanup_of_an_unknown_miner_is_a_safe_noop(self):
        remove_miner_psu_series('10.255.255.252')

    def test_psu_gauges_stay_out_of_get_all_miner_metrics(self):
        # Not an oversight, and not safe to "fix": that list is consumed by
        # remove_miner_series(), which calls metric.remove(ip, name, model,
        # algorithm) positionally. A gauge carrying `psu_model` in the fourth
        # position would be handed a value that never matches, and
        # prometheus_client answers a non-matching label set by doing nothing
        # -- so every cleanup would appear to run and silently leave the PSU
        # series behind. They are removed by remove_miner_psu_series() instead,
        # exactly as the board, fan and DMI-81 families are.
        registered = set(get_all_miner_metrics())
        for metric in (miner_psu_input_volts, miner_psu_input_amps,
                       miner_psu_input_watts, miner_psu_temp_c):
            self.assertNotIn(metric, registered)

    def test_the_failure_streak_cull_reaches_psu_series(self):
        # What main.py does once a miner passes FAILURE_THRESHOLD. A mains
        # voltage from a machine that has not answered in hours reads as a
        # live measurement of the site.
        ip = self.publish('10.0.4.12', self.HEALTHY)

        remove_miner_series(ip, get_stale_value_metrics())
        remove_miner_psu_series(ip)

        self.assertIsNone(self.volts(ip))

if __name__ == '__main__':
    unittest.main(verbosity=2)
