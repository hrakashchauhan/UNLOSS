# UNLOSS backend progress

Updated: 23 October 2026 (Asia/Kolkata). The latest user instruction authorizes all remaining backend phases sequentially, with tested checkpoints.

## Repository and coordination audit

- Product source found and read at `UNLOSS_Master_Build_Reference_and_Parallel_Codex_Guide.md`; no duplicate master reference created.
- Starting checkout: `main`, commit `6e7e0fc006574b41f58d9925c4678c40e711281d`, clean tracked files and 12 untracked backend files under `apps/api/`. That commit already existed on `origin/main` at `https://github.com/hrakashchauhan/UNLOSS.git` (private repository). GitHub access verified for the existing repository; no new repository/history created.
- Created branch `backend/phase-1-foundation` in `D:/AI Bhoomi Hackathon/Unloss-backend-phase1`. Copied and hash-verified all 12 existing backend files before edits. Original checkout and frontend work remain in place. The checkpoint includes this previously untracked backend baseline, not newly built later phases.
- Read `docs/API_CONTRACT.md` v1.0, frontend API adapter/auth/public preview, `docs/FRONTEND_PROGRESS.md`, root README, schema/migration/seed, scripts, dependencies, and all existing backend routes/tests. No prior backend progress or additional integration doc existed. No applicable `AGENTS.md` was found in the workspace or ancestors.
- The separate frontend chat is not available through this session's agent messaging. This document is the backend handoff; direct acknowledgement has **not** been obtained. No shared contract, frontend file, root configuration, or frontend progress file is edited. No merge into `main` is performed.

## Phase audit and next work

| Phase | Audited state and remaining acceptance criteria |
| --- | --- |
| 1 Foundation | Completed in this checkpoint: validated config, app factory, startup/DB probe, liveness/readiness, safe errors/logging, working compiled entry point, local-only serving, demo seed protection, tests and dependency audit. Final database verification results below. |
| 2 Authentication/isolation | **Completed.** Persistent hashed sessions, login rotation, absolute expiry, durable logout, invalidation after password changes/deletion, safe failure handling, PostgreSQL-backed throttles, trusted seller context, and all seller-route isolation checks. Proxy trust stays disabled for this local deployment. See Phase 2 details below; production remains gated for later workflow/deployment checks. |
| 3 Orders/events | **Next unfinished phase.** Create/list/detail/search/events/transitions exist. Creation/event/two-token writes are not atomic. Pagination accepts fractional/unbounded/invalid values. Transition read/update is vulnerable to concurrent stale state. Phase 2 now blocks seller `DELIVERED_VERIFIED`; still centralize the full actor-aware transition service, enforce transactionality/reasons, validate queries and test concurrent requests. No update/delete contract exists; do not invent CRUD routes without agreement. |
| 4 QR | Separate 32-byte random tokens, stored hashes, purpose/expiry checks and terminal revocation exist. Delivery GET permits ineligible states. Public delivery POST exposes private order fields/event notes/ledger. Verify every public response's privacy and state-dependent actions; scans must remain read-only. Tokens are returned once; reprint/reissue behavior needs contract coordination before adding routes. |
| 5 Delivery/customer | OTP demo flow, expiry, per-token resend count/cooldown, proof and decisions exist. Phase 2 adds shared IP/token request throttles. Concurrency-safe challenge retry limits and one-time proof/decision consumption remain missing. Customer decisions bypass transition graph. Acceptance can remain eligible across later attempts. Repeated delivery submission after revocation is not idempotent. Resolve attempt-scoped acceptance/verification and duplicate response semantics with contract owner before dependent implementation. |
| 6 Returns | Generic transitions/reason enums exist; reason requirements and actor/state rules are incomplete and unverified. Preserve structured source labels and seller isolation. |
| 7 Reward ledger | INR 500-paise credit, transaction and `(orderId,type)` uniqueness/upsert exist. Eligibility relies on any prior ACCEPT event and stale/concurrent state; exactly-once completion behavior is unverified. Keep internal only. |
| 8 Notifications/reports | Seller-scoped reads, aggregation and CSV exist. No notification creation/provider. Report route duplicates month parsing and accepts invalid months despite the tested helper rejecting them; attempt/redelivery event counting and no-reason CSV row need reconciliation. No provider deliveries are claimed. |
| 9 Integration/final QA | Not complete. Foundation, authentication and all seller-route isolation checks now pass. QR/OTP/return/reward concurrency, report reconciliation and browser/mobile checks remain. |

## Phase 1 changes

