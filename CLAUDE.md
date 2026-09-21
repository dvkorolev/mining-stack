# CLAUDE.md

This file provides guidance to Claude Code when working in this repository.

## Project

Cryptocurrency mining-farm monitoring and control system.

Target runtime: Raspberry Pi 4 (ARM64).  
Deployment model: multi-container Docker stack on the Pi.  
Scale: 20+ ASIC miners.

The repository contains three first-party services plus the monitoring stack:
- backend
- frontend
- python-scheduler
- Prometheus / Grafana / Alertmanager / blackbox-exporter / node-exporter

Primary repository:
https://github.com/dvkorolev/mining-stack

## Critical rules

- Never work directly on `main`.
- Always use a dedicated branch for changes.
- For any non-trivial task, propose a short plan before changing code.
- Do not access the Raspberry Pi, Tailscale hosts, or remote services unless I explicitly ask for it.
- Do not change deployment scripts, system services, network settings, or runtime infrastructure without approval.
- Prefer small, reversible changes over large rewrites.
- Do not commit or push without explicit approval.
- Treat the repository as publicly shareable: keep outputs clean, specific, and safe for a public repo.

## Architecture

Main flow:

miners → python-scheduler → Prometheus → backend → frontend

There is also a side channel for miner control.

### python-scheduler
Python + FastAPI + APScheduler.

Responsibilities:
- poll miners on an interval
- expose `/metrics` for Prometheus
- optionally push metrics to backend via `POST {BACKEND_URL}/api/internal/metrics` when `PUSH_TO_BACKEND` is enabled

Important files:
- `python-scheduler/main.py`
- `python-scheduler/asic_profile_loader.py`
- `python-scheduler/asic_profiles.yaml`
- `python-scheduler/collectors/`

Collector implementations live in:
- `pyasic_collector`
- `antminer_cgi_collector`
- `whatsminer_cgi_collector`
- `dg1_tcp_collector`
- `dg1_http_collector`

### backend
Node/Express + TypeScript.

Responsibilities:
- API + WebSocket server
- read miner metrics from Prometheus
- own SQLite DB
- JWT auth
- Telegram bot
- miner reboot/control (implemented in-process in TypeScript, not via shell scripts)

Important files:
- `backend/src/server.ts`
- `backend/src/services/prometheus.service.ts`
- `backend/src/services/mining.service.ts`
- `backend/src/services/database.service.ts`
- `backend/src/services/miner-control.service.ts`
- `backend/src/utils/miner-rebooter.ts` (WhatsMiner protocol + `antminerRestart`)

Important rule:
- backend does not poll miners directly for stats; it reads them from Prometheus

### frontend
React 18 + TypeScript + CRA + Material UI + Redux Toolkit.

Responsibilities:
- dashboard UI
- REST calls to backend
- live updates over WebSocket

Important files:
- `frontend/src/services/api.ts`
- `frontend/src/services/apiSlice.ts`
- `frontend/src/hooks/useWebSocket.ts`
- `frontend/src/middleware/websocketMiddleware.ts`

## Algorithm separation

This is critical and easy to break.

SHA-256 and SCRYPT miners use different hashrate metrics and scales:

- SHA-256 → `miner_hashrate_ths{algorithm="sha256"}` in TH/s
- SCRYPT → `miner_hashrate_mhs{algorithm="scrypt"}` in MH/s

Common metrics:
- `miner_power_watts`
- `miner_temp_max_c`
- `miner_state`

`miner_state`:
- 0 = faulty
- 1 = idle
- 2 = mining

The backend normalizes `currentHashrate` and `averageHashrate` to TH/s internally.

See:
- `ALGORITHM_SEPARATION.md`

## Data sources & metrics

### Two metric namespaces (distinct — do not conflate)
- `miner_*` — per-miner metrics the **python-scheduler** exposes on its `/metrics` for Prometheus to scrape (`miner_hashrate_ths`, `miner_power_watts`, `miner_state`, etc.). This is the fleet data.
- `mining_*` / `alert_queue_*` — aggregate/operational metrics the **backend** exposes on its own `/metrics` (`server.ts`), e.g. `mining_hashrate_total`, `mining_active_miners`, alert-queue gauges. These are about the backend itself, not individual miners.

