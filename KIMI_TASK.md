# KIMI_TASK.md — Implementation brief

This is a self-contained task for the implementing agent (Kimi). Full context is in
[`PROJECT_STATE.md`](PROJECT_STATE.md). Read it before starting.

**Working directory must be the repo root:**
`/Users/dmitrykor82/CascadeProjects/windsurf-project/mining-stack`
(Do NOT work from `/Users/dmitrykor82/Kimi` — that folder does not contain this project.)

---

## Ground rules

- Never work directly on `main`. Branch from `main`: `git checkout main && git checkout -b feat/require-jwt-secrets-in-prod`.
- Start from a **clean working tree**. Run `git status` first; if there are unrelated
  changes (e.g. stray untracked scripts, `S5_OUTPUT.md`), do NOT stage them. Only ever
  `git add` the specific files this task touches — never `git add -A` / `git add .`
  (the repo working copy contains `CLAUDE.local.md` with secrets; `main`'s `.gitignore`
  may not protect it on a branch cut from `main`).
- `CLAUDE.md` does NOT exist on `main` (it rides in a separate pending PR). **Do not create
  or edit `CLAUDE.md`.** Put any doc note in `.env.example` comments instead.
- Make the smallest change that satisfies the task. No drive-by refactors. No commit/push.
- Do not print, log, or commit any secret.

---

## Task: S2 — Refuse to boot in production with default/unset JWT secrets

### The problem
`backend/src/config/config.ts` (lines ~13-14) falls back to hardcoded secrets:
```ts
jwtAccessSecret: process.env.JWT_ACCESS_SECRET || 'dev-access-secret',
jwtRefreshSecret: process.env.JWT_REFRESH_SECRET || 'dev-refresh-secret',
```
There is **no startup guard** (the only `process.exit` calls in `server.ts` are in the
shutdown handler). If `JWT_ACCESS_SECRET` / `JWT_REFRESH_SECRET` are unset in production,
the app boots with publicly-known secrets and all JWTs become forgeable.

### Goal
In production, **fail fast at startup** if either JWT secret is unset or still equals the
`dev-*` default. In development, keep the current behavior (allow defaults) but log a warning.
This mirrors the established pattern (`secureCookies = NODE_ENV === 'production'`, and the
S1 fail-closed-in-prod logic).

### Steps
1. **Keep the dev defaults** in `config.ts` as-is (do not remove them — dev relies on them),
   but make the two literals referenceable so the guard can compare against them. Either:
   - export the default strings as named constants (e.g. `DEV_ACCESS_SECRET`,
     `DEV_REFRESH_SECRET`) and use them both in the config fallback and the guard, OR
   - re-derive "is default/unset" from `process.env.*` directly in the guard.
2. **Add a startup guard.** In `backend/src/server.ts`, early in the `server.listen`
   callback (before mining/Telegram init), call a small `validateProductionConfig()`:
   - When `config.env === 'production'`: if `JWT_ACCESS_SECRET` or `JWT_REFRESH_SECRET` is
     unset/empty OR equals its `dev-*` default → `logger.error(...)` a clear message naming
     the missing/insecure var(s), then `process.exit(1)`.
   - When not production: if either secret is unset/default → `logger.warn(...)` once that
     insecure dev secrets are in use, and continue.
   - Place the helper either in `config.ts` (exported) or `server.ts`; keep it small.
3. **Docs/env.** Ensure `.env.example` documents `JWT_ACCESS_SECRET` and
   `JWT_REFRESH_SECRET` as **required in production** (add a one-line comment if not already
   clear). Do not put real secret values anywhere.

### Constraints
- Do NOT change token signing/verification logic (`auth.service.ts`), cookie handling, or
  any route.
- Do NOT alter dev behavior beyond adding a warning log.
- The guard must run at startup, not per-request.

### Acceptance criteria (verify locally; see CLAUDE.local.md for the run recipe)
Build: `cd backend && npm run build` passes.
Run with `PORT=5055 USE_REAL_DATA=false PROMETHEUS_ENABLED=false`:
- **`NODE_ENV=production` + no JWT secrets set** → process logs an error naming the vars and
  **exits with code 1** (server does NOT stay up; `curl /health` fails to connect).
- **`NODE_ENV=production` + `JWT_ACCESS_SECRET=x JWT_REFRESH_SECRET=y` (non-default)** →
  server boots normally, `/health` returns 200.
- **`NODE_ENV=development` + no secrets** → server boots, logs a warning about insecure dev
  secrets, `/health` returns 200.

### When done
- Summarize the diff (files + key lines) and the acceptance results (the three runs above).
- Write the summary to `S2_OUTPUT.md` (do not commit it).
- Do NOT commit. Leave the branch for review.
