# UNLOSS backend integration handoff

The nine agreed MVP backend phases are implemented. Backend input: `backend/phase-9-integration-qa` at `f2c2d5d`, isolated worktree `D:/AI Bhoomi Hackathon/Unloss-backend-phase1`. The integration owner has combined it with frontend `f4fd8c4` on main and rerun the suites. Read [backend setup](../apps/api/README.md), the historical [backend verification record](BACKEND_PROGRESS.md), and current [frontend integration results](FRONTEND_PROGRESS.md).

Integration changes: auth/public previews now advertise configuration-derived `mode`; explicit demo mode enables labelled persisted frontend forms. Manual/production writes remain gated. Confirmed POST receipts stay visible after token closure, and delivery reason choices match server rules. No route, permission or reward rule was relaxed.

The user explicitly kept delivery-partner verification gated. There are no agreed partner/reviewer/evidence routes. Do not enable `LIVE_PUBLIC_WRITES_READY` or production deployment from synthetic partner approval. Real SMS/email/courier/GPS/identity/payout services are not installed. Backend non-demo OTP returns 503; production startup remains gated. Browser/mobile/zoom/physical-print checks remain with the frontend/integration owner.

## Implemented phases and checkpoints

| Phase | Checkpoint | Result |
| --- | --- | --- |
| 1 Foundation | e4ef6d5 | Validated config, safe HTTP/logging, lifecycle, DB readiness and test setup |
| 2 Authentication/isolation | 40b143c | Durable hashed sessions, rotation/revocation, seller scope, persistent throttles |
| 3 Orders/events | 537b976 | Atomic create/event/QR, validation, snapshot pagination, locked seller transitions |
| 4 QR security | ddd140d | Purpose/expiry/revocation/state checks, read-only scans, public-safe responses |
| 5 Delivery/customer | 30892c4 | Attempt-scoped acceptance, one-time OTP/proof, serialized retries and decisions |
| 6 Returns | ad580ea | Structured reasons, sourced events, full return/redelivery graph |
| 7 Ledger | 751ec24 | Independent eligibility evidence, transaction rollback, exactly one INR 500-paise credit |
| 8 Notifications/reports | f422ca2 | Transactional in-app records, reconciled monthly aggregates, safe CSV |
| 9 Integration/QA | final branch HEAD | 157 backend tests, 45 frontend tests, actual adapter and compiled-process verification |

No major phase was restarted. The original untracked backend was archived and hash-verified under ignored `.local/backups/api-original-20261023`, including its dependencies. All feature branches build cumulatively on prior backend checkpoints; the integration uses the cumulative merge, preserving their history.

## API compatibility and clarifications

The existing contract's paths/methods/statuses/request shapes, cookie name, pagination and flat seller order fields are preserved. No edit/delete, token reissue, mark-as-read, payout or partner route was invented. The final live adapter check used the frontend's actual `api.ts` and `features/public/workflowApi.ts` without modifying them.

- Every mutating request requires the exact configured browser Origin. Keep credentials enabled. Cookie sessions persist across server restarts and expire absolutely after seven days.
- Delivery preview is available only OUT_FOR_DELIVERY. Completion is offered only while customer acceptance is current. Customer accepts/rejects/requests redelivery during OUT_FOR_DELIVERY; attempted/failed/rejected/returned states permit only redelivery. Other token states return the same 404 as an invalid token.
- Seller cancellation, return initiation and redelivery require reason codes, matching the current frontend form. Address outcomes require ADDRESS_INCORRECT or ADDRESS_INCOMPLETE. Customer rejection requires a reason. Client actor/source/reward/acceptance flags never authorize state changes.
- OTP request/verify/decision routes are unchanged. Proofs are one-time and tied to the current dispatch; a new dispatch requires fresh verification. Acceptance expires with the 15-minute verification proof. Demo response is labelled and explicitly says no SMS was sent; manual mode without a provider returns 503.
- Public mutation results retain `order` and `event`; delivery retains `ledgerEntry: null` to honor the explicit public-privacy rule. Order contains reference/status only. Event receipt includes id, eventType, fromStatus, toStatus, actorType, reasonCode, source and createdAt. It omits private note, actor identity and internal metadata. Current frontend only requires `order.status` and passed against these responses.
- Idempotence is enforced on committed effects. After a transition makes the link ineligible or completion revokes it, retries return the contract's required 404, without another event/credit. One-time proof replay returns 401. A seller can inspect detail/history after an ambiguous network failure. Replaying a success receipt after revocation would require a separately agreed contract extension.
- QR URLs are shown once at creation. Print/save the current creation sheet; hash-only tokens cannot be recovered later. Reissue/rotation remains a potential contract extension, not a missing documented endpoint.
- Notifications are in-app records only; no fake external-send/read-state flags. Report deliveryAttempts counts all delivery-actor outcomes; redeliveryRequests includes both customer action and seller status events. Other metrics retain documented event semantics and Kolkata bounds. CSV columns are unchanged; empty reasons emit two blank cells.

## Running the reviewed versions together

Use the integrated main checkout's `apps/api` and `apps/web`. Install each app's own dependencies. The ignored environment uses PostgreSQL, a random secret, `APP_ORIGIN=http://127.0.0.1:5173` and `API_PORT=3001`. The retained cluster is running on 55432 with separate `unloss_local_demo` and `unloss_test_phase1` databases. It is local test infrastructure. Generated login instructions and database restart helper are under ignored `.local`; no credentials are tracked.

Run generate/validate/migrate/seed/dev as described in the backend README. Keep demo mode explicit. The optional adapter check accepts the current frontend directory:

```powershell
npm.cmd --prefix apps/api run test:frontend -- "D:\AI Bhoomi Hackathon\Unloss\apps\web"
```

It requires TEST_DATABASE_URL pointing to a migrated loopback `unloss_test_*` database. It exercises actual HTTP and data persistence; it does not bypass or alter the UI's partner release gate.

The user authorized this integration and local testing. The merge preserves both frontend and backend histories, and the original-file backup was verified before replacing the checkout directory. Current frontend dependency notes now distinguish resolved MVP defects from remaining partner/provider/deployment work.

## Release boundaries

Complete for the agreed backend MVP: foundation, seller isolation, documented order/event API, separate secure QR flows, demo/manual verification semantics, returns, internal ledger, in-app notifications, reports/CSV, migrations/seed and automated integration QA.

Still gated: production proxy/TLS/hosting configuration and operational rollout; authorized real OTP provider; partner identity/consent/reviewer/activation contract and backend; frontend manual/production public-write activation; browser/accessibility/mobile and physical QR printing. No real user database or external provider was changed. No real payout is implemented or implied.