### Live-stats source of truth (`METRICS_SOURCE`)
The backend has two ways miner data can reach the live `miningStats`: reading Prometheus on an interval, and the scheduler push to `/api/internal/metrics`. Exactly one is authoritative, selected by `METRICS_SOURCE`:
- `prometheus` (default) — the interval reads Prometheus (`getRealMiningStats`) and is the only writer; the push endpoint still returns 200 but does **not** overwrite live stats.
- `push` — `updateMetricsFromScheduler` is authoritative; the interval does not overwrite.
Do not let both write `miningStats` again — that reintroduces the clobber this flag fixed.

### Pool health and uplink availability (DMI-56)
- **Pool health comes from the miners**, not from probing pools: `miner_pool_alive{ip,name,url,pool_index}`,
  built from each miner's own reported pool list (`pool_status.extract_pool_status()`). The `url` label
  is the fleet's ground truth for which pools are in use.
- **Never read `probe_success{job="pool-tcp-check"}` as connectivity.** A pool drops repeated bare TCP
  connects from an address that never speaks stratum, so that metric measures the pool's tolerance of
  us. Doing this produced a phantom 25% outage rate and a wrong outage diagnosis (DMI-46). The target
  list is deliberately empty; see `docker/prometheus/targets/README.md` before adding to it.
- **Uplink availability is `sum(rate(miner_pool_accepted_total[5m]))`** — real share submission across
  ~20 devices, riding the production path.

### Expected hashrate — provenance is tracked (DMI-81)
`miner_expected_hashrate_ths` is the nameplate a machine *should* produce, and every SHA-256 degradation
threshold is derived from it. It is resolved in a fixed order by
`asic_profile_loader.resolve_expected_hashrate()`, and the winner is published as
`miner_expected_hashrate_source{ip,name,source}`:
- `v3` — `rated_hashrate.py` asks the machine over WhatsMiner API v3 (port 4433,
  `get.device.info` → `msg.miner.detect-hash-rate`, per-board GH/s, unauthenticated, cached 1 h).
- `cgminer` — summed `Factory GHS` from the CGMiner `devs` response. Independent second source;
  measured to agree exactly with `v3` on 17 of 19 machines, and reaches `.74`, which refuses 4433.
- `profile` — inferred from the model string in `asic_profiles.yaml`. This is the *guess*, and it
  understated every machine that can be asked (+5.2% fleet-wide, +23.4% on `.126`).
- `none` — nothing could be resolved; no expected-hashrate series is published, deliberately, so a
  degradation rule cannot fire against an invented figure.

Same rule as `SIMULATION_MODE` and `miners_config_source`: **a fallback must never be
indistinguishable from success.** Do not collapse this to a single number, and do not re-fit a
threshold without checking which source produced the value it is fitted to (DMI-75).

Per-board figures come from `devs`, not from pyasic, which populates them on one machine in this
fleet: `miner_board_chips_count`, `miner_board_hashrate_ths`, `miner_board_temp_c`,
`miner_board_chip_temp_c` (DMI-64, DMI-91). ⚠️ **`MHS av` does not carry a consistent unit across
this fleet's firmware** — derive it from the same entry's `Factory GHS`, as `parsers/board_readings.py`
does; never assume MH/s.

### Removed: the `pool_network_*` family (DMI-86)
The scheduler used to TCP-probe the pools in `etc/pools.yaml` and publish seven `pool_network_*`
gauges. Four of them — `pool_network_ping_avg_ms`, `_ping_min_ms`, `_ping_max_ms` and
`_packet_loss_percent` — were written as a literal `0.0` every cycle in this deployment, because
`ENABLE_ICMP_PING` was off, and **three of the file's six alert rules read those constants** (`PoolHighLatency`, `PoolPacketLoss`, `PoolHighPacketLoss`). The probe, the gauges,
`pool_network_alerts.yml` and the Pool Network Quality dashboard are all gone. Pool health is the
DMI-56 path above; do not reintroduce either.

### Error-code events and v3 PSU output (DMI-108)
`python-scheduler/v3_telemetry.py` asks every configured miner `get.device.info` on port 4433
**once per collection cycle** — the request DMI-81 already uses, but hourly there and every cycle
here: a nameplate changes only when someone swaps a hashboard, while a code timestamp means nothing
at any cadence slower than the sampling. It publishes:

| metric | what |
|---|---|
| `miner_error_events_total{ip,name,code}` | counter, +1 per **new** occurrence of a code |
| `miner_error_last_happened_seconds{ip,name,code}` | poll-time unix ts of that occurrence |
| `miner_psu_vout_raw{ip,name,model,psu_model}` | PSU output voltage, firmware raw units |
| `miner_apiswitch{ip,name,model,psu_model}` | API switch state, 0/1 as reported |

- **A machine's `error-code` list holds only the LAST occurrence of each code** (measured
  2026-09-18: `.122` carried a `233` from 09-10 next to a fresh `275`). That is why this is a counter
  plus an append-only JSONL and not a gauge: a sampled gauge loses every earlier occurrence, which is
  exactly the answer to "what happened while nobody was looking".
- The JSONL lives on the scheduler's docker volume (`V3_EVENTS_DIR`, default `/app/data/events`,
  bind-mounted at `data/python-scheduler/events`), rotates at 10 MB into `errors-<date>.jsonl`, and is
  **the only copy of the `reason` texts** — which is why it sits in the config tier of
  `bin/backup_prod.py`. `reason` never goes into a Prometheus label (cardinality).
- **A code's first sighting is recorded as baseline and is not counted**; the counter is born on the
  first *change* of an already-known pair. An absent series for a code that has been sitting on a
  machine for weeks is therefore by design, not a dead collector.
- `miner_error_last_happened_seconds` carries **poll** time, never the machine's `when_machine` —
  that field is the machine's own local time with no timezone.
- `vout` is `_raw` deliberately: the firmware states no unit, and its own code 212 gives the operating
  border as `[1150, 1500]` in that same scale. Do not rename to `_volts` or divide by 100 until a
  source confirms centivolts — an unconfirmed unit in a metric name is the `MHS av` failure (DMI-91),
  repeated on every dashboard that reads it.
- The input side of the same supply is DMI-94's `miner_psu_input_volts` / `_amps` / `_watts` /
  `_temp_c`, from `get_psu` on **4028**. The two families share a label set but keep **separate**
  published-set caches, so neither can prune the other's series when their `psu_model` strings
  disagree.
- Trap found on the first deploy (`ed0af17`): `dict.get('api_port', 4028)` does **not** substitute for
  a present `None`, and `miners.api_port` is NULL in this database — the collector dialled port 0
  every cycle while its log said `:4028`, so DMI-94 collected nothing at all for six days while
  looking healthy. Where a value can legitimately be absent, `or` the default; do not rely on `.get()`.

### Park rules — a standing machine, and a site power sag (DMI-109)
`docker/prometheus/rules/park_alerts.yml` holds five rules: `ParkMinerDark`, `ParkMinerStale`,
`ParkPowerEvent`, `ParkVinLow`, `ParkVinCluster`. They exist to **wake someone** when the farm stops
producing — the failure mode behind ~85% of the month's measured losses, and the one that previously
went unnoticed until a human looked.

- **`component: farm` on every one is load-bearing.** This site sets
  `ALERT_NOTIFY_EXCLUDE_COMPONENTS=miner`, so a park rule labelled `miner` would be born suppressed
  and nobody would ever see it fire — the rule would look deployed and reach no one.
