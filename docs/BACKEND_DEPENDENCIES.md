# Frontend integration dependencies

Inspected 23 October 2026. The user explicitly instructed this frontend session to keep backend files unchanged. No backend modifications or backend files are included in the frontend checkpoint. These observations describe the current `apps/api` implementation, not guarantees of compliance with the contract.

## Release blockers

| Dependency | Existing implementation / required correction | Verification required from backend owner |
| --- | --- | --- |
| Local services | No `apps/api/.env`, configured database, or running API was supplied. | Configure PostgreSQL, secrets and exact `APP_ORIGIN`; generate client, migrate, seed, start API. Run seller workflows against persisted records. |
| Public delivery privacy | `POST /delivery/:token` returns the full Prisma order, event and ledger entry. Frontend filtering cannot prevent data exposure over HTTP. | Return only documented public-safe reference/status/receipt fields. Test absence of phone, address, internal notes, seller identifiers and ledger on all public endpoints. Coordinate the response-schema amendment. |
| QR eligibility | `getToken()` checks purpose/expiry/revocation/terminal state but GET permissions are constant and eligible states are not checked. | Derive `allowedActions` / `permittedOutcomes` from current state and authenticated authorization; reject ineligible, wrong-purpose, revoked and expired tokens. |
| Customer transitions | Customer decisions can directly set rejection/redelivery status without the shared transition graph. Proofs can be reused. | Validate eligible state and action inside the transaction; consume scoped proof; reject expired/replayed proofs and concurrent duplicate decisions. |
| Seller completion bypass | Generic seller transition endpoint accepts `DELIVERED_VERIFIED` without the customer/handoff checks. Frontend never offers that choice. | Enforce actor-specific transitions and verified completion rules on the server. Exercise direct HTTP requests, not just UI. |
| Partner identity and authorization | No partner registration, contact verification, consent, evidence, reviewer, activation, or authorization schema/routes exist. | Agree the proposal in `PARTNER_VERIFICATION_PROPOSAL.md`, implement server permissions and audit, then connect frontend. A seller session or QR possession alone cannot imply verified partner identity. |
| Production OTP | No real provider; only `DEMO_MODE=true` returns test codes. Token throttling exists, IP throttling does not. | Configure authorized provider or explicitly restrict deployment to demo; enforce request/attempt/IP limits, expiry and one-use proofs. Never expose production OTPs. |
| Idempotency/concurrency | Completion revokes token, so a retry is rejected rather than returning the prior receipt. Ledger constraint alone does not prevent repeated events/races. | Atomically validate state and record one receipt/event/eligible credit; retry and parallel-request integration tests. |
| Session hardening | MemoryStore, development fallback secret, no session regeneration at login, and login bypasses origin validation. | Durable session store, required production secret, session rotation, login/logout origin checks, isolation and fixation tests. |
| Notifications | Read endpoint exists, but workflow writes do not create notification records. No read/unread mutation route. | Persist appropriate seller notifications transactionally; define read-state API only if needed. Frontend intentionally offers no fake mark-as-read control. |
| Report reconciliation | Counts use specific event types. Customer `REQUEST_REDELIVERY` differs from `REDELIVERY_REQUESTED`; attempts with other outcomes may not be counted. Runtime server month parser differs from tested helper. | Agree event-count definitions; include the intended customer/redelivery and attempt events consistently; use strict month bounds and reconcile JSON/CSV with database fixtures. |
| Order atomicity / QR reprint | Order, creation event and QR tokens are written separately. Plaintext QR links are returned once; no retrieval/reissue route exists. | Make creation atomic. If later reprinting is required, agree an authenticated rotation/reissue endpoint; never recover token hashes as plaintext. Current UI prints at creation only. |

`LIVE_PUBLIC_WRITES_READY` remains `false` in `apps/web/src/features/public/workflowApi.ts`. This is a frontend release gate, **not a security control on the API**. Do not enable it before the backend tests above pass and the partner identity/authorization contract is agreed. Existing route shapes have not been silently changed.

## Integration handoff

1. Backend owner resolves the blockers and agrees any minimal public response and partner schema changes.
2. Run backend integration tests with two sellers, two purpose-specific tokens, OTP failure/expiry/throttling, unauthorized/inactive partner, replay/concurrent completion and one-credit eligibility cases.
3. Configure the local API/database and verify the seller-to-customer-to-delivery workflow plus returns/reports/CSV in a browser.
4. Replace the public-write release gate only after those checks. Keep synthetic demo state separate; it must never become a live authorization source.
5. Review production cookie/CORS/origin configuration and route fallback. Complete the browser/print checks in `FRONTEND_QA.md`.
