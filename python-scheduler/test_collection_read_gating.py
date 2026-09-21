"""
DMI-208: our driver is read only when something will use the answer.

With the shipped defaults — `COLLECTION_PRIMARY=pyasic`, `COLLECTION_COMPARE=off`
— nothing reads it: `_report_comparison` is the only consumer of `own`, and it
sits under `comparing`. The read used to be unconditional with its result
discarded, so every WhatsMiner-class machine was read twice per cycle and our
driver's answer thrown away: measured on the Pi 2026-09-19, ~11 requests per
minute per machine against the ~2/min the pyasic path alone accounts for.

Both this file and `PROJECT_STATE.md` described that phase as inert. That was
true of published *values* and false of *load*, which is what these tests pin
from both sides: off under the defaults, on for the two states that consume it.

The soak the flip wants is the bounded `COLLECTION_COMPARE` window, which
produces findings. An unconditional read nobody inspects produces load, and a
driver returning an error dict under the default produced no signal at all —
only `_report_comparison` ever looked at `own`.

Run standalone (no pytest, no pyasic):
    python python-scheduler/test_collection_read_gating.py
"""

import asyncio
import sys
import types
import unittest
from unittest import mock

# The same stub as test_collection_path.py: collectors/pyasic_collector.py:11 is
# `from pyasic import get_miner` — the only pyasic import in the scheduler — and
# CI installs no pyasic, deliberately. Stubbing it is what lets a test reach the
# real collect_one(); no pyasic-free module can.
if 'pyasic' not in sys.modules:
    _pyasic_stub = types.ModuleType('pyasic')
    _pyasic_stub.get_miner = None  # patched per test, before any cycle runs
    sys.modules['pyasic'] = _pyasic_stub

import config
from collectors import pyasic_collector

# An exact match in asic_profiles.yaml for whatsminer_m30s (MicroBT, sha256):
# the machines our driver reads. VH40 is deliberately absent from
# COLLECTION_PYASIC_SOURCE_MODELS, so `_uses_our_path` alone decides.
OURS = 'M30S++ VH40 (Stock)'
# An exact match for antminer_s19 (Bitmain): collect_one() returns before it
# could read anything, whatever the mode says.
NOT_OURS = 'Antminer S19'

UNREADABLE = {'error': 'stubbed reader', 'error_type': 'other'}


class ReadGatingTest(unittest.TestCase):
    """One real collect_pyasic_metrics() cycle per test, readers stubbed."""

    def setUp(self):
        self.own_reads = self.patch(
            pyasic_collector, '_read_with_our_driver',
            mock.AsyncMock(return_value=UNREADABLE))
        self.patch(pyasic_collector, 'get_miner',
                   mock.AsyncMock(return_value=None))
        self.patch(pyasic_collector, '_collect_via_cgminer_only',
                   mock.AsyncMock(return_value=UNREADABLE))
        self.patch(pyasic_collector, 'COLLECTION_PRIMARY', 'pyasic')
        self.set_compare(False)

    def patch(self, target, name, value):
        patcher = mock.patch.object(target, name, value)
        patcher.start()
        self.addCleanup(patcher.stop)
        return value

    def set_compare(self, enabled):
        """
        Turn the comparison on or off, in both places it lives.

        The collector binds COLLECTION_COMPARE at import (`from config import
        ...`) while compare_enabled_for() reads config's live attribute, so
        patching one of them changes nothing about the other.
        """
        self.patch(pyasic_collector, 'COLLECTION_COMPARE', enabled)
        self.patch(config, 'COLLECTION_COMPARE', enabled)

    def cycle(self, model=OURS):
        """Run one batch the way the scheduler does."""
        miner = {'ip': '10.208.0.1', 'name': 'dmi208', 'model': model,
                 'algorithm': 'sha256'}
        return asyncio.run(pyasic_collector.collect_pyasic_metrics([miner]))

    # -- the fixtures themselves --------------------------------------------

    def test_the_fixtures_take_the_paths_they_claim(self):
        """Otherwise every assertion below is about the wrong branch."""
        self.assertTrue(
            pyasic_collector._uses_our_path(OURS, 'sha256'),
            f'{OURS!r} no longer resolves to a MicroBT sha256 profile, so '
            f'collect_one() returns before the gate is reached')
        self.assertFalse(
            pyasic_collector._uses_our_path(NOT_OURS, 'sha256'),
            f'{NOT_OURS!r} now resolves to a profile our driver reads')

    # -- the regression -----------------------------------------------------

    def test_the_default_cycle_does_not_read_with_our_driver(self):
        """DMI-208 itself: the shipped defaults must not pay for the read."""
        self.cycle()

        self.own_reads.assert_not_called()

    def test_a_comparing_cycle_reads_with_our_driver(self):
        """The comparison consumes `own`, so it still has to be read."""
        self.set_compare(True)

        self.cycle()

        self.assertEqual(self.own_reads.call_count, 1)

    def test_the_flip_reads_with_our_driver(self):
        """PRIMARY=cgminer publishes ours; whether we compare is irrelevant."""
        self.patch(pyasic_collector, 'COLLECTION_PRIMARY', 'cgminer')

        self.cycle()

        self.assertEqual(self.own_reads.call_count, 1)

    def test_a_machine_our_path_does_not_speak_for_is_never_read(self):
        """Neither state matters if the machine was never ours to read."""
        self.set_compare(True)
        self.patch(pyasic_collector, 'COLLECTION_PRIMARY', 'cgminer')

        self.cycle(model=NOT_OURS)

        self.own_reads.assert_not_called()


if __name__ == '__main__':
    unittest.main(verbosity=2)
