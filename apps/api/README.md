# UNLOSS backend

Phase 1 foundation checkpoint. Product behavior remains defined by the existing [master reference](../../UNLOSS_Master_Build_Reference_and_Parallel_Codex_Guide.md) and [API contract](../../docs/API_CONTRACT.md). See [backend progress](../../docs/BACKEND_PROGRESS.md) for the audit, remaining security defects, and verification results.

This checkpoint is for local development. It binds to `127.0.0.1` and rejects `NODE_ENV=production` with `PRODUCTION_NOT_READY`. The preserved MVP routes still need session, isolation, QR, OTP, transition, and reward verification. Keep public workflow actions paused in the frontend. Do not publish this checkpoint through a reverse proxy or tunnel.

## Setup

Use Node.js 20.19+ or 22.12+ (verified with Node 24), npm, and PostgreSQL 15+. From the repository root:

```powershell
npm.cmd --prefix apps/api ci
Copy-Item apps/api/.env.example apps/api/.env
```

Edit the ignored `apps/api/.env`:

- Set `DATABASE_URL` to your local database. Database creation is an explicit operator step; startup never creates, migrates, resets, or seeds a database.
- Replace `SESSION_SECRET` with a cryptographically random secret of at least 32 bytes. Placeholder secrets are rejected. Generate a local value with `node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"`; never commit it.
- Set `APP_ORIGIN` to the exact browser origin, for example `http://localhost:5173`, without a path or trailing slash. Use that same hostname in your browser. Every mutating `/api` request, including login, requires this `Origin` header. The existing browser client sends it automatically.
- `API_PORT` defaults to 3001; valid values are 1–65535. `QR_TOKEN_TTL_DAYS` defaults to 90 and must be an integer from 1 to 365.
- `DEMO_MODE` defaults to `false`. To seed a local demo, explicitly set it to `true` and choose `SEED_SELLER_EMAIL` and `SEED_SELLER_PASSWORD` (12–72 UTF-8 bytes). The example password is a placeholder and is rejected. **There is no default login password in this checkpoint.** The root README's older fixed demo credentials no longer apply.

```powershell
npm.cmd --prefix apps/api run prisma:generate
npm.cmd --prefix apps/api run db:validate
npm.cmd --prefix apps/api run db:migrate
npm.cmd --prefix apps/api run db:seed
npm.cmd --prefix apps/api run dev
```

Seeding requires explicit non-production demo mode. It creates a seller if absent; reruns preserve an existing seller's password and data. Seeded sample orders and scenarios remain for later phases. Never run `db:dev` against existing/shared data without reviewing its proposed migration; this phase uses only `db:migrate` (`prisma migrate deploy`).

For a compiled local run:

```powershell
npm.cmd --prefix apps/api run build
npm.cmd --prefix apps/api start
```

`build` compiles application files to `dist/server.js`; tests and seed scripts are not emitted. `start` validates configuration and database connectivity/schema before opening a port. Startup failures exit nonzero with a sanitized JSON event; connection strings and raw database errors are not printed. `SIGINT`/`SIGTERM` stop accepting new requests, drain HTTP connections (10-second deadline), and disconnect Prisma.

## Operational endpoints

These endpoints sit outside the product `/api` contract and require no cookie:

| Endpoint | Result |
| --- | --- |
| `GET /health/live` | 200 `{status:"ok",mode:"demo"\|"manual"}` while the process responds; no DB query |
| `GET /health/ready` | 200 `{status:"ready",mode:"demo"\|"manual"}` after a DB probe and Seller-table query; 503 common error envelope if unavailable/unmigrated or draining |

The DB probe checks reachability and the initial Seller table; full migration status is checked separately with `prisma migrate status`. Connection, pool, and socket timeouts default to five seconds when not explicitly set in the connection URL.

All responses get a server-generated `X-Request-Id` and `Cache-Control: no-store`. JSON errors include the same request ID. JSON bodies are limited to 32 KiB. Unexpected failures return a generic message; validation details expose field paths and stable issue codes only. Operational logs contain JSON events and route templates, never raw URLs, query strings, bodies, cookies, verification tokens, OTPs, connection strings, or stack traces. Configure your reverse-proxy access logs separately before future deployment; application redaction cannot sanitize external logs.

## Verification

```powershell
npm.cmd --prefix apps/api run lint
npm.cmd --prefix apps/api run typecheck
npm.cmd --prefix apps/api test
npm.cmd --prefix apps/api run build
npm.cmd --prefix apps/api audit
```

`test` runs the existing business-rule tests plus foundation/configuration/HTTP/lifecycle tests. HTTP tests use real Express middleware with stubbed database calls; they are not evidence of completed business workflows.

For real database tests, explicitly create a dedicated **local** database whose name starts with `unloss_test_`. Set `DATABASE_URL` to that test database while running `db:migrate`, and set `TEST_DATABASE_URL` to the same connection URL before running:

```powershell
npm.cmd --prefix apps/api run test:integration
```

The integration command fails if the URL is missing, non-loopback, or not named `unloss_test_*`; it never silently skips. Tests check the migrated tables, real readiness, non-destructive seed reruns, existing frontend login/cookie/order response shapes, and database rollback. Cleanup targets only the synthetic seller and orders created by that run. The default unit command deliberately excludes this separately invoked suite.

## Dependencies and boundaries

- Express 5, TypeScript, Prisma 6, PostgreSQL, Zod, bcryptjs, and the existing migrations are retained.
- Vitest is updated from 3 to 4.1.12 to remove audited mocker/worker vulnerabilities; the existing rule tests remain unchanged.
- A scoped npm override pins `@prisma/config`'s `deepmerge-ts` to 8.0.2 to address [GHSA-ggr8-5vv4-36mx](https://github.com/RebeccaStevens/deepmerge-ts/security/advisories/GHSA-ggr8-5vv4-36mx). [Upstream release notes](https://github.com/RebeccaStevens/deepmerge-ts/releases/tag/v8.0.0) identify changed Map merging and custom-helper types; this project uses ordinary Prisma configuration and none of those custom helpers. Generation, validation, deployment, and schema checks verify the current path. Reassess this override if introducing custom Prisma config or upgrading Prisma; no forced Prisma major migration was used.
- The installed `connect-pg-simple` and `express-rate-limit` are not yet wired into the preserved routes. The existing Prisma Session model is also unused. These are Phase 2 work, not completed security controls.
- No SMS, courier, GPS, email, payment, or payout provider is implemented. Non-demo OTP requests return `OTP_PROVIDER_UNAVAILABLE`. Demo OTP is test-only. Notifications currently have a read route but no event-driven creation.
