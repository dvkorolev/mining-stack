#!/usr/bin/env python3
"""
DMI-45 -- reconcile the miner inventory against the hardware (2026-08-21).

The inventory had drifted from physical reality. This corrects it, in place,
from evidence rather than inference: every change below was confirmed three
independent ways -- the machine's own cgminer API on port 4028, its MAC as seen
in a live ARP sweep of 192.168.2.0/24, and the worker name it submits shares
under.

What was wrong, and why it was not cosmetic:

  .121  recorded as "M30S++ VH90 (Stock)" with MAC CC:0C:0C:00:05:E0.
        It is an M60_VK6A (MAC CE:02:01:00:42:38) producing 176.1 TH/s, and it
        mines as korr2014.m60_1. The M30S++ profile publishes an expected
        hashrate of 100 TH/s, putting its degradation thresholds at 80 and 50
        TH/s -- so this machine could have lost 49% of its output in silence.

  .122  recorded as a bare "WhatsMiner (Stock)" with no MAC.
        It is an M30S++_VH95 and it holds MAC CC:0C:0C:00:05:E0 -- the one the
        .121 record was claiming. The hardware moved and the inventory did not.
        A bare "WhatsMiner" matches whatsminer_generic, which publishes no
        expected hashrate at all, so the SHA-256 degradation rules could not
        fire for it under any circumstances.

  .58   same bare-model problem, and it is an M60_VK6A (MAC CE:02:01:00:92:C1)
        mining as Busiginpavel.m601761. It sits at a flat 0 TH/s and only
        DMI-67's MinerFaulty catches it; nothing hashrate-based could.

  .132  absent from the inventory entirely while mining 104.8 TH/s with 14 days
        of uptime. Unmonitored, unalerted, and missing from every fleet total.

  owner three records disagreed with the pool account the machine actually mines
        under. Ownership is taken from the pool user here: korr2014 ->
        246139233, Busiginpavel -> 427436847, which holds for every other
        machine in the fleet.

Deliberately NOT done here:

  * The three phantom 192.168.1.x records are left alone. Their MACs could be
    backfilled from the router's DHCP reservations, but that correlation rests
    on the last octet of a name ("Antminer-64" -> .64) and the machines are
    offline, so the hardware cannot be asked. Writing an inference into the
    inventory as though it were measured is the specific mistake this project
    has already made six times. There is no operational gain either: a MAC
    changes no alert while the machine is absent.

  * No renames, though the evidence for one is strong: .122 mines as
    korr2014.004 while the DB name `004` sits on .121. The name follows the
    slot and the pool follows the machine, so the two disagree. Which of them
    should win is the owner's call, not this script's.

Safety properties:

  * Idempotent -- re-running after a successful apply reports "no changes".
  * Dry-run by default; --apply is required to write.
  * In-place UPDATEs only, never DELETE + INSERT: miners.ip is the primary key
    and miner_stats_history cascades from it, so a delete would take the
    history with it.
  * Single transaction; any failure rolls the whole set back.
  * Does NOT enable PRAGMA foreign_keys. The schema declares
    miners.pool_account_id REFERENCES pool_accounts(id), and that table does
    not exist in this database -- with enforcement on, every INSERT into miners
    fails. The application runs with enforcement off, so this matches it. That
    schema defect is real and is filed separately; do not "fix" it by turning
    the pragma on here.

Usage on the Pi:

    python3 /opt/mining-stack/bin/dmi45_reconcile.py                  # dry run
    python3 /opt/mining-stack/bin/dmi45_reconcile.py --apply          # write

Take a consistent snapshot first -- the database is in WAL mode, so copying the
.db file alone does not capture a valid backup:

    python3 -c "import sqlite3;s=sqlite3.connect('file:/opt/mining-stack/data/mining-stats.db?mode=ro',uri=True);d=sqlite3.connect('/opt/mining-stack/data/snapshot.db');s.backup(d)"
"""

import argparse
import sqlite3
import sys
import time

DEFAULT_DB = "/opt/mining-stack/data/mining-stats.db"

