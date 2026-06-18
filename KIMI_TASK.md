# KIMI_TASK.md — Implementation brief

This is a self-contained task for the implementing agent (Kimi). Full context is in
[`PROJECT_STATE.md`](PROJECT_STATE.md) and [`CLAUDE.md`](CLAUDE.md). Read both before starting.

**Working directory must be the repo root:**
`/Users/dmitrykor82/CascadeProjects/windsurf-project/mining-stack`
(Do NOT work from `/Users/dmitrykor82/Kimi` — that folder does not contain this project.)

---

## Ground rules

- Never work directly on `main`. Branch from `main` first: `git checkout main && git checkout -b feat/disable-legacy-header-auth`.
- Start from a **clean working tree**. Run `git status` first; if there are unrelated
  uncommitted changes, stop and report — do not let them ride along on your branch.
- Make the smallest change that satisfies the task. No drive-by refactors.
- Do not touch deploy scripts, infra, or the Pi.
- Do not commit or push without the user's explicit approval.
- Do not print, log, or commit any secret.

---

## Task: S5 — Disable the legacy `X-Telegram-Chat-ID` admin path by default

### The problem
`backend/src/middleware/auth.middleware.ts` resolves auth in `ensureAuthenticated`
(lines ~154-164) in this order: system API key → JWT → **legacy header**.
The legacy path `tryLegacyChatHeader` (line ~94) sets `role: 'admin'` whenever the
plaintext request header `X-Telegram-Chat-ID` equals `ADMIN_TELEGRAM_CHAT_ID` (line ~100).
A Telegram chat ID is **not a secret**, so anyone who can reach the backend can send
`X-Telegram-Chat-ID: <admin id>` and obtain full admin — defeating the JWT auth added in
commit `9205646`.

### Goal
Make the legacy header path **opt-in and off by default**, so JWT (and system API key)
are the only credentials that work unless an operator explicitly re-enables legacy mode.

> Usage note: a repo-wide search found **no in-repo sender** of `X-Telegram-Chat-ID` — the
> frontend authenticates via cookies (`api.ts` `withCredentials: true` → JWT); the only
> consumer is `auth.middleware.ts:95`. So default-off should not affect the dashboard. The
> opt-in flag exists as a safety hedge for any out-of-repo caller (manual curl / Pi script).

### Steps
1. **Config flag** — add `ALLOW_LEGACY_HEADER_AUTH` (boolean, default **false**):
   - Surface it in `backend/src/config/config.ts` (e.g. `auth.allowLegacyHeaderAuth =
     process.env.ALLOW_LEGACY_HEADER_AUTH === 'true'`).
2. **Gate the legacy path** — in `auth.middleware.ts`, where `tryLegacyChatHeader` is called
   inside `ensureAuthenticated` (~line 164), only attempt it when the flag is true.
   When the flag is false, the legacy branch must be skipped entirely (fall through to the
   `required` 401 / `optionalAuth` pass-through as if no credentials were supplied).
3. **Warn on use** — keep/strengthen the existing `logger.warn` so that when legacy auth IS
   enabled and used, it logs a clear deprecation warning (it already warns; ensure it stays).
   Optionally, log once at startup if `ALLOW_LEGACY_HEADER_AUTH=true` that an insecure
   compatibility mode is active.
4. **Docs/env** — add `ALLOW_LEGACY_HEADER_AUTH=false` (commented, with a one-line warning)
   to `.env.example`, and a one-line note in `CLAUDE.md` under the auth section.

### Constraints
- Do NOT change the system-API-key path (`applySystemAuth`) or the JWT path (`tryJwtAuth`).
- Do NOT remove `tryLegacyChatHeader` — just gate its invocation (keep the code so the
  opt-in flag can re-enable it).
- `requireAdmin`, `authenticate`, and `optionalAuth` signatures/behavior must be unchanged
  apart from the legacy path no longer running by default.

### Acceptance criteria (verify locally; see CLAUDE.local.md for the port-5055 run recipe)
With the backend running (`PORT=5055 USE_REAL_DATA=false PROMETHEUS_ENABLED=false node dist/server.js`):
- **Flag unset/false (default):** a request to an admin-only route using only
  `-H 'X-Telegram-Chat-ID: <admin id>'` (no JWT) is rejected (`401`/`403`), NOT granted admin.
- **Flag `ALLOW_LEGACY_HEADER_AUTH=true`:** the same request is accepted (legacy behavior
  restored) and a deprecation warning is logged.
- A valid JWT cookie still authenticates in both modes (unchanged).
- `cd backend && npm run build` passes.

Pick a concrete admin-only route to test (e.g. a `requireAdmin`-protected endpoint such as
`POST /api/mining/import-yaml`). Confirm the exact route in `mining.routes.ts` before testing.

### When done
- Summarize the diff (files + key lines) and the acceptance results.
- Do NOT commit. Leave the branch dirty for review.
- The change will be reviewed against this brief before any commit/push.
