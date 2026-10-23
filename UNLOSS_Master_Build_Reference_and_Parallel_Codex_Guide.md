# UNLOSS — MASTER BUILD REFERENCE & PARALLEL WORKSTREAM GUIDE

UNLOSS

MASTER BUILD REFERENCE & PARALLEL WORKSTREAM GUIDE

A shared source of truth for Codex, frontend/backend workstreams, integration, testing, and handoff

Version: 1.0 | Prepared: 23 October 2026


## 1. Purpose and product definition

UNLOSS is a seller-focused parcel-delivery verification, accountability, and return-tracking web application. It gives a seller an independent, readable record of what happened to an order across delivery attempts, customer decisions, returns, and redelivery. It should make events and reasons easier to inspect; it must not promise that returns will be eliminated or automatically assign blame.

Core product principle: a QR scan is an interaction or workflow trigger, not proof that a parcel physically reached the correct person. Delivery completion should be represented only after the required verification workflow and a server-side eligibility check.


### Problem statement

Sellers can have limited visibility into why parcels fail, are rejected, or return to origin. Courier tracking may be too coarse for a seller’s operational needs. UNLOSS aims to provide a seller-owned order timeline, structured delivery outcomes, customer verification, return reasons, redelivery tracking, and monthly summaries.


### Illustrative example — not an industry benchmark

A seller records 100 orders and sees 20 returns. UNLOSS should help the seller inspect the recorded outcomes and reasons, identify patterns, and decide what to improve. The figures are only an example; do not present them as market averages or promise a specific reduction in returns.


### Primary users

- Seller: creates and manages orders, views status and history, prints QR codes, reviews returns and reports.

- Delivery person: uses an authorized delivery workflow to record the attempt and result.

- Customer: opens a customer-specific link/QR, verifies with OTP where configured, and accepts, rejects, or requests redelivery.

- Administrator/maintainer: configures the demo environment and inspects technical health; no broad admin console is required for MVP.


## 2. Product scope and non-goals


### MVP must include

- Seller sign-in/sign-out and seller-owned data isolation.

- Dashboard with order counts and status summaries derived from real persisted data.

- Create, list, search/filter, and view orders.

- Two different QR codes per order: a delivery workflow QR and a customer verification QR.

- Delivery QR eligibility: only usable for the intended delivery workflow/status; invalid, expired, wrong-purpose, or out-of-state tokens are rejected.

- Customer workflow with OTP verification (development OTP only unless a real provider is configured), accept/reject, and redelivery request where permitted.

- Append-only order event timeline with actor, timestamp, event type, and reason where applicable.

- Structured delivery attempt outcomes and structured return/rejection reasons, with optional notes.

- Return/redelivery workflow and clear display of last confirmed status.

- Internal ₹5 reward ledger entry for each eligible customer-verified completed delivery, idempotently recorded; no real payout in MVP.

- In-app notifications or a notification centre for relevant events.

- Monthly report with counts/rates and CSV export; label date ranges and denominators clearly.

- Print-friendly order sheet/labels showing the two separate QR codes and concise instructions.

- Seeded demo data and a clearly labelled demo mode so the product can be tested without real courier/SMS integrations.

- Responsive, accessible interface inspired by Wikimedia Codex design principles.


### Explicit non-goals for MVP

- No AI-based blame assignment, risk scoring, or guaranteed return reduction.

- No live GPS tracking, route optimization, map tracking, or fabricated location data.

- No real courier integration unless official credentials, documentation, and endpoints are supplied.

- No real SMS/WhatsApp delivery unless a provider is configured.

- No real money transfer, wallet withdrawal, payment gateway, or payout promise.

- No marketplace, inventory management, subscription billing, multi-tenant enterprise analytics, or unrelated features.

- No customer-facing claim that a QR scan alone proves delivery or customer identity.

- No hidden mock data presented as production data.


## 3. Roles, permissions, and trust boundaries

Enforce authorization on the backend, not just by hiding frontend controls.

- Seller: can access only orders, reports, events, and ledger entries belonging to that seller.

- Delivery workflow: must use a narrowly scoped token or authenticated role; can perform only permitted delivery actions, not read all seller data.

- Customer: can access only the customer action associated with a purpose-specific, high-entropy token. The page must reveal only the minimum information needed.

- Public QR endpoints: must not expose customer phone, full address, internal notes, reward ledger, or other private seller data.

- Tokens: use cryptographically secure random values; store token hashes where feasible; separate token purposes; support expiry/revocation; never use sequential IDs as security tokens.

- OTP: rate-limit requests and attempts, expire codes, avoid leaking whether an account/phone exists, and never log production OTPs.

- Auditability: record who/what performed a state change and when. Do not allow the frontend to directly set arbitrary order statuses.


## 4. QR code design and workflow


### A. Delivery QR

- Purpose: open the authorized delivery workflow for the specific order.

- It is not the customer QR and must not be interchangeable with it.

- It should be valid only when the order is in an eligible state, normally Out for Delivery or an explicitly permitted attempt state.

- Scanning should show the permitted next action and current confirmed status, not silently mark the parcel delivered.

- The delivery person records an outcome such as delivered after required verification, customer unavailable, customer rejected, address issue, or delivery attempted.

- The backend validates token purpose, expiry, order state, permissions, and duplicate submissions.


### B. Customer QR

- Purpose: open a customer-facing verification page for the specific order.

- Show minimal order details and explain what the customer is confirming.

- Use OTP when configured by the product flow; in local development, display a clearly labelled test OTP or development-only shortcut.

- Allow accept, reject with a structured reason where applicable, and redelivery request when allowed.

- A customer action records a verified event; it does not independently prove physical delivery unless the full configured workflow supports that conclusion.

- The customer token must not grant delivery-person permissions or seller dashboard access.


### QR lifecycle

1. Create the order and generate two separate purpose-specific tokens.

1. Keep each token tied to one order and its intended role; never embed private personal data directly in the QR URL.

1. Allow the delivery workflow only when the order is eligible.

1. Record every successful action in the event timeline and reject invalid transitions server-side.

1. Revoke or expire tokens when an order is cancelled, closed, or the relevant workflow ends, as appropriate.


## 5. Order lifecycle and event model

Use one documented enum/status model across frontend, backend, database, API contract, tests, and reports. Avoid multiple spellings or status models.

Suggested MVP statuses:

- CREATED

- READY_FOR_DISPATCH

- OUT_FOR_DELIVERY

- DELIVERY_ATTEMPTED

- DELIVERED_VERIFIED

- CUSTOMER_REJECTED

- DELIVERY_FAILED

- RETURN_INITIATED

- RETURN_IN_TRANSIT

- RETURNED_TO_SELLER

- REDELIVERY_REQUESTED

- CANCELLED

The backend must define the valid transition graph. This list is a starting point, not permission to transition freely between every pair. Keep transition rules in one shared service and test invalid transitions.

Event records should include at minimum: id, orderId, eventType, fromStatus (nullable), toStatus (nullable), actorType, actorId where available, reasonCode (nullable), note (nullable), source (manual/demo/integration), createdAt, and safe metadata. Event history should be append-only in normal application flows.


### Return and failure reason taxonomy

- CUSTOMER_UNAVAILABLE

- CUSTOMER_REJECTED

- ADDRESS_INCORRECT

- ADDRESS_INCOMPLETE

- PHONE_UNREACHABLE

- DELIVERY_DELAY

- PACKAGE_DAMAGED

- PACKAGE_MISMATCH

- CUSTOMER_REQUESTED_REDELIVERY

- SELLER_CANCELLED

- COURIER_REPORTED_OTHER

- OTHER

Keep reason codes structured for reporting and allow an optional note. Do not automatically conclude that the seller, courier, or customer is at fault. Label the source of each reported reason (customer-reported, delivery-person-reported, seller-entered, or integration-reported).


## 6. ₹5 reward ledger rules

