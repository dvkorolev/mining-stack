"""Reconcile the inventory against the machines, which are the source of truth.

The subnet move and the network storms left the database describing a farm that
no longer exists. Two operations:

  REMOVE  records for hardware that has been taken off site. Three of them never
          produced a single row in their entire history and sit on 192.168.1.x,
          the modem's own subnet, so the router can never route to them at all.
          Two more stopped at the same minute on 2026-08-07 and never returned.

  RENAME  records whose name disagrees with the worker the machine actually
          submits shares under. The pool string wins: it is what the machine
          says about itself.

Order matters -- miners.name is UNIQUE, so .96 must go before .98 can take the
name it has been mining under all along.

Foreign keys stay OFF deliberately (see DMI-73: miners.pool_account_id points at
a pool_accounts table that does not exist, so enabling them breaks other work).
Dependent rows are therefore deleted explicitly rather than by cascade.

Dry run unless --apply.
"""
import sqlite3, sys

DB = "/opt/mining-stack/data/mining-stats.db"
APPLY = "--apply" in sys.argv

REMOVE = [
    ("192.168.1.115", "workers19kpro115",   "never produced; modem subnet, unroutable"),
    ("192.168.1.134", "miner-134-inactive", "never produced; modem subnet, unroutable"),
    ("192.168.1.64",  "workerS19new",       "never produced; modem subnet, unroutable"),
    ("192.168.2.114", "workerS19",          "last produced 2026-08-07 11:32; removed from site"),
    ("192.168.2.96",  "m50oktober",         "last produced 2026-08-07 11:32; removed from site"),
]

RENAME = [
    ("192.168.2.98", "m50s-098",       "m50oktober", "submits as korr2014.m50oktober"),
    ("192.168.2.58", "whatsminer-058", "m601761",    "submits as Busiginpavel.m601761"),
]

db = sqlite3.connect(DB)
c = db.cursor()
print("PRAGMA foreign_keys =", c.execute("PRAGMA foreign_keys").fetchone()[0], "(left off on purpose)")

# Any table carrying miner_ip must be cleaned too, not just the two with FKs.
# fetchall() first: reusing one cursor for the outer loop and the inner
# PRAGMA resets the outer result set, which silently reported "(none)" and
# would have left ~433k orphaned history rows behind.
dependents = []
tables = [r[0] for r in c.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall()]
for t in tables:
    cols = [r[1] for r in c.execute(f"PRAGMA table_info('{t}')").fetchall()]
    if "miner_ip" in cols and t != "miners":
        dependents.append(t)
print("dependent tables:", ", ".join(dependents) or "(none)")

print("\n--- REMOVE ---")
plan_rows = 0
for ip, expect, why in REMOVE:
    row = c.execute("SELECT name FROM miners WHERE ip=?", (ip,)).fetchone()
    if row is None:
        print(f"  {ip:16} ABSENT already - skipping")
        continue
    if row[0] != expect:
        print(f"  {ip:16} !! name is {row[0]!r}, expected {expect!r} - REFUSING")
        sys.exit(1)
    counts = {t: c.execute(f"SELECT COUNT(*) FROM {t} WHERE miner_ip=?", (ip,)).fetchone()[0]
              for t in dependents}
    plan_rows += sum(counts.values())
    print(f"  {ip:16} {expect:20} {why}")
    print(f"                   dependent rows: " + ", ".join(f"{t}={n}" for t, n in counts.items()))

print("\n--- RENAME ---")
for ip, old, new, why in RENAME:
    row = c.execute("SELECT name FROM miners WHERE ip=?", (ip,)).fetchone()
    if row is None:
        print(f"  {ip:16} ABSENT - REFUSING"); sys.exit(1)
    if row[0] != old:
        print(f"  {ip:16} !! name is {row[0]!r}, expected {old!r} - REFUSING"); sys.exit(1)
    clash = c.execute("SELECT ip FROM miners WHERE name=? AND ip<>?", (new, ip)).fetchone()
    note = ""
    if clash:
        held = clash[0]
        if any(held == r[0] for r in REMOVE):
            note = f"(name currently held by {held}, removed above)"
        else:
            print(f"  {ip:16} !! target name {new!r} held by {held} which is NOT being removed - REFUSING")
            sys.exit(1)
    print(f"  {ip:16} {old:20} -> {new:14} {why} {note}")

print(f"\nsummary: remove {len(REMOVE)} miners (+{plan_rows} dependent rows), rename {len(RENAME)}")

if not APPLY:
    print("DRY RUN - nothing written. Re-run with --apply.")
    raise SystemExit

with db:
    for ip, _, _ in REMOVE:
        for t in dependents:
            c.execute(f"DELETE FROM {t} WHERE miner_ip=?", (ip,))
        c.execute("DELETE FROM miners WHERE ip=?", (ip,))
    for ip, old, new, _ in RENAME:
        c.execute("UPDATE miners SET name=? WHERE ip=? AND name=?", (new, ip, old))
print("APPLIED.")
print("  miners now:", c.execute("SELECT COUNT(*) FROM miners").fetchone()[0])
print("  history now:", c.execute("SELECT COUNT(*) FROM miner_stats_history").fetchone()[0])
print("  integrity:", c.execute("PRAGMA integrity_check").fetchone()[0])