- `ParkMinerDark` uses `max_over_time` ("every reading in the window was low") while `ParkPowerEvent`
  uses `min_over_time` ("any low reading"). Both chosen by measurement: a reboot ramp stays under
  500 W for 1–2 minutes, so the min-variant pages on machines that are *recovering*, while the early
  cluster signal wants exactly that sensitivity.
- `.58` and `.117` are excluded with `ip!~"192.168.2.(58|117)"` wherever power is counted — both are
  stopped deliberately and would otherwise fire every park rule forever.

### Simulation (`SIMULATION_MODE`)
Simulated/fake data is served **only** when `SIMULATION_MODE=true` (default false). It is never a silent fallback: on a Prometheus read error the backend keeps last-known real stats and logs the error; boot does not seed fake data. Do not reintroduce a `simulateMiningStats()` fallback into the real path.

### Collection path (`COLLECTION_PRIMARY`, DMI-136)
WhatsMiner-class machines can be read by two collectors: `asic/` (our own 4028 client and driver,
DMI-135's layer) and the pyasic path the scheduler grew up on. `COLLECTION_PRIMARY` says which one
**publishes** — `pyasic` (default, today's behaviour) or `cgminer` (ours). The default matters: a
deploy that changes nothing but the code cannot change a value.

`COLLECTION_COMPARE=on` runs **both** paths against the same machine in the same cycle and logs every
field that disagrees, per machine, with the source field each side read. It never decides which path
publishes, so it is a measurement of the switch and not part of it. Bound it — it roughly doubles
4028 traffic — with `COLLECTION_COMPARE_CYCLES` / `COLLECTION_COMPARE_IPS`.
`COLLECTION_COMPARE_EXPECTED=ip:reason,…` is the written record of machines allowed to differ; a
difference with no reason is the finding, and `miner_compare_mismatch_total{field,result}` keeps the
count. The active path is published as `scheduler_collection_path` — a mode that runs must not be
invisible. It is written once per cycle from the batch publish block in
`collect_pyasic_metrics()`, and once at startup so the series exist from the first scrape. Its
`comparing` sibling `scheduler_collection_compare` is *counted, not configured*: it reads 1 only
when the comparison actually ran for a machine in that cycle, so an expired
`COLLECTION_COMPARE_CYCLES` reads 0 rather than the flag's 1. Until 2026-09-21
`publish_collection_path()` had **no caller anywhere** (DMI-211) — the family was scraped as HELP
and TYPE with no sample, so the mode was invisible by means of the metric that existed to make it
visible. `python-scheduler/test_metric_wiring.py` fails on that class now.

Two things to keep true:

- **`asic/parity.py` reproduces pyasic's field *selection*, not a better one.** This fleet answers
  `summary` in two shapes — `{"SUMMARY":[…]}` on 13 machines, `{"STATUS":"S","Msg":{…}}` on 7 — and
  pyasic reads only the first; a `KeyError` is a `LookupError`, which `_get_hashrate` catches, so on
  the Msg-shaped machines the published hashrate and power already come from *our* gap-filler. `MHS
  av` and `MHS 1m` are both in **MH/s** here, while `asic_profiles.yaml` declares TH/s for
  WhatsMiner — wrong by 10^6, and its own ticket; reproducing it is what this phase requires, fixing
  it is a published-value change.
- **A machine whose `devs` pyasic can parse keeps the pyasic source even when `COLLECTION_PRIMARY=cgminer`**
  (the driver reports it as `pyasic_registry_tainted`). Its board series carry pyasic *registry*
  values — chips per model, and a placeholder slot per `expected_hashboards` — that no machine
  states, so our driver cannot reproduce them. Measured 2026-09-18: one machine out of twenty, `.74`,
  where it is not cosmetic — its headline temperature is pyasic's rounded chip average.

### Alert delivery (`ALERT_NOTIFY_*`, DMI-78/79)
`notifier.service.ts` owns delivery, and its contract is **"say what happened"**, not "send a
message": every call returns `delivered` / `not_delivered` / `unverified` and is counted in
`alert_notifications_total{channel,outcome}`.

- `ALERT_NOTIFY_CHANNEL` — `telegram` (default) · `ntfy` · `log` · `none`. **This site runs `ntfy`** because
  Telegram is blocked upstream here, measured with a control (`api.telegram.org` times out while
  `cloudflare.com` and `ya.ru` answer). `ntfy` needs `NTFY_TOPIC`; `NTFY_URL` defaults to the public
  `https://ntfy.sh`.
- `ntfy` is the only channel allowed to report `delivered`, because it answers with a status code.
  The telegram branch may return **only** `unverified` — `sendSmartAlert()` swallows its own
  transport errors, so "it returned" says nothing about delivery. Do not "upgrade" that to
  `delivered`; it would be a fabricated measurement.
- `ALERT_NOTIFY_EXCLUDE_COMPONENTS` / `ALERT_NOTIFY_EXCLUDE_ALERTS` — suppress *notification* only,
  by the rule's `component` label or its name. **This site sets `ALERT_NOTIFY_EXCLUDE_COMPONENTS=miner`**:
  the farm runs old ASICs to failure, so per-machine overheating and error codes are recorded and
  dashboarded but never pushed. Both are empty by default, so the failure direction is one
  notification too many, never one silently withheld.
- Suppression is **not** silence: the alert is still recorded by `alert.service` before notify is
  called, still in history and `activeAlerts`, and the suppressed attempt is still counted as
  `not_delivered` with a stated reason.
- Do not filter in Alertmanager instead — all its receivers post to the same backend webhook, so
  filtering there would stop the alert being *recorded*, not just announced.

## Miner configuration

Miners historically lived in `etc/miners.yaml`.
Current runtime source of truth for the **stack** is SQLite.

**Source of truth for miner *identity* is the machine itself** (decided 2026-08-28, DMI-74): the
pool worker string it submits under, `<account>.<worker>`. The subnet move and the local network
storms are what desynchronised the database, so when the two disagree the machine wins and the DB is
reconciled to it — not the other way round. `miners.name` should equal the worker name; after the
2026-08-28 reconciliation it does for every reachable machine. `miners.name` is UNIQUE, so freeing a
name (removing a decommissioned record) must precede assigning it.

Boot behavior:
- `server.ts` calls `initializeMinersFromYAML()`
- YAML seeds the DB only if the DB is empty

Rule:
- do not reintroduce runtime dependence on YAML for normal request handling

### Scheduler miner list — provenance is tracked (DMI-58)
The scheduler fetches its miner list from `GET {BACKEND_URL}/api/mining/miners` and falls back to
`MINERS_CONFIG` (`etc/miners.yaml`, which holds example miners) only when it has never fetched a
real one. Every load records where the list came from, in `config.miners_config_source`:
- `database_api` / `yaml` — the intended source (healthy)
- `stale_cache` — backend unreachable, last known good list retained rather than replaced
- `yaml_fallback` — backend unreachable with nothing cached; likely polling placeholders
- `none` — nothing loaded

Same rule as `SIMULATION_MODE`: **a fallback must never be indistinguishable from success.** The
source is exposed as `scheduler_config_source{source}` / `scheduler_miners_configured`, drives
`/health` (degraded on the fallback sources) and `/status`, and is alerted on in
`docker/prometheus/rules/scheduler_alerts.yml`. Do not make the health check re-probe the backend
instead of reporting the loaded config, and do not let a failed fetch overwrite a good list.

### Miner API cadence — the 1/min rule is about writes, not reads (2026-09-12)

Two APIs, and the rate rule applies to only one kind of traffic on one of them:

- **Reads on 4028 (CGMiner) are the deployed polling path and stay as they are.** The scheduler
  issues `summary`, `devs`, `pools` and `get_psu` per miner per cycle — about **2 requests/min per
  machine at the 120 s cycle** — and has done for months with no observed harm. pyasic speaks the
  same port.
- **`≤1 request/min` applies to 4028 *write* commands** — `power_off`/`power_on`, `set_pools`,
  firmware operations. The rule originated around power commands on `.117`; it was later restated
  as "4028 is not for polling", and that generalisation is **withdrawn** — it contradicted the
  running system.
- In practice mass writes cannot happen anyway: a write needs **`apiswitch = 1`, which is set on
  exactly two machines in this fleet**. Enabling it on another requires WhatsMinerTool from the
  Windows VM with a known web password set first. So "the write channel is open on 2 of 21" is a
  property of the hardware configuration, not a policy the code enforces.

**Do not move fleet polling to the v3 API (port 4433) for tidiness.** v3 answers on 19 of 21
machines; 4028 answers on 20, and the two sets differ where it counts. `.74` refuses 4433 while
mining ~105 TH/s, and `.78` (DG1+) refuses both and needs its own collector. A v3-only fleet audit
on 2026-09-12 reported both as "offline" for exactly this reason, while both were producing. Port
coverage is why `get_psu` (DMI-94) reads from 4028.

## Commands

### Backend
```bash
cd backend
npm run dev
npm run build
npm start
npm run migrate:dev
npm run migrate:alert-rules:dev
```

Notes:
- there is no real automated test suite
- use `npm run build` as the main TypeScript validation step

### Frontend
```bash
cd frontend
npm start
npm run build
npm test -- MyComponent
```

### Python scheduler
```bash
cd python-scheduler
pip install -r requirements.txt
python main.py
python test_profile_integration.py
```

### Docker / full stack
```bash
make build
make up
make down
make logs
make rebuild-backend
make rebuild-frontend
```

Notes:
- targets run against `docker-compose.prod.yml` (via the `COMPOSE_FILES` var); add the logging overlay with `make up COMPOSE_FILES="-f docker-compose.prod.yml -f docker-compose.logging.yml"`
- there is no `dev` target / `docker-compose.dev.yml`; use the per-service dev commands above for local work
- `make clean` destroys volumes and DB state

## Deployment

Primary deployment target: Raspberry Pi 4 (ARM64).

Current deployment model:
- local build on dev machine
- Raspberry Pi pulls updated images or artifacts via existing deploy scripts

Known deploy paths:
- local registry flow
- Docker Hub flow

Important scripts:
- `quick-deploy.sh`
- `build-local.sh`
- `deploy-to-pi-registry.sh`
- `deploy-optimized.sh`
- `pi-quick-update.sh`

Rule:
- do not redesign deployment unless explicitly asked

## Working assumptions

- config is env-driven; prefer `.env` / `.env.example` patterns over hardcoding
- thresholds in backend config must stay aligned with Prometheus alert rules
- Telegram bot settings come from DB settings at runtime
- backend uses singleton getters and lazy requires to avoid circular imports; preserve that pattern where relevant
- historical markdown in repo root and `docs/` is useful background, but code is authoritative
- `INTERNAL_METRICS_TOKEN` must be set in production to authenticate scheduler metrics pushes to `/api/internal/metrics`

## Docker guidance

For local code changes, Docker is not required by default.

Preferred workflow:
- inspect and change code locally first
- use the smallest validation command that fits the change
- use Docker only when needed for integration verification or deployment-related work

Do not force a Docker-first workflow unless the task specifically requires it.

## Default first step

When starting work on this repository:
1. inspect repository structure
2. summarize current architecture
3. identify risk areas
4. propose a phased plan
5. only then start implementation

## Implementation workflow

Code changes may be produced by a separate code-generation agent rather than written by hand. Regardless of who authored a change, the same discipline applies before anything is committed:
- work on a dedicated branch off `main`, scoped to the smallest change that fits the task
- review the full diff for scope and correctness
- validate with the smallest sufficient command (`npm run build` for the backend, plus the relevant runtime/acceptance check)
- stage only the intended files — never blanket-add the working tree (local/untracked and machine-specific files must not be committed)
- commit only after the change is reviewed and verified; do not commit or push without approval

Machine-specific tooling and local setup notes live in `CLAUDE.local.md` (git-ignored), not here.