- The reward is an internal ledger record, not money transferred to a bank account or wallet.

- Create a ₹5 ledger credit only when the backend confirms that the order meets the documented eligible customer-verified completion rule.

- The rule must be explicit in code and docs; do not award a credit merely because a QR was scanned or a client submitted a status.

- Use a unique idempotency key or database constraint so retries cannot create duplicate credits for the same eligible delivery.

- Record sellerId, orderId, amount in paise (500), currency INR, ledger type, eligibility reason, and timestamp.

- Make reversals explicit ledger entries if later required; do not silently delete or mutate prior ledger records.

- Do not offer withdrawal, redemption, or payout in MVP. UI copy must say 'internal reward ledger' or equivalent.


## 7. Reports, dashboard, and metrics

Dashboard and monthly reports must be calculated from persisted backend data, not hardcoded frontend numbers. Provide empty states when there is no data.

- Total orders created during the selected period.

- Current counts by status.

- Delivery attempts and verified completions.

- Return count and return rate, with an explicit denominator and date range.

- Structured failure/rejection/return reason counts.

- Redelivery requests and outcomes where recorded.

- Eligible ₹5 credits and total internal ledger balance.

- CSV export with safe quoting, stable column names, date range, and no unnecessary sensitive fields.

Use a clear metric definition, for example: return rate = orders returned to seller during the selected period / orders dispatched during the same period. If a different cohort-based definition is used, document it and use it consistently. Avoid mixing orders created in one period with returns from another without explanation.


## 8. Recommended technical architecture


### Frontend

React, Vite, TypeScript, Tailwind CSS, React Router, TanStack Query, React Hook Form, Zod, and Lucide icons. Keep API access in a centralized typed client. Prefer feature-based folders and reusable components.


### Backend

Node.js, Express, TypeScript, Zod validation, Prisma ORM, PostgreSQL, secure session-based authentication, structured error handling, migrations, seed scripts, and automated tests. Use the repository's existing stack if it is already established and sound; document any deliberate deviation before making it.


### Repository shape (suggested)

- apps/web/ — frontend application

- apps/api/ — backend application

- packages/shared/ — shared types/status enums/schema fragments, only if repository tooling supports it cleanly

- docs/UNLOSS_MASTER_REFERENCE.md — this document

- docs/API_CONTRACT.md — endpoints, request/response examples, error shapes, status transitions

- docs/DECISIONS.md — brief architecture/product decisions

- README.md — setup, environment, migrations, seed, test, run instructions

Do not force a monorepo restructuring if the current repository already has a sensible layout. Inspect first, then document the chosen structure.


## 9. UI/UX requirements

Use Wikimedia Codex as a design reference: https://doc.wikimedia.org/codex/latest/. Borrow its clarity, accessible controls, neutral surfaces, restrained color, typography hierarchy, and consistent interaction patterns. Do not copy Wikimedia branding.

- Visual direction: operational tool, calm and professional; white/neutral backgrounds with restrained blue for primary actions and clear semantic status colors.

- Avoid generic SaaS gradients, excessive shadows, glassmorphism, decorative animation, and oversized hero sections.

- Use consistent spacing, typography, form labels, buttons, badges, tables, alerts, dialogs, and empty states.

- All pages must work on mobile and desktop; tables should adapt or provide horizontal scrolling intentionally.

- Every action needs a visible loading, success, and failure state. Disable duplicate submits while requests are in flight.

- Use accessible focus states, keyboard navigation, contrast, descriptive labels, and useful validation messages.

- Do not create fake buttons. Every visible action must work or be clearly disabled with an explanation.

- Do not show fake metrics, fake delivery locations, or demo events as live production data.

- Print view should hide navigation and present the two QR codes with labels and short scanning instructions.


## 10. API contract and integration rules

Before frontend and backend implement beyond scaffolding, agree on docs/API_CONTRACT.md. It is the interface agreement, not an optional note.


### Contract must define

- Authentication approach and session/cookie behavior.

- All shared enums: order statuses, event types, actor types, reason codes, ledger types.

