"""
Unit tests for miner-reported pool status (DMI-56).

The fleet's real pools were invisible to monitoring: the collector summed each
miner's pool share counters and discarded the pool URLs and Alive/Dead status,
while the blackbox job watched seven pools the farm does not use.

Run standalone (no pytest needed):
    python python-scheduler/test_pool_status.py
"""

import unittest

from prometheus_client import REGISTRY

from metrics import (
    _miner_pool_label_cache,
    miner_pool_alive,
    remove_miner_pool_series,
    set_miner_pools,
)
from parsers.cgminer_parser import parse_cgminer_response
from parsers.pool_status import extract_pool_status


class PyasicPool:
    """Stand-in for a pyasic pool object (attributes, not dict keys)."""

    def __init__(self, url, alive=True, index=None):
        self.url = url
        self.alive = alive
        if index is not None:
            self.index = index


def alive_sample(ip, name, url, pool_index):
    return REGISTRY.get_sample_value(
        'miner_pool_alive',
        {'ip': ip, 'name': name, 'url': url, 'pool_index': str(pool_index)},
    )


class ExtractPoolStatusTest(unittest.TestCase):

    def test_pyasic_objects(self):
        pools = [
            PyasicPool('stratum+tcp://gate.emcd.network:3333', alive=True),
            PyasicPool('stratum+tcp://eu.emcd.network:3333', alive=False),
        ]

        result = extract_pool_status(pools)

        self.assertEqual(
            result,
            [
                {'index': 0, 'url': 'stratum+tcp://gate.emcd.network:3333', 'alive': True},
                {'index': 1, 'url': 'stratum+tcp://eu.emcd.network:3333', 'alive': False},
            ],
        )

    def test_cgminer_dicts_use_the_status_word(self):
        pools = [
            {'POOL': 0, 'URL': 'stratum+tcp://gate.emcd.network:3333', 'Status': 'Alive'},
            {'POOL': 1, 'URL': 'stratum+tcp://eu.emcd.network:3333', 'Status': 'Dead'},
        ]

        result = extract_pool_status(pools)

        self.assertEqual([p['alive'] for p in result], [True, False])
        self.assertEqual([p['index'] for p in result], [0, 1])

    def test_alive_false_is_respected_over_a_healthy_looking_status(self):
        """`alive` is authoritative when present, including when it is False."""
        pool = {'URL': 'stratum+tcp://pool:3333', 'alive': False, 'Status': 'Alive'}

        self.assertEqual(extract_pool_status([pool])[0]['alive'], False)

    def test_stratum_active_is_the_last_resort(self):
        pool = {'URL': 'stratum+tcp://pool:3333', 'Stratum Active': False}

        self.assertEqual(extract_pool_status([pool])[0]['alive'], False)

    def test_pools_without_a_url_are_skipped(self):
        """An empty url label would merge unrelated pools into one series."""
        pools = [{'POOL': 0, 'URL': '', 'Status': 'Dead'}, PyasicPool('stratum+tcp://real:3333')]

        result = extract_pool_status(pools)

        self.assertEqual([p['url'] for p in result], ['stratum+tcp://real:3333'])

    def test_missing_status_is_not_reported_as_dead(self):
        """Inventing an outage for a collector that omits the field is worse."""
        result = extract_pool_status([{'URL': 'stratum+tcp://pool:3333'}])

        self.assertEqual(result[0]['alive'], True)

    def test_no_pools_at_all(self):
        self.assertEqual(extract_pool_status(None), [])
        self.assertEqual(extract_pool_status([]), [])
        self.assertEqual(extract_pool_status('not a list'), [])

    def test_index_falls_back_to_position(self):
        result = extract_pool_status([{'URL': 'a:1'}, {'URL': 'b:2'}])

        self.assertEqual([p['index'] for p in result], [0, 1])


class CgminerParserPoolFieldsTest(unittest.TestCase):
    """The parser used to keep only the share counters."""

    def test_url_and_status_survive_parsing(self):
        pools = {'POOLS': [{
            'POOL': 0,
            'URL': 'stratum+tcp://gate.emcd.network:3333',
            'Status': 'Alive',
            'Stratum Active': True,
            'Accepted': 1234,
            'Rejected': 5,
        }]}

        result = parse_cgminer_response(None, None, pools, None)

        self.assertEqual(result['pools'], [{
            'accepted': 1234,
            'rejected': 5,
            'index': 0,
            'url': 'stratum+tcp://gate.emcd.network:3333',
            'status': 'Alive',
            'stratum_active': True,
        }])

    def test_parsed_pools_feed_extract_directly(self):
        pools = {'POOLS': [
            {'POOL': 0, 'URL': 'stratum+tcp://gate.emcd.network:3333', 'Status': 'Alive'},
            {'POOL': 1, 'URL': 'stratum+tcp://eu.emcd.network:3333', 'Status': 'Dead'},
        ]}

        parsed = parse_cgminer_response(None, None, pools, None)

        self.assertEqual([p['alive'] for p in extract_pool_status(parsed['pools'])], [True, False])


