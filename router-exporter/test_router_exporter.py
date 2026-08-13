"""
Unit tests for the router exporter's parsing (DMI-47).

Every function under test is pure, so the whole suite runs without a router.
Fixtures are real output captured from the site's Keenetic on 2026-08-12.

Run standalone (no pytest needed):
    python router-exporter/test_router_exporter.py
"""

import json
import threading
import unittest

import rci
from router_exporter import (
    build_interface_series,
    parse_hosts,
    parse_snmp_walk,
    parse_uplink,
)


class FakeOpener:
    """Stands in for the urllib opener. Nothing here touches a network."""

    def __init__(self, *results):
        self._results = list(results)
        self.requests = []

    def open(self, request, timeout=None):
        self.requests.append(request)
        result = self._results.pop(0)
        if isinstance(result, Exception):
            raise result

        class Response:
            def __init__(self, payload):
                self._body = json.dumps(payload).encode()

            def read(self):
                return self._body

            def __enter__(self):
                return self

            def __exit__(self, *exc):
                return False

        return Response(result)


# Trimmed real `snmpwalk -Oqn` output.
IF_DESCR = """
.1.3.6.1.2.1.2.2.1.2.2 GigabitEthernet0
.1.3.6.1.2.1.2.2.1.2.8 GigabitEthernet1
.1.3.6.1.2.1.2.2.1.2.30 CdcEthernet2
.1.3.6.1.2.1.2.2.1.2.31 UsbLte0
.1.3.6.1.2.1.2.2.1.2.40 Bridge0
.1.3.6.1.2.1.2.2.1.2.44 WifiMaster0/AccessPoint0
.1.3.6.1.2.1.2.2.1.2.99 ra7.2
"""
IF_IN = """
.1.3.6.1.2.1.31.1.1.1.6.2 419430400
.1.3.6.1.2.1.31.1.1.1.6.8 0
.1.3.6.1.2.1.31.1.1.1.6.30 5807269197
.1.3.6.1.2.1.31.1.1.1.6.40 763363328
.1.3.6.1.2.1.31.1.1.1.6.44 483183820
.1.3.6.1.2.1.31.1.1.1.6.99 12345
"""
IF_OUT = """
.1.3.6.1.2.1.31.1.1.1.10.2 880803840
.1.3.6.1.2.1.31.1.1.1.10.8 0
.1.3.6.1.2.1.31.1.1.1.10.30 791372640
.1.3.6.1.2.1.31.1.1.1.10.40 5637144576
.1.3.6.1.2.1.31.1.1.1.10.44 4804183820
.1.3.6.1.2.1.31.1.1.1.10.99 999
"""

# Real `show interface CdcEthernet2`, trimmed.
UPLINK = {
    "id": "CdcEthernet2", "type": "CdcEthernet", "description": "Qualcomm Mobile Broadband",
    "link": "up", "connected": "yes", "state": "up", "mobile": "4G", "plugged": "yes",
    "address": "192.168.1.100", "mask": "255.255.255.0", "uptime": "230884",
    "rsrp": "-99", "rsrq": "-12", "rssi": "-71", "cinr": "6", "signal-level": "3",
}

HOTSPOT = {"host": [
    {"mac": "c8:ff:28:54:a5:fd", "ip": "192.168.2.54", "hostname": "DESKTOP-QEB032M",
     "rxbytes": 181321044, "txbytes": 8164751, "link": "up"},
    {"mac": "cc:0c:0c:00:01:b4", "ip": "192.168.2.117", "hostname": "WhatsMiner",
     "name": "WhatsMiner-117", "rxbytes": 24700000, "txbytes": 12600000, "link": "up"},
    {"mac": "ea:95:a3:c2:a6:be", "ip": "192.168.2.135", "hostname": "A51",
     "rxbytes": 0, "txbytes": 0, "link": "down"},
]}