- Endpoint method/path, auth requirements, request schema, success response, errors, and pagination/filter behavior.

- Standard error shape with stable machine-readable code and human-readable message.

- QR token creation, token purpose, expiry, and public endpoint response fields.

- OTP development behavior versus production provider behavior.

- Reward eligibility and idempotency rule.

- Report date/time zone, rate denominator, and CSV columns.

- Environment variables and local setup.


### API endpoint families (proposal)

- POST /api/auth/login, POST /api/auth/logout, GET /api/auth/me

- GET /api/dashboard/summary

- GET /api/orders, POST /api/orders, GET /api/orders/:id

- POST /api/orders/:id/dispatch or an explicitly documented status-transition endpoint

- GET /api/delivery/:token and POST /api/delivery/:token/attempt

- GET /api/customer/:token, POST /api/customer/:token/request-otp, POST /api/customer/:token/verify-otp

- POST /api/customer/:token/decision

- POST /api/orders/:id/redelivery-request where seller authorization is required; customer token flow may use its own scoped endpoint

- GET /api/orders/:id/events

- GET /api/rewards/ledger and GET /api/rewards/summary

- GET /api/notifications

- GET /api/reports/monthly and GET /api/reports/monthly.csv

These are proposed route families, not permission to build conflicting alternatives. Finalize exact routes and schemas in API_CONTRACT.md before parallel implementation. Never invent a route in the frontend to compensate for a missing backend route.


## 11. Quality, security, and acceptance criteria


### Functional acceptance checks

- A seller can sign in, create an order, see it in the order list, and open its detail page.

- Every order has two distinct QR tokens with distinct purposes and destinations.

- A QR scan alone never marks an order delivered.

- Delivery actions are blocked when status/token/permissions make them ineligible.

- Customer verification, decision, and redelivery requests are recorded in the event timeline.

- Invalid transitions and unauthorized cross-seller access are rejected by the backend.

- A qualifying delivery produces exactly one ₹5 internal ledger credit, including when the request is retried.

- A non-qualifying event produces no credit.

- Dashboard and monthly report totals reconcile with persisted orders/events.

- CSV export opens correctly and matches the selected date range.

- Demo/manual integrations are clearly labelled and do not claim real courier, SMS, GPS, or payout capability.

- The main workflows work on mobile viewport and desktop.

- No console errors, TypeScript errors, failed migrations, or failing required tests remain.


### Testing expectations

- Unit tests for transition rules, QR token purpose/expiry, reward eligibility/idempotency, reason validation, and report calculations.

- API/integration tests for seller ownership, invalid tokens, invalid transitions, OTP throttling, duplicate submissions, and event creation.

- Frontend tests or practical browser checks for login, create order, order details, QR views, customer actions, and error/empty states.

- Run formatter/linter, typecheck, tests, migrations, and production build; fix root causes rather than suppressing errors.

- If a command cannot run due to missing environment/services, report the exact blocker and the command needed; do not claim it passed.


## 12. Parallel Codex execution plan


### Recommended sequence

1. Coordinator chat: inspect the existing repository, map current files and scripts, identify stack constraints, and create docs/UNLOSS_MASTER_REFERENCE.md plus docs/API_CONTRACT.md. Do not start large feature implementation until the contract is stable.

1. Backend chat: own backend implementation and database schema. First return an architecture/repo assessment and proposed contract changes; then implement backend vertical slices.

1. Frontend chat: own frontend implementation. First inspect the repository and read the same master reference and API contract; then implement the UI and typed API client against the agreed contract.

1. Integration owner: reconcile types/routes, run the whole application, execute migrations/seeds/tests/build, and fix integration issues.

1. Final review: test acceptance criteria end-to-end, update README, remove misleading mock data, and provide a concise completion report with known limitations.


## 13. Copy-ready prompt: Coordinator / repository owner

Paste this into the primary Codex chat. Attach or place this reference in the repository.