- `apps/api/src/config.ts`: validate env, reject placeholder/absent secrets, invalid URLs/origins/ports/TTL, production demo/HTTP origin; fail closed on production serving while known security issues remain.
- `apps/api/src/app.ts`: dependency-injected Express construction, no import-time listening, safe middleware order, headers, CORS, login-inclusive origin checking, request size limit, health routes and error boundary. No unconditional proxy trust.
- `apps/api/src/http.ts`, `logger.ts`: stable envelope, early request IDs (including parser failures), no-store responses, route-template JSON logs, sanitized validation/parser/internal errors.
- `apps/api/src/database.ts`, `server.ts`: explicit DB connection, bounded default waits, schema probe before listen, listener-error handling, loopback bind, graceful drain/disconnect and sanitized nonzero startup failures.
- `apps/api/src/routes.ts`: moved the existing handlers from `server.ts`, injected validated settings, removed unused duplicated graph/imports and corrected `let` to `const`. Later-phase behavior is retained for phased repair, not certified as correct.
- `apps/api/prisma/seed.ts`, `.env.example`: explicit demo-only seed and credentials, no password reset on reruns, no fixed usable credential in template. `DEMO_MODE` now defaults false as specified by contract. Schema and initial migration remain unchanged.
- `apps/api/package.json`, lockfile, `tsconfig.build.json`: correct `dist/server.js` output/start target, separate explicit DB integration suite, validation script, Node engine range, patched test tooling and scoped dependency override. Original rule tests retained.
- `apps/api/test/config.test.ts`, `http.test.ts`, `server.test.ts`, `database.integration.test.ts`, `helpers.ts`: config, error/privacy, origin, health, listener failure, shutdown, safe seeding, PostgreSQL and limited existing contract checks.
- `apps/api/README.md`: exact setup, changed seed instructions, operational endpoints, production gate, testing and dependency decisions. Root README is preserved for its owner; its old fixed demo login now needs updating during integration.

## API and frontend handoff

- Shared `/api` routes, order/status/event enums, success payloads, `unloss.sid` cookie name, ISO timestamps and pagination shape are unchanged.
- Login now enforces the origin check already required by the contract. Browser callers should use the configured exact origin and `credentials: include`; nonbrowser POSTs must supply `Origin` explicitly. Errors keep the contract envelope, with validation details restricted to field paths/codes to avoid data exposure.
- Added operational `/health/live` and `/health/ready` outside the product contract; no frontend dependency is introduced.
- Use this backend worktree for local API execution while reviewing the checkpoint. Do not overwrite the original untracked `apps/api/` to integrate it: compare/archive that preserved copy before a deliberate merge/cherry-pick.
- Keep public customer/delivery controls paused. This phase does not resolve the workflow eligibility/privacy defects already listed in `FRONTEND_PROGRESS.md`. Production startup is intentionally blocked, not production-ready.

## Phase 1 verification record

