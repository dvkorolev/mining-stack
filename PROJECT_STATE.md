# PROJECT_STATE.md

Repository review and improvement plan. Originally analysis-only; now also the
living roadmap, kept in sync with shipped work and the Linear "Mining Stack" project.

Date: 2026-06-17 (original review) · **Last refreshed: 2026-06-20**
Reviewer: Claude Code
Scope: full repository read (`backend/`, `frontend/`, `python-scheduler/`, Docker/monitoring, deploy scripts).

> **Status at a glance (main `64a5af8`)**
> - ✅ **Done & merged:** P0 (Pi-drift backport), **Phase 0** (test harness + CI), Phase 1 (security S1–S5), Phase 2 (data-path clarity), **Phase 4 cleanup complete (C1–C5)**.
> - ✅ **Operational:** subnet-move recovery — DMI-19 (MAC-keyed reconcile tool) + DMI-20 (live Pi DB remap).
> - ⏳ **Open / next up:** **Phase 3** (decompose large modules + SQLite schema versioning) — the remaining major workstream.

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

### Phase 3 — Maintainability — ⏳ OPEN (not started)
- Decompose the largest modules (`telegram.service.ts` 2369, `database.service.ts` 1595, `mining.service.ts` 1470) along clear seams (command handlers, schema/migrations, stats vs. control). Add unit tests as each seam is extracted. **Depends on Phase 0** for a safety net.
- Introduce explicit SQLite schema versioning/migrations (M3). Note: the live DB now also carries a `mac` column added operationally during DMI-20 — fold it into the versioned schema.

### Phase 4 — Cleanup & docs — ✅ DONE (C1–C5 complete)
- ✅ C1 dead code (DMI-21), ✅ C2 root markdown (DMI-23), ✅ C3 Makefile + README drift / MIT LICENSE (DMI-22/26), ✅ C4 canonical deploy script (DMI-27), ✅ C5 metric namespaces (P2.3).

### Operational stream — subnet-move recovery — ✅ DONE
Not in the original review (environmental, surfaced 2026-06-20 when the Pi's `eth0` moved `192.168.1.x → 192.168.2.x`).
- **DMI-19** — universal MAC-keyed `reconcile` mode in `bin/farm_init.py` (matching tiers MAC → IP-enrich → octet+model heuristic; dry-run default; 14 unit tests). Merged `cc53027`.
- **DMI-20** — live Pi SQLite remap (PK-safe in-place multi-table UPDATE preserving `miner_stats_history`); restored 0 → 19 active miners (~2070 TH/s); added + backfilled the `miners.mac` column so future moves are MAC-recoverable.

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
