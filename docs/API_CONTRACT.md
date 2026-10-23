# UNLOSS API Contract

Version: 1.0 (MVP)

This contract is the shared interface for `apps/web` and `apps/api`. The product source of truth is `UNLOSS_Master_Build_Reference_and_Parallel_Codex_Guide.md`. All timestamps are ISO-8601 UTC; report month boundaries use `Asia/Kolkata`.

## Conventions

- Base path: `/api`; JSON request/response bodies except CSV export.
- Seller routes require an authenticated seller session. Every database lookup is scoped to the session seller.
- Public delivery/customer routes require a purpose-specific opaque token. Tokens are high-entropy random values; persist a hash for lookup, set a 90-day expiry, and revoke on completion/cancellation. Wrong-purpose, expired, revoked, unknown, or ineligible tokens return `404 TOKEN_INVALID` (do not reveal which condition failed).
- Session cookie: `unloss.sid`, `HttpOnly`, `SameSite=Lax`, `Secure` in production. Login/logout and state-changing cookie-authenticated requests enforce same-origin/CSRF protection.
- Error envelope: `{ "error": { "code": "STABLE_CODE", "message": "Human-readable message", "details": {} }, "requestId": "..." }`. `details` is optional. Validation: 400; unauthenticated: 401; forbidden: 403; missing/inaccessible resource: 404; conflict/invalid transition: 409; throttled: 429; unavailable provider: 503.
- Paginated lists accept `page` (default 1) and `pageSize` (default 25, max 100) and return `{ "items": [], "page": 1, "pageSize": 25, "total": 0 }`.

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

## Routes

| Method and path | Auth | Request/query | Success |
| --- | --- | --- | --- |
| `POST /auth/login` | Public | `{email,password}` | 200 `{seller}` and session cookie |
| `POST /auth/logout` | Seller | none | 204, clears session |
| `GET /auth/me` | Seller | none | 200 `{seller}` |
| `GET /dashboard/summary` | Seller | none | 200 counts from persisted data |
| `GET /orders` | Seller | `q,status,page,pageSize` | 200 paginated seller-owned orders |
| `POST /orders` | Seller | Order create schema | 201 `{order,qr:{deliveryUrl,customerUrl}}`; tokens are distinct and shown once |
| `GET /orders/:id` | Seller | none | 200 `{order,events}` |
| `GET /orders/:id/events` | Seller | pagination | 200 paginated append-only events |
| `POST /orders/:id/transitions` | Seller | transition schema | 200 `{order,event}` |
| `GET /delivery/:token` | Delivery token | none | 200 minimal order reference, status, permitted outcomes |
| `POST /delivery/:token` | Delivery token | attempt schema | 201 `{order,event,ledgerEntry|null}`; duplicate action is idempotent |
| `GET /customer/:token` | Customer token | none | 200 minimal order reference/status/actions |
| `POST /customer/:token/request-otp` | Customer token | `{}` | 202 OTP request schema |
| `POST /customer/:token/verify-otp` | Customer token | OTP verify schema | 200 verification token schema |
| `POST /customer/:token/decision` | Customer token + verification token | customer decision schema | 201 `{order,event}` |
| `GET /rewards/ledger` | Seller | pagination | 200 paginated own ledger entries |
| `GET /rewards/summary` | Seller | none | 200 `{creditCount,totalPaise,currency}` |
| `GET /notifications` | Seller | pagination | 200 paginated own notifications |
| `GET /reports/monthly` | Seller | `month=YYYY-MM` | 200 report schema below |
| `GET /reports/monthly.csv` | Seller | `month=YYYY-MM` | 200 `text/csv`, UTF-8, safely quoted |

All `:id` routes return 404 for another seller's order. Auth errors and invalid transitions use the common envelope. No frontend may call undocumented routes.

## Reports and CSV

Monthly JSON includes `{month,timezone,periodStart,periodEnd,totalOrdersCreated,ordersDispatched,deliveryAttempts,verifiedCompletions,returnsToSeller,returnRate,returnRateNumerator,returnRateDenominator,redeliveryRequests,rewardCreditCount,rewardTotalPaise,reasonCounts}`. Counts are events occurring within the selected local calendar month; current status summaries are as-of request time. Return rate is `RETURNED_TO_SELLER` events during the month divided by dispatch events during the month; if denominator is zero, rate is `null`. The response labels date range and denominator. CSV headers are stable: `month,timezone,period_start,period_end,total_orders_created,orders_dispatched,delivery_attempts,verified_completions,returns_to_seller,return_rate,return_rate_numerator,return_rate_denominator,redelivery_requests,reward_credit_count,reward_total_paise,reason_code,reason_count`. Emit one summary row per reason code; emit one row with blank reason fields if there are no reason events. No personal data in export.

## Environment and setup contract

`DATABASE_URL` (PostgreSQL), `SESSION_SECRET` (random, minimum 32 bytes), `APP_ORIGIN`, `API_PORT` (default 3001), `DEMO_MODE` (default false), `SEED_SELLER_EMAIL`, `SEED_SELLER_PASSWORD`, `QR_TOKEN_TTL_DAYS` (default 90), and provider credentials only when a real OTP provider is implemented. `.env.example` contains placeholders, never live secrets. Demo seed data and test OTP must be labelled and must never be represented as production data.

## Implementation status and proposed extensions — 23 October 2026

The interface above is unchanged. Current backend behavior does not yet satisfy every guarantee: see [backend dependencies](BACKEND_DEPENDENCIES.md) for public response privacy, state/actor enforcement, OTP replay/rate limiting, idempotency, notifications and report reconciliation. Frontend public writes remain disabled pending these fixes; a client-side gate does not secure the underlying API.

Delivery-partner identity/review is a new requirement with no live routes. [The partner verification proposal](PARTNER_VERIFICATION_PROPOSAL.md) is **not an agreed API extension**. The frontend only implements an explicitly labelled synthetic demo for it; no partner endpoints have been invented. The user has reserved backend changes for the backend owner.

Frontend demo routes are separate from API routes and issue no live requests. `VITE_ENABLE_DEMO=true` explicitly enables them on a dedicated demo deployment; local development enables them by default. Default production builds do not expose them. Demo approval never authorizes live delivery actions.
