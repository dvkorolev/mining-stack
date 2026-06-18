# KIMI_TASK.md — Implementation brief

This is a self-contained task for the implementing agent (Kimi). Full context is in
[`PROJECT_STATE.md`](PROJECT_STATE.md). Read it before starting.

**Working directory must be the repo root:**
`/Users/dmitrykor82/CascadeProjects/windsurf-project/mining-stack`
(Do NOT work from `/Users/dmitrykor82/Kimi` — that folder does not contain this project.)

---

## Ground rules

- Never work directly on `main`. Branch from `main`: `git checkout main && git checkout -b feat/cors-allowlist`.
- Start from a **clean working tree**. Run `git status` first; if there are unrelated
  changes (stray untracked scripts, `S2_OUTPUT.md`, etc.), do NOT stage them. Only ever
  `git add` the specific files this task touches — never `git add -A` / `git add .`
  (the working copy contains `CLAUDE.local.md` with secrets; `main`'s `.gitignore` does not
  protect it on a branch cut from `main`).
- `CLAUDE.md` does NOT exist on `main`. **Do not create or edit `CLAUDE.md`.** Put any doc
  note in `.env.example` comments instead.
- Make the smallest change that satisfies the task. No drive-by refactors. No commit/push.
- Do not print, log, or commit any secret.

---

## Task: S3 — Replace reflect-any CORS with an explicit allowlist

### The problem
`backend/src/server.ts` (~lines 47-50):
```ts
app.use(cors({
  origin: config.corsOrigin || true,   // `true` reflects ANY request Origin
  credentials: true,
}));
```
`config.corsOrigin` defaults to `'*'` (`config.ts:10`). With `credentials: true`, reflecting
an arbitrary origin lets any website make credentialed (cookie-bearing) cross-origin requests
to the API. The fix is to allow credentials only for an explicit allowlist.

### Goal / decided behavior
Parse `CORS_ORIGIN` as a comma-separated allowlist and configure CORS so that:
1. **Explicit allowlist set** (`CORS_ORIGIN` is one or more origins, no `*`): use it as the
   `origin` allowlist with `credentials: true`. The `cors` package will echo the matched
   origin and deny non-listed ones.
2. **`CORS_ORIGIN` unset or `*`:**
   - **production** → log a warning and **drop credentials**: `origin: '*'`, `credentials: false`.
     (Closes the credentialed-reflection hole without hard-breaking same-origin/nginx-proxied
     deployments.)
   - **development** → keep the current convenience: reflect the request origin with
     credentials (`origin: true`, `credentials: true`) so local cross-origin cookie auth
     (frontend :3000 → backend :5000) still works. Log an info/warn that this is dev-only.

### Suggested implementation (adapt as needed)
In `server.ts`, before `app.use(cors(...))`, build the options:
```ts
const allowlist = (process.env.CORS_ORIGIN || '')
  .split(',').map(s => s.trim()).filter(Boolean);
const hasExplicitAllowlist = allowlist.length > 0 && !allowlist.includes('*');

let corsOptions: cors.CorsOptions;
if (hasExplicitAllowlist) {
  corsOptions = { origin: allowlist, credentials: true };
} else if (config.env === 'production') {
  logger.warn('CORS_ORIGIN is unset or "*": credentialed CORS disabled in production. ' +
              'Set CORS_ORIGIN to an explicit comma-separated allowlist to enable cookie auth cross-origin.');
  corsOptions = { origin: '*', credentials: false };
} else {
  logger.warn('CORS_ORIGIN is unset or "*": reflecting request origin with credentials (development only).');
  corsOptions = { origin: true, credentials: true };
}
app.use(cors(corsOptions));
```
You may keep using `config.corsOrigin` instead of `process.env.CORS_ORIGIN` if you prefer,
as long as the parsing/behaviour above is preserved.

### Docs/env
Update `.env.example` so `CORS_ORIGIN` documents the allowlist format, e.g.:
```
# Comma-separated allowlist of browser origins permitted to send credentialed (cookie) requests.
# Example: CORS_ORIGIN=http://localhost:3000,http://192.168.1.66:3000
# Unset or "*" -> dev reflects origin with credentials; production disables credentialed CORS.
CORS_ORIGIN=*
```

### Constraints
- Touch only `backend/src/server.ts` and `.env.example` (and `config.ts` only if you choose
  to parse there). Do NOT change auth, routes, helmet, or other middleware.
- Keep `helmet()` and the middleware order unchanged.
- Do NOT remove the `credentials` capability for the explicit-allowlist case.

### Acceptance criteria (verify locally; see CLAUDE.local.md for the run recipe)
Build: `cd backend && npm run build` passes. Inspect CORS response headers with curl
(`-H 'Origin: ...'` and read `Access-Control-Allow-Origin` / `Access-Control-Allow-Credentials`):

1. **Explicit allowlist** — run with `CORS_ORIGIN=http://localhost:3000`:
   - Request with `Origin: http://localhost:3000` → `Access-Control-Allow-Origin: http://localhost:3000`
     and `Access-Control-Allow-Credentials: true`.
   - Request with `Origin: http://evil.com` → response does NOT allow that origin (no ACAO for it).
2. **Production + wildcard** — `NODE_ENV=production CORS_ORIGIN=*`:
   - Startup logs the CORS warning.
   - Request with `Origin: http://evil.com` → `Access-Control-Allow-Credentials` is NOT `true`
     (credentials disabled).
3. **Development + wildcard** — `NODE_ENV=development` (no `CORS_ORIGIN`):
   - Request with `Origin: http://localhost:3000` → origin reflected and
     `Access-Control-Allow-Credentials: true` (dev DX preserved).

Use the `PORT=5055 USE_REAL_DATA=false PROMETHEUS_ENABLED=false` run recipe. Note: CORS
headers appear on actual responses to requests that include an `Origin` header; you can hit
`/health` with `-H 'Origin: ...'` and inspect with `curl -i`.

### When done
- Summarize the diff (files + key lines) and the acceptance results (the three cases above).
- Write the summary to `S3_OUTPUT.md` (do not commit it).
- Do NOT commit. Leave the branch for review.
