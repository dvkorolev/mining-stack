"""
DMI-211: the gauge that makes the collection mode visible must have a sample.

`publish_collection_path()` was defined in metrics.py and called from nowhere in
the repository, so production published the HELP and TYPE lines of
`scheduler_collection_path` and no sample line at all. The metric written to
satisfy DMI-136's "a mode that runs must not be invisible" was itself invisible.
A test asserting that the *function* exists cannot see that; these run a real
`collect_pyasic_metrics()` cycle and read what a scrape would read.

`scheduler_collection_compare` is checked for its *value*, not for its
existence: it is an unlabelled Gauge, so prometheus_client emits `0.0` for it
even while the publisher is dead. "The family has a sample" would have been
true, and useless, for exactly this metric.

Run standalone (no pytest, no pyasic):
    python python-scheduler/test_collection_path.py
"""

import asyncio
import sys
import types
import unittest
from unittest import mock

# collectors/pyasic_collector.py:11 is `from pyasic import get_miner` -- the only
# pyasic import in the scheduler -- and CI installs no pyasic, deliberately (see
# the DMI-136 block in .github/workflows/ci.yml). Stub the one symbol it needs
# rather than skipping the test: the whole point of this file is to reach the
# *call site* inside collect_pyasic_metrics(), and no pyasic-free module can.
if 'pyasic' not in sys.modules:
    _pyasic_stub = types.ModuleType('pyasic')
    _pyasic_stub.get_miner = None  # patched per test, before any cycle runs
    sys.modules['pyasic'] = _pyasic_stub

from prometheus_client import REGISTRY

import config
from collectors import pyasic_collector

# An exact match in asic_profiles.yaml for whatsminer_m30s (manufacturer
# MicroBT, algorithm sha256), and VH40 is deliberately absent from
# COLLECTION_PYASIC_SOURCE_MODELS -- so our path is the one that publishes and
# `compare_enabled_for` alone decides the comparison. The precondition is
# asserted below, so a profile change fails loudly instead of quietly testing
# the early-return branch.
MODEL = 'M30S++ VH40 (Stock)'

UNREADABLE = {'error': 'stubbed reader', 'error_type': 'other'}


def sample(name, labels=None):
    """Current value of a series, or None when no sample is published."""
    return REGISTRY.get_sample_value(name, labels or {})


class CollectionPathPublishTest(unittest.TestCase):
    """One real collect_pyasic_metrics() cycle per test, readers stubbed."""

    MINER = {'ip': '10.211.0.1', 'name': 'dmi211', 'model': MODEL,
             'algorithm': 'sha256'}

    def setUp(self):
        # The readers are stubbed so the cycle opens no socket; the cycle
        # itself, and the publish block at its end, are the real ones.
        self.patch(pyasic_collector, 'get_miner',
                   mock.AsyncMock(return_value=None))
        self.patch(pyasic_collector, '_collect_via_cgminer_only',
                   mock.AsyncMock(return_value=UNREADABLE))
        self.patch(pyasic_collector, '_read_with_our_driver',
                   mock.AsyncMock(return_value=UNREADABLE))
        self.patch(pyasic_collector, 'COLLECTION_PRIMARY', 'pyasic')
        self.set_compare(True)

    def patch(self, target, name, value):
        patcher = mock.patch.object(target, name, value)
        patcher.start()
        self.addCleanup(patcher.stop)

    def set_compare(self, enabled, cycles=None):
        """
        Turn the comparison on or off, in both places it lives.

        The collector binds COLLECTION_COMPARE at import (`from config import
        ...`) while compare_enabled_for() reads config's live attribute, so
        patching one of them changes nothing about the other.
        """
        self.patch(pyasic_collector, 'COLLECTION_COMPARE', enabled)
        self.patch(config, 'COLLECTION_COMPARE', enabled)
        if cycles is not None:
            self.patch(config, 'COLLECTION_COMPARE_CYCLES', cycles)

    def seed_cycles_run(self, value):
        """Set the cycle counter the COLLECTION_COMPARE_CYCLES bound reads."""
        original = list(pyasic_collector._compare_cycles_run)
        pyasic_collector._compare_cycles_run[0] = value
        self.addCleanup(pyasic_collector._compare_cycles_run.__setitem__,
                        0, original[0])

    def cycle(self):
        """Run one batch the way the scheduler does."""
        return asyncio.run(pyasic_collector.collect_pyasic_metrics([self.MINER]))

    # -- the fixture itself -------------------------------------------------

    def test_the_fixture_really_takes_our_path(self):
        """Otherwise every test below exercises the early-return branch."""
        self.assertTrue(
            pyasic_collector._uses_our_path(MODEL, 'sha256'),
            f'{MODEL!r} no longer resolves to a MicroBT sha256 profile, so '
            f'collect_one() returns before it can compare')

    # -- the regression -----------------------------------------------------

    def test_the_path_gauge_has_a_sample_after_a_collection(self):
        """DMI-211 itself: a labelled family emits nothing until a child is set."""
        self.cycle()

        self.assertEqual(sample('scheduler_collection_path', {'path': 'pyasic'}), 1)
        self.assertEqual(sample('scheduler_collection_path', {'path': 'cgminer'}), 0)

    def test_the_compare_gauge_is_computed_not_the_registration_default(self):
        """
        Its `0.0` in any pre-fix scrape was the Gauge default, not a reading.

        The assertion is on the value for that reason: existence proves nothing
        here, which is why this test is not redundant with the one above.
        """
        self.cycle()

        self.assertEqual(sample('scheduler_collection_compare'), 1)

    def test_an_expired_compare_window_reads_zero_not_the_config_flag(self):
        """
        Decision DMI-211 took: `comparing` counts machines compared, not config.

        COLLECTION_COMPARE is on here; only the cycle bound has expired. Read
        from the flag, this would report 1 -- the fabricated value the ticket is
        about, pointing the other way.
        """
        self.set_compare(True, cycles=1)
        self.seed_cycles_run(5)

        self.cycle()

        self.assertEqual(sample('scheduler_collection_compare'), 0)
        # ... and the cycle ran: the path is still published, so the 0 above is
        # a computed 0 and not a missing call.
        self.assertEqual(sample('scheduler_collection_path', {'path': 'pyasic'}), 1)

    def test_the_primary_path_is_what_the_gauge_reports(self):
        self.patch(pyasic_collector, 'COLLECTION_PRIMARY', 'cgminer')

        self.cycle()

        self.assertEqual(sample('scheduler_collection_path', {'path': 'cgminer'}), 1)
        self.assertEqual(sample('scheduler_collection_path', {'path': 'pyasic'}), 0)

    def test_a_cycle_with_the_comparison_off_reads_zero_after_one_that_ran(self):
        """
        Why the reset had to become unconditional (DMI-211).

        _compare_stats was cleared only when COLLECTION_COMPARE was on, so the
        cycle after the comparison was switched off would still have published
        the previous cycle's machine count -- a stopped comparison reporting
        that it was running, which is the same lie in the other direction.
        """
        self.cycle()             # comparison on: one machine compared
        self.set_compare(False)  # switched off
        self.cycle()

        self.assertEqual(sample('scheduler_collection_compare'), 0)


if __name__ == '__main__':
    unittest.main(verbosity=2)
