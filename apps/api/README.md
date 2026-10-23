# UNLOSS backend

The nine agreed MVP backend phases are implemented and verified against PostgreSQL. The [master reference](../../UNLOSS_Master_Build_Reference_and_Parallel_Codex_Guide.md), existing [API contract](../../docs/API_CONTRACT.md), [progress record](../../docs/BACKEND_PROGRESS.md), and [backend integration handoff](../../docs/BACKEND_INTEGRATION.md) describe scope and evidence.

This remains a loopback-only local/manual MVP. `NODE_ENV=production` fails with `PRODUCTION_NOT_READY` until deployment, real OTP delivery and the separately proposed partner authorization are agreed and verified. The frontend public-write gate remains disabled. No courier/GPS integration, real SMS/email, identity verification, payment or payout is claimed. An authorized QR bearer records a manual/demo outcome; that is not independently verified physical evidence.

## Setup

Use Node.js 20.19+ or 22.12+ (tested with Node 24), npm, and PostgreSQL 15+ (tested with 17.11). From the repository root:

```powershell
npm.cmd --prefix apps/api ci
Copy-Item apps/api/.env.example apps/api/.env
```

Edit the ignored `.env`. Set your PostgreSQL `DATABASE_URL`, a random `SESSION_SECRET` of at least 32 bytes, exact `APP_ORIGIN` (default `http://localhost:5173`), and `API_PORT` (default 3001). Generate secrets locally; never commit them. There is no built-in seller password. All mutating API calls, including public token actions and login, require the exact `Origin` header. Browser requests supply it automatically.

`DEMO_MODE` defaults false. Set it true only for local synthetic testing and demo seeding. Choose `SEED_SELLER_EMAIL` and a non-placeholder `SEED_SELLER_PASSWORD` of 12–72 UTF-8 bytes. `QR_TOKEN_TTL_DAYS` defaults to 90, range 1–365. `SEED_SAMPLE_ORDERS=true` optionally adds three explicitly synthetic created/dispatched/returned orders; default false. Reruns preserve existing passwords, order edits and events. Seeds never credit rewards. Create a new order through the API/UI to obtain printable QR links: raw seed tokens are not retained or logged.

```powershell
npm.cmd --prefix apps/api run prisma:generate
npm.cmd --prefix apps/api run db:validate
npm.cmd --prefix apps/api run db:migrate
npm.cmd --prefix apps/api run db:seed
npm.cmd --prefix apps/api run dev
```

Database creation is an operator step. Startup never creates, migrates, resets or seeds data. `db:migrate` deploys four preserved/versioned migrations. The ledger integrity migration adds a composite owner foreign key and INR 500-paise credit check; it fails on inconsistent legacy records instead of deleting/repairing them. Back up and inspect existing data before applying to any non-test database. Do not run `db:dev` against shared data without reviewing its proposal.

The existing Vite proxy targets port 3001. If running from the separate backend worktree, use port 3001 and the same `APP_ORIGIN` as the frontend; do not overwrite the original untracked backend copy. For a compiled run:

```powershell
npm.cmd --prefix apps/api run build
npm.cmd --prefix apps/api start
```

## Operations and authentication

`/health/live` reports process liveness. `/health/ready` probes connectivity, every application table and the added workflow columns; it returns 503 while unavailable/unmigrated/draining. Both identify demo/manual mode. Startup errors are sanitized and exit nonzero. The server binds `127.0.0.1`, uses bounded connection/query waits and HTTP timeouts, and drains before disconnecting on shutdown. Production/reverse-proxy deployment is not enabled.

Requests have server-generated IDs, `Cache-Control: no-store`, security headers and safe JSON errors. Bodies are capped at 32 KiB. Logs contain route templates and status, never raw URLs/tokens, phone/address, bodies, cookies, OTPs, secrets or stack traces. Future proxy logs must separately redact token paths.

Seller authentication uses bcrypt, normalized email, constant-cost unknown-email comparison and a signed HttpOnly/SameSite=Lax host-only cookie. Login rotates/persists before success. Sessions use hashed IDs in PostgreSQL with seven-day absolute expiry; logout revokes durably, and password change/deletion invalidates access. Stale requests cannot recreate revoked sessions. All seller queries are scoped to the trusted session seller. Foreign and missing orders both return 404. No password-reset, registration or partner-review endpoints are invented.

Durable HMAC-keyed PostgreSQL rate limits apply across processes sharing the same session secret. Forwarded IP headers remain untrusted; local Vite users share its socket IP budget. Limits fail closed with 503 if storage fails. 429 includes `Retry-After`. Expired sessions and rate buckets are cleaned every 15 minutes.

