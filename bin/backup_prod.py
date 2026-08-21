#!/usr/bin/env python3
"""
Take a restorable backup of the production stack. Runs ON the Pi.

Written 2026-08-21, after a `docker system prune -a` removed the only local
rollback path and made it obvious that the site's state had no backup at all --
only a scatter of ad-hoc `.db.bak-*` copies in the data directory, three of
which were duplicates of the same day.

The thing this protects against is the microSD card, which is where all of it
currently lives (see DMI-51). A copy that stays on the Pi does not protect
against the failure mode that is actually likely, so the point of this script
is to produce ONE archive that can leave the machine.

## What is worth what

Tiers exist because the uplink is a metered 4G link (DMI-63) and the volumes
are large. Ordered by value per byte:

  config   ~24 KB  .env, etc/, compose files, alertmanager and watchdog state.
                   `.env` is the critical one: it exists ONLY on the Pi, in no
                   repository, and holds CORS_ORIGIN, ROUTER_PASSWORD,
                   WAN_WATCHDOG_ARM and the JWT/metrics secrets. Losing it
                   means reconstructing production configuration from memory.
                   Always included.

  db       ~271 MB SQLite: the miner inventory and its history. The inventory
                   alone took DMI-19, DMI-20 and DMI-45 to get correct, and it
                   cannot be rebuilt from the fleet -- IP, owner and pool
                   bindings are not derivable from the hardware. Compresses
                   hard. Always included.

  metrics  ~253 MB Prometheus + Grafana volumes. Fleet history. Grafana's own
                   dashboards are provisioned from git and need no backup; what
                   is here is its sqlite (users, annotations, ad-hoc panels).
                   Opt in with --metrics.

  logs     ~1.1 GB Loki. Highest bytes, lowest value per byte, and the store
                   that DMI-70 found unable to answer for the previous day.
                   Opt in with --logs, and think twice on a metered link.

## Correctness notes

  * The database is in WAL mode. `cp mining-stats.db` is NOT a backup -- it
    misses everything still in the -wal file. This uses the SQLite backup API,
    which produces a consistent snapshot of a live database without stopping
    the stack, then verifies it with integrity_check before archiving it.

  * Volumes are read from /var/lib/docker/volumes/<name>/_data with sudo rather
    than through a helper container, so this needs no image pulled and works on
    a pruned host. It copies them live: Prometheus and Loki tolerate that
    (their on-disk formats are append-mostly and they replay on start), which
    is the accepted trade for not stopping the fleet's monitoring to take a
    backup. If you want a strictly quiesced copy, stop the stack first.

  * Nothing is deleted. `--prune-old-db-copies` is offered separately and lists
    what it would remove before doing it.

Usage:

    python3 bin/backup_prod.py                 # config + db
    python3 bin/backup_prod.py --metrics       # + prometheus/grafana
    python3 bin/backup_prod.py --all           # + loki

Then pull it off the machine -- a backup that stays put is not a backup:

    rsync -avP admin@<pi>:/opt/mining-stack/backups/<file> ~/mining-stack-backups/

Store it somewhere OUTSIDE the git repository. The archive contains `.env`.

## Restoring, and one trap in it

    tar xzf mining-stack-backup-<stamp>.tar.gz -C /somewhere
    # config/   -> /opt/mining-stack/   (.env, etc/, compose files, docker/)
    # database/ -> /opt/mining-stack/data/mining-stats.db, stack stopped
    # volumes/  -> sudo tar -xf <vol>.tar -C /var/lib/docker/volumes/<vol>/_data

The trap: the snapshot inherits `journal_mode=wal` from production, and an
extracted copy has no `-wal` or `-shm` beside it. SQLite then refuses a
READ-ONLY open of it with the distinctly unhelpful

    sqlite3.OperationalError: unable to open database file

because a read-only connection cannot create the shared-memory index it needs.
The file is fine. Open it read-write (or with `immutable=1`) to inspect it --
verifying a backup and concluding it is corrupt when it is not would be a bad
way to spend an outage.

Verified on 2026-08-21 by extracting and opening the archive on another
machine: integrity ok, 26 miners, 2 159 271 history rows.
"""

import argparse
import os
import shutil
import sqlite3
import subprocess
import sys
import tarfile
import tempfile
import time

STACK = "/opt/mining-stack"
DB = STACK + "/data/mining-stats.db"
VOLUMES = "/var/lib/docker/volumes"

# name -> (volume, tier). Config-tier volumes are tiny and always included.
VOLUME_TIERS = {
    "mining-stack_alertmanager_data": "config",
    "mining-stack_watchdog_state": "config",
    "mining-stack_prometheus_data": "metrics",
    "mining-stack_grafana-storage": "metrics",
    "mining-stack_loki-data": "logs",
}

