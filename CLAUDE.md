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
- Prometheus / Grafana / Alertmanager / blackbox-exporter

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

### Simulation (`SIMULATION_MODE`)
Simulated/fake data is served **only** when `SIMULATION_MODE=true` (default false). It is never a silent fallback: on a Prometheus read error the backend keeps last-known real stats and logs the error; boot does not seed fake data. Do not reintroduce a `simulateMiningStats()` fallback into the real path.

## Miner configuration

Miners historically lived in `etc/miners.yaml`.
Current runtime source of truth is SQLite.

Boot behavior:
- `server.ts` calls `initializeMinersFromYAML()`
- YAML seeds the DB only if the DB is empty

Rule:
- do not reintroduce runtime dependence on YAML for normal request handling

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
- `make dev` references `docker-compose.dev.yml`, but that file is not present; do not assume it works
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