You are the TECH LEAD AND INTEGRATION OWNER for UNLOSS. Read docs/UNLOSS_MASTER_REFERENCE.md completely before coding. This file is the product source of truth. Do not silently change product rules.

FIRST: inspect the existing repository, current branch, package manager, directory structure, existing code, scripts, tests, environment examples, and current working state. Do not overwrite working code or restructure the project without a reason. Report the architecture and the smallest safe implementation plan.

THEN:
1. Create/maintain docs/API_CONTRACT.md and docs/DECISIONS.md. Finalize shared enums, status transitions, auth behavior, endpoint schemas, error shape, QR token purposes, OTP behavior, reward eligibility/idempotency, report definitions, and CSV columns before the two workstreams diverge.
2. Split ownership cleanly: backend owner edits apps/api/ and backend database/migrations/tests; frontend owner edits apps/web/ and frontend tests. You own contract docs, shared types/interfaces if applicable, root scripts, and integration. Avoid simultaneous edits to the same files.
3. Keep scope limited to the MVP in the master reference. No AI, live GPS, real courier APIs, real SMS, or real payouts unless explicitly configured.
4. Ensure every UI action is connected to a real endpoint or is clearly labelled as demo-only. Never fabricate metrics, status updates, location, delivery proof, or external integration.
5. Integrate vertical slices incrementally: auth + shell; create/list/detail order; separate QR workflows; customer verification and delivery outcome; return/redelivery; reward ledger; reports/CSV.
6. After each slice, run relevant tests and fix root causes. At completion run migrations, seed, lint/format, typecheck, tests, and production builds for both apps.
7. Verify all acceptance criteria in the master reference. Update README with exact setup commands and environment variables. Report what is implemented, what tests actually passed, and any remaining blockers.

Do not claim a command or feature works unless you ran or verified it. If the current repository conflicts with this reference, explain the conflict and propose the smallest safe resolution before changing architecture.


## 14. Copy-ready prompt: Backend owner

Use in the second Codex chat. Provide the same reference file and API_CONTRACT.md.

You are the BACKEND OWNER for UNLOSS. Read docs/UNLOSS_MASTER_REFERENCE.md and docs/API_CONTRACT.md completely before implementing features. The master reference defines product rules; the API contract defines the interface. If a requirement is ambiguous or the contract conflicts with the master reference, stop and document the question rather than inventing behavior.

OWNERSHIP: backend application, Prisma schema/migrations/seed, backend tests, backend environment configuration, and backend-specific documentation. Do not edit frontend files. Do not change shared API routes/types silently. Propose contract changes to the integration owner and update the contract only after agreement.

FIRST RESPONSE: inspect the repository and report current backend structure, runtime, package manager, database status, existing scripts/tests, missing environment variables, and a staged implementation plan. Preserve useful existing code.

IMPLEMENT:
1. Auth/session handling with secure cookies and seller ownership checks.
2. Database models for sellers/users as needed, orders, purpose-specific QR tokens or token hashes, append-only order events, OTP challenges, reward ledger, and notifications.
3. One authoritative transition service validating all status changes; invalid transitions must return a stable API error.
4. Order create/list/detail, filtering/pagination, and dashboard aggregation.
5. Separate delivery and customer token flows. Tokens must be high entropy, purpose-specific, expiring/revocable as appropriate, and must not expose private data. A QR scan must not mark an order delivered.
6. Customer OTP with safe development-only behavior, expiry, attempt limits, and rate limiting. Do not claim real SMS delivery unless configured.
7. Delivery attempt outcome and customer accept/reject/redelivery actions; persist each valid action to the event timeline with actor/source/reason.
8. Structured return reasons and clear last-confirmed-status handling. Do not assign fault automatically.
9. ₹5 ledger credit only under the documented eligibility rule. Store amount as integer paise, add a uniqueness/idempotency guard, and test duplicate submissions. No payout/withdrawal.
10. Notifications and monthly report/CSV using documented date-range, denominator, and privacy rules.
11. Clearly labelled demo/manual integration mode. Do not invent courier APIs, live GPS, SMS, or payment functionality.
12. Validation, standard error responses, logging that avoids secrets/OTP values, migrations, seed data, unit tests, and API/integration tests.

