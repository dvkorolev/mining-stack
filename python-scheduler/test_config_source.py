"""
Unit tests for miner-config provenance in config.py and health_check.py.

Regression cover for DMI-58: when the backend API was unreachable the loader
silently read the YAML seed file — which ships example miners — and the health
check re-probed the backend instead of reporting the config actually in use, so
polling four placeholders looked exactly like a healthy collection.

Run standalone (no pytest needed):
    python python-scheduler/test_config_source.py
"""

import os
import tempfile
import unittest
from unittest import mock

import config
from config import (
    CONFIG_SOURCE_DATABASE,
    CONFIG_SOURCE_NONE,
    CONFIG_SOURCE_STALE_CACHE,
    CONFIG_SOURCE_YAML,
    CONFIG_SOURCE_YAML_FALLBACK,
    CONFIG_SOURCES,
    DEGRADED_CONFIG_SOURCES,
)
from health_check import HealthCheck, HealthStatus

REAL_FLEET = [
    {'ip': f'192.168.2.{n}', 'name': f'worker-{n}', 'model': 'M50'}
    for n in range(101, 126)
]
# What etc/miners.yaml actually ships, and what the fleet was replaced with.
PLACEHOLDER_YAML = """
miners:
  - ip: 192.168.1.100
    name: miner-01
    model: Antminer S19
  - ip: 192.168.1.101
    name: miner-02
    model: Antminer S19
"""


class FakeResponse:
    def __init__(self, status_code, payload=None):
        self.status_code = status_code
        self._payload = payload or {}

    def json(self):
        return self._payload


class ConfigSourceTestBase(unittest.TestCase):
    """Each test starts from a cold cache and its own temp YAML file."""

    yaml_content = PLACEHOLDER_YAML

    def setUp(self):
        handle, path = tempfile.mkstemp(suffix='.yaml')
        with os.fdopen(handle, 'w') as f:
            f.write(self.yaml_content)
        self.addCleanup(os.unlink, path)

        patches = {
            'MINERS_CONFIG': path,
            'USE_DATABASE_CONFIG': True,
            'SYSTEM_API_KEY': 'test-key',
            'miners_config_cache': None,
            'last_config_load': 0,
            'miners_config_source': CONFIG_SOURCE_NONE,
        }
        for name, value in patches.items():
            patcher = mock.patch.object(config, name, value)
            patcher.start()
            self.addCleanup(patcher.stop)

    def api_returns(self, miners):
        return mock.patch.object(
            config.requests, 'get',
            return_value=FakeResponse(200, {'miners': list(miners)}))

    def api_unreachable(self):
        return mock.patch.object(
            config.requests, 'get',
            side_effect=OSError('Name or service not known: backend'))


class LoadMinersConfigTest(ConfigSourceTestBase):

    def test_database_api_is_the_source_when_reachable(self):
        with self.api_returns(REAL_FLEET):
            miners = config.load_miners_config()

        self.assertEqual(len(miners), 25)
        self.assertEqual(config.get_miners_config_source(), CONFIG_SOURCE_DATABASE)

    def test_unreachable_backend_keeps_the_fleet_instead_of_yaml_placeholders(self):
        """The DMI-58 failure: 25 real miners must not become 2 examples."""
        with self.api_returns(REAL_FLEET):
            config.load_miners_config()

        config.last_config_load = 0  # expire the cache, force a refetch
        with self.api_unreachable():
            miners = config.load_miners_config()

        self.assertEqual(len(miners), 25)
        self.assertEqual(config.get_miners_config_source(), CONFIG_SOURCE_STALE_CACHE)

    def test_yaml_fallback_only_when_nothing_was_ever_fetched(self):
        with self.api_unreachable():
            miners = config.load_miners_config()

        self.assertEqual(len(miners), 2)
        self.assertEqual(config.get_miners_config_source(), CONFIG_SOURCE_YAML_FALLBACK)

    def test_degraded_sources_retry_the_api_on_every_call(self):
        """A degraded load must not be cached as fresh, or recovery waits out the TTL."""
        with self.api_unreachable():
            config.load_miners_config()
        self.assertEqual(config.get_miners_config_source(), CONFIG_SOURCE_YAML_FALLBACK)

        with self.api_returns(REAL_FLEET):
            miners = config.load_miners_config()

        self.assertEqual(len(miners), 25)
        self.assertEqual(config.get_miners_config_source(), CONFIG_SOURCE_DATABASE)

    def test_fresh_database_config_is_served_from_cache(self):
        with self.api_returns(REAL_FLEET) as api:
            config.load_miners_config()
            config.load_miners_config()

        self.assertEqual(api.call_count, 1)

    def test_http_error_is_treated_as_unreachable(self):
        with mock.patch.object(config.requests, 'get', return_value=FakeResponse(503)):
            config.load_miners_config()

        self.assertEqual(config.get_miners_config_source(), CONFIG_SOURCE_YAML_FALLBACK)

    def test_yaml_is_the_intended_source_when_database_config_is_off(self):
        with mock.patch.object(config, 'USE_DATABASE_CONFIG', False):
            with mock.patch.object(config.requests, 'get') as api:
                miners = config.load_miners_config()

        self.assertEqual(len(miners), 2)
        self.assertEqual(config.get_miners_config_source(), CONFIG_SOURCE_YAML)
        api.assert_not_called()

    def test_miners_get_a_name_derived_from_their_ip(self):
        with self.api_returns([{'ip': '192.168.2.7'}, {'ip': '192.168.2.8', 'alias': 'rig-8'}]):
            miners = config.load_miners_config()

        self.assertEqual(miners[0]['name'], 'miner-192-168-2-7')
        self.assertEqual(miners[1]['name'], 'rig-8')

    def test_reload_refetches_from_the_api(self):
        with self.api_returns(REAL_FLEET[:3]):
            config.load_miners_config()

        config.invalidate_config_cache()

        with self.api_returns(REAL_FLEET):
            miners = config.load_miners_config()

        self.assertEqual(len(miners), 25)
        self.assertEqual(config.get_miners_config_source(), CONFIG_SOURCE_DATABASE)

    def test_reload_during_a_backend_outage_keeps_the_fleet(self):
        """/reload must not be a second route back to the YAML placeholders."""
        with self.api_returns(REAL_FLEET):
            config.load_miners_config()

        config.invalidate_config_cache()

        with self.api_unreachable():
            miners = config.load_miners_config()

        self.assertEqual(len(miners), 25)
        self.assertEqual(config.get_miners_config_source(), CONFIG_SOURCE_STALE_CACHE)

    def test_every_reachable_source_is_a_known_value(self):
        self.assertIn(CONFIG_SOURCE_DATABASE, CONFIG_SOURCES)
        for source in DEGRADED_CONFIG_SOURCES:
            self.assertIn(source, CONFIG_SOURCES)
        self.assertNotIn(CONFIG_SOURCE_DATABASE, DEGRADED_CONFIG_SOURCES)
        self.assertNotIn(CONFIG_SOURCE_YAML, DEGRADED_CONFIG_SOURCES)


