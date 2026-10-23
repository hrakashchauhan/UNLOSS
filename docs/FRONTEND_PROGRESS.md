# UNLOSS frontend progress

Updated: 23 October 2026. Source of truth: `UNLOSS_Master_Build_Reference_and_Parallel_Codex_Guide.md` and `docs/API_CONTRACT.md`.

## Repository assessment

- React/Vite/TypeScript and Lucide were present. One 30 KB, densely written `main.tsx` contained all screens. React was never mounted, so the successful baseline build emitted a 1.69 KB JS bundle and a blank page.
- Seller, order, delivery/customer, reward, notification, and report screen code existed. Their runtime behavior was unverified. The frontend expected nested order fields while Prisma responses use flat fields. `/api` had no Vite proxy. There were no frontend tests or lint script.
- Placeholder QR graphics were not scannable; public delivery/customer actions did not respect server eligibility and delivery POST returned a full private order. Dashboard used nonexistent response fields and a hardcoded date. The shell showed unsupported system status and dead help/privacy/support links.
- At the initial audit the repo had no commits. Foundation/authentication were subsequently committed as `6e7e0fc` on `main` and pushed to private `hrakashchauhan/UNLOSS`. Backend files remained untracked and were not included in that frontend checkpoint.

## Master-reference checklist by phase

| Phase | Requirements and current state |
| --- | --- |
| 1 Foundation | **Implemented:** React mount, explicit routes and unknown-route page, seller/public shell separation, shared status/feedback/pagination components, error boundary, blue/neutral design tokens, accessible focus and navigation controls, typed order adapter, API error handling, Vite proxy, frontend tests/lint/configuration. Browser layout and real API integration remain unverified. |
| 2 Authentication | **Implemented:** session restoration, `/login`, protected-route redirects with safe return path, login and logout pending/error states, retry when session check cannot reach the API, and seller-data 401 handling. Backend still owns actual session and seller isolation. Live API verification remains pending. |
| 3 Dashboard/orders | **Frontend implemented:** typed persisted counts, current status drill-down, recent orders, search/filter/URL pagination, refresh/retry/empty/error states, trimmed creation validation, duplicate-submit protection, detail refresh and chronological history. Mocked contract tests pass; actual persisted API workflow remains unverified. |
| 4 QR | **Frontend implemented:** distinct purpose-specific SVG QR images, exact-link decoding tests, copy feedback, one-time creation sheet, full destination and print rules, invalid/expired public link feedback. API reissue absent; physical print/phone scan unverified; backend eligibility fixes pending. |
| 5 Delivery/customer | **Forms and adapters implemented, live writes BLOCKED:** request/resend OTP, cooldown, expiry, verify, accept/reject/reasons/redelivery, delivery outcomes, confirmations, pending/error/success. Work in explicit isolated synthetic demo. Live gate stays off until backend privacy/state/partner authorization is fixed; no invented endpoints or fabricated provider. |
| 6 Returns/events | **Frontend implemented:** return/redelivery queue, contract-based seller next steps, required reasons for returns/redelivery/cancellation, optional note, last confirmed status, refresh, oldest-first events with actor/source/reason/timestamp. Never offers seller verified completion. Backend actor enforcement still required. |
| 7 Rewards/reports | **Frontend implemented:** paginated ledger/notifications, truthful internal ₹5 labels, monthly report, exclusive-end display correction, zero denominator and event-count explanation, validated CSV download with pending/error/success. Notification production and report event reconciliation require backend fixes. |
| 8 Final QA | **Automated frontend checks passed; live acceptance incomplete:** 45 tests, typecheck/lint/build, independent QR decode and axe structural checks. Browser/mobile/zoom/print/cross-seller/persisted integration remain unverified. Exact checklist and blockers documented. |
| Addendum | **Synthetic partner journey implemented:** explicit consent/privacy, fictional contact/employer/ID, evidence selection, simulated provider failure, manual reviewer reasons, revision/rejection/approval, active/inactive state, audit history and deletion. No real document uploads or official identity/UIDAI claims. Live partner contract/backend unimplemented. |

## Phase 1 files and changes