WORK METHOD: implement in small vertical slices and keep the API contract accurate. After each slice run relevant tests. Before finishing run formatter/linter, typecheck, all backend tests, and migrations against the available database. Fix the root cause of failures; do not disable tests or hide errors.

DONE MEANS: frontend can use the documented contract without guessing; ownership/security rules are tested; QR purposes are isolated; state transitions are enforced; reward credit is idempotent; reports reconcile; README/environment instructions are accurate. End with files changed, commands run, actual results, and remaining limitations.


## 15. Copy-ready prompt: Frontend owner

Use in the third Codex chat. Provide the same reference file and API_CONTRACT.md.

You are the FRONTEND OWNER for UNLOSS. Read docs/UNLOSS_MASTER_REFERENCE.md and docs/API_CONTRACT.md completely before implementing features. The master reference defines product rules; the API contract defines the actual endpoints and schemas. Never invent backend routes, statuses, response fields, or security behavior.

OWNERSHIP: frontend application and frontend tests. Do not edit backend/Prisma files. Do not change API_CONTRACT.md or shared types without agreement from the integration owner.

FIRST RESPONSE: inspect the repository, current frontend framework, package manager, routes, components, styling, scripts, tests, and existing design system. Report the current structure and a staged plan. Preserve useful existing code.

TECHNICAL DIRECTION: use the repository's established stack if sound; otherwise use React + Vite + TypeScript + Tailwind CSS, React Router, TanStack Query, React Hook Form, Zod, and Lucide. Centralize API access in a typed client, keep secrets out of the browser, and use environment-based API URLs.

