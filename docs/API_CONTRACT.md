# UNLOSS API Contract

Version: 1.2 (Phase 1 verified: foundation, multi-role auth, 4 distinct dashboards, 24 October 2026)

This contract is the shared interface for `apps/web` and `apps/api`. The product source of truth is `UNLOSS_Master_Build_Reference_and_Parallel_Codex_Guide.md`. All timestamps are ISO-8601 UTC; report month boundaries use `Asia/Kolkata`.

## Conventions

- Base path: `/api`; JSON request/response bodies except CSV export.
- Role-based authorization: `SELLER`, `DELIVERY`, `CUSTOMER`, `ADMIN`.
- Session cookie: `unloss.sid`, `HttpOnly`, `SameSite=Lax`, host-only. Sessions are persisted using hashed IDs, rotated on login and revoked on logout, with seven-day absolute expiry. Every mutation, including login and public token actions, requires the exact configured `Origin`.
- Multi-role session endpoint: `GET /api/auth/session` returns `{ seller, user, mode }`.

## Role-Based Route Matrix

| Route | Role / Auth | Request | Success Response |
| --- | --- | --- | --- |
| `POST /auth/login` | Public | email/phone + password | 200 `{seller, user, mode}` |
| `GET /auth/me` | Any Authenticated | none | 200 `{seller, user, mode}` |
| `GET /auth/session` | Any Authenticated | none | 200 `{seller, user, mode}` |
| `POST /auth/logout` | Any Authenticated | none | 204 No Content |
| `POST /auth/register` | Public | registration schema | 201 `{user}` |
| `POST /auth/demo-switch` | Demo mode only | `{role}` | 200 `{seller, user, mode}` |
| `GET /delivery/pending` | DELIVERY | none | 200 `{items: Order[]}` |
| `POST /orders/:id/claim` | DELIVERY (Approved) | `{latitude?, longitude?, accuracyMeters?}` | 201 `{claim}` |
| `GET /delivery/earnings` | DELIVERY | none | 200 `{items, eligiblePaise, payoutAccount}` |
| `POST /delivery/payout-account` | DELIVERY | `{method: 'UPI'\|'BANK', ...}` | 200 `{account}` |
| `GET /admin/delivery-accounts` | ADMIN | none | 200 `{items: DeliveryProfile[]}` |
| `POST /admin/delivery-accounts/:id/review` | ADMIN | `{action: 'APPROVE'\|'REJECT', reason?}` | 200 `{profile}` |
| `POST /admin/payouts/run` | ADMIN | none | 200 `{batch, scheduledFor, note}` |
| `POST /integrations/aftership/webhook` | Public Webhook | courier tracking payload | 200 `{accepted: true}` |
| `GET /products` | SELLER | none | 200 `{items: Product[]}` |
| `POST /products` | SELLER | `{name, description?, sku?, defaultQuantity?}` | 201 `{product}` |
| `GET /drafts` | SELLER | none | 200 `{items: OrderDraft[]}` |
| `POST /drafts` | SELLER | `{productName, quantity?}` | 201 `{draft, product, qr, status}` |
| `PATCH /drafts/:id` | SELLER | recipient and delivery fields | 200 `{draft}` |
| `POST /drafts/:id/activate` | SELLER | none | 201 `{orderId, qr}` |
| `POST /drafts/:id/duplicate` | SELLER | none | 201 `{draft, qr}` |
| `POST /drafts/:id/archive` | SELLER | none | 204 No Content |
| `GET /seller/claims` | SELLER | none | 200 `{items: ParcelClaim[]}` |
| `POST /seller/claims/:id/decide` | SELLER | `{action: 'APPROVE'\|'REJECT', reason?}` | 200 `{claim}` |
| `GET /seller/funding` | SELLER | none | 200 `{account, txns, reservations, earnings}` |
| `POST /seller/funding/checkout` | SELLER | `{amountPaise}` | 200 `{provider, providerOrderId, ...}` |
| `POST /seller/funding/capture` | SELLER | `{providerOrderId, providerPaymentId}` | 200 `{status: 'CAPTURED', transaction}` |
| `POST /orders/:id/fund-reserve` | SELLER | none | 201 `{reservation}` |
| `GET /events/live` | Any Authenticated | `Last-Event-ID` header/param | 200 SSE `text/event-stream` with heartbeat |
| `GET /events/poll` | Any Authenticated | `?since=<ISO_TIMESTAMP>` | 200 `{items: OrderEvent[], timestamp}` |