- `apps/web/src/main.tsx`, `App.tsx`, `features/public/PublicFlow.tsx`, `ui/common.tsx`, `ui/AppErrorBoundary.tsx`: startup, routing, shell, read-only public preview, shared UI, recovery page and truthful controls.
- `apps/web/src/api.ts`: flat-order normalization, typed interfaces and endpoint wrappers, cookie transport, cancellation, common error envelope, CSV and 204 handling.
- `apps/web/src/foundation.css`, `vite.config.ts`, `.env.example`, `package.json`, lockfile, `eslint.config.js`: tokens, keyboard focus, dev proxy, configuration, lint and tests.
- `apps/web/src/*.test.*`: startup, routing, public disabled state, pagination and API boundary tests.
- `docs/API_CONTRACT.md`, `README.md`, this file: exact order/dashboard response shape and setup/progress notes.

## Checks actually run

| Command | Result |
| --- | --- |
| Baseline `npm.cmd --prefix apps/web run typecheck` | Passed; did not detect missing mount. |
| Baseline `npm.cmd --prefix apps/web run build` | Passed; emitted 1.69 KB JS without the app. |
| Phase 1 `npm.cmd --prefix apps/web test` | Passed: 10 tests in 3 files. |
| Phase 1 `npm.cmd --prefix apps/web run typecheck` | Passed. |
| Phase 1 `npm.cmd --prefix apps/web run lint` | Passed. |
| Phase 1 `npm.cmd --prefix apps/web run build` | Passed; emitted 298.40 KB JS including React and the app. |
| Baseline `npm.cmd --prefix apps/api test` | Passed: 4 backend rule tests. |
| Baseline `npm.cmd --prefix apps/api run typecheck` | Passed. |
| Baseline `npm.cmd --prefix apps/api run lint` | Failed: four pre-existing errors in `src/server.ts`. |

## Dependencies and unverified behavior

- No `apps/api/.env`, database URL, running PostgreSQL, or API was configured during this phase. Login and persisted-data workflows could not be tested end to end.
- Browser access to `http://127.0.0.1:5173` was denied by the browser approval gate. No visual, mobile, zoom, keyboard-in-browser, console or practical workflow check was completed. The test suite uses jsdom only.
- Backend must reject seller `DELIVERED_VERIFIED` transitions without verified handoff, validate customer decisions against status, enforce delivery GET eligibility, and return public-safe fields from delivery POST. The frontend hides/pauses affected controls but cannot enforce these security rules.
- Current API has no real courier, SMS, GPS, or payout integration. Demo OTP requires `DEMO_MODE=true` and is for local testing only. No unsupported integration is represented as live.

## Phase 2 authentication checkpoint

- Changed `apps/web/src/App.tsx` to route seller pages through a persistent auth provider and show logout progress/errors in the shell. Added `apps/web/src/features/auth/Auth.tsx` for session restoration, login, logout, protected routes, safe return navigation and API retry.
- Changed `apps/web/src/api.ts` to notify the auth provider when a seller API call returns 401. Public token errors and invalid login credentials do not expire the seller session. Added `apps/web/src/features/auth/Auth.test.tsx` for network failure/retry, login, duplicate submission prevention, invalid credentials, logout failure/success, and session expiry.
- Added `*.tsbuildinfo` to `.gitignore`; the existing generated TypeScript cache remains on disk but is excluded from the checkpoint.
- `npm.cmd --prefix apps/web test`: **15 passed in 4 files**. `npm.cmd --prefix apps/web run typecheck`: **passed**. `npm.cmd --prefix apps/web run lint`: **passed**. `npm.cmd --prefix apps/web run build`: **passed** (301.86 KB JS).
- End-to-end authentication against PostgreSQL/API remains unverified because local backend environment and database are not configured. The browser origin approval gate previously denied the local preview, so visual/mobile testing also remains unverified.

## Continuation: phases 3–8 and delivery-partner addendum

The user's latest instruction approved work across all remaining frontend phases. During this continuation the user explicitly selected **“Keep backend files unchanged; document dependencies.”** Backend source has therefore not been edited, staged or committed. No live integration completion is claimed.

### Files and corrections

