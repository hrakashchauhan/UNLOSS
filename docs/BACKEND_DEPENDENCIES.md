# Integration dependencies — 23 October 2026

The user's integration request superseded the earlier frontend-only handoff. The cumulative backend/phase-9-integration-qa work is integrated with targeted frontend/API compatibility fixes. Original untracked backend files were hash-verified and archived under ignored .local/backups/api-original-20261023; no original work was discarded.

## Resolved for the local MVP

| Earlier blocker | Current implementation and evidence |
| --- | --- |
| No configured API/database | Separate unloss_local_demo database, four applied migrations, synthetic seed, API on 127.0.0.1:3001 and web on 127.0.0.1:5173. |
| Sessions and seller isolation | PostgreSQL hashed sessions, rotation, revocation, expiry, exact Origin checks and persistent limits; authentication/isolation integration suite. |
| QR privacy, eligibility and seller completion bypass | Purpose/state/expiry checks, minimal public receipts, actor-specific transitions and no seller verified-completion bypass; QR/order/security suites. |
| OTP replay, expiry and dispatch binding | Single-use proofs, rate limits, dispatch-bound acceptance and expiry; verification/rate-limit suites. No real SMS provider. |
| Concurrency, rewards and order atomicity | Locked transactional workflow, unique 500-paise INR credit, owner/amount constraints, atomic create/event/QR and notifications; race/rollback/reward suites. |
| Notifications and report reconciliation | Transactional notifications, unified monthly JSON/CSV aggregation, all attempt outcomes and both redelivery event types; reporting suite. |
| Frontend compatibility | Actual adapters passed against PostgreSQL/HTTP; confirmed public receipts survive link closure; address/completion reasons match server validation. |

All 62 backend unit tests and 95 database integration tests passed on the integrated code. A running local API smoke completed login, order creation/dispatch, demo OTP acceptance, handoff, duplicate rejection, one credit, events, notifications, monthly report/CSV and logout. See FRONTEND_PROGRESS.md for exact commands and limits.

## Remaining boundaries

| Dependency | Exact next step |
| --- | --- |
| Partner identity/reviewer authorization | Agree PARTNER_VERIFICATION_PROPOSAL.md, then implement backend consent, contact verification, evidence handling, reviewer permissions, retention and active-partner authorization. Current partner UI is synthetic only. |
| Real OTP provider | Configure an authorized provider and verify send/failure/throttling behavior before enabling non-demo customer workflows. Manual mode currently returns 503 for OTP requests. |
| Production deployment | Review hosting/TLS/proxy/cookie policy and operations; complete partner/provider requirements before removing the backend PRODUCTION_NOT_READY guard or frontend manual/production gate. |
| Browser and physical print acceptance | Saved browser-tool origin permission still blocks 127.0.0.1:5173 despite user consent. Resolve that permission externally and run FRONTEND_QA.md; no alternate automation bypass was used. |
| Later QR reprinting | URLs are intentionally returned once. Print/save during creation. An authenticated rotation/reissue endpoint requires a separate contract decision. |

LIVE_PUBLIC_WRITES_READY=false is preserved. Explicit server mode=demo allows supervised, labelled QR-bearer demo actions; the backend enforces eligibility and does not claim verified partner identity. Demo approval in browser memory is never a backend authorization source. No real courier, GPS, SMS, identity verification or payout is represented as working.
