# UNLOSS backend progress

Updated: 23 October 2026 (Asia/Kolkata). This work completes **Phase 1 only**. Wait for the user's `continue` before starting Phase 2.

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
| 2 Authentication/isolation | **Next unfinished phase.** Existing bcrypt login/logout/me and seller-scoped reads are partial. Replace MemoryStore with persistent expiring sessions; regenerate login session IDs; handle store/logout failures and deleted sellers; throttle login/verification endpoints; define proxy trust only for the actual deployment topology. Prove cross-seller read/write isolation on every seller endpoint, session persistence/revocation/expiry, origin checks and retry behavior with API tests. Keep the production gate until all audited security defects are closed. |
| 3 Orders/events | Create/list/detail/search/events/transitions exist. Creation/event/two-token writes are not atomic. Pagination accepts fractional/unbounded/invalid values. Transition read/update is vulnerable to concurrent stale state; seller can currently set `DELIVERED_VERIFIED`. Make the transition service authoritative and actor-aware; enforce transactionality/reasons and validate queries. No update/delete contract exists; do not invent CRUD routes without agreement. |
| 4 QR | Separate 32-byte random tokens, stored hashes, purpose/expiry checks and terminal revocation exist. Delivery GET permits ineligible states. Public delivery POST exposes private order fields/event notes/ledger. Verify every public response's privacy and state-dependent actions; scans must remain read-only. Tokens are returned once; reprint/reissue behavior needs contract coordination before adding routes. |
| 5 Delivery/customer | OTP demo flow, expiry, per-token resend count/cooldown, proof and decisions exist. Missing IP throttling, concurrency-safe retry limits and one-time proof/decision consumption. Customer decisions bypass transition graph. Acceptance can remain eligible across later attempts. Repeated delivery submission after revocation is not idempotent. Resolve attempt-scoped acceptance/verification and duplicate response semantics with contract owner before dependent implementation. |
| 6 Returns | Generic transitions/reason enums exist; reason requirements and actor/state rules are incomplete and unverified. Preserve structured source labels and seller isolation. |
| 7 Reward ledger | INR 500-paise credit, transaction and `(orderId,type)` uniqueness/upsert exist. Eligibility relies on any prior ACCEPT event and stale/concurrent state; exactly-once completion behavior is unverified. Keep internal only. |
| 8 Notifications/reports | Seller-scoped reads, aggregation and CSV exist. No notification creation/provider. Report route duplicates month parsing and accepts invalid months despite the tested helper rejecting them; attempt/redelivery event counting and no-reason CSV row need reconciliation. No provider deliveries are claimed. |
| 9 Integration/final QA | Not complete. Foundation tests and limited persisted-data contract smoke checks only. Full seller isolation, QR/OTP/return/reward concurrency, report reconciliation and browser/mobile checks remain. |

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

## Verification record

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

## Boundaries

No destructive migration, user-data reset, force push, frontend commit, unsupported external notification, courier/GPS evidence, or real payout is introduced. Existing MVP handlers remain explicitly unverified where noted. Phase 2 requires `continue`.