- `features/orders/Orders.tsx`, `QrSheet.tsx`: extracted existing order screens into maintainable feature modules; validated create, URL-based queries and pagination, return/redelivery workflow, status errors, chronological timelines and real QR/print sheet. `qrcode.react` is the single new runtime dependency.
- `features/reports/Reporting.tsx`: API-driven dashboard, complete paginated ledger/notification states, report definitions/date boundaries and CSV export. No fabricated balances, analytics or read-status controls.
- `features/public/PublicFlow.tsx`, `workflowApi.ts`: complete customer/delivery form state machines and exact contract route adapters. Live writes remain visibly unavailable; the release gate is not a backend security mechanism.
- `features/demo/store.ts`, `PartnerDemo.tsx`: isolated in-memory synthetic journeys, demo-only permission checks, proof expiry/consumption, one simulated eligible credit, partner audit/review/activation/deletion. No API calls or persistent storage in demo. These rule tests do not establish real backend correctness.
- `App.tsx`, `features/auth/Auth.tsx`, `config.ts`, `features/settings/Settings.tsx`: routes/navigation, settings/availability, production demo opt-in, safe redirect hardening, mobile focus trap/Escape/resize and route focus. Auth behavior retained.
- `api.ts`, `domain.ts`, `ui/useResource.ts`, `ui/ResourceState.tsx`: typed report/ledger/notification shapes, seller transition adapter, cancellation/stale-response protection and shared retry state.
- `foundation.css`: consistent readable forms/statuses, focus, table overflow, responsive/print layouts, restrained visual direction. No framework migration. Design concepts/selection documented in `FRONTEND_DESIGN.md`.
- Tests: auth/routing plus new order/QR, public, demo, reporting, resource race, configuration and accessibility suites. `axe-core` and `jsqr` are test-only dependencies.
- `.env.example`, README and contract implementation notes; `BACKEND_DEPENDENCIES.md`, `PARTNER_VERIFICATION_PROPOSAL.md`, `FRONTEND_QA.md` describe the precise remaining work without inventing an agreed API.

### Actual verification

| Command/check | Result |
| --- | --- |
| `npm.cmd --prefix apps/web test` | **45 passed in 11 files**. One earlier new test incorrectly reused a consumed Response body; corrected the fixture and its TypeScript signature, then reran. |
| `npm.cmd --prefix apps/web run typecheck` | Passed after correcting that test signature. |
| `npm.cmd --prefix apps/web run lint` | Passed. |
| `npm.cmd --prefix apps/web run build` | Passed on the final code: 335.90 KB JS / 18.44 KB CSS (105.37 / 5.04 KB gzip); default production demo routes disabled. |
| QR test | Both rendered SVG matrices decoded to the exact delivery/customer URLs by `jsqr`. Physical print scanning unverified. |
| Axe structural tests | Order form and partner consent: zero reported structural violations. Color contrast disabled because jsdom does not render; not a visual-accessibility pass. |
| `npm.cmd --prefix apps/web audit --omit=dev` | **0 vulnerabilities reported**. This dependency audit is not a security guarantee. |
| `npm.cmd --prefix apps/api test` | **4 passed** (existing rule tests; not API integration). |
| `npm.cmd --prefix apps/api run typecheck` | Passed. |
| `npm.cmd --prefix apps/api run lint` | **Failed: 4 unchanged errors** in `src/server.ts`: unused `createHash`, `reportMonthBounds`, `graph`; `prefer-const` for `to`. Left unchanged per ownership instruction. |

### Definition-of-done comparison and omissions

All remaining frontend areas have implementations and automated checks. Complete production acceptance is **not achieved**: no configured PostgreSQL/API, no live partner/provider backend, public-write security/integration defects, notification generation/report reconciliation gaps, and no browser/physical-print pass. These are not hidden by synthetic data. The default frontend uses real API data; only explicit demo routes use isolated fiction. Production public writes remain blocked, and partner identity remains synthetic only.

The backend owner must resolve `BACKEND_DEPENDENCIES.md`, agree the partner contract and run service integration tests. Then connect/enable the real forms and execute `FRONTEND_QA.md`. Existing untracked backend work needs its own reviewed checkpoint by its owner; this frontend commit deliberately excludes it.

Final review: `git diff --check` passed. Reviewed intended frontend/docs files for credential patterns, non-template environment files and files over 2 MB: no findings. Generated dependencies/build output/TypeScript caches remain ignored. GitHub target verified as private `hrakashchauhan/UNLOSS`, branch `main`; prior local and remote checkpoint matched before the new commit. This scan does not replace a comprehensive security review.