- Baseline: 4 rule tests and typecheck passed; lint failed with four existing errors; production `start` pointed at a nonexistent build path. No configured PostgreSQL or API environment existed.
- New tests initially exposed a listener error bug: Express 5 invokes its listen callback on bind failure. Changed bootstrap to Node's HTTP server with separate error/listening events and reran successfully.
- Foundation lint, typecheck, build and **42 tests** passed after the fix. No tests disabled or assertions weakened. The real-database suite is intentionally separate and requires an explicit local test DB.
- Initial npm audit: 6 findings (including 2 critical). Patched Vitest and scoped `@prisma/config > deepmerge-ts` without upgrading Prisma major. `npm audit` and `npm audit --omit=dev`: **0 vulnerabilities** after the changes. Prisma Client generation passed with the override.
- Real PostgreSQL **17.11** was run in an isolated temporary cluster on `127.0.0.1:55432`, using a fresh `unloss_test_phase1` database and generated credentials. No existing database/service was altered. Binaries came from the [EDB PostgreSQL archive distribution](https://www.enterprisedb.com/download-postgresql-binaries). An interrupted download was resumed before extraction; the actual server version was checked.
- `db:validate`: passed. `db:migrate`: applied existing `20261023150000_init`; rerun: no pending migrations. `prisma migrate status`: up to date. `prisma migrate diff --from-schema-datasource prisma/schema.prisma --to-schema-datamodel prisma/schema.prisma --exit-code`: no difference. No migration file or schema edit was needed.
- `test:integration`: **4 passed** against that PostgreSQL instance. This verifies tables, health, existing login/cookie/flat-order/event responses, seed password preservation and transaction rollback. It does not certify full authentication isolation or later workflows.
- `db:seed` ran twice successfully. Only synthetic data was used. Generated credentials stay in the ignored backend `.env` and temporary PostgreSQL files, never Git. No fixed password or customer data is included in the commit.
- Final lint/typecheck/build and **42 foundation/rule tests** passed after all runtime changes (46 tests total including the separate DB suite).
- `npm start`: compiled `dist/server.js` listened on loopback. Actual HTTP: liveness 200, readiness 200, unauthenticated `/api/auth/me` 401. With PostgreSQL stopped: readiness 503, liveness 200, separate compiled startup exited 1 with sanitized `STARTUP_FAILED`. After PostgreSQL restarted: readiness recovered to 200. Invalid config and production startup both exited 1 with their safe error codes. Graceful close/disconnect is covered by lifecycle tests.
- `git diff --cached --check` flags one inherited extra blank line at EOF in the original migration. Its byte-for-byte baseline was verified and retained to avoid changing an existing migration/checksum; all other checkpoint files pass the whitespace check. This is a pre-existing formatting warning, not a failed application check.
- Final staged scope and credential-pattern checks passed; generated `.env` secrets were also compared against the entire staged diff and are absent. `.env`, dependencies and build output are ignored. Only backend-owned files and this handoff are staged; no main-branch merge is performed. The final commit/remote hash is reported in the task handoff after push verification.
- Verification API and temporary PostgreSQL processes were stopped. The Windows npm-wrapper interruption left its Node child running; its exact PID, command and creation time were verified before stopping it. OS-signal propagation through that wrapper is not claimed as tested graceful shutdown. Local test database/binaries and ignored credentials are retained for reuse, outside the checkpoint.

## Phase 2 implementation and handoff

- Started from verified `e4ef6d5` with a clean backend worktree. Rechecked original `main`, remote heads, the shared contract, frontend adapter/progress and the preserved backend. No new frontend tracked changes were present. Created `backend/phase-2-auth-isolation` in the existing isolated backend worktree (`Unloss-backend-phase1`); the directory name is historical. `main` and the Phase 1 remote branch are preserved.
- `src/auth.ts`, `sessions.ts`, `session-types.d.ts`, `app.ts`: extracted typed authentication from the legacy routes. The existing Session table now persists a digest of the session ID, seller ID, password-hash version digest and absolute expiry. Login rotates and saves before success; logout revokes before clearing the cookie; read/save/revocation errors fail safely. Session saves cannot upsert/recreate a revoked row. No MemoryStore fallback. Seven-day absolute expiry; current seller existence and password version are checked on authenticated requests.
- `src/rate-limits.ts`, `maintenance.ts`, `server.ts`: PostgreSQL-backed limits via the already-installed library, HMAC-digested keys, atomic parameterized upsert, safe failure responses, expiry cleanup and shutdown handling. Login budgets: 30/IP and 10/normalized email per 15 minutes. OTP request budgets: 5/IP and 5/token per hour. OTP verify budgets: 30/IP and 10/token per 15 minutes. All attempts count. `Retry-After` accompanies 429; failed limiter storage returns 503 rather than allowing requests.
- `prisma/schema.prisma`, `prisma/migrations/20261023170000_auth_rate_limits/migration.sql`: one additive table with primary key, expiry index and nonnegative-hit constraint. No alteration, reset, deletion or checksum change to the original migration. Existing Session table is reused. `src/database.ts` now requires Seller, Session and RateLimitBucket readiness.
- `src/routes.ts`: seller identity now comes from the validated auth context; event queries and transition updates explicitly include seller scope. The seller endpoint rejects `DELIVERED_VERIFIED` with 403 after ownership checking. This closes a previously documented authorization defect in accordance with the master rule that client status flags are not delivery proof. Other lifecycle and public-token defects are deferred to their phases.
- Tests added: `test/auth.test.ts`, `auth-isolation.integration.test.ts`, `rate-limits.integration.test.ts`, `integration-helpers.ts`. Foundation HTTP/server test stubs reflect the real new storage calls; original assertions/rule tests are retained. `vitest.integration.config.ts`, package scripts and TypeScript config cover all dedicated DB suites and quote test globs for cross-platform execution.
- `apps/api/README.md` documents authentication semantics, limits, migration/setup, proxy assumptions and the next-phase boundaries. Dependencies/lockfile are unchanged in this phase. Implementation followed the installed [Express session API](https://expressjs.com/en/resources/middleware/session/) and [external-store rate-limit interface](https://express-rate-limit.mintlify.app/reference/stores); [PostgreSQL ON CONFLICT](https://www.postgresql.org/docs/17/sql-insert.html) supplies atomic counter updates.
- Shared routes, successful payloads, cookie name/attributes and the API contract file remain unchanged. New operational failures (`SESSION_UNAVAILABLE`, `RATE_LIMIT_UNAVAILABLE`) use the existing error envelope/503 convention; seller-forged completion uses the documented 403 convention. Existing frontend auth error handling already accepts these envelopes. No frontend-owned files or root setup files were changed, and no frontend acknowledgement is claimed; this is the available cross-workstream handoff.
- Forwarded headers remain untrusted and do not change IP keys. Local Vite users share the proxy's request budget. Public deployment/proxy topology must be verified later; the production gate remains. OTP requests now have additional throttles, but this does not certify their per-challenge concurrency, decisions or reward eligibility.

## Phase 2 verification record

| Check | Actual result |
| --- | --- |
| Baseline tests | 42 passed before changes. |
| `npm.cmd run lint` | Passed, including new Vitest config. |
| `npm.cmd run typecheck` | Passed. Initial Cookie type incompatibilities were corrected without weakening type checks. |
| `npm.cmd test` | **51 passed** in 5 files. |
| `npm.cmd run test:integration` | **42 passed** in 3 files against real PostgreSQL 17.11 (93 tests total). |
| `npm.cmd run build` | Passed; compiled runtime tested below. |
| Prisma generate/validate | Passed. |
| `db:migrate`, migration status, schema diff | New additive migration applied to the existing isolated test database; rerun found no pending migrations. Status current; schema diff reports no difference. Original migration unchanged. |
| Full and production dependency audits | Both report **0 vulnerabilities**. |
| Compiled process restart check | Real compiled Node process: readiness 200, login 200; graceful shutdown, fresh Node process, old cookie `/auth/me` 200; logout 204; revoked cookie 401. Both processes drained and exited successfully. No credentials printed. |

Database tests exercise two synthetic sellers across all protected route families, foreign order read/write rejection, forged ownership fields, public-token/non-cookie rejection, session rotation/expiry/logout/password-change/deletion, persistence across independent clients, no stale-save resurrection, safe cleanup, concurrent counter increments, limiter persistence across app instances, spoofed forwarding headers, and separate OTP IP/token budgets. Synthetic ledger fixtures test read isolation only; they are removed and do not claim completion/reward eligibility.

Manual testing used only the retained local test cluster and ignored generated credentials. No production service/database was configured or altered. Both compiled API test processes and the isolated PostgreSQL server are stopped; test data is retained. File-scope, credential-pattern and whitespace reviews passed; the final staged diff is also checked against the generated local secrets. Remote commit verification is reported in the task handoff after push.

## Boundaries

No destructive migration, user-data reset, force push, frontend commit, unsupported external notification, courier/GPS evidence, or real payout is introduced. Existing MVP handlers remain explicitly unverified where noted. All remaining backend phases are now authorized.


## Phase 3 completed — orders and history

- Extracted `src/orders.ts` and `domain.ts`: atomic order/event/two-token creation, normalized bounded inputs, validated integer pagination/filter queries, stable tie-break ordering and snapshot-consistent lists. Flat seller responses remain compatible with the current frontend adapter.
- Seller transitions lock the owned order row before validating the lifecycle; only seller operations are accepted. Delivery/customer outcomes cannot be forged through this endpoint. Cancellation revokes both tokens in the same transaction. No undocumented edit/delete route was added.
- Added `test/workflow-fixture.ts` and `orders.integration.test.ts`: injected token failure rolls back creation, malformed inputs fail, pagination is deterministic, eight competing transitions produce exactly one event, and cancellation/actor restrictions hold.
- Actual checks: lint, typecheck, build, **51 unit tests + 58 PostgreSQL integration tests passed (109 total)**. No migration required. Shared API contract/frontend files unchanged. Remaining public mutation concurrency is addressed in Phases 4–5.


## Phase 4 completed — purpose-specific QR privacy

- Added `src/qr.ts` and `test/qr.integration.test.ts`; delivery tokens are eligible only OUT_FOR_DELIVERY. Customer tokens permit accept/reject/redelivery during that state, and redelivery alone after attempted/failed/rejected/returned outcomes. Wrong purpose, malformed, unknown, expired, revoked and ineligible links all return the same 404.
- Scans never mutate state. Public outcome/decision serialization includes only the order reference/status and safe event fields. Public delivery keeps the documented `ledgerEntry` key as null: the contract explicitly forbids exposing ledger data. Private notes, address, phone and seller identifiers are not returned.
- Repeated scans, purpose isolation, expiry/revocation, state eligibility, response field allowlists and absence of scan rewards verified against PostgreSQL. Mutation concurrency and OTP consumption remain Phase 5 work.
- Checks: lint/typecheck/build, **51 unit + 61 integration tests passed (112 total)**. Initial integration run timed out on ten sequential bcrypt checks under parallel load; raised the real-DB timeout to 15 seconds and capped workers at two. Assertions unchanged; full rerun passed. No schema/contract/frontend edits.