DESIGN: use Wikimedia Codex as a reference (https://doc.wikimedia.org/codex/latest/) for clear hierarchy, restrained colors, accessible components, and consistent interaction patterns. Do not copy Wikimedia branding. Build a polished, responsive operational tool—not a generic gradient-heavy SaaS landing page. Ensure keyboard support, visible focus, accessible labels, contrast, and useful validation.

BUILD THESE SCREENS/WORKFLOWS:
1. Seller sign-in and session state.
2. App shell/navigation and dashboard populated from backend data.
3. Orders list with search/filter/pagination and useful loading/empty/error states.
4. Create order form with validation.
5. Order details with current status, safe order summary, event timeline, return/redelivery details, and clearly labelled QR sections.
6. Delivery QR workflow showing allowed action and eligibility; scanning alone must never display a completed delivery.
7. Customer QR page with minimal data, OTP flow, accept/reject and redelivery actions according to the contract.
8. Return/failure reason selection with optional note and clear source labels.
9. Internal ₹5 reward ledger, explicitly not a payout wallet.
10. Notifications and monthly report/CSV export.
11. Print-friendly layout with two separately labelled QR codes and scanning instructions.

IMPLEMENTATION RULES:
- Read the API contract and create typed request/response definitions. Use actual backend data.
- If an endpoint is not ready, isolate any temporary mock behind a clearly named development-only adapter and do not present it as live. Prefer an explicit empty/error state until integration is available.
- Backend is authoritative for status transitions, QR eligibility, OTP verification, and reward eligibility. Never calculate or award a reward solely in the frontend.
- Every button must work or be clearly disabled with a reason. Prevent duplicate submits and show success/error feedback.
- Handle session expiry, network failures, validation errors, and unauthorized access gracefully.
- Do not put personal data or secret tokens in logs, analytics, or unrelated page URLs.
- Make tables usable on narrow screens and make the print view readable.

TEST: typecheck, lint, production build, and available frontend tests. Test the main workflows at desktop and mobile widths. Fix root causes instead of suppressing errors. Do not claim tests passed unless run.

DONE MEANS: a cohesive accessible UI integrated with the documented API, no dead controls, no fabricated delivery proof or metrics, no frontend-owned business rules, and a clear list of unfinished endpoints/blockers.


## 16. Copy-ready prompt: Integration and QA pass

You are the INTEGRATION AND QA OWNER for UNLOSS. Read docs/UNLOSS_MASTER_REFERENCE.md, docs/API_CONTRACT.md, and README.md. Inspect the actual repository state before making changes.

Your job is not to redesign the product or add features. Integrate the existing frontend and backend, identify mismatches, and make the smallest safe fixes.
1. Verify environment variables, package scripts, database connectivity, migrations, seed data, CORS/cookies, API base URL, and local startup instructions.
2. Compare every frontend API call to the contract and backend implementation. Fix mismatched routes, enums, request bodies, response fields, and error handling at the correct owner layer.
3. Run formatter/linter, typecheck, tests, migrations, and production builds. Record the exact commands and results.
4. Test end-to-end: login; create order; list/detail; generate and scan both distinct QR codes; attempt invalid QR/status combinations; customer OTP and decision; delivery attempt; return/redelivery; exactly-once ₹5 ledger credit; dashboard/monthly report/CSV; seller isolation; mobile layout.
5. Confirm that QR scan alone never marks an order delivered, demo behavior is labelled, and no fake GPS/courier/SMS/payout claims appear.
6. Fix actual root causes. Do not delete tests, disable validation, cast away errors without explanation, or replace broken integrations with hidden fake data.
7. Update README and docs with known limitations and exact setup/test commands.
Finish with a table of checks, status (pass/fail/not run), evidence/command, and remaining blockers. Be honest about anything not tested.


## 17. Efficient usage to reduce Codex waste

- Attach this same reference file in every workstream and tell Codex to read it before coding.

- Do not paste the full master specification into every prompt repeatedly if the file is available in the repository; use the short workstream prompt plus explicit file paths.

- Ask for a repository assessment and API contract first. Avoid having two chats make independent architectural choices.

- Use one owner per folder and one owner for shared contract/types. Do not let both chats edit the same files simultaneously.

- Implement vertical slices and test after each slice rather than asking for the entire app in one giant pass.

- Ask Codex to inspect errors, identify root causes, and fix them; require actual command output before claiming success.

- Do not add features merely because they sound impressive. If a feature is outside MVP, list it under future scope instead.

- Use a separate Git branch/worktree per workstream when editing the same repository could cause collisions; merge only after contract and tests are aligned.


## 18. Required handoff report

Every workstream must end with:

- Files created/changed.

- Implementation completed versus intentionally deferred.

- Commands actually run and their pass/fail results.

- Database migration/seed status if applicable.

- API contract changes and reasons.

- Known bugs, blockers, or assumptions.

- Exact steps to run locally.

- Confirmation that no unsupported external integration was represented as real.


## 19. Future scope — only after MVP is stable

Potential future options include official courier integrations, verified SMS/WhatsApp provider, signed delivery evidence with consent and privacy review, configurable reward policy, seller team roles, advanced cohort analytics, and operational exports. These are not part of the MVP unless explicitly prioritized and technically supported.

Privacy note: if future versions collect photos, location, signatures, or customer identity documents, perform a separate privacy/security review, obtain appropriate consent, minimize retention, and document access controls before implementation.


## 20. Final instruction to any Codex workstream


> How to use this file
  Keep this document in the repository as docs/UNLOSS_MASTER_REFERENCE.md (or attach it to both Codex chats). Treat it as the product source of truth. Give each workstream its dedicated prompt from Section 12; do not ask both chats to build the entire application independently.


> Important
  Parallel work is effective only when both chats share this same reference and agree on the API contract. Separate chats do not automatically share reasoning or messages. Use separate branches/worktrees if they might edit the same checkout concurrently.


> Source-of-truth rule
  This reference and the agreed API contract take precedence over guesses. If a requirement is unclear, state the ambiguity and ask the integration owner. Inspect before modifying, preserve working code, make small testable changes, and report only verified results.

---

**Product source of truth. Use together with `docs/API_CONTRACT.md`.**
