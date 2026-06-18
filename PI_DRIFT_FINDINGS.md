# Pi config/code drift — findings and interpretation

Date: 2026-06-18
Pi checked: `admin@100.119.15.37` (Tailscale; `100.112.244.18` from `CLAUDE.local.md` is stale and timed out)
Branch with the backport: `backport/pi-local-fixes` (commit `e5ad63d`)

## What was checked

Read-only inspection of `/opt/mining-stack` on the Raspberry Pi: `git status`/`git diff`
against the Pi's checked-out commit, container list, and `.env` keys (values not read).

## Finding 1: Pi's git history matches `main`, but working tree had 6 days of uncommitted edits

The Pi's `HEAD` (`9205646`, "Implement JWT authentication with httpOnly cookies") is an
ancestor of this repo's `main` — no diverged branch. But the working tree had local,
uncommitted modifications to 7 tracked files, never pushed anywhere. These looked like
real fixes, not experiments, so they were backported onto `backport/pi-local-fixes`:

| File | Change | Interpretation |
|---|---|---|
| `backend/Dockerfile` | Added explicit `deps` stage, `npm ci` instead of `npm install`, better layer ordering | Build hygiene / smaller, more reproducible image. Low risk. |
| `backend/src/server.ts`, `backend/src/services/alert.service.ts` | Alert DB init moved out of module-load into explicit `initAlertDatabase()` called after the data volume is mounted at boot; dedup guard against duplicate Telegram sends on repeated Alertmanager webhook deliveries (`generateAlertId` now includes `startsAt` timestamp) | Real bug fixes: module-load-time DB init could race the volume mount; without the dedup guard, Alertmanager's retried webhooks would double-page Telegram. |
| `docker/prometheus/rules/mining_alerts.yml` | `miner_scrape_success == 0/1` → `miner_scrape_status <= 0` / `== 2` | Verified necessary: `miner_scrape_success` does not exist anywhere in `python-scheduler`; `miner_scrape_status` is the actual current metric (`metrics.py`). The old rules were silently broken (never firing / always firing incorrectly). |
| `python-scheduler/collectors/pyasic_collector.py` | Guard against non-string `model` before `.replace()` | Defensive fix for stale tuple keys leaking through `state_manager` deserialization (see below) — would otherwise crash metric collection for an affected miner. |
| `python-scheduler/state_manager.py` | `eval()` → `ast.literal_eval()` for parsing serialized state keys; added phantom-miner cleanup (drops `failure_streaks`/`last_uptimes` entries for miners no longer in config) | `eval()` on a value loaded from a local JSON state file is low real-world risk here (not attacker-controlled), but `ast.literal_eval` is strictly safer and was a one-line cost-free improvement. Phantom cleanup avoids unbounded state-file growth as miners are renamed/retired over time. |
| `python-scheduler/main.py` | Pool-connectivity check refactored to drop the blocking `socket.gethostbyname()` call, relying on `asyncio.open_connection`'s implicit DNS resolution instead | Removes a blocking call from an async code path — was likely stalling the event loop briefly on every pool check. |

## Finding 2: one part of the Pi's edit was unsafe and was deliberately *not* backported

The Pi's `main.py` also called `await load_miners_config()` and `await load_pools_config()`.
Both functions are defined as plain `def` (synchronous) in `python-scheduler/config.py` —
on the Pi *and* in this repo. Awaiting a non-awaitable raises `TypeError` at runtime.

Cross-checking explained why: the Pi has an **untracked, unfinished** file
`python-scheduler/config.py.new` with `async def` versions of those same two functions —
work in progress that was never renamed/swapped into `config.py`. Checking the actual
running container confirmed this directly:

```
docker exec mining-stack-python-scheduler-1 grep -n 'await load_miners_config' /app/main.py
# (no match — the deployed image still has the old, non-awaited calls)
```

So this part of the working-tree edit was never built into a running image, let alone
verified. It was excluded from the backport (the two call sites were reverted back to
synchronous calls); the async config.py conversion is left as unfinished work for later,
to be done and tested as its own change.

## Finding 3: other Pi-local state, not backported (intentionally)

- `docker-compose.registry.yml` was deleted from the Pi's checkout. This is Mac-side
  tooling (the local Docker registry, run on the Mac, not the Pi) — its presence in the
  Pi's checkout was likely just an artifact of an old rsync; deleting it there doesn't
  reflect a code change and wasn't touched.
- Untracked on the Pi: `data/`, `images/`, a `mining-stack` binary, `*.bak` files, and
  `python-scheduler/config.py.new`. These are runtime data, backups, and the unfinished
  async-config WIP — not committed anywhere by design.
- `mining-stack-frontend-1` and `promtail` containers were `unhealthy` at check time —
  not investigated as part of this pass.

## Net effect / risk assessment

Backporting these fixes into version control removes a real operational risk: the Pi was
the only place several bug fixes existed, and a redeploy from this repo (e.g. via the new
local-Docker build pipeline) would otherwise have silently reverted the Pi to the buggier
behavior (duplicate Telegram alerts, broken `MinerOffline`/`MinerNotMining` alert rules,
a possible crash path in `pyasic_collector.py`).

The one piece excluded (async `load_miners_config`/`load_pools_config`) was excluded
specifically *because* it was untested and would have introduced a new crash if deployed
as-is — confirmed by the fact the Pi's own running container had never been rebuilt with it.

## Status

- Branch `backport/pi-local-fixes`, commit `e5ad63d`, **not pushed, not merged**.
- Backend (`npm run build`) and all three touched Python files (`py_compile`) validated.
- Recommend: review/merge this branch before the next Pi deploy, otherwise a fresh
  deploy from `main` will overwrite the Pi's working tree and lose these fixes for real.