class SnmpParsingTest(unittest.TestCase):

    def test_indexes_by_last_oid_component(self):
        rows = parse_snmp_walk(IF_DESCR)

        self.assertEqual(rows["30"], "CdcEthernet2")
        self.assertEqual(rows["44"], "WifiMaster0/AccessPoint0")

    def test_ignores_blank_and_malformed_lines(self):
        self.assertEqual(parse_snmp_walk("\n\n   \nnot-an-oid-line\n"), {})

    def test_strips_quotes_around_string_values(self):
        self.assertEqual(parse_snmp_walk('.1.3.6.1.2.1.2.2.1.2.30 "CdcEthernet2"')["30"],
                         "CdcEthernet2")


class InterfaceSeriesTest(unittest.TestCase):

    def setUp(self):
        self.series = build_interface_series(
            parse_snmp_walk(IF_DESCR), parse_snmp_walk(IF_IN), parse_snmp_walk(IF_OUT))
        self.by_name = {name: (rx, tx) for name, rx, tx in self.series}

    def test_keeps_the_interfaces_that_carry_traffic(self):
        for name in ("CdcEthernet2", "Bridge0", "WifiMaster0/AccessPoint0", "GigabitEthernet0"):
            self.assertIn(name, self.by_name)

    def test_drops_internal_interfaces(self):
        """`ra7.2` and friends are bridge members; 32 interfaces would bury the four that matter."""
        self.assertNotIn("ra7.2", self.by_name)

    def test_counter_values_pass_through_unchanged(self):
        self.assertEqual(self.by_name["CdcEthernet2"], (5807269197.0, 791372640.0))

    def test_wan_download_is_attributable_to_the_wifi_ap(self):
        """The observation that motivated this exporter, pinned as a regression test."""
        wan_in = self.by_name["CdcEthernet2"][0]
        ap_out = self.by_name["WifiMaster0/AccessPoint0"][1]

        self.assertGreater(ap_out / wan_in, 0.8)

    def test_interface_without_counters_is_omitted_not_zeroed(self):
        """A fabricated zero would read as 'no traffic', which is a different claim."""
        series = build_interface_series({"30": "CdcEthernet2"}, {}, {})

        self.assertEqual(series, [])

    def test_unparseable_counter_is_omitted(self):
        series = build_interface_series({"30": "CdcEthernet2"}, {"30": "No Such Object"}, {"30": "1"})

        self.assertEqual(series, [])


class UplinkParsingTest(unittest.TestCase):

    def test_signal_fields_become_floats(self):
        values = parse_uplink(UPLINK)

        self.assertEqual(values["router_uplink_rsrp_dbm"], -99.0)
        self.assertEqual(values["router_uplink_cinr_db"], 6.0)
        self.assertEqual(values["router_uplink_signal_level"], 3.0)

    def test_link_and_connection_state(self):
        values = parse_uplink(UPLINK)

        self.assertEqual(values["router_uplink_up"], 1.0)
        self.assertEqual(values["router_uplink_connected"], 1.0)

    def test_down_link_reports_zero_not_missing(self):
        values = parse_uplink({"link": "down", "connected": "no"})

        self.assertEqual(values["router_uplink_up"], 0.0)
        self.assertEqual(values["router_uplink_connected"], 0.0)

    def test_absent_signal_fields_are_omitted_rather_than_zeroed(self):
        """A modem that is `not ready` reports no signal; 0 dBm would be a fiction."""
        values = parse_uplink({"link": "down"})

        self.assertNotIn("router_uplink_rsrp_dbm", values)

    def test_non_numeric_signal_is_ignored(self):
        values = parse_uplink(dict(UPLINK, rsrp="n/a"))

        self.assertNotIn("router_uplink_rsrp_dbm", values)


