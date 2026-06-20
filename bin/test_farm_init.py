#!/usr/bin/env python3
"""
Unit tests for bin/farm_init.py reconcile logic.

These tests use only the stdlib and pyyaml; pyasic and netifaces are NOT
required because the module imports them lazily inside scan/identify functions.
"""

import copy
import sys
import unittest
from pathlib import Path

# Add the bin directory to the path so we can import farm_init.
BIN_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(BIN_DIR))

import farm_init


class TestMacNormalization(unittest.TestCase):
    def test_various_separators(self):
        expected = "CC:0C:0C:00:02:17"
        self.assertEqual(farm_init.normalize_mac("cc:0c:0c:00:02:17"), expected)
        self.assertEqual(farm_init.normalize_mac("CC-0C-0C-00-02-17"), expected)
        self.assertEqual(farm_init.normalize_mac("CC 0C 0C 00 02 17"), expected)
        self.assertEqual(farm_init.normalize_mac("  cc:0c:0c:00:02:17  "), expected)

    def test_bare_hex(self):
        self.assertEqual(farm_init.normalize_mac("cc0c0c000217"), "CC:0C:0C:00:02:17")

    def test_case_insensitive_match(self):
        a = farm_init.normalize_mac("Cc:0C:0c:00:02:17")
        b = farm_init.normalize_mac("cc:0c:0c:00:02:17")
        self.assertEqual(a, b)

    def test_invalid_and_empty(self):
        self.assertIsNone(farm_init.normalize_mac(None))
        self.assertIsNone(farm_init.normalize_mac(""))
        self.assertIsNone(farm_init.normalize_mac("not-a-mac"))
        self.assertIsNone(farm_init.normalize_mac("00:11:22:33:44"))


class TestReconcileInventory(unittest.TestCase):
    def test_mac_exact_ip_changed(self):
        inventory = [
            {
                "ip": "192.168.1.65",
                "name": "m50-065",
                "model": "M50",
                "mac": "CC:0C:0C:00:02:17",
                "owner": "ops",
            }
        ]
        live = [
            {
                "ip": "192.168.2.65",
                "model": "M50",
                "mac": "cc:0c:0c:00:02:17",
            }
        ]
        result = farm_init.reconcile_inventory(live, inventory)

        self.assertEqual(len(result["ip_changed"]), 1)
        self.assertEqual(len(result["unchanged"]), 0)
        self.assertEqual(len(result["mac_enriched"]), 0)

        item = result["ip_changed"][0]
        self.assertEqual(item["old"]["name"], "m50-065")
        self.assertEqual(item["new"]["name"], "m50-065")
        self.assertEqual(item["new"]["ip"], "192.168.2.65")
        self.assertEqual(item["new"]["mac"], "CC:0C:0C:00:02:17")
        self.assertEqual(item["new"]["owner"], "ops")

    def test_mac_exact_ip_same(self):
        inventory = [
            {
                "ip": "192.168.1.65",
                "name": "m50-065",
                "model": "M50",
                "mac": "CC:0C:0C:00:02:17",
            }
        ]
        live = [
            {
                "ip": "192.168.1.65",
                "model": "M50",
                "mac": "cc:0c:0c:00:02:17",
            }
        ]
        result = farm_init.reconcile_inventory(live, inventory)

        self.assertEqual(len(result["unchanged"]), 1)
        self.assertEqual(len(result["ip_changed"]), 0)
        self.assertEqual(result["unchanged"][0]["new"]["ip"], "192.168.1.65")

    def test_no_mac_ip_same(self):
        inventory = [
            {
                "ip": "192.168.1.65",
                "name": "m50-065",
                "model": "M50",
            }
        ]
        live = [
            {
                "ip": "192.168.1.65",
                "model": "M50",
                "mac": "CC:0C:0C:00:02:17",
            }
        ]
        result = farm_init.reconcile_inventory(live, inventory)

        self.assertEqual(len(result["mac_enriched"]), 1)
        self.assertEqual(len(result["ip_changed"]), 0)

        item = result["mac_enriched"][0]
        self.assertNotIn("mac", item["old"])
        self.assertEqual(item["new"]["mac"], "CC:0C:0C:00:02:17")
        self.assertEqual(item["new"]["name"], "m50-065")

    def test_heuristic_same_octet_model(self):
        # Inventory has a MAC, live has a *different* MAC, same last octet & model.
        inventory = [
            {
                "ip": "192.168.1.65",
                "name": "m50-065",
                "model": "M50",
                "mac": "AA:BB:CC:00:02:17",
            }
        ]
        live = [
            {
                "ip": "192.168.2.65",
                "model": "M50",
                "mac": "CC:0C:0C:00:02:17",
            }
        ]
        result = farm_init.reconcile_inventory(live, inventory)

        self.assertEqual(len(result["heuristic"]), 1)
        self.assertEqual(len(result["ip_changed"]), 0)
        self.assertEqual(len(result["new"]), 0)

        item = result["heuristic"][0]
        self.assertEqual(item["old"]["ip"], "192.168.1.65")
        self.assertEqual(item["new"]["ip"], "192.168.2.65")
        self.assertEqual(item["new"]["name"], "m50-065")

    def test_new_miner(self):
        inventory = [
            {
                "ip": "192.168.1.65",
                "name": "m50-065",
                "model": "M50",
                "mac": "AA:BB:CC:00:02:17",
            }
        ]
        live = [
            {
                "ip": "192.168.2.98",
                "model": "M50",
                "mac": "CC:0C:0C:00:02:98",
            }
        ]
        result = farm_init.reconcile_inventory(live, inventory)

        self.assertEqual(len(result["new"]), 1)
        self.assertEqual(len(result["heuristic"]), 0)
        self.assertEqual(result["new"][0]["live"]["mac"], "CC:0C:0C:00:02:98")

    def test_missing_miner(self):
        inventory = [
            {
                "ip": "192.168.1.63",
                "name": "m50-063",
                "model": "M50",
                "mac": "AA:BB:CC:00:02:63",
            }
        ]
        live = []
        result = farm_init.reconcile_inventory(live, inventory)

        self.assertEqual(len(result["missing"]), 1)
        self.assertEqual(result["missing"][0]["old"]["name"], "m50-063")

    def test_unidentified(self):
        inventory = [
            {
                "ip": "192.168.1.65",
                "name": "m50-065",
                "model": "M50",
            }
        ]
        live = [
            {
                "ip": "192.168.2.77",
                "model": "M50",
                # no mac
            }
        ]
        result = farm_init.reconcile_inventory(live, inventory)

        self.assertEqual(len(result["unidentified"]), 1)
        self.assertEqual(len(result["new"]), 0)
        self.assertEqual(result["unidentified"][0]["live"]["ip"], "192.168.2.77")

    def test_inputs_not_mutated(self):
        inventory = [
            {
                "ip": "192.168.1.65",
                "name": "m50-065",
                "model": "M50",
                "mac": "cc:0c:0c:00:02:17",
            }
        ]
        live = [
            {
                "ip": "192.168.2.65",
                "model": "M50",
                "mac": "CC:0C:0C:00:02:17",
            }
        ]
        original_inventory = copy.deepcopy(inventory)
        original_live = copy.deepcopy(live)

        farm_init.reconcile_inventory(live, inventory)

        self.assertEqual(inventory, original_inventory)
        self.assertEqual(live, original_live)