class SetMinerPoolsTest(unittest.TestCase):
    """Each test uses its own ip so the shared default registry stays isolated."""

    def publish(self, ip, name, pools):
        self.addCleanup(remove_miner_pool_series, ip)
        set_miner_pools(ip, name, pools)

    def test_publishes_one_series_per_pool(self):
        self.publish('10.1.0.1', 'worker-1', extract_pool_status([
            PyasicPool('stratum+tcp://gate.emcd.network:3333', alive=True),
            PyasicPool('stratum+tcp://eu.emcd.network:3333', alive=False),
        ]))

        self.assertEqual(alive_sample('10.1.0.1', 'worker-1', 'stratum+tcp://gate.emcd.network:3333', 0), 1)
        self.assertEqual(alive_sample('10.1.0.1', 'worker-1', 'stratum+tcp://eu.emcd.network:3333', 1), 0)

    def test_a_pool_that_disappears_is_removed_not_frozen(self):
        """A stale `alive == 0` is indistinguishable from a pool down right now."""
        ip, name = '10.1.0.2', 'worker-2'
        old = 'stratum+tcp://old.pool:3333'
        self.publish(ip, name, extract_pool_status([PyasicPool(old, alive=False)]))
        self.assertEqual(alive_sample(ip, name, old, 0), 0)

        set_miner_pools(ip, name, extract_pool_status([
            PyasicPool('stratum+tcp://gate.emcd.network:3333', alive=True)]))

        self.assertIsNone(alive_sample(ip, name, old, 0))
        self.assertEqual(alive_sample(ip, name, 'stratum+tcp://gate.emcd.network:3333', 0), 1)

    def test_renaming_a_miner_does_not_leave_a_ghost_series(self):
        ip, url = '10.1.0.3', 'stratum+tcp://gate.emcd.network:3333'
        self.publish(ip, 'old-name', extract_pool_status([PyasicPool(url)]))

        set_miner_pools(ip, 'new-name', extract_pool_status([PyasicPool(url)]))

        self.assertIsNone(alive_sample(ip, 'old-name', url, 0))
        self.assertEqual(alive_sample(ip, 'new-name', url, 0), 1)

    def test_reporting_no_pools_clears_the_miner(self):
        ip, name, url = '10.1.0.4', 'worker-4', 'stratum+tcp://gate.emcd.network:3333'
        self.publish(ip, name, extract_pool_status([PyasicPool(url)]))

        set_miner_pools(ip, name, [])

        self.assertIsNone(alive_sample(ip, name, url, 0))
        self.assertNotIn(ip, _miner_pool_label_cache)

    def test_removing_an_unreachable_miner_drops_every_pool_series(self):
        ip, name = '10.1.0.5', 'worker-5'
        urls = ['stratum+tcp://gate.emcd.network:3333', 'stratum+tcp://eu.emcd.network:3333']
        self.publish(ip, name, extract_pool_status([PyasicPool(u) for u in urls]))

        remove_miner_pool_series(ip)

        for position, url in enumerate(urls):
            self.assertIsNone(alive_sample(ip, name, url, position))
        self.assertNotIn(ip, _miner_pool_label_cache)

    def test_removing_a_miner_that_never_reported_pools_is_a_no_op(self):
        remove_miner_pool_series('10.1.0.99')

    def test_other_miners_keep_their_series(self):
        url = 'stratum+tcp://gate.emcd.network:3333'
        self.publish('10.1.0.6', 'worker-6', extract_pool_status([PyasicPool(url)]))
        self.publish('10.1.0.7', 'worker-7', extract_pool_status([PyasicPool(url)]))

        remove_miner_pool_series('10.1.0.6')

        self.assertIsNone(alive_sample('10.1.0.6', 'worker-6', url, 0))
        self.assertEqual(alive_sample('10.1.0.7', 'worker-7', url, 0), 1)


if __name__ == '__main__':
    unittest.main(verbosity=2)