class HostParsingTest(unittest.TestCase):

    def test_extracts_one_row_per_host(self):
        rows = parse_hosts(HOTSPOT)

        self.assertEqual(len(rows), 3)
        self.assertEqual(rows[0]["mac"], "c8:ff:28:54:a5:fd")
        self.assertEqual(rows[0]["rx"], 181321044.0)

    def test_link_state_drives_active(self):
        rows = {r["ip"]: r for r in parse_hosts(HOTSPOT)}

        self.assertTrue(rows["192.168.2.54"]["active"])
        self.assertFalse(rows["192.168.2.135"]["active"])

    def test_hostname_wins_over_the_decorated_name(self):
        """RCI `name` is a display string like 'WhatsMiner-117 - Home network - 2026-...'."""
        rows = {r["ip"]: r for r in parse_hosts(HOTSPOT)}

        self.assertEqual(rows["192.168.2.117"]["name"], "WhatsMiner")

    def test_single_host_object_is_accepted(self):
        """RCI collapses a one-element list into a bare object."""
        rows = parse_hosts({"host": {"mac": "aa:bb", "ip": "1.2.3.4", "rxbytes": 1, "txbytes": 2}})

        self.assertEqual(len(rows), 1)

    def test_entries_without_a_mac_are_skipped(self):
        rows = parse_hosts({"host": [{"ip": "1.2.3.4", "rxbytes": 5}]})

        self.assertEqual(rows, [])

    def test_empty_response_is_not_an_error(self):
        self.assertEqual(parse_hosts({}), [])
        self.assertEqual(parse_hosts({"host": []}), [])


class RciCommandTests(unittest.TestCase):
    """A rejected command comes back as HTTP 200 (DMI-49).

    The router buries the refusal in a nested `status` array, so anything that
    trusts the transport reads "not found" as success. Fixture below is the real
    response to a misspelled command, captured 2026-08-13.
    """

    REJECTED = {"system": {"status": [{
        "status": "error", "code": "1179781", "ident": "Core::Configurator",
        "message": 'not found: "system/definitely-not-a-command" [http/rci].'}]}}
    ACCEPTED = {"show": {"version": {"title": "5.0.10"}}}
    OK_STATUS = {"system": {"status": [{"status": "ok", "message": "done"}]}}

    def _client(self, *results):
        client = rci.RciClient.__new__(rci.RciClient)
        client.base = "http://router"
        client.user = "admin"
        client.password = "x"
        client.timeout = 1
        client._lock = threading.Lock()
        client._opener = FakeOpener(*results)
        return client

    def test_error_status_inside_a_200_raises(self):
        client = self._client(self.REJECTED)
        with self.assertRaises(rci.RciError) as caught:
            client.command({"system": {"definitely-not-a-command": {}}})
        self.assertIn("not found", str(caught.exception))

    def test_accepted_command_returns_the_payload(self):
        client = self._client(self.ACCEPTED)
        self.assertEqual(client.command({"show": {"version": {}}}), self.ACCEPTED)

    def test_a_non_error_status_is_not_treated_as_failure(self):
        client = self._client(self.OK_STATUS)
        self.assertEqual(client.command({"system": {"reboot": {}}}), self.OK_STATUS)

    def test_command_is_posted_as_json_to_rci(self):
        client = self._client(self.ACCEPTED)
        client.command({"show": {"version": {}}})
        request = client._opener.requests[0]
        self.assertEqual(request.get_method(), "POST")
        self.assertEqual(request.full_url, "http://router/rci/")
        self.assertEqual(json.loads(request.data), {"show": {"version": {}}})

    def test_disconnect_is_success_only_when_expected(self):
        # A router executing `reboot` never answers; that silence is the win.
        client = self._client(OSError("connection reset"))
        self.assertIsNone(client.command({"system": {"reboot": {}}},
                                         expect_disconnect=True))

    def test_disconnect_otherwise_raises(self):
        client = self._client(OSError("connection reset"))
        with self.assertRaises(rci.RciError):
            client.command({"show": {"version": {}}})


class StatusErrorTests(unittest.TestCase):
    def test_finds_an_error_nested_at_the_top_level(self):
        payload = {"status": [{"status": "error", "message": "not found"}]}
        self.assertEqual(len(rci.status_errors(payload)), 1)

    def test_ignores_ok_and_message_statuses(self):
        payload = {"status": [{"status": "ok"}, {"status": "message"}]}
        self.assertEqual(rci.status_errors(payload), [])

    def test_walks_into_lists(self):
        payload = {"a": [{"b": {"status": [{"status": "critical", "message": "x"}]}}]}
        self.assertEqual(len(rci.status_errors(payload)), 1)

    def test_a_clean_response_has_no_errors(self):
        self.assertEqual(rci.status_errors({"show": {"version": {"title": "5"}}}), [])


if __name__ == "__main__":
    unittest.main(verbosity=2)