## Shared enums and lifecycle

`OrderStatus`: `CREATED`, `READY_FOR_DISPATCH`, `OUT_FOR_DELIVERY`, `DELIVERY_ATTEMPTED`, `DELIVERED_VERIFIED`, `CUSTOMER_REJECTED`, `DELIVERY_FAILED`, `RETURN_INITIATED`, `RETURN_IN_TRANSIT`, `RETURNED_TO_SELLER`, `REDELIVERY_REQUESTED`, `CANCELLED`.

Allowed transitions (all others rejected):

| From | To |
| --- | --- |
| CREATED | READY_FOR_DISPATCH, CANCELLED |
| READY_FOR_DISPATCH | OUT_FOR_DELIVERY, CANCELLED |
| OUT_FOR_DELIVERY | DELIVERY_ATTEMPTED, DELIVERED_VERIFIED, CUSTOMER_REJECTED, DELIVERY_FAILED, REDELIVERY_REQUESTED, RETURN_INITIATED |
| DELIVERY_ATTEMPTED | OUT_FOR_DELIVERY, REDELIVERY_REQUESTED, RETURN_INITIATED |
| CUSTOMER_REJECTED | REDELIVERY_REQUESTED, RETURN_INITIATED |
| DELIVERY_FAILED | OUT_FOR_DELIVERY, REDELIVERY_REQUESTED, RETURN_INITIATED |
| REDELIVERY_REQUESTED | READY_FOR_DISPATCH, RETURN_INITIATED |
| RETURN_INITIATED | RETURN_IN_TRANSIT |
| RETURN_IN_TRANSIT | RETURNED_TO_SELLER |
| RETURNED_TO_SELLER | REDELIVERY_REQUESTED |
| DELIVERED_VERIFIED, CANCELLED | (terminal) |

`ReasonCode`: `CUSTOMER_UNAVAILABLE`, `CUSTOMER_REJECTED`, `ADDRESS_INCORRECT`, `ADDRESS_INCOMPLETE`, `PHONE_UNREACHABLE`, `DELIVERY_DELAY`, `PACKAGE_DAMAGED`, `PACKAGE_MISMATCH`, `CUSTOMER_REQUESTED_REDELIVERY`, `SELLER_CANCELLED`, `COURIER_REPORTED_OTHER`, `OTHER`.

`ActorType`: `SELLER`, `DELIVERY`, `CUSTOMER`, `SYSTEM`. `EventSource`: `MANUAL`, `DEMO`, `INTEGRATION`. `LedgerType`: `DELIVERY_REWARD`, `REVERSAL`.

Events are append-only and contain `id`, `orderId`, `eventType`, `fromStatus`, `toStatus`, `actorType`, nullable `actorId`, nullable `reasonCode`/`note`, `source`, `createdAt`, and safe metadata. Reason source is represented by `actorType` and `source`; no automatic fault attribution is made.

## Schemas

Order create request:

```json
{
  "sellerReference": "optional string, max 100",
  "customer": { "name": "string, max 160", "phone": "E.164 string" },
  "deliveryAddress": {
    "line1": "string, max 200", "line2": "optional string, max 200",
    "city": "string", "state": "string", "postalCode": "string"
  }
}
```

Order response exposes seller-only customer/address data on authenticated seller routes. Public QR responses must not include phone, full address, internal notes, or ledger information. Order list query: `q`, `status`, `page`, `pageSize`. Transition body: `{ "toStatus": "OrderStatus", "reasonCode": "ReasonCode|null", "note": "string|null" }`. Attempt body: `{ "outcome": "DELIVERY_ATTEMPTED|CUSTOMER_UNAVAILABLE|CUSTOMER_REJECTED|ADDRESS_ISSUE|DELIVERED_VERIFIED", "reasonCode": "ReasonCode|null", "note": "string|null" }`.

The current authenticated order HTTP response uses flat fields: `id`, `sellerId`, `sellerReference`, `status`, `customerName`, `customerPhone`, `addressLine1`, `addressLine2`, `city`, `state`, `postalCode`, `createdAt`, and `updatedAt`. The list returns these in `items`; create returns one in `order` plus the two purpose-specific URLs; detail returns one in `order` plus `events`. The frontend maps these flat fields into its nested customer/address view model at the API boundary. Public token responses must remain separate and minimal. The dashboard currently responds with `{totalOrders,statusCounts,rewardTotalPaise}`; `statusCounts` is a partial map of current `OrderStatus` counts.