# Every value here was measured on 2026-08-21; see the module docstring for how.
# ip -> {column: new value}
CHANGES = {
    "192.168.2.121": {"model": "M60 VK6A (Stock)", "mac": "CE:02:01:00:42:38"},
    "192.168.2.122": {"model": "M30S++ VH95 (Stock)", "mac": "CC:0C:0C:00:05:E0"},
    "192.168.2.58": {"model": "M60 VK6A (Stock)", "mac": "CE:02:01:00:92:C1",
                     "owner": "427436847"},
    "192.168.2.78": {"mac": "B8:4C:87:E0:3D:95"},
    # Ownership from the pool account the machine actually mines under.
    "192.168.2.145": {"owner": "427436847"},
    "192.168.2.52": {"owner": "246139233"},
}

# The machine that was mining unmonitored. Name and alias are its pool worker
# name; owner follows from its pool account (korr2014).
INSERT = {
    "ip": "192.168.2.132",
    "name": "30n1",
    "model": "M30S++ VH95 (Stock)",
    "alias": "30n1",
    "owner": "246139233",
    "status": "online",
    "use_https": 0,
    "mac": "CC:0C:0C:00:06:23",
}

TRACKED = ("name", "model", "mac", "owner")


def current_rows(conn, ips):
    placeholders = ",".join("?" * len(ips))
    sql = "SELECT ip," + ",".join(TRACKED) + " FROM miners WHERE ip IN (" + placeholders + ")"
    return {r[0]: dict(zip(TRACKED, r[1:])) for r in conn.execute(sql, list(ips))}


def plan(conn):
    """Return (updates, do_insert). Only genuinely differing columns are listed."""
    rows = current_rows(conn, list(CHANGES) + [INSERT["ip"]])
    updates = {}
    for ip, wanted in CHANGES.items():
        row = rows.get(ip)
        if row is None:
            print("  ! %s is not in the inventory -- skipped, nothing to update" % ip)
            continue
        diff = {c: v for c, v in wanted.items() if row.get(c) != v}
        if diff:
            updates[ip] = (row, diff)
    return updates, INSERT["ip"] not in rows


def main():
    ap = argparse.ArgumentParser(description="Reconcile the miner inventory against the hardware (DMI-45).")
    ap.add_argument("--db", default=DEFAULT_DB, help="path to mining-stats.db (default: %(default)s)")
    ap.add_argument("--apply", action="store_true", help="write the changes; without it this is a dry run")
    args = ap.parse_args()

    mode = "" if args.apply else "?mode=ro"
    conn = sqlite3.connect("file:" + args.db + mode, uri=True, timeout=30)

    updates, do_insert = plan(conn)

    if not updates and not do_insert:
        print("Inventory already reconciled -- no changes.")
        return 0

    print("Planned changes:" if args.apply else "Planned changes (dry run, nothing written):")
    for ip, (row, diff) in sorted(updates.items()):
        print("  %s" % ip)
        for col, new in sorted(diff.items()):
            print("      %-6s %r -> %r" % (col, row.get(col), new))
    if do_insert:
        print("  %s  INSERT" % INSERT["ip"])
        for col in ("name", "model", "owner", "mac"):
            print("      %-6s %r" % (col, INSERT[col]))

    if not args.apply:
        print("\nRe-run with --apply to write.")
        return 0

    now = int(time.time())
    try:
        conn.execute("BEGIN IMMEDIATE")
        for ip, (_row, diff) in updates.items():
            assignments = ", ".join("%s=?" % c for c in diff) + ", updated_at=?"
            conn.execute("UPDATE miners SET " + assignments + " WHERE ip=?",
                         list(diff.values()) + [now, ip])
        if do_insert:
            cols = list(INSERT)
            conn.execute(
                "INSERT INTO miners (" + ",".join(cols) + ") VALUES (" + ",".join("?" * len(cols)) + ")",
                [INSERT[c] for c in cols])
        conn.execute("COMMIT")
    except Exception as exc:                                  # noqa: BLE001
        conn.execute("ROLLBACK")
        print("\nROLLED BACK, nothing was written: %s" % exc, file=sys.stderr)
        return 1

    print("\nCommitted.")
    after = current_rows(conn, list(CHANGES) + [INSERT["ip"]])
    for ip in sorted(set(list(updates) + ([INSERT["ip"]] if do_insert else []))):
        print("  %-16s %s" % (ip, after.get(ip)))
    print("\nintegrity_check: %s" % list(conn.execute("PRAGMA integrity_check"))[0][0])
    print("miners total   : %d" % list(conn.execute("SELECT COUNT(*) FROM miners"))[0][0])
    print("\nThe scheduler refreshes its miner list from the backend API on its own "
          "interval; POST /reload on port 8000 makes it immediate.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