| Endpoint | IP budget | Token/account budget |
| --- | --- | --- |
| Login | 30 / 15 minutes | 10 / normalized email / 15 minutes |
| OTP request | 5 / hour | 5 / token / hour, 60-second resend cooldown |
| OTP verification | 30 / 15 minutes | 10 / token / 15 minutes; five guesses per challenge |
| Customer decision | 30 / 15 minutes | 10 / token / 15 minutes |
| Delivery outcome | 60 / 15 minutes | 20 / token / 15 minutes |

## Workflow guarantees

Order/event/two-token creation is atomic. Inputs, filters and integer pagination are validated; lists use deterministic ordering and consistent count snapshots. Seller responses retain the documented flat fields. Events are append-only through the API; there is no undocumented edit/delete endpoint.

Every mutation locks the order, rechecks token and current state, and uses the authoritative transition service. Sellers cannot impersonate delivery/customer actors or set verified completion. Cancellation, return initiation, redelivery, rejection and failure require reasons. Actor/source describe who reported a reason; they do not assign fault.

QR tokens contain 32 random bytes and only hashes are stored. Purpose, expiry, revocation and eligible state are enforced. Delivery is eligible OUT_FOR_DELIVERY; customer actions are state-dependent. Scans never change state or award rewards. Public responses contain only reference/status and safe event receipt fields, never phone/address/private notes/seller ID/ledger. The legacy response key `ledgerEntry` is always null publicly.

Demo OTP responses explicitly say no SMS was sent. Non-demo requests return `503 OTP_PROVIDER_UNAVAILABLE`. Codes are HMAC-bound to a challenge, expire after five minutes and allow five guesses. Successful verification is one-time; its scoped proof expires after 15 minutes and is consumed by one decision. Acceptance expires with that proof and belongs to the current dispatch attempt. Resend invalidates older outstanding challenges. Lifecycle changes invalidate proofs and acceptance; redelivery must redispatch and obtain fresh acceptance.

Verified handoff requires the current expiring acceptance, consumed verified challenge, live customer token and recorded CUSTOMER ACCEPT evidence. Status, event, revocation, notification and the one INR 500-paise internal credit commit together. Uniqueness and owner/amount constraints backstop eligibility. No reward comes from a scan, acceptance alone, a seller flag or an old attempt. There is no payout API.

Duplicates are idempotent in effect: one event/credit can commit. After state changes make the QR ineligible or completion revokes it, retries return the contract-required `404 TOKEN_INVALID`; they do not replay success through a revoked capability. Reused decision proofs return 401. The authenticated order timeline confirms whether an earlier request committed.

## Reports and notifications

Notifications are persisted in-app records only, one per recorded event. No external send or read/unread status is implied. Monthly reports count events within inclusive-start/exclusive-end Asia/Kolkata month bounds, expressed as UTC ISO strings. Delivery attempts include all delivery-actor outcomes; redelivery includes both customer and seller request event names. Return rate is returned events / dispatch events in the month, null if there were no dispatches. Repeated attempts can exceed unique orders. Dashboard counts are current status, not monthly cohorts.

CSV and JSON use the same aggregate/snapshot logic and stable documented columns. CSV contains no customer fields, escapes quotes/formulas, and leaves both reason cells blank for an empty reason set. Month inputs require years 1000–9999 and months 01–12.

## Verification

```powershell
npm.cmd --prefix apps/api run lint
npm.cmd --prefix apps/api run typecheck
npm.cmd --prefix apps/api test
npm.cmd --prefix apps/api run build
npm.cmd --prefix apps/api audit
```

For integration tests, explicitly use a migrated loopback database named `unloss_test_*` and set `TEST_DATABASE_URL`. The command fails if absent/unsafe; it never silently skips. Only synthetic fixture rows are cleaned. Run migrations with `DATABASE_URL` pointed to the same test database.

```powershell
npm.cmd --prefix apps/api run test:integration
npm.cmd --prefix apps/api run test:frontend -- "D:\path\to\current-frontend\apps\web"
```

The optional frontend command requires the current frontend dependencies installed. It loads the actual API adapters with Vite and runs them against real HTTP/PostgreSQL using a Node cookie/Origin transport shim. It does not enable the UI gate, modify frontend files, or claim browser/print/mobile QA. Current automated totals and process checks are recorded in backend progress.

Express 5/TypeScript/Prisma 6/PostgreSQL/Zod and original migration history are retained. Vitest 4 and the scoped `@prisma/config` → `deepmerge-ts` 8.0.2 override address the foundation audit findings; Prisma generation/validation/migrations/build are verified with it. No major ORM migration was introduced. `connect-pg-simple` remains an unused original dependency; sessions use one Prisma pool.