class TestApplyReconciliation(unittest.TestCase):
    def test_apply_ip_changed_and_keep_missing(self):
        inventory = [
            {"ip": "192.168.1.65", "name": "m50-065", "model": "M50", "mac": "CC:0C:0C:00:02:17"},
            {"ip": "192.168.1.63", "name": "m50-063", "model": "M50", "mac": "AA:BB:CC:00:02:63"},
        ]
        live = [{"ip": "192.168.2.65", "model": "M50", "mac": "cc:0c:0c:00:02:17"}]
        result = farm_init.reconcile_inventory(live, inventory)

        updated = farm_init.apply_reconciliation(result, inventory)
        miners = updated["miners"]
        self.assertEqual(len(miners), 2)

        by_name = {m["name"]: m for m in miners}
        self.assertEqual(by_name["m50-065"]["ip"], "192.168.2.65")
        self.assertEqual(by_name["m50-063"]["ip"], "192.168.1.63")

    def test_apply_heuristic_only_when_accepted(self):
        inventory = [
            {"ip": "192.168.1.65", "name": "m50-065", "model": "M50", "mac": "AA:BB:CC:00:02:17"},
        ]
        live = [{"ip": "192.168.2.65", "model": "M50", "mac": "CC:0C:0C:00:02:17"}]
        result = farm_init.reconcile_inventory(live, inventory)
        self.assertEqual(len(result["heuristic"]), 1)

        without = farm_init.apply_reconciliation(result, inventory, apply_heuristic=False)
        self.assertEqual(without["miners"][0]["ip"], "192.168.1.65")

        with_heuristic = farm_init.apply_reconciliation(result, inventory, apply_heuristic=True)
        self.assertEqual(with_heuristic["miners"][0]["ip"], "192.168.2.65")
        self.assertEqual(with_heuristic["miners"][0]["mac"], "CC:0C:0C:00:02:17")


if __name__ == "__main__":
    unittest.main()
