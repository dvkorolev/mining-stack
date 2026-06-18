# PROJECT_STATE.md

Repository review and improvement plan. **Analysis only — no code changed.**
Prepared as input for implementation (Kimi will implement the steps below, one at a time).

Date: 2026-06-17
Reviewer: Claude Code
Scope: full repository read (`backend/`, `frontend/`, `python-scheduler/`, Docker/monitoring, deploy scripts).

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
- **Simulation** — when `config.mining.useRealData` is false or Prometheus is disabled, the backend serves `simulateMiningStats()` (random data) instead of real metrics (`mining.service.ts:948`).
- **Control** — miner reboot is in-process TypeScript (`miner-control.service.ts` → `miner-rebooter.ts`: WhatsMiner protocol + `antminerRestart`), exposed via API and the Telegram bot — independent of the read path.

**Two metric namespaces exist:** the scheduler exposes `miner_*`; the backend's own `/metrics` endpoint exposes a different `mining_*` / `alert_queue_*` set (`server.ts:122`). Not wrong, but worth knowing they are distinct.

---

## 3. Likely risk areas

Ordered by severity. File:line references included.

### Security
- **S1 — `/api/internal/metrics` is unauthenticated** — ✅ **DONE** (branch `feat/internal-metrics-auth`, commit `05971be`, verified live). Now requires `X-Internal-Token` = `INTERNAL_METRICS_TOKEN`; unset token fails closed (503) in production, warns+allows in dev.
- **S5 — Legacy `X-Telegram-Chat-ID` header grants admin without a token** 🔴 (`auth.middleware.ts:94` `tryLegacyChatHeader`, reached from `ensureAuthenticated` at lines 154-164, after system-key and JWT). It sets `role: 'admin'` whenever the plaintext header equals `ADMIN_TELEGRAM_CHAT_ID` (line 100). A Telegram chat ID is not a secret, so anyone reaching the backend can send `X-Telegram-Chat-ID: <admin id>` and obtain full admin — this **defeats the JWT auth added in `9205646`**. Highest severity of the remaining items. *Fix:* gate the legacy path behind an opt-in env flag (default off) or remove it now that JWT exists.
- **S2 — Hardcoded fallback JWT secrets** (`config.ts:13-14`: `'dev-access-secret'` / `'dev-refresh-secret'`). Confirmed there is **no** startup guard — the only `process.exit` calls in `server.ts` are in the shutdown handler. If the env vars are unset in production, tokens are forgeable. *Fix:* at boot, if `NODE_ENV==='production'` and either secret is unset or equals the dev default → log error + `process.exit(1)` (mirror S1's prod-fail-closed).
- **S3 — Permissive CORS with credentials** (`server.ts:47-50`): `origin: config.corsOrigin || true` + `credentials: true`, and `corsOrigin` defaults to `'*'` (`config.ts:10`). `origin: true` reflects any requesting origin, effectively allowing all origins to send credentialed requests. *Fix:* require an explicit allowlist (comma-split `CORS_ORIGIN`) whenever `credentials:true`; never fall back to `true`.
- **S4 — Weak default Grafana password** `mining123` — present in **three committed files**, not one: `docker-compose.prod.yml:225`, `.env.example:87`, `README.md:86` (plus `docker/grafana/README.md` ×3). Risky if it survives onto a Pi exposed on LAN/Tailscale. *Fix:* require `GF_SECURITY_ADMIN_PASSWORD` (drop the inline default), set it in `.env`, scrub the value from docs.

### Correctness / consistency
- **R1 — Dual ingestion paths** (Prometheus read vs. `/internal/metrics` push) can disagree and there is no documented "source of truth" precedence. Increases the chance of stale or conflicting stats depending on deployment config.
- **R2 — In-memory stats are authoritative for the live UI** (`miningStats` global in `mining.service.ts`). On restart or between intervals the UI can show empty/zeroed state until the next tick.
- **R3 — Simulation path still wired into the production code path** (`simulateMiningStats`, `generateRandomError`, `Math.random()` in `mining.service.ts`). A misconfigured `USE_REAL_DATA`/`PROMETHEUS_ENABLED` silently serves fake data that looks real.

### Operability / maintainability
- **M1 — Very large modules** concentrate risk and are hard to test: `telegram.service.ts` (2369), `database.service.ts` (1595), `mining.service.ts` (1470), `Miners.tsx` (958).
- **M2 — No automated test suite.** `backend` `npm test` is a stub; only `python-scheduler/test_profile_integration.py` (a standalone script) exists. No safety net for refactors.
- **M3 — No schema/migration versioning visible** for SQLite beyond ad-hoc migrate scripts (`backend/scripts/migrate-*.js`, `src/scripts/migrate-*.ts`). Schema drift between environments is easy.

---

## 4. Obvious cleanup opportunities

Low-risk, high-signal. None of these change behavior.

- **C1 — Dead/backup code**: `python-scheduler/backup/` (`scheduler_v1_backup.py`, `scheduler_v2.py`), `bin/backup/`, `docs/archive/`, `.github/workflows/build-and-push-full.yml.disabled`, `CLAUDE_backup_17062026.md`. Move to a single `archive/` or delete.
- **C2 — Root markdown sprawl**: ~20 historical design notes at repo root (`FIXES_IMPLEMENTED.md`, `SCRYPT_*.md`, `TELEGRAM_*.md`, `ALGORITHM_SEPARATION*.md`, `COMPLETE_ALGORITHM_SEPARATION.md`, etc.). Consolidate under `docs/` so the root shows only README + CLAUDE + PROJECT_STATE.
- **C3 — README drift**: README points at `docker-compose.dev.yml` and several `docs/*.md` paths that don't exist (`make dev` references a missing compose file). Fix or remove the broken references.
- **C4 — Duplicate/overlapping deploy scripts**: `quick-deploy.sh`, `build-local.sh`, `deploy-to-pi-registry.sh`, `deploy-optimized.sh`, `pi-quick-update.sh`, `pi-deploy.sh`. Document which is canonical; retire the rest.
- **C5 — Two metric namespaces** (`miner_*` vs `mining_*`) undocumented — add a short note (or unify) so future contributors don't assume they're the same series.

---

## 5. Phased improvement plan

Designed so each phase is independently shippable and reversible. Earlier phases unblock later ones.

### Phase 0 — Safety net (prerequisite)
- Add a minimal test harness: backend (Jest or node:test) with one smoke test that boots the app and hits `/health`; wire `npm test` for real.
- Add a typecheck/lint CI step (`npm run build` on backend + frontend) so regressions are caught.
- *Goal: make every later change verifiable.*

### Phase 1 — Security hardening (highest value)
Recommended order: **S5 → S2 → S3 → S4** (S5/S2 both harden auth; do them first).
- **S1**: authenticate `/api/internal/metrics` — ✅ DONE (commit `05971be`, verified).
- **S5**: disable the legacy `X-Telegram-Chat-ID` admin path by default (opt-in env flag, or remove). **Next up.**
- **S2**: refuse to boot in production with default/unset JWT secrets; require them via env.
- **S3**: tighten CORS — explicit allowlist when `credentials: true`; never reflect arbitrary origins.
- **S4**: force Grafana admin password via required env, drop the `mining123` default from committed files.

### Phase 2 — Data-path clarity
- Decide and document the single source of truth (Prometheus read **or** push), make precedence explicit, and gate/remove the unused path.
- Make the simulation path opt-in and loudly logged so it can never be mistaken for real data (R3).
- Document the two metric namespaces or unify them (C5).

### Phase 3 — Maintainability
- Decompose the largest modules (`telegram.service.ts`, `database.service.ts`, `mining.service.ts`) along clear seams (command handlers, schema/migrations, stats vs. control). Add unit tests as each seam is extracted.
- Introduce explicit SQLite schema versioning/migrations (M3).

### Phase 4 — Cleanup & docs
- Execute C1–C4: archive dead code, consolidate root markdown into `docs/`, fix README drift, document the canonical deploy script.

---

## Implementation steps (for Kimi)

**Next up: Phase 1 / S5 — disable the legacy header admin path.** Brief in `KIMI_TASK.md`.

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
