# PROJECT_STATE.md

Repository review and improvement plan. Originally analysis-only; now also the
living roadmap, kept in sync with shipped work and the Linear "Mining Stack" project.

Date: 2026-06-17 (original review) · **Last refreshed: 2026-08-12 (post-deploy)**
Reviewer: Claude Code
Scope: full repository read (`backend/`, `frontend/`, `python-scheduler/`, Docker/monitoring, deploy scripts).

> **Status at a glance (main `cb3b509`, deployed and verified on the Pi)**
> - ✅ **Done & merged:** P0 (Pi-drift backport), **Phase 0** (test harness + CI), Phase 1 (security S1–S5), Phase 2 (data-path clarity), **Phase 4 cleanup complete (C1–C5)**, **Phase 3.3** (`mining.service.ts` decomposition, DMI-36..41).
> - ✅ **Operational:** DMI-19/20 (subnet-move recovery) · **DMI-43** (deploy-script host discovery) · **DMI-44** (router syslog → Loki) · **DMI-53** (router log flood removed) · **DMI-54** (stale-series crash) · **DMI-56** (pool health read from the miners) · **DMI-58** (scheduler config provenance) · **DMI-59/60** (SHA-256 hashrate alerting actually binds) · **DMI-61** (the Pi can now witness its own failures).
> - ⏳ **In progress:** **Phase 3** — 3.1 (DMI-28), 3.2 (DMI-29..35) and 3.3 (DMI-36..41) done; **3.4 (`telegram.service.ts`) is next and last**.
> - 🔧 **Open ops items:** **DMI-62** (21 permanently-firing false `MinerMissingChips` — the largest source of alert noise) · **DMI-47** (uplink observability: exporter + alert shipped, SIM/session state still unmeasured) · **DMI-49** (watchdog **armed** 2026-08-12; its router-restart action is still unproven — see below) · **DMI-45** (hashrate shortfall — a hardware-repair list) · **DMI-52** (error codes / ambient temp / fan RPM) · **DMI-55** (dead miners' gauges inflate fleet totals) · **DMI-57** (retest the Fibocom + external antenna) · DMI-50/51 (remaining fault-tolerance layers).
> - 🚨 **The site has no automatic WAN recovery, and the diagnosis of why has been corrected twice.** Both August outages ended only when a human restarted the router. The router's own built-in modem power-cycling fired **134 times in 2h29m on 2026-08-12 and recovered nothing.** See DMI-46 below before trusting any earlier account.
> - ✅ **Deployed 2026-08-12**, then six follow-up fixes shipped and verified live the same day: Loki query limits, the Grafana datasource collision, a full 7-dashboard sweep, promtail coverage for the two new services, and the watchdog armed.
> - ℹ️ **Deploy detail:** Fleet 2009 TH/s / 62 kW / 20 miners scraped; scheduler `config_source: database_api` with 25 miners and **0 placeholders**; 0 "No profile found"; 17 `miner_expected_hashrate_ths` series live; 57 `miner_pool_alive` series live; watchdog running and, since 19:26 UTC, armed. Deploy mechanics and traps are in `CLAUDE.local.md`.

---

## 1. Current architecture

Cryptocurrency mining-farm monitoring & control system. Multi-container Docker stack, target runtime Raspberry Pi 4 (ARM64), ~20+ ASIC miners.

Three first-party services + a monitoring stack:

| Service | Stack | Role |
|---|---|---|
| `python-scheduler` | Python, FastAPI, APScheduler | Polls miners, exposes `/metrics` for Prometheus, optionally pushes to backend |
| `backend` | Node, Express, TypeScript | REST + WebSocket API, SQLite store, JWT auth, Telegram bot, miner control |
| `frontend` | React 18, TypeScript (CRA), MUI, Redux Toolkit | Dashboard UI |
| monitoring | Prometheus, Grafana, Alertmanager, blackbox-exporter | Scraping, dashboards, alerting |
| `router-exporter` | Python, stdlib + `prometheus_client` | Reads the Keenetic over RCI/SNMP; exports uplink health and traffic accounting (DMI-47) |
| `wan-watchdog` | Python, stdlib | Restarts the router over RCI after 10 min of confirmed downtime — **armed** on the Pi, disarmed by default in the image (DMI-49) |

Orchestration: `docker-compose.prod.yml` (+ `docker-compose.logging.yml`, `docker-compose.dockerhub.yml` on the Pi). `Makefile` wraps common compose actions. Both new services are built on the Mac for `linux/arm64` and pulled from the registry like the rest — deliberately **not** `build:` directives, since the Pi has no build context.

**Service size (LOC, measured 2026-08-12 — indicative of where complexity still concentrates):**
- `backend/src/services/telegram.service.ts` — **2369** ← the only untouched monolith; Phase 3.4
- `python-scheduler/main.py` — 999
- `frontend/src/pages/Miners.tsx` — 958
- `backend/src/services/database.service.ts` — 804 *(was 1595; facade over 7 repositories, Phase 3.2)*
- `python-scheduler/collectors/pyasic_collector.py` — 720
- `backend/src/services/mining.service.ts` — 308 *(was 1470; facade over `services/mining/`, Phase 3.3)*

---

## 2. How the monitoring flow works

Primary flow:

```
miners ──poll──> python-scheduler ──/metrics──> Prometheus ──query──> backend ──REST/WS──> frontend
```

Step by step:

1. **Collection** — `python-scheduler/main.py` runs an APScheduler interval job. Per-vendor collectors (`collectors/pyasic_collector.py`, `antminer_cgi_collector.py`, `whatsminer_cgi_collector.py`, `dg1_tcp_collector.py`, `dg1_http_collector.py`) talk to each miner. Model→algorithm/profile mapping comes from `asic_profiles.yaml` via `asic_profile_loader.py`.
2. **Exposure** — scheduler publishes Prometheus metrics (`miner_hashrate_ths{algorithm="sha256"}`, `miner_hashrate_mhs{algorithm="scrypt"}`, `miner_power_watts`, `miner_temp_max_c`, `miner_state`, scrape status, etc.).
3. **Scrape** — Prometheus scrapes the scheduler; alert rules live in `docker/prometheus/rules`, routed by Alertmanager.
4. **Read** — backend reads metrics from Prometheus (`prometheus.service.ts` → `getAllMinerMetrics()`, called by `mining.service.ts:756`). Backend normalizes hashrate to TH/s internally.
5. **Serve** — backend pushes stats to the UI over WebSocket on `config.mining.updateInterval` (`mining.service.ts` `startMining()` interval, ~30s) and serves REST. Frontend consumes via `services/api.ts` / `apiSlice.ts` and `hooks/useWebSocket.ts`.

**Two important side paths:**
- **Push channel** — scheduler can also `POST {BACKEND_URL}/api/internal/metrics` when `PUSH_TO_BACKEND` is enabled (`main.py:287`), handled at `backend/src/routes/mining.routes.ts:777` → `updateMetricsFromScheduler()`. This is a *second* way the same data reaches the backend, parallel to the Prometheus read path.
- **Simulation** — gated behind `SIMULATION_MODE` (default false) since Phase 2/P2.1. Fake data is served *only* when explicitly enabled; a Prometheus read error keeps last-known real stats rather than silently falling back to random data.
- **Control** — miner reboot is in-process TypeScript (`miner-control.service.ts` → `miner-rebooter.ts`: WhatsMiner protocol + `antminerRestart`), exposed via API and the Telegram bot — independent of the read path.

**Two metric namespaces exist:** the scheduler exposes `miner_*`; the backend's own `/metrics` endpoint exposes a different `mining_*` / `alert_queue_*` set (`server.ts:122`). Not wrong, but worth knowing they are distinct.

### Which signals are trustworthy — read this before adding a metric or an alert

Nearly every wrong conclusion recorded in this document came from the same mistake: **trusting a
proxy signal instead of the production path.** The list is long enough to be a pattern, not bad luck.

| Rejected signal | What it actually measured | Cost |
|---|---|---|
| `probe_success{job="pool-tcp-check"}` | the pool's tolerance of bare TCP connects from a prober | a phantom 75.5% availability and a whole wrong outage diagnosis (DMI-46, DMI-56) |
| Tailscale reachability | whether the DERP path has re-established | lagged real recovery by **56 min** on 2026-08-12; produces routine false "site is down" |
| `Network::InternetChecker` | an unreliable router-side ping check | missed one recovery and one entire event |
| `router_uplink_up` | the USB link to the dongle | stayed up through a 2h29m total outage |
| count of `miner_scrape_status` series | a value that oscillates 20↔25 by design | would produce false alarms in both directions |
| a single ICMP reply | nothing durable | a false "the Pi is back" notification |

**The one signal that has never been wrong: `sum(rate(miner_pool_accepted_total[5m]))`** — real share
submission across ~20 devices, riding the production path end to end. Prefer it, and prefer anything
built the same way: measured *through* the system that matters, aggregated over many independent
sources.

Two rules follow, and both are already load-bearing in the code:

1. **A fallback must never be indistinguishable from success** (Phase 2/P2.1, DMI-58). If the source
   of a value can vary, publish the source alongside the value.
2. **Absent is not zero.** A fabricated `0` on a counter reads as "nothing happened", which is a
   different claim from "not measured". The router exporter omits interfaces it cannot read rather
   than zeroing them, for exactly this reason.

---

## 3. Likely risk areas

Ordered by severity. File:line references included.

### Security
- **S1 — `/api/internal/metrics` is unauthenticated** — ✅ **DONE** (branch `feat/internal-metrics-auth`, commit `05971be`, verified live). Now requires `X-Internal-Token` = `INTERNAL_METRICS_TOKEN`; unset token fails closed (503) in production, warns+allows in dev.
- **S5 — Legacy `X-Telegram-Chat-ID` header grants admin without a token** — ✅ **DONE** (branch `feat/disable-legacy-header-auth`, commit `e41fd54`, verified live). Legacy path now gated behind `ALLOW_LEGACY_HEADER_AUTH` (default false) with a startup warning when enabled; JWT and system-API-key paths unchanged. Verified: default → legacy admin header rejected (401); flag on → admin 200 / non-admin 403 + warning.
- **S2 — Hardcoded fallback JWT secrets** — ✅ **DONE** (branch `feat/require-jwt-secrets-in-prod`, commit `fe157fa`, verified live). `validateJwtSecrets()` startup guard: prod + unset/dev-default `JWT_ACCESS_SECRET`/`JWT_REFRESH_SECRET` → error + `exit(1)`; dev → warn. Dev defaults exported as constants from `config.ts`.
- **S3 — Permissive CORS with credentials** — ✅ **DONE** (branch `feat/cors-allowlist`, commit `369cfd4`, verified live). Explicit comma-split `CORS_ORIGIN` allowlist with `credentials:true`; when unset/`*` → production warns and drops credentials (origin `*`, `credentials:false`), development keeps reflect-origin+credentials for local cookie auth.
- **S4 — Weak default Grafana password** — ✅ **DONE** (branch `feat/grafana-password-required`, commit `93fbdfb`, verified). `docker-compose.prod.yml` now requires `GF_SECURITY_ADMIN_PASSWORD` (fail-closed `${..:?}`); the committed default was dropped and scrubbed from all docs + `health-check.sh`. ⚠️ The Pi `.env` must set this before a prod Grafana restart.

### Correctness / consistency
- **R1 — Dual ingestion paths** — ✅ **RESOLVED** (Phase 2, P2.2). `METRICS_SOURCE` (default `prometheus`) makes exactly one path authoritative; the other acks but does not overwrite `miningStats`.
- **R2 — In-memory stats are authoritative for the live UI** (`miningStats` global in `mining.service.ts`). 🟡 Partly mitigated: on a Prometheus error the backend now keeps last-known real stats (P2.1) instead of zeroing. Still in-memory only — a restart shows empty until the next tick. Open.
- **R3 — Simulation path wired into the production code path** — ✅ **RESOLVED** (Phase 2, P2.1). Fake data is served only when `SIMULATION_MODE=true` (default false); never a silent fallback. Reintroducing a `simulateMiningStats()` fallback is explicitly disallowed.

### Operability / maintainability
- **M1 — Very large modules** — 🟡 **mostly addressed.** `database.service.ts` 1595 → 804 (Phase 3.2) and `mining.service.ts` 1470 → 308 (Phase 3.3), both as facades with zero callsite changes. Remaining: `telegram.service.ts` (2369, Phase 3.4) and `Miners.tsx` (958, not scheduled).
- **M2 — No automated test suite** — ✅ **RESOLVED** (Phase 0, DMI-25). `npm test` is real (`npm run build && node --test test/`), CI gates backend build+tests, frontend build, and the scheduler on every PR and push. Coverage has grown with each slice: repository tests (41), mining-service tests, `metrics.py`/collector tests (DMI-54), watchdog tests (DMI-49), profile-matcher tests (DMI-60), router-exporter parser tests (DMI-47). All stdlib — no new test dependencies.
- **M3 — No schema/migration versioning** — ✅ **RESOLVED** (Phase 3.1, DMI-28). `backend/src/db/migrations.ts` uses `PRAGMA user_version` + an ordered `MIGRATIONS` array. 🟡 Residual: legacy ad-hoc `ALTER`s remain in `initializeDatabase` (~L396-426) and should be folded into `migrations.ts`.

---

## 4. Obvious cleanup opportunities

Low-risk, high-signal. None of these change behavior.

- **C1 — Dead/backup code** — ✅ **DONE** (DMI-21, commit `ca45aa7`). Removed `python-scheduler/backup/`, `bin/backup/`, and `.github/workflows/build-and-push-full.yml.disabled` (14 files). `docs/archive/` is retained as the deliberate archive home; gitignored `CLAUDE_backup_*.md` left as-is.
- **C2 — Root markdown sprawl** — ✅ **DONE** (DMI-23, commit `6f5f1e9`). 8 historical notes `git mv`'d into `docs/archive/`; root tracked `.md` reduced 18 → 10 (canonical + planning).
- **C3 — README / Makefile drift** — ✅ **DONE.** Makefile fixed (DMI-22, `8ad4279`); README link drift fixed (DMI-26, `1dc72a1`): all 23 relative links now resolve (was 3/18), two duplicate Documentation sections merged, dead `docker-compose.dev.yml` quickstart → `make up`, MIT `LICENSE` added.
- **C4 — Duplicate/overlapping deploy scripts** — ✅ **DONE** (DMI-27, `da71063`). `DEPLOYMENT.md` now has a "Deployment scripts (reference)" section mapping all 9 `*.sh` to two flows, marking `quick-deploy.sh` (local-registry) and `deploy-optimized.sh` (Docker Hub) as the canonical entrypoints.
- **C5 — Two metric namespaces** (`miner_*` vs `mining_*`) — ✅ **DONE** (Phase 2, P2.3, commit `0b3ef19`). Documented in CLAUDE.md "Data sources & metrics".

---

## 5. Phased improvement plan

Designed so each phase is independently shippable and reversible. Earlier phases unblock later ones.

### Phase P0 — Pi drift backport — ✅ DONE & merged (`7f1d4b6`)
The ~6 days of uncommitted Pi-side bug fixes (duplicate Telegram alerts, broken `MinerOffline`/`MinerNotMining` rules using the non-existent `miner_scrape_success`, a `pyasic_collector` crash path) were reconciled and merged so a redeploy can no longer revert them. `feat/per-miner-history` was retired (archived to local tag `archive/per-miner-history`); the overlap was resolved in main's favour. `PI_DRIFT_FINDINGS.md` committed as the record (now under `docs/archive/`). Deferred and still open: the async `config.py` conversion (Pi WIP `config.py.new`) — finish + test as its own change.

### Phase 0 — Safety net (prerequisite) — ✅ DONE & merged (DMI-25, `3f4ddb1`)
Landed late (after Phases 1/2/4) but now in place, so Phase 3 refactors are verifiable.
- `backend/test/smoke.test.js` — `node:test` smoke test that boots `dist/server.js` (safe self-contained env, temp `DATA_DIR`) and asserts `GET /health` → 200; `npm test` is now real (`npm run build && node --test test/`).
- `.github/workflows/ci.yml` — gates backend (build + smoke test), frontend (build), and scheduler (`py_compile main.py` + `python bin/test_farm_init.py`) on PR + push to `main`.
- *Goal achieved: every later change is now verifiable by CI, not just by hand.*

### Phase 1 — Security hardening (highest value) — ✅ DONE & merged to `main`
Order delivered: S1 ✅ → S5 ✅ → S2 ✅ → S3 ✅ → S4 ✅.
- **S1**: authenticate `/api/internal/metrics` — ✅ DONE (commit `05971be`, verified).
- **S5**: disable the legacy `X-Telegram-Chat-ID` admin path by default — ✅ DONE (commit `e41fd54`, verified).
- **S2**: refuse to boot in production with default/unset JWT secrets — ✅ DONE (commit `fe157fa`, verified).
- **S3**: tighten CORS — explicit allowlist when `credentials: true`; never reflect arbitrary origins. — ✅ DONE (commit `369cfd4`, verified).
- **S4**: force Grafana admin password via required env, drop the weak committed default. — ✅ DONE (commit `93fbdfb`, verified).
- **Phase 1 fully merged to `main`.**

### Phase 2 — Data-path clarity — ✅ DONE & merged to `main` (`9a9d94f`)
- P2.1 `SIMULATION_MODE` (opt-in, no silent fallback) — `5203334`.
- P2.2 `METRICS_SOURCE` single source of truth; fixes the `miningStats` dual-write — `a3b72ea`.
- P2.3 CLAUDE.md namespaces/data-path docs — `0b3ef19`.
- Verified safe against the live Pi (`.env` takes new defaults; Prometheus holds 22 miner series).

### Phase 3 — Maintainability — ⏳ IN PROGRESS
- **3.1 — SQLite schema versioning (M3)** — ✅ DONE & merged (DMI-28, `76df13e`). `backend/src/db/migrations.ts`: `PRAGMA user_version` + ordered `MIGRATIONS` array; migration #1 folds in the operationally-added `mac` column (DMI-20) idempotently.
- **3.2 — `database.service.ts` decomposition** — ✅ DONE & merged (DMI-29..35, merge `7fb376e`). 1599 → 804 LOC thin facade over 7 per-domain repositories in `backend/src/db/repositories/`; zero callsite changes; 41 repository unit tests; build + tests green.
- **3.3 — `mining.service.ts` decomposition** — ✅ DONE (DMI-36..41, branch `feature/dmi-phase3.3-mining-service`). 1488 → 308 LOC facade over `backend/src/services/mining/`: `simulation` (fake data, SIMULATION_MODE only), `state` (live snapshot, single writer), `stats-reader` (Prometheus read path), `push-receiver` (scheduler push path), `lifecycle` (interval orchestration), `aggregates` (pure fleet aggregates). Public API unchanged (zero callsite changes); `METRICS_SOURCE` single-writer invariant preserved and now pinned by unit tests; facade no longer writes live stats at all.
- **3.4 — `telegram.service.ts` (~2369 LOC)** — ⏳ OPEN (highest risk, last). Decompose along command-handler seams.

### Phase 4 — Cleanup & docs — ✅ DONE (C1–C5 complete)
- ✅ C1 dead code (DMI-21), ✅ C2 root markdown (DMI-23), ✅ C3 Makefile + README drift / MIT LICENSE (DMI-22/26), ✅ C4 canonical deploy script (DMI-27), ✅ C5 metric namespaces (P2.3).

### Operational stream — subnet-move recovery — ✅ DONE
Not in the original review (environmental, surfaced 2026-06-20 when the Pi's `eth0` moved `192.168.1.x → 192.168.2.x`).
- **DMI-19** — universal MAC-keyed `reconcile` mode in `bin/farm_init.py` (matching tiers MAC → IP-enrich → octet+model heuristic; dry-run default; 14 unit tests). Merged `cc53027`.
- **DMI-20** — live Pi SQLite remap (PK-safe in-place multi-table UPDATE preserving `miner_stats_history`); restored 0 → 19 active miners (~2070 TH/s); added + backfilled the `miners.mac` column so future moves are MAC-recoverable.
- **DMI-43** (2026-08-07) — DMI-19/20 fixed the *miners'* addresses on the Pi's own DB, but the Mac-side deploy scripts (`quick-deploy.sh`, `deploy-to-pi-registry.sh`, `deploy-optimized.sh`, `pi-quick-update.sh`) still hardcoded the Pi's own pre-migration address (`192.168.1.66` / `100.112.244.18`), two of them with no fallback at all. New `deploy-lib.sh` provides one `find_pi_host()` (SSH-probe based, `PI_HOST`/`PI_HOSTS` overridable) sourced by all four, now pointed at the current addresses (`192.168.2.63` LAN DHCP / `100.119.15.37` Tailscale); also made `quick-deploy.sh`'s buildx builder creation idempotent (`ensure_buildx_builder()`). `pi-deploy.sh` (runs on-Pi, not host-discovery-relevant) untouched. Commit `cc93c71`.
- **DMI-44** (2026-08-07, commit `e7fcf82`) — router syslog → Loki. The site's Keenetic keeps its system log in RAM only, so a full-site outage that day was unanalysable: the recovery power-cycle wiped the evidence. promtail now runs a `keenetic-syslog` job on UDP 1514 and was bumped **2.9.0 → 3.5.1** — the router speaks RFC3164 (BSD) syslog and 2.9 parses only RFC5424, silently discarding the datagrams (`syslog_format` requires promtail ≥ 3.1). Applied live on the Pi first, then ported to git and verified byte-identical. Router side, out-of-band: `system log server <pi-ip>:1514`.

### Open operational items (Linear Backlog)
- **DMI-45** — hashrate shortfall. **Diagnosed 2026-08-07 by querying every miner's cgminer API (port 4028) directly; the ticket's original premise was wrong and has been corrected.** It is not a DB-address problem: the 5 non-scraping miners are simply *not on the network at all* (a full ARP sweep found none of them), so re-pointing their IPs cannot help. The real accounting closes as: Prometheus 1866 TH/s + one miner missing from the DB entirely (~103 TH/s) ≈ 1969 vs ~2070 in June — and the ~101 TH/s gap is one machine whose fans have failed. Findings, all hardware:
  - **`.117`** — both fans at 0 RPM, codes 352/560/561/562/600, self-throttled to 51 of 101.8 TH/s, restart-looping. This *is* the June delta.
  - **`.58`** — code 542 (SM2 chip-ID), PSU reports `enable: "0"`; produces nothing. Largest absolute recovery (~172 TH/s).
  - **`.122`** — code 233 (PSU output over-temperature, typically loose copper bus bars), boards stuck Initialising, restarting every ~70 s.
  - **`.145`** — outlet fan at 0 RPM, code 131 (urgent), still hashing 103.8 TH/s: an early warning on the same path as `.117`.
  - **Farm-wide:** all 13 reporting miners sit at ambient 36.9–47.0 °C against a 35 °C throttling threshold; PSU input 211–216 V with code 206 (input voltage low) active on two machines. Ventilation and supply voltage are the systemic causes behind the individual failures.
  - **Inventory drift:** three DB records are bound to the wrong physical machines (model and MAC disagree with what the hardware reports). Fix must be a PK-safe in-place `UPDATE` — miner IP is the primary key and `miner_stats_history` has an `ON DELETE CASCADE` FK — and is deliberately deferred to a field-by-field review.
  - An on-site repair worklist was produced for whoever visits the farm; ~357 TH/s is recoverable with hand tools.
  - **Pending:** adding the unmonitored miner to the Pi's inventory (script prepared and collision-checked, DB backed up, awaiting execution), then MAC backfill and cleanup of the stale records. No repo code changes — this is a live-DB operation like DMI-20.
  - **Still-degraded machines as of 2026-08-12,** now visible because DMI-59/60 made the SHA-256 alerts bind for the first time:
    - **`rebuildm303`** — 0 TH/s on every board while reporting `is_mining=1`, restarting every ~26 s. Caught by `MinerHashrateCriticalSHA256` on its first-ever firing.
    - **`.58`** — still at 0.0 TH/s (unchanged from the diagnosis above).
    - **`.121`** — reports **175.4 TH/s** against a model rated ~100. Either the inventory record names the wrong model or the miner is misreporting; both matter, because this figure feeds fleet totals and every ratio-based alert. Worth resolving alongside the inventory drift above.
    - Five miners remain permanently unreachable. Their series are published with `miner_scrape_status = -2` and culled/recreated on a cycle — see the DMI-58 warning about counting series.
- **DMI-46** — post-mortem of the August outages. **The diagnosis has now been retracted twice.** Read this entry top to bottom before citing any availability figure or cause from an earlier revision of this document.
  - **Retraction 1 (2026-08-08):** the 2026-08-07 version claimed the uplink "demonstrably drops on its own" — ~77% availability, drops every 45–90 min. That came from `probe_success` against `stratum.slushpool.com`, which fails ~25% of the time by itself because pools drop repeated bare TCP connects from an address that never speaks stratum. It measured the pool's tolerance of us, not our connectivity. The owner caught it: pool-side statistics showed no errors, impossible if the link were down a quarter of the time.
  - **Retraction 2 (2026-08-12): it was not balance exhaustion either.** The 08-08 revision concluded "the mobile balance ran out" and called it the only failure this site has suffered. The owner confirms there was money on the SIM, and that they **restarted the router by hand** several times during the event because the link would not come back. That fact was not in the earlier analysis at all, and it changes the conclusion completely.
  - **Correct availability metric: `sum(rate(miner_pool_accepted_total[5m]))`** — the miners' own share submission. It rides the production path and aggregates ~20 independent devices. This part of the 08-08 revision stands and should be the only signal used.
  - **The 2026-08-12 outage is the first one fully instrumented, and it is unambiguous** (persistent journal from DMI-61 + router syslog in Loki from DMI-44). 12:40 → 15:09 MSK, 2h29m, fleet share rate flat at zero:
    - The modem hung **enumerating as a CD-ROM** (`MM200-1 CD-ROM`, `sr0`) and never reached modem mode. `ndm` logged "has not completed IPv4 connection" **106 times**.
    - KeeneticOS's built-in USB-modem recovery power-cycled it **134 times over the whole window and restored nothing.**
    - The link came back **40 seconds after the owner restarted the router by hand.**
  - 🚨 **Therefore: the built-in modem power-cycle does not recover this failure.** An earlier revision of this file credited it with the 2026-08-09 recovery. That was wrong — a manual router restart preceded it there too. There is currently **no automatic recovery on this site at all**; every outage so far has ended with a person present. This is the strongest argument for arming DMI-49.
  - **`Network::InternetChecker` is not usable as a signal** — it missed a recovery on 07.08 and an entire event on 08.08.
  - **Tailscale is not usable as a recovery signal either.** On 08-12 it lagged the real restoration by **56 minutes** while the fleet was already submitting shares. "The site is down" seen from the Mac means, more often than not, only that the DERP path has not re-established. Check the share rate first.
  - **Why the router cannot see any of this:** the topology is a triple NAT — Keenetic `192.168.2.x` → the dongle's own NAT at `192.168.1.1` → carrier CGNAT `10.x`. The Keenetic only ever observes the USB link to the dongle, which never goes down; `show interface CdcEthernet2` uptime is **not** 4G session uptime. Real session state lives in the dongle and is currently unread (DMI-47).
  - **Remaining open question:** what hangs the modem. Volume caps, tethering detection (`ip adjust-ttl send 64` exists on the absent Fibocom profile and *not* on the active `CdcEthernet2`) and carrier-side registration trouble are all still live hypotheses. Answering it needs the dongle's own session data or the operator's usage figures — not more inference from the router.
  - Also identified incidentally: `.54` is a Windows PC (`DESKTOP-QEB032M`), not a miner — closing an open DMI-45 question; and the DHCP log yields a full MAC↔IP map for the fleet, useful for the DMI-45 inventory reconciliation.
- **DMI-53** — ✅ **DONE 2026-08-08.** The router's Entware AdGuard VPN netfilter hook (`/opt/etc/ndm/netfilter.d/001-adguardvpn.sh`) failed on every netfilter reload and at times produced ~95% of the router's entire syslog volume, burying real events and writing continuously into Loki on the Pi's microSD.
  - **`chmod -x` does not disable an `ndm` hook** — `ndm` runs everything in `/opt/etc/ndm/*.d/` through an interpreter and ignores the execute bit (verified: the hook kept firing for 20 minutes afterwards). Moving the file out of the directory is what works: it now lives at `/opt/backup/001-adguardvpn.sh.disabled`. Reversible with `mv`.
  - Verified by comparing the `adguardvpn` line rate against the rest of the syslog — a clean 5-minute window afterwards showed 0 hook lines while ordinary logging continued. Measuring silence alone would have proved nothing.
  - Shell access route worth remembering: the NDMS CLI's `exec sh` drops into Entware's BusyBox with the ordinary `admin` login. Entware's dropbear on port 222 uses a *separate* Unix user database and is a dead end.
- **DMI-49 — WAN watchdog: shipped, deployed, and ⚡ ARMED 2026-08-12.** Merged (`aedf2ca`), containerised (`watchdog/Dockerfile`), built for arm64 and pulled from the registry like every other service, so a clean install brings it back with no manual steps.
  - **Armed state, verified at the time:** `WAN_WATCHDOG_ARM=true` in the Pi's `.env` (backup `.env.bak-arm-*`), startup log `ARMED - the router will be restarted after 10 min of downtime`, exit code 0, clean state file, logs reaching Loki. Exit 0 matters: `main()` returns 2 and refuses to run if it cannot build an authenticated RCI session, so a running armed container is itself proof the router credentials work. Disarm by flipping that one variable and recreating the container.
  - 🚨 **The one thing still unproven: rung 0 has never been executed.** `RciRestarter.restart()` issues `GET /rci/system/reboot`, and the only way to verify an action is to perform it. Authentication and a read-back through the *same* client are verified; the reboot call itself is not. If the path is wrong the watchdog logs the attempt, finds rung 1 is a logging no-op, exhausts the ladder and reports "site visit required" — no worse than before, but no better either. **Arming is therefore safe in both cases; believing rung 0 works is what is not yet earned.** Settle it with one deliberate restart at a chosen moment (~90 s of downtime, an action the owner has already performed by hand several times) rather than discovering it during an outage.
  - **Recalibrated 2026-08-12 after the outage evidence.** The original design waited **45 minutes** before acting, sized against a "21–23 min self-heal envelope" that turned out to be a sample of one — and, per the DMI-46 correction, was not a self-heal at all. Nothing on this site heals itself. First action now happens at **10 minutes** of confirmed dead uplink.
  - **Rung 0 of the ladder is now "restart the router over RCI"** — the only action ever observed to work. Power-cycling the modem (rung 1) is demoted below it, because 134 built-in cycles fixed nothing on 08-12.
  - Safe by construction, unchanged: dry-run unless armed, a logging-only default backend, a Tuya backend that raises rather than silently no-op'ing, a rolling action budget that backs off instead of looping, and a LAN-health guard so it will not restart the router when the fault is local. The guard is three-valued — an *unknown* LAN verdict must not block action, or an outage that also breaks the check would disable recovery exactly when it is needed.
  - ⚠️ **Arming is an open decision for the owner.** `WAN_WATCHDOG_ARM=true` is the whole change. The case for: both outages cost hours and ended only because someone was there; at 2009 TH/s the 08-12 event alone was ~2.5 h of lost production, and the watchdog would have cut it to ~10 min. The case against: an automatic router restart is a real action on the only management path into the site, and it has never run live.
  - **Guards verified by reading the code, not by trusting the description:** it refuses to start if the router socket is also the Pi's own; the LAN-health check is three-valued and an *unknown* verdict does not block action (a watchdog that abstains whenever unsure never acts); the action budget is 3 in 6 h and persists on a volume, so a crash-looping container cannot earn a fresh budget; the arm flag accepts only `1/true/yes/on`, so a typo leaves it disarmed.
  - **Note on its down-detection:** it TCP-probes `1.1.1.1:443` and `8.8.8.8:443` and counts the link up if *either* answers — not the fleet share rate this document otherwise insists on. Defensible, since this measures the Pi's own reachability rather than a third party's tolerance of us, and it reacts in 60 s where a `rate()[5m]` cannot. The residual risk is narrow but real: a carrier that blackholes those two anycast addresses while passing other traffic would look like an outage. Worth revisiting if a restart ever fires with the share rate still healthy.
  - Still open from the original scope: `diagnose()` returns `UNKNOWN` for the upstream-fault case. Distinguishing "modem hung" from "carrier gave us nothing" needs DMI-47's dongle data; until then the watchdog cannot tell an unpaid SIM from a hung modem and will restart the router either way.
- **DMI-47 — uplink observability. Half shipped 2026-08-12; the half that matters most is still missing.**
  - ✅ **Shipped:** a `router-exporter` service (`router-exporter/`, arm64 image, in `docker-compose.prod.yml`) that reads the Keenetic over its **RCI HTTP API** and over SNMP, exporting `router_uplink_up`, `router_uplink_rsrp/rsrq/cinr`, `router_interface_{rx,tx}_bytes_total` and `router_host_{rx,tx}_bytes_total`. Plus a `FleetNoSharesAccepted` alert on the one trustworthy signal, and two Grafana dashboards (Router Syslog, Network Traffic).
  - **Design rule applied throughout: an interface whose counters cannot be read is omitted, never zeroed.** A fabricated `0` on a byte counter reads as "no traffic", which is a different claim from "not measured" — the same failure mode as DMI-58 and `SIMULATION_MODE`.
  - ⚠️ **`router_uplink_up` is the USB link to the dongle, not the 4G session.** It stayed up through the entire 08-12 outage. Do not alert on it as connectivity; it is context, and the panel descriptions say so.
  - ⚠️ **Per-host byte counters under-report** — they only count what the router itself forwards, so they must not be reconciled against the WAN total.
  - **Loki was sized for a cluster, not a Pi — fixed 2026-08-12 after the dashboard returned "too many outstanding requests".** Reproduced before changing anything: 5 panels firing at once over the default 6h range, 2 of 5 got HTTP 429. `split_queries_by_interval: 15m` turned each panel into 24 subqueries (~120 total) against a `query_scheduler.max_outstanding_requests_per_tenant` of **100**, Loki's default. Now `1h` / `max_query_parallelism: 8` / queue `2048` — ~30 subqueries for the same view, and 6h dropped from 9–12 s to ~5 s. Splitting finer bought parallelism a 4-core Pi does not have.
    - **Two stacked timeouts also had to move, and they fail differently.** Loki's `http_server_write_timeout` (default 30s) killed the *connection* on a 7-day range at ~70 s — the query had already succeeded, so the client saw a dropped socket rather than an error. Grafana's own `GF_DATAPROXY_TIMEOUT` (default 30s) is a second ceiling on top and would have cut it off regardless. Both are now 180 s. A wide range is exactly what these dashboards are for when reconstructing an outage, so the ceiling has to clear it.
  - **Grafana trap found while shipping these, now fixed permanently (`95fc36f`).** Both dashboards rendered "No data" because datasource UIDs are generated per install, and a dashboard referencing a datasource by *name* where a UID is expected gets a 404 from `/api/ds/query`. Fixed by pinning `uid: prometheus` / `uid: loki` in provisioning — which alone still failed with "data source not found" until a `deleteDatasources` block was added, since provisioning will not change the UID of an existing datasource. Any dashboard added from now on must reference the pinned UIDs.
    - 🚨 **That fix then caused a second failure, and the "harmless" leftover was the cause.** An earlier revision of this line called the stray hand-made datasource harmless and deferred it to a clean install. It was not harmless: it was named `prometheus` (lowercase) while the real one is `Prometheus` with `uid: prometheus`, so **pinning the UID created a name/UID collision** and Grafana resolved every dashboard reference to the stray — whose URL was `http://localhost:9090`, nothing from inside the container. The whole Network Traffic dashboard failed with "An error occurred within the plugin". Fixed by adding it to `deleteDatasources` (`1a9dce3`). Lesson worth keeping: a pinned UID is only unambiguous if no *name* in the same org collides with it.
  - ❌ **Still missing: SIM balance and 4G session state.** This is the whole reason the ticket exists and the blocker for DMI-49's `diagnose()`. The dongle is reachable from the Pi at `http://status.megafon.ru/` (DNS-hijacked to `192.168.1.1`) but its ZTE `goform` API needs a login handshake the SPA performs and a script has not reproduced. Next step is a browser session (credentials in `CLAUDE.local.md`) to capture the exchange — not more scripted guessing.
  - **Full dashboard sweep afterwards (`5326a7c`) — every panel of all 7 dashboards run through Grafana's own `/api/ds/query`, since that is where the resolution bugs live.** Result `ok=69, errors=0`. It found two more things the eye would not:
    - **27 panels across 4 dashboards still carried `datasource: null`** (mining-overview, per-miner-details, pool-network-quality, scrypt-miners). They worked — but only because the right datasource happened to be default, which is exactly how one stray entry took down Network Traffic. All 51 panels now name their datasource explicitly.
    - **Two panels in logs-overview had never worked:** `Errors (Last 5m)` and `Warnings (Last 5m)` hardcoded `{container_name=~".*"}`, which LogQL rejects outright ("queries require at least one regexp or equality matcher"). Now on `$container` like the rest of the dashboard.
    - ⚠️ **Method note for the next sweep: expanding an `All` variable as `.*` is wrong.** Grafana substitutes the real value list joined by `|`. The first run reported 5 failures; 3 of them were the checker's fault, not the dashboards'. Verifying each one individually before believing it is what kept three healthy panels from being "fixed".
  - **Watchdog and router-exporter logs now reach Loki (`beb88ee`).** Neither carried the `logging: "promtail"` label, so promtail's `docker_sd` never discovered them. That gap was worst where it mattered: the watchdog's log *is* the incident record, wanted precisely after it restarts the router, and a container log does not survive a rebuild. Gotcha met on the way: the compose service is `wan-watchdog`, not `watchdog`, and using the container name made compose reject the entire project — which silently skipped the router-exporter change in the same command.
  - **Measured incidentally, and it answered a live question from the owner:** WAN traffic is 5.81 GB over 2.7 days, of which **4.80 GB went out over the 2.4 GHz Wi-Fi AP** to two client devices. All 20 miners together use ~150 MB/day. The volume-cap hypothesis for the outages is not supported by the miners' own consumption; the Wi-Fi key was changed and WPS disabled as a result (details in `CLAUDE.local.md`).
- **DMI-48, DMI-50, DMI-51** — remaining site fault-tolerance layers (second modem as an independent control channel; whether the miners themselves need WAN failover; moving the Pi off microSD to USB-SSD), designed 2026-08-07 from hardware already on hand (a smart power strip with individually switchable sockets, a spare USB 4G modem, the Pi's on-board Wi-Fi). Layered rather than monolithic; the explicit decision was **not** to make the Pi the site router — it is the device most likely to be down when you need it, and collapsing router and monitoring into one box removes the independent path that makes remote recovery possible. Two design constraints drive the plan: the control channel must never share a power feed with the device it power-cycles, and the smart-strip's local key is only extractable while the strip is still cloud-paired. Found during the router audit: the modem's USB port reports `power-control: yes`, so the Keenetic can cut modem power itself — possibly removing the need for the strip entirely.
- **DMI-52** — collect miner error codes, ambient temperature, fan RPM and PSU input voltage as Prometheus metrics (`miner_error_code`, `miner_env_temp_c`, `miner_fan_rpm{in,out}`, `miner_psu_vin_v`). Every DMI-45 finding came from the same port-4028 API that already feeds the existing metrics — none of it was visible in monitoring, so a fleet that had been degrading for weeks looked merely "slow". Alerts should self-calibrate against each miner's own reported `Factory GHS` rather than a hand-maintained model table, so inventory drift like DMI-45's cannot break detection.

- **DMI-54** — ✅ **DONE 2026-08-08: fixed, merged (`214e5f8`), deployed and verified live.**
  - *The bug:* `main.py` removed stale series by passing three label values to `miner_scrape_status` / `miner_state`, which are declared with four (`ip, name, model, algorithm`). `prometheus_client` raises `ValueError` on the mismatch and only `KeyError` was caught, so the exception escaped to the cycle-level handler and aborted the whole collection — every cycle, for months.
  - *What that cost:* the run was never marked successful (`/health` stuck at `degraded`), failure streaks were never persisted, and the stale-series cleanup had **never worked** at all. Metric values and the backend push were unaffected, since both happen earlier in the cycle — which is why the fleet data still looked right and nobody noticed.
  - *The fix:* removal goes through a new `remove_miner_series()`, which recovers the full label set from the collector's cache. The collector's failure branch also now records labels — it did not, so the repaired cleanup would have stayed a no-op for exactly the unreachable miners it targets. Plus 11 stdlib tests, and CI gained `prometheus-client` and now compiles `metrics.py` and the collectors.
  - *Verified after deploy:* scheduler `healthy`, `last_collection: successful`, and both `Incorrect label count` and `Collection failed` at **zero** in the logs. Fleet unchanged at 1901.6 TH/s.
- **DMI-58** — ✅ **DONE 2026-08-12: fixed, merged (`2694857`), deployed and verified live.**
  - *The bug:* the scheduler fetches its entire miner list from the backend API, but `docker-compose.prod.yml` gave it no `depends_on` for `backend`. On the 2026-08-08 deploy it started first, could not resolve the `backend` host, and fell back to the placeholders bundled in `etc/miners.yaml` (`miner-01`…`miner-04` at `192.168.1.100-103`). The real 25 were not polled. Not deploy-specific — the same race can occur on any stack restart and on every Pi reboot, precisely when nobody is watching.
  - *What made it dangerous:* nothing reported a problem. `/health` said `healthy` and "last collection successful" — collection *was* succeeding, against the wrong list. The `config_file` check even reported "Config loaded from database API", because it re-probed the backend live instead of reporting the source actually in use.
  - *The fix:* every load now records its provenance in `config.miners_config_source` — `database_api` / `yaml` (healthy) vs `stale_cache` / `yaml_fallback` / `none` (degraded). Exposed as `scheduler_config_source{source}` and `scheduler_miners_configured`, surfaced in `/health` and `/status`, and alerted on in `docker/prometheus/rules/scheduler_alerts.yml`. A failed fetch now **retains the last known good list** rather than replacing it with placeholders. Same rule the project adopted for `SIMULATION_MODE` in Phase 2/P2.1 — it simply had not been applied here.
  - *Verified after deploy:* `config_source: database_api`, 25 miners, **0 placeholder IPs**.
  - ⚠️ **Never verify this by counting series.** The count is unstable by design and oscillates between **20 and 25** — 5 miners are permanently unreachable, their series are published with `miner_scrape_status = -2`, culled after N consecutive failures (DMI-54), then recreated on the next attempt. Both values were observed within an hour on 2026-08-12. An earlier revision of this file said "must be 25"; that was wrong and would have produced false alarms. Check `/health`'s `config_file.source`, or grep for the placeholder range `192.168.1.10[0-3]` and require zero.
- **DMI-55** — dead miners' gauges live in the scheduler's process memory and are never cleared, so a machine that stopped responding weeks ago still contributes its last hashrate, power and temperature to every fleet aggregate. Deliberately split from DMI-54 to keep that a pure crash fix: this one changes dashboard numbers and alert inputs, and needs a decision on semantics (delete the series vs. expose staleness explicitly) rather than a mechanical patch.
- **DMI-56** — ✅ **DONE 2026-08-12: fixed, merged (`d494376`), deployed and verified live.**
  - *The bug:* the `pool-tcp-check` blackbox job watched seven pools **the farm does not use, and none of the ones it does.** Six returned exactly 0.0% for a full month (two hostnames no longer resolve; three point at Cloudflare addresses that do not carry port 3333). The fleet actually mines **EMCD** (`gate.emcd.network:3333`), which was unmonitored. The seventh target (slushpool) is the one that produced the retracted availability figure in DMI-46.
  - *The fix:* pool health now comes **from the miners themselves** — `miner_pool_alive{ip,name,url,pool_index}`, built from each miner's own reported pool list. A miner holds a real stratum session, so its verdict cannot be confused with a pool refusing bare TCP connects from a prober. The blackbox target list is now deliberately empty, with `docker/prometheus/targets/README.md` explaining why before anyone adds to it. 57 series live after deploy.
  - *Rules in `docker/prometheus/rules/pool_status_alerts.yml`:* `MinerNoLivePool` (critical), `PrimaryPoolDead` (critical), `PoolDeadAcrossFleet` (critical), `BackupPoolDead` (info, 6h).
  - **Two defects were caught in these rules *after* deploy and fixed same-day** — both worth remembering, because they are the classic shapes of a bad alert:
    - `PoolDeadAcrossFleet` fired "100% dead across the fleet" **off a sample of one** — a URL configured on a single miner. Fixed with a `> 2` sample-size guard (`d063dbf`). A ratio without a denominator check is not a fleet-wide signal.
    - It then fired **critical** on a backup pool while the per-miner `BackupPoolDead` called the same fact **info**. Incoherent by construction. Fixed by restricting it to `pool_index="0"` (`3775920`).
  - *Settled state after both fixes:* `MinerNoLivePool` 0, `PrimaryPoolDead` 0, `PoolDeadAcrossFleet` 0, `BackupPoolDead` 13 at info — 13 dead backups while all primaries are alive and the farm runs at full hashrate, which is exactly the kind of fact that must not read as an incident.
- **DMI-59** — ✅ **DONE 2026-08-12 (`fa7c075`), deployed and verified.** `miner_expected_hashrate_ths` was **never exported**, so both SHA-256 hashrate-degradation rules could never bind and had been silently dead the whole time. Prometheus binary operators match on the *full* label set, so the new gauge carries exactly the labels of `miner_hashrate_ths`; it is registered for stale cleanup alongside the others. 17 series live after deploy, and `MinerHashrateCriticalSHA256` fired **for the first time ever** — catching `rebuildm303` at 0 TH/s on every board while reporting `is_mining=1`.
- **DMI-60** — ✅ **DONE 2026-08-12 (`7249730`), deployed and verified.** `asic_profiles.yaml` matched almost none of the fleet: **18 of 20 miners fell through to no profile**, which is also what starved DMI-59's metric. Added bare-form exacts and patterns for the model strings the miners actually report, an `M50` family, and an exact-only `whatsminer_generic` with **no** expected hashrate — an unknown model must not get a fabricated rating.
  - The load-bearing part of this change was **not** the matcher. Fixing matching alone would have silently removed the `whatsminer_cgi` fallback collector from 18 miners, because `main.py`'s fallback loop did not know that driver type. The profile change and the loop change had to ship together. 0 "No profile found" after deploy.
- **DMI-61** — ✅ **DONE 2026-08-12 (Pi-side, no repo change).** The Pi could not witness its own failures, which is why the 08-07 and 08-09 outages were unanalysable:
  - **The journal did not survive reboots.** Raspberry Pi OS ships `Storage=volatile`, so everything lived in tmpfs. `/var/log/journal` existed but was empty, which makes it *look* persistent — check the effective value, not the directory. Fixed with a `50-` drop-in (the shipped file is `40-`). ⚠️ Restarting journald is **not** enough: `systemd-journal-flush.service` is `static` and already ran at boot: finish with `journalctl --flush`.
  - **No RTC and no `fake-hwclock`,** so every boot started at 2026-04-24 and `journalctl --list-boots` reported one nonsense four-month "boot" that hid every real reboot. First line of the now-persistent journal: `System clock wrong by 9257742 seconds` — 107 days. ⚠️ The SysV-compat `fake-hwclock.service` is masked on this image and will abort a `set -e` script; the units that matter are `fake-hwclock-load/save/save.timer`.
  - Both gotchas are recorded in `CLAUDE.local.md`. This is what made the 08-12 post-mortem possible at all.
- **DMI-62** — 🔧 **OPEN, and the highest-value alerting fix available.** `MinerMissingChips` produces **21 permanently-firing false positives** — roughly half the entire alert list — because chip counts are never collected while expected counts are. The cost is not the rule itself: a list that is half noise trains everyone to stop reading it, which is the only thing standing between a real fault and a silent one. Same class of problem as the `BackupPoolDead` severity decision above, and it should be fixed before any new alert is added.
- **DMI-57** — retest the **Fibocom L850** (Cat.9, in a Vertell VT-STATION with the Petra BB MIMO external antenna) using the *current working Megafon SIM*. Only one modem is physically attached today — a Megafon dongle-router (`05c6:f00e`, MM200-1); the Fibocom's profile survives in the config as `UsbLte0` (`8087:095a`, Intel) but the device is absent. The earlier swap that condemned the antenna changed **two variables at once** — modem/antenna *and* SIM/operator — and Yota is an MVNO on Megafon's own radio, so it never isolated the antenna. `ip adjust-ttl send 64` exists on `UsbLte0` alone, the standard tethering-detection workaround, suggesting the old "constant errors" may have been operator policy. Possible bonus: the Fibocom presents as a plain modem, removing the dongle's NAT layer and perhaps the Tailscale flapping. Requires someone on site, and must be measured with the share rate — not pool probes.

Site-specific network/ops details (router credentials, Tailscale footguns, 4G constraints, deploy preflight) live in the git-ignored `CLAUDE.local.md`, not here.

---

## What to pick up next

Ordered by value, not by ticket number.

1. **DMI-62 — kill the 21 false `MinerMissingChips` alerts.** Half the alert list is noise; nothing
   else in monitoring pays off until reading the list is worth doing. Cheap and self-contained.
2. **Prove the watchdog's router restart actually works (DMI-49).** Arming is done — the remaining
   gap is that rung 0 has never executed, and an action cannot be verified without performing it.
   One deliberate restart at a chosen moment (~90 s of downtime) converts the site's only automatic
   recovery from "probably works" to "known to work". Cheapest possible way to find out, and the
   alternative is finding out during an outage.
3. **DMI-47 — read the dongle.** SIM balance and 4G session state are the last unmeasured part of the
   only failure mode that has actually taken this site down. It also unblocks DMI-49's `diagnose()`,
   which today cannot tell a hung modem from an unpaid SIM. Next concrete step: log into
   `http://status.megafon.ru/` from a browser and capture the auth exchange.
4. **Phase 3.4 — `telegram.service.ts` (~2369 LOC).** The last and highest-risk decomposition slice.
   Purely repo work, no site dependency, so it is the natural filler between the ops items above.
5. **DMI-45 follow-through** — the inventory drift and the `.121` model/hashrate contradiction, both
   of which corrupt fleet totals.

Completed & merged to main: P0, **Phase 0** (DMI-25), Phase 1 (S1–S5), Phase 2 (P2.1–P2.3),
**Phase 3.1–3.3**, **Phase 4 (C1–C5)**, the DMI-19/20 subnet-move stream, and the 2026-08-12
observability/alerting batch (DMI-54/56/58/59/60/61 + the DMI-47/49 slices above).

> **Housekeeping the next clean install should absorb:** the Pi's bind-mounted `etc/pools.yaml` still
> lists the seven unused DMI-56 pools (it is outside the deploy rsync). The stray Grafana datasource
> that used to be listed here is gone and is now blocked by provisioning — see DMI-47.

> **Applied live on the Pi and mirrored in git, so a deploy will not revert them:** the Loki limits
> and both 180 s timeouts, `GF_DATAPROXY_TIMEOUT`, all seven dashboards, the datasource provisioning,
> the promtail labels, and `WAN_WATCHDOG_ARM=true`. Backups sit beside each edited file on the Pi
> (`loki-config.yaml.bak-*`, `docker-compose.logging.yml.bak-*`, `.env.bak-arm-*`). The one thing
> that lives **only** on the Pi is `.env` itself — as designed, but it means `CORS_ORIGIN`,
> `ROUTER_PASSWORD` and `WAN_WATCHDOG_ARM` have no copy in the repo.

---

### ✅ Completed — Phase 1 / S1 — Authenticate the internal metrics push endpoint.

Done in commit `05971be`, verified live (200 / 401 / 503 / 200+warn). Retained below as the template for subsequent slices.

Why first: it was the single highest-value, lowest-risk change. It is small, self-contained, reversible, touches one route, and closes a real unauthenticated-write surface. It does not require the test harness to land safely (though Phase 0 ideally precedes it).

Concrete scope:
1. Add an env var, e.g. `INTERNAL_METRICS_TOKEN`, surfaced in `backend/src/config/config.ts` and `.env.example`.
2. In `backend/src/routes/mining.routes.ts:777`, reject the request (401) unless a shared-secret header (e.g. `X-Internal-Token`) matches the configured token. If the token is unset, log a clear warning and (choose one, to be confirmed) either fail closed or allow only loopback.
3. In `python-scheduler` (`main.py` push call, ~line 299), send the same header from a matching env var.
4. Update `.env.example` and a one-line note in `CLAUDE.md`/docs.

**Decision (confirmed): when `INTERNAL_METRICS_TOKEN` is unset, the endpoint is env-dependent — fail closed (reject all pushes, 503/401) in production (`NODE_ENV === 'production'`), allow in development with a loud warning log.** This mirrors the existing `secureCookies = NODE_ENV === 'production'` pattern in `config.ts`. When the token *is* set, enforce header match in all environments.

Acceptance check: with the token set, scheduler push succeeds and an unauthenticated `curl POST /api/internal/metrics` returns 401.
