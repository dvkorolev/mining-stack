# PROJECT_STATE.md

Repository review and improvement plan. Originally analysis-only; now also the
living roadmap, kept in sync with shipped work and the Linear "Mining Stack" project.

Date: 2026-06-17 (original review) · **Last refreshed: 2026-08-07**
Reviewer: Claude Code
Scope: full repository read (`backend/`, `frontend/`, `python-scheduler/`, Docker/monitoring, deploy scripts).

> **Status at a glance (main `e7fcf82`)**
> - ✅ **Done & merged:** P0 (Pi-drift backport), **Phase 0** (test harness + CI), Phase 1 (security S1–S5), Phase 2 (data-path clarity), **Phase 4 cleanup complete (C1–C5)**, **Phase 3.3** (`mining.service.ts` decomposition, DMI-36..41).
> - ✅ **Operational:** subnet-move recovery — DMI-19 (MAC-keyed reconcile tool) + DMI-20 (live Pi DB remap) + **DMI-43** (deploy-script host discovery) + **DMI-44** (router syslog → Loki).
> - ⏳ **In progress:** **Phase 3** (decompose large modules + SQLite schema versioning). 3.1 (DMI-28), 3.2 (DMI-29..35, `database.service.ts`) and 3.3 (DMI-36..41, `mining.service.ts`) done; **3.4 (`telegram.service.ts`) is next and last**.
> - 🔧 **Open ops items:** **DMI-45** (hashrate shortfall — diagnosed 2026-08-07, now a hardware-repair list) · **DMI-46** (post-mortem of the 2026-08-07 site outage, root cause undetermined) · **DMI-47..51** (site fault-tolerance: smart PDU, backup 4G modem, Wi-Fi failover, SSD migration) · **DMI-52** (collect miner error codes / ambient temp / fan RPM as metrics).
> - ⚠️ **Pi is running images ~6 weeks old.** Everything from Phase 3.3 onward — plus DMI-43/44 — is on `main` but has never been deployed. The only exception is the DMI-44 promtail change, which was applied live on the Pi first and then ported to git (repo and Pi verified identical). A deploy is the obvious next operational step, but was deliberately deferred until site stability was restored.

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

Orchestration: `docker-compose.prod.yml` (+ `docker-compose.logging.yml`, `docker-compose.dockerhub.yml` on the Pi). `Makefile` wraps common compose actions.

**Service size (LOC, indicative of where complexity concentrates):**
- `backend/src/services/telegram.service.ts` — 2369
- `backend/src/services/database.service.ts` — 1595
- `backend/src/services/mining.service.ts` — 1470
- `python-scheduler/main.py` — 1013
- `python-scheduler/collectors/pyasic_collector.py` — 720
- `frontend/src/pages/Miners.tsx` — 958

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
- **M1 — Very large modules** concentrate risk and are hard to test: `telegram.service.ts` (2369), `database.service.ts` (1595), `mining.service.ts` (1470), `Miners.tsx` (958).
- **M2 — No automated test suite.** `backend` `npm test` is a stub; only `python-scheduler/test_profile_integration.py` (a standalone script) exists. No safety net for refactors.
- **M3 — No schema/migration versioning visible** for SQLite beyond ad-hoc migrate scripts (`backend/scripts/migrate-*.js`, `src/scripts/migrate-*.ts`). Schema drift between environments is easy.

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
- **DMI-46** — post-mortem of the 2026-08-07 outage. Root cause **undetermined**: the pre-reboot router log was already lost. Two candidates remain undistinguished — an `ip ssh security-level` CLI change made a minute earlier, or ordinary 4G-uplink flakiness (this site is 4G-only, weak signal, and Keenetic's `ping-check` auto modem-restart is deliberately disabled by the owner, so the link never self-heals). DMI-44 exists specifically so the next occurrence leaves evidence.
- **DMI-47..51** — site fault-tolerance, designed 2026-08-07 from hardware already on hand (a smart power strip with individually switchable sockets, a spare USB 4G modem, the Pi's on-board Wi-Fi). Layered rather than monolithic; the explicit decision was **not** to make the Pi the site router — it is the device most likely to be down when you need it, and collapsing router and monitoring into one box removes the independent path that makes remote recovery possible. Two design constraints drive the whole plan: the control channel must never share a power feed with the device it power-cycles, and the smart-strip's local key is only extractable while the strip is still cloud-paired. Start with DMI-47.
- **DMI-52** — collect miner error codes, ambient temperature, fan RPM and PSU input voltage as Prometheus metrics (`miner_error_code`, `miner_env_temp_c`, `miner_fan_rpm{in,out}`, `miner_psu_vin_v`). Every DMI-45 finding came from the same port-4028 API that already feeds the existing metrics — none of it was visible in monitoring, so a fleet that had been degrading for weeks looked merely "slow". Alerts should self-calibrate against each miner's own reported `Factory GHS` rather than a hand-maintained model table, so inventory drift like DMI-45's cannot break detection.

Site-specific network/ops details (router credentials, Tailscale footguns, 4G constraints) live in the git-ignored `CLAUDE.local.md`, not here.

---

## Implementation steps (for Kimi)

**Next up: Phase 3 — maintainability** (see Phase 3 above): decompose the largest backend services along clear seams (now safe — Phase 0 CI is in place) and introduce explicit SQLite schema versioning (incl. the operationally-added `mac` column). This is a multi-session workstream; split into independently shippable slices, each green on CI.
Completed & merged to main: P0, **Phase 0** (DMI-25), Phase 1 (S1–S5), Phase 2 (P2.1–P2.3), **Phase 4 (C1–C5, DMI-21/22/23/26/27)**, and the DMI-19/20 operational stream.

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