OTP request response: `{ "challengeId": "string", "expiresAt": "ISO timestamp", "devCode": "string (demo only)" }`. OTP verify request: `{ "challengeId": "string", "code": "string" }`; response: `{ "verificationToken": "short-lived opaque token", "expiresAt": "ISO timestamp" }`. The verification token is valid for 15 minutes and scoped to that order/customer token. OTP expires in 5 minutes, allows five attempts, and has a 60-second resend cooldown and max five requests per hour per token/IP. Demo OTP is returned only with `DEMO_MODE=true`; production with no provider returns 503 `OTP_PROVIDER_UNAVAILABLE`. Never log OTPs.

Customer decision body (requires `X-Customer-Verification`): `{ "action": "ACCEPT|REJECT|REQUEST_REDELIVERY", "reasonCode": "ReasonCode|null", "note": "string|null" }`. `REJECT` requires a reason. Decisions require successful OTP verification. Customer responses expose only minimal order reference, parcel description if present, current status, and allowed actions.

Reward ledger entries contain `id`, `sellerId`, `orderId`, `amountPaise` (500 for credit), `currency` (`INR`), `type`, `eligibilityReason`, and `createdAt`. Unique constraint on `(orderId, type=DELIVERY_REWARD)` ensures idempotence. Credit only after an OTP-verified `ACCEPT` event followed by a delivery actor recording `DELIVERED_VERIFIED` handoff, in the same transaction as the status/event update.

Delivery preview is eligible only in `OUT_FOR_DELIVERY`. It offers `DELIVERED_VERIFIED` only while this dispatch has current OTP acceptance. Customer actions in `OUT_FOR_DELIVERY` are `ACCEPT`, `REJECT`, and `REQUEST_REDELIVERY`; attempted/failed/rejected/returned states permit only `REQUEST_REDELIVERY`. Other states return `404 TOKEN_INVALID`. Acceptance does not change status or prove handoff. Proofs are one-use and bound to the token and dispatch attempt; a new dispatch requires fresh verification. Acceptance expires with the 15-minute proof.

Seller cancellation, return initiation and redelivery require a reason. Sellers cannot directly record verified delivery or customer/delivery-only outcomes. `ADDRESS_ISSUE` requires `ADDRESS_INCORRECT` or `ADDRESS_INCOMPLETE`; `DELIVERED_VERIFIED` cannot include a failure reason. Optional notes are private to the seller timeline.

Public mutation `order` is exactly `{orderReference,status}`. The safe `event` receipt exposes `id,eventType,fromStatus,toStatus,actorType,reasonCode,source,createdAt`; it omits private notes, actor IDs, order/seller IDs and metadata. Delivery always returns `ledgerEntry: null`. Ledger data is available only through seller-authenticated routes.

## Routes

| Method and path | Auth | Request/query | Success |
| --- | --- | --- | --- |
| `POST /auth/login` | Public | `{email,password}` | 200 `{seller,mode}` and session cookie |
| `POST /auth/logout` | Seller | none | 204, clears session |
| `GET /auth/me` | Seller | none | 200 `{seller,mode}` |
| `GET /dashboard/summary` | Seller | none | 200 counts from persisted data |
| `GET /orders` | Seller | `q,status,page,pageSize` | 200 paginated seller-owned orders |
| `POST /orders` | Seller | Order create schema | 201 `{order,qr:{deliveryUrl,customerUrl}}`; tokens are distinct and shown once |
| `GET /orders/:id` | Seller | none | 200 `{order,events}` |
| `GET /orders/:id/events` | Seller | pagination | 200 paginated append-only events |
| `POST /orders/:id/transitions` | Seller | transition schema | 200 `{order,event}` |
| `GET /delivery/:token` | Delivery token | none | 200 `{orderReference,status,mode,permittedOutcomes}` |
| `POST /delivery/:token` | Delivery token | attempt schema | 201 `{order,event,ledgerEntry:null}`; effects are idempotent |
| `GET /customer/:token` | Customer token | none | 200 `{orderReference,status,mode,allowedActions}` |
| `POST /customer/:token/request-otp` | Customer token | `{}` | 202 OTP request schema |
| `POST /customer/:token/verify-otp` | Customer token | OTP verify schema | 200 verification token schema |
| `POST /customer/:token/decision` | Customer token + verification token | customer decision schema | 201 `{order,event}` |
| `GET /rewards/ledger` | Seller | pagination | 200 paginated own ledger entries |
| `GET /rewards/summary` | Seller | none | 200 `{creditCount,totalPaise,currency}` |
| `GET /notifications` | Seller | pagination | 200 paginated own notifications |
| `GET /reports/monthly` | Seller | `month=YYYY-MM` | 200 report schema below |
| `GET /reports/monthly.csv` | Seller | `month=YYYY-MM` | 200 `text/csv`, UTF-8, safely quoted |

