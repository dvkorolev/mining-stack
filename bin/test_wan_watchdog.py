#!/usr/bin/env python3
"""
Unit tests for bin/wan_watchdog.py.

Stdlib only. Nothing here touches the network: the link probe is stubbed and
time is injected, so a multi-hour outage is simulated in milliseconds.

The tests that matter most are the ones about *not* acting: the watchdog reboots
the site's router, so every guard that holds it back is load-bearing. It must
stay still below the threshold, refuse to act when the fault is on our own side
of the router, refuse when the radio is healthy and the account is the problem,
and stop entirely once its budget is spent.

Note the threshold these are written against is 10 minutes, not the 45 an
earlier version used. That figure came from a self-heal envelope of 21-23
minutes which was later withdrawn -- see the retraction on DMI-46. On the
corrected record no outage has ever self-healed.
"""

import logging
import sys
import tempfile
import unittest
from pathlib import Path

BIN_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(BIN_DIR))

import wan_watchdog as ww

# The watchdog is deliberately talkative; tests only care about behaviour.
logging.disable(logging.CRITICAL)


class RecordingBackend(ww.PowerBackend):
    name = "recording"

    def __init__(self):
        self.calls = []

    def cycle(self, socket_name, off_seconds):
        self.calls.append((socket_name, off_seconds))


class RecordingRestarter(ww.RouterRestarter):
    name = "recording"

    def __init__(self):
        self.calls = 0

    def restart(self):
        self.calls += 1


def make_watchdog(tmpdir, *, armed=True, diagnose=None, up=False, lan=None):
    """A watchdog whose link state is whatever `up` says at the time of call.

    `lan` mirrors the real callback: True healthy, False broken on our side,
    None unknown.
    """
    backend = RecordingBackend()
    restarter = RecordingRestarter()
    wd = ww.Watchdog(
        th=ww.Thresholds(),
        backend=backend,
        state_file=Path(tmpdir) / "state.json",
        armed=armed,
        router_socket="router",
        pi_socket="pi",
        diagnose=diagnose or (lambda: ww.Diagnosis.UNKNOWN),
        restarter=restarter,
        lan_is_healthy=(lambda: lan),
    )
    wd._up = up
    ww.link_is_up = lambda probes, timeout: wd._up
    return wd, backend, restarter


class ThresholdTests(unittest.TestCase):
    """When the ladder fires, and in which order."""

    def setUp(self):
        self._real_link_is_up = ww.link_is_up
        self.tmp = tempfile.TemporaryDirectory()

    def tearDown(self):
        ww.link_is_up = self._real_link_is_up
        self.tmp.cleanup()

    def _run_outage(self, minutes, **kw):
        wd, backend, restarter = make_watchdog(self.tmp.name, up=False, **kw)
        t = 1_000_000.0
        # One tick a minute for the whole outage.
        for _ in range(minutes):
            wd.tick(now=t)
            t += 60
        return wd, backend, restarter

    def test_silent_through_a_brief_drop(self):
        """Short drops must not cost a router reboot."""
        _, backend, restarter = self._run_outage(8)

        self.assertEqual(restarter.calls, 0)
        self.assertEqual(backend.calls, [])

    def test_still_silent_just_below_the_threshold(self):
        _, backend, restarter = self._run_outage(12)

        self.assertEqual(restarter.calls, 0)
        self.assertEqual(backend.calls, [])

    def test_restarts_the_router_first_past_the_threshold(self):
        """Rung 0 is the RCI restart, the only action with a record of working.

        Cutting mains power is strictly heavier -- it drops the LAN too -- so it
        must never be what happens first.
        """
        _, backend, restarter = self._run_outage(16)

        self.assertEqual(restarter.calls, 1)
        self.assertEqual(backend.calls, [], "power was cut before trying a restart")

    def test_escalates_to_power_only_after_the_restart_fails(self):
        # 3 rounds to declare, 10 min to the restart, 15 min settle, then power.
        _, backend, restarter = self._run_outage(32)

        self.assertEqual(restarter.calls, 1)
        self.assertEqual(len(backend.calls), 1)
        self.assertEqual(backend.calls[0][0], "router")

    def test_ladder_does_not_repeat_forever(self):
        _, backend, restarter = self._run_outage(240)

        self.assertEqual(restarter.calls, 1, "ladder must exhaust rather than loop")
        self.assertLessEqual(len(backend.calls), 1)

    def test_unarmed_watchdog_never_acts(self):
        _, backend, restarter = self._run_outage(240, armed=False)

        self.assertEqual(restarter.calls, 0)
        self.assertEqual(backend.calls, [])


class LanHealthTests(unittest.TestCase):
    """Separating "the uplink is down" from "our own side is broken"."""

    def setUp(self):
        self._real_link_is_up = ww.link_is_up
        self.tmp = tempfile.TemporaryDirectory()

    def tearDown(self):
        ww.link_is_up = self._real_link_is_up
        self.tmp.cleanup()

    def _run(self, minutes, lan):
        wd, backend, restarter = make_watchdog(self.tmp.name, up=False, lan=lan)
        t = 1_000_000.0
        for _ in range(minutes):
            wd.tick(now=t)
            t += 60
        return backend, restarter

    def test_broken_lan_blocks_the_restart(self):
        """If this Pi cannot see the miners either, the router is not the fault.

        Rebooting it would not help and would destroy the evidence.
        """
        backend, restarter = self._run(240, lan=False)

        self.assertEqual(restarter.calls, 0)
        self.assertEqual(backend.calls, [])

    def test_healthy_lan_allows_the_restart(self):
        """The 2026-08-12 shape: LAN perfectly healthy, only egress dead."""
        backend, restarter = self._run(16, lan=True)

        self.assertEqual(restarter.calls, 1)

    def test_unknown_lan_does_not_block(self):
        """An unanswerable question is not evidence of a local fault.

        Prometheus lives on the same Pi; if it is unreachable the watchdog must
        still be able to recover the uplink, or it never acts when it matters.
        """
        backend, restarter = self._run(16, lan=None)

        self.assertEqual(restarter.calls, 1)