class MissingYamlTest(ConfigSourceTestBase):

    def test_no_source_at_all_reports_none(self):
        with mock.patch.object(config, 'MINERS_CONFIG', '/nonexistent/miners.yaml'):
            with self.api_unreachable():
                miners = config.load_miners_config()

        self.assertEqual(miners, [])
        self.assertEqual(config.get_miners_config_source(), CONFIG_SOURCE_NONE)


class HealthCheckConfigSourceTest(ConfigSourceTestBase):
    """The health check must report the config in use, not re-probe the backend."""

    def setUp(self):
        super().setUp()
        self.checker = HealthCheck(collection_lock=mock.Mock(), service_state=mock.Mock())

    def status_now(self):
        status, message, details = self.checker.check_config_file()
        return status, details

    def test_database_config_is_healthy(self):
        with self.api_returns(REAL_FLEET):
            config.load_miners_config()

        status, details = self.status_now()

        self.assertEqual(status, HealthStatus.HEALTHY)
        self.assertEqual(details['source'], CONFIG_SOURCE_DATABASE)
        self.assertEqual(details['miners_count'], 25)

    def test_yaml_fallback_is_degraded_even_though_the_backend_is_back(self):
        """The old check probed the backend live and reported healthy here."""
        with self.api_unreachable():
            config.load_miners_config()

        with self.api_returns(REAL_FLEET):  # backend up again, config not reloaded
            status, details = self.status_now()

        self.assertEqual(status, HealthStatus.DEGRADED)
        self.assertEqual(details['source'], CONFIG_SOURCE_YAML_FALLBACK)
        self.assertEqual(details['miners_count'], 2)

    def test_stale_cache_is_degraded(self):
        with self.api_returns(REAL_FLEET):
            config.load_miners_config()
        config.last_config_load = 0
        with self.api_unreachable():
            config.load_miners_config()

        status, details = self.status_now()

        self.assertEqual(status, HealthStatus.DEGRADED)
        self.assertEqual(details['source'], CONFIG_SOURCE_STALE_CACHE)

    def test_startup_before_any_load_is_degraded_not_unhealthy(self):
        status, _ = self.status_now()

        self.assertEqual(status, HealthStatus.DEGRADED)

    def test_loaded_but_empty_is_unhealthy(self):
        with self.api_returns([]):
            config.load_miners_config()

        status, details = self.status_now()

        self.assertEqual(status, HealthStatus.UNHEALTHY)
        self.assertEqual(details['miners_count'], 0)

    def test_degraded_config_drags_the_overall_status_down(self):
        with self.api_unreachable():
            config.load_miners_config()

        overall = self.checker.perform_full_check()

        self.assertNotEqual(overall['status'], HealthStatus.HEALTHY)
        self.assertEqual(
            overall['checks']['config_file']['details']['source'],
            CONFIG_SOURCE_YAML_FALLBACK,
        )


class PublishConfigSourceTest(unittest.TestCase):
    """The gauge must expose one series per source, so alerts can watch == 1."""

    def test_exactly_one_source_is_active(self):
        from prometheus_client import REGISTRY
        from metrics import publish_config_source

        publish_config_source(CONFIG_SOURCE_STALE_CACHE, 25, CONFIG_SOURCES)

        active = {
            source: REGISTRY.get_sample_value('scheduler_config_source', {'source': source})
            for source in CONFIG_SOURCES
        }
        self.assertEqual(active[CONFIG_SOURCE_STALE_CACHE], 1)
        self.assertEqual(
            [v for s, v in active.items() if s != CONFIG_SOURCE_STALE_CACHE],
            [0] * (len(CONFIG_SOURCES) - 1),
        )
        self.assertEqual(REGISTRY.get_sample_value('scheduler_miners_configured'), 25)


if __name__ == '__main__':
    unittest.main(verbosity=2)
