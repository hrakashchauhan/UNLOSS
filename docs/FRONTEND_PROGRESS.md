# UNLOSS frontend progress

Updated: 23 October 2026. Source of truth: `UNLOSS_Master_Build_Reference_and_Parallel_Codex_Guide.md` and `docs/API_CONTRACT.md`.

## Repository assessment

- React/Vite/TypeScript and Lucide were present. One 30 KB, densely written `main.tsx` contained all screens. React was never mounted, so the successful baseline build emitted a 1.69 KB JS bundle and a blank page.
- Seller, order, delivery/customer, reward, notification, and report screen code existed. Their runtime behavior was unverified. The frontend expected nested order fields while Prisma responses use flat fields. `/api` had no Vite proxy. There were no frontend tests or lint script.
- Placeholder QR graphics were not scannable; public delivery/customer actions did not respect server eligibility and delivery POST returned a full private order. Dashboard used nonexistent response fields and a hardcoded date. The shell showed unsupported system status and dead help/privacy/support links.
- The repo is on `main` with no commits. All project files are untracked. Existing work was preserved.

## Master-reference checklist by phase

| Phase | Requirements and current state |
| --- | --- |
| 1 Foundation | **Implemented:** React mount, explicit routes and unknown-route page, seller/public shell separation, shared status/feedback/pagination components, error boundary, blue/neutral design tokens, accessible focus and navigation controls, typed order adapter, API error handling, Vite proxy, frontend tests/lint/configuration. Browser layout and real API integration remain unverified. |
| 2 Authentication | **Implemented:** session restoration, `/login`, protected-route redirects with safe return path, login and logout pending/error states, retry when session check cannot reach the API, and seller-data 401 handling. Backend still owns actual session and seller isolation. Live API verification remains pending. |
| 3 Dashboard/orders | Existing views. Pending: complete real-data workflow validation, search/filter/pagination states, validated creation and chronological detail verification. Dashboard now uses existing persisted summary keys; list/detail/create use flat-order mapping. |
| 4 QR | Backend creates distinct links once; UI shows real purpose-specific links without fake QR art. Pending: scannable codes, eligibility/expiry states, print sheet with both codes, and backend public-token fixes. |
| 5 Delivery/customer | Public link preview is read-only. Actions are visibly disabled until backend validates eligibility, transitions, and public response privacy. Pending OTP, outcomes, structured reasons, customer decisions, redelivery actions. |
| 6 Returns/events | Existing seller transition and timeline view. Only initial dispatch/cancel controls remain exposed for now. Pending return/redelivery handling, reason/source labels across complete workflows, last confirmed status. |
| 7 Rewards/reports | Existing API-driven pages. Ledger is now labelled internal; report CSV route exists. Pending data reconciliation, pagination, notification behavior, date/rate verification and export check. |
| 8 Final QA | Pending desktop/mobile/zoom browser checks, full integration, accessibility review, cross-seller checks and final acceptance comparison. |

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

Stop at the Phase 2 gate. On “continue,” begin Phase 3 and fix any earlier regressions first.