CONFIG_PATHS = [
    ".env",
    "etc",
    "docker-compose.prod.yml",
    "docker-compose.logging.yml",
    "docker",
]


def human(n):
    for unit in ("B", "KB", "MB", "GB"):
        if n < 1024 or unit == "GB":
            return "%.1f %s" % (n, unit)
        n /= 1024.0


def snapshot_db(dest):
    """Consistent copy of a live WAL-mode database, then verify it."""
    src = sqlite3.connect("file:" + DB + "?mode=ro", uri=True)
    dst = sqlite3.connect(dest)
    src.backup(dst)
    dst.close()
    src.close()

    check = sqlite3.connect("file:" + dest + "?mode=ro", uri=True)
    result = list(check.execute("PRAGMA integrity_check"))[0][0]
    miners = list(check.execute("SELECT COUNT(*) FROM miners"))[0][0]
    check.close()
    if result != "ok":
        raise RuntimeError("snapshot failed integrity_check: %s" % result)
    return miners


def add_volume(tar, volume, staging):
    """Copy a docker volume out with sudo, then add it to the archive."""
    path = os.path.join(VOLUMES, volume, "_data")
    if not os.path.isdir(path) and subprocess.run(
            ["sudo", "test", "-d", path]).returncode != 0:
        print("    ! %s: no such volume, skipped" % volume)
        return
    out = os.path.join(staging, volume + ".tar")
    # tar as root; -C so the archive holds relative paths.
    subprocess.run(["sudo", "tar", "-cf", out, "-C", path, "."], check=True)
    subprocess.run(["sudo", "chown", str(os.getuid()), out], check=True)
    size = os.path.getsize(out)
    print("    %-34s %s" % (volume, human(size)))
    tar.add(out, arcname="volumes/" + volume + ".tar")
    os.remove(out)


def main():
    ap = argparse.ArgumentParser(description="Back up the production stack (config, database, optionally volumes).")
    ap.add_argument("--metrics", action="store_true", help="include the Prometheus and Grafana volumes")
    ap.add_argument("--logs", action="store_true", help="include the Loki volume (large)")
    ap.add_argument("--all", action="store_true", help="same as --metrics --logs")
    ap.add_argument("--out", default=STACK + "/backups", help="output directory (default: %(default)s)")
    ap.add_argument("--prune-old-db-copies", action="store_true",
                    help="after a successful backup, list and remove ad-hoc *.db.bak-* / *.snapshot-* copies")
    args = ap.parse_args()

    tiers = {"config", "db"}
    if args.metrics or args.all:
        tiers.add("metrics")
    if args.logs or args.all:
        tiers.add("logs")

    os.makedirs(args.out, exist_ok=True)
    stamp = time.strftime("%Y%m%d-%H%M%S")
    archive = os.path.join(args.out, "mining-stack-backup-%s.tar.gz" % stamp)
    staging = tempfile.mkdtemp(prefix="msbackup-")

    print("Backing up tiers: %s" % ", ".join(sorted(tiers)))
    try:
        with tarfile.open(archive, "w:gz") as tar:
            print("  config")
            for rel in CONFIG_PATHS:
                path = os.path.join(STACK, rel)
                if os.path.exists(path):
                    tar.add(path, arcname="config/" + rel)
                    print("    %s" % rel)
                else:
                    print("    ! %s missing, skipped" % rel)

            print("  database")
            snap = os.path.join(staging, "mining-stats.db")
            miners = snapshot_db(snap)
            print("    consistent snapshot, integrity ok, %d miners, %s"
                  % (miners, human(os.path.getsize(snap))))
            tar.add(snap, arcname="database/mining-stats.db")
            os.remove(snap)

            wanted = [v for v, t in VOLUME_TIERS.items() if t in tiers]
            if wanted:
                print("  volumes")
                for volume in wanted:
                    add_volume(tar, volume, staging)
    finally:
        shutil.rmtree(staging, ignore_errors=True)

    size = os.path.getsize(archive)
    print("\n%s  (%s)" % (archive, human(size)))
    print("Pull it off this machine -- a backup that stays here does not survive the SD card:")
    print("  rsync -avP admin@<pi>:%s ~/mining-stack-backups/" % archive)

    if args.prune_old_db_copies:
        data = os.path.join(STACK, "data")
        stale = [f for f in sorted(os.listdir(data))
                 if (".db.bak-" in f or ".db.snapshot-" in f or ".db.backup-" in f)]
        if not stale:
            print("\nNo ad-hoc database copies to remove.")
            return 0
        total = sum(os.path.getsize(os.path.join(data, f)) for f in stale)
        print("\nRemoving %d ad-hoc database copies (%s):" % (len(stale), human(total)))
        for f in stale:
            print("  %s" % f)
            os.remove(os.path.join(data, f))
    return 0


if __name__ == "__main__":
    sys.exit(main())