class DiagnosisTests(unittest.TestCase):
    def setUp(self):
        self._real_link_is_up = ww.link_is_up
        self.tmp = tempfile.TemporaryDirectory()

    def tearDown(self):
        ww.link_is_up = self._real_link_is_up
        self.tmp.cleanup()

    def test_upstream_fault_triggers_no_action_at_all(self):
        """A live radio with no traffic means an unpaid account, not a hang.

        Neither rung helps: the 2026-08-07 outage ran ~12 hours and ended when
        the account was topped up, with no restart or power cycle involved.
        """
        wd, backend, restarter = make_watchdog(
            self.tmp.name, up=False, diagnose=lambda: ww.Diagnosis.UPSTREAM)
        t = 1_000_000.0
        for _ in range(120):
            wd.tick(now=t)
            t += 60

        self.assertEqual(restarter.calls, 0,
                         "restarted the router for a fault beyond the router")
        self.assertEqual(backend.calls, [],
                         "power cycled a fault that power cycling cannot fix")


class RecoveryTests(unittest.TestCase):
    def setUp(self):
        self._real_link_is_up = ww.link_is_up
        self.tmp = tempfile.TemporaryDirectory()

    def tearDown(self):
        ww.link_is_up = self._real_link_is_up
        self.tmp.cleanup()

    def test_recovery_resets_the_ladder(self):
        wd, backend, restarter = make_watchdog(self.tmp.name, up=False)
        t = 1_000_000.0
        for _ in range(50):
            wd.tick(now=t)
            t += 60
        self.assertEqual(len(backend.calls), 1)

        wd._up = True
        wd.tick(now=t)
        self.assertEqual(wd.state.link, ww.LinkState.UP.value)
        self.assertEqual(wd.state.rung, 0)
        self.assertIsNone(wd.state.down_since)

    def test_a_brief_blip_never_declares_the_link_down(self):
        wd, _, restarter = make_watchdog(self.tmp.name, up=False)
        wd.tick(now=1_000_000.0)
        wd.tick(now=1_000_060.0)
        self.assertEqual(wd.state.link, ww.LinkState.UP.value,
                         "two failed probes should not be an outage yet")


class BudgetTests(unittest.TestCase):
    def setUp(self):
        self._real_link_is_up = ww.link_is_up
        self.tmp = tempfile.TemporaryDirectory()

    def tearDown(self):
        ww.link_is_up = self._real_link_is_up
        self.tmp.cleanup()

    def test_budget_window_expires_old_actions(self):
        th = ww.Thresholds()
        st = ww.State()
        now = 1_000_000.0
        st.action_times = [now - th.budget_window - 1] * 5
        self.assertFalse(st.budget_spent(th, now),
                         "actions older than the window must not count")

    def test_budget_blocks_once_full(self):
        th = ww.Thresholds()
        st = ww.State()
        now = 1_000_000.0
        st.action_times = [now - 60] * th.budget_actions
        self.assertTrue(st.budget_spent(th, now))


class SafetyTests(unittest.TestCase):
    def test_refuses_to_switch_its_own_socket(self):
        with tempfile.TemporaryDirectory() as tmp:
            with self.assertRaises(ValueError):
                ww.Watchdog(
                    th=ww.Thresholds(),
                    backend=ww.LoggingBackend(),
                    state_file=Path(tmp) / "s.json",
                    armed=True,
                    router_socket="strip-1",
                    pi_socket="strip-1",
                    diagnose=lambda: ww.Diagnosis.UNKNOWN,
                )

    def test_unarmed_watchdog_takes_no_action(self):
        with tempfile.TemporaryDirectory() as tmp:
            real = ww.link_is_up
            try:
                wd, backend, restarter = make_watchdog(tmp, up=False, armed=False)
                t = 1_000_000.0
                for _ in range(120):
                    wd.tick(now=t)
                    t += 60
                self.assertEqual(backend.calls, [])
            finally:
                ww.link_is_up = real

    def test_tuya_backend_is_not_silently_a_noop(self):
        backend = ww.TuyaBackend("id", "key", "192.168.2.99")
        with self.assertRaises(NotImplementedError):
            backend.cycle("router", 30)


class StatePersistenceTests(unittest.TestCase):
    def test_state_survives_a_restart(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "state.json"
            st = ww.State(link="down", down_since=123.0, rung=1,
                          action_times=[1.0, 2.0])
            st.save(path)
            again = ww.State.load(path)
            self.assertEqual(again.link, "down")
            self.assertEqual(again.rung, 1)
            self.assertEqual(again.action_times, [1.0, 2.0])

    def test_missing_state_file_yields_defaults(self):
        with tempfile.TemporaryDirectory() as tmp:
            st = ww.State.load(Path(tmp) / "nope.json")
            self.assertEqual(st.link, ww.LinkState.UP.value)
            self.assertEqual(st.rung, 0)


if __name__ == "__main__":
    unittest.main()