All `:id` routes return 404 for another seller's order. Auth errors and invalid transitions use the common envelope. No frontend may call undocumented routes.

Idempotence means no duplicate committed event or credit. Once completion revokes a link or an action makes it ineligible, retries return 404 rather than replaying a success receipt. A consumed proof returns 401 when the QR is still eligible. The frontend retains the confirmed POST receipt instead of immediately fetching the now-closed link. After an ambiguous network failure, inspect seller history before retrying. Success-receipt replay and QR reissue are not existing routes.

## Reports and CSV

Monthly JSON includes `{month,timezone,periodStart,periodEnd,totalOrdersCreated,ordersDispatched,deliveryAttempts,verifiedCompletions,returnsToSeller,returnRate,returnRateNumerator,returnRateDenominator,redeliveryRequests,rewardCreditCount,rewardTotalPaise,reasonCounts}`. Counts are events occurring within the selected local calendar month; current status summaries are as-of request time. Return rate is `RETURNED_TO_SELLER` events during the month divided by dispatch events during the month; if denominator is zero, rate is `null`. The response labels date range and denominator. CSV headers are stable: `month,timezone,period_start,period_end,total_orders_created,orders_dispatched,delivery_attempts,verified_completions,returns_to_seller,return_rate,return_rate_numerator,return_rate_denominator,redelivery_requests,reward_credit_count,reward_total_paise,reason_code,reason_count`. Emit one summary row per reason code; emit one row with blank reason fields if there are no reason events. No personal data in export.

Report `periodStart` is inclusive and `periodEnd` exclusive. `deliveryAttempts` counts every delivery-actor outcome, including failed attempts and verified completion. `redeliveryRequests` includes customer `REQUEST_REDELIVERY` and seller `REDELIVERY_REQUESTED` events. Repeated attempts are event counts, not unique-order counts. Notifications are persisted in-app event records; there is no external-send or mark-as-read endpoint.

## Environment and setup contract

`DATABASE_URL` (PostgreSQL), `SESSION_SECRET` (random, minimum 32 bytes), `APP_ORIGIN`, `API_PORT` (default 3001), `DEMO_MODE` (default false), `SEED_SELLER_EMAIL`, `SEED_SELLER_PASSWORD`, `QR_TOKEN_TTL_DAYS` (default 90), and provider credentials only when a real OTP provider is implemented. `.env.example` contains placeholders, never live secrets. Demo seed data and test OTP must be labelled and must never be represented as production data.

## Implementation status and proposed extensions — 23 October 2026

The cumulative backend phases are integrated with the frontend. Version 1.1 records the additive server `mode` field and reconciles public-safe receipts, state/actor restrictions, retry semantics and report definitions with tested behavior. Existing paths and request schemas are preserved. Database-backed demo actions are enabled only by the explicit backend mode; `LIVE_PUBLIC_WRITES_READY` remains false for manual/production workflows. Production runtime is independently refused by the API. See [backend dependencies](BACKEND_DEPENDENCIES.md) for the remaining provider, partner and deployment work.

Delivery-partner identity/review has no live routes. [The partner verification proposal](PARTNER_VERIFICATION_PROPOSAL.md) is **not an agreed API extension**. Its isolated frontend demo uses synthetic identities only. Local database demo delivery is a scoped QR-bearer workflow and is labelled accordingly; it does not authenticate official partner identity. Synthetic partner approval cannot authorize backend requests.

Frontend demo routes are separate from API routes and issue no live requests. `VITE_ENABLE_DEMO=true` explicitly enables them on a dedicated demo deployment; local development enables them by default. Default production builds do not expose them. Demo approval never authorizes live delivery actions.
