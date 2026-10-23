# Frontend QA and integration handoff

## Automated scope

The frontend suite uses jsdom and mocked HTTP fixtures. Tests cover application mounting, seller session restore/retry/login/logout/expiry, safe navigation, orders/search/pagination/validation, duplicate-submit states, transition failure, chronological event labels, two QR matrices decoded by an independent QR decoder, OTP/customer decisions, partner consent/review/activation/deletion, demo permission/expiry/replay rules, reporting/CSV and list pagination. Synthetic-rule tests do **not** demonstrate backend enforcement.

Axe structural checks run on the order form and partner consent flow. Color contrast is disabled in those jsdom checks because jsdom does not render layout; contrast, screen reader behavior, touch target geometry and visual layout still need browser verification. The CSS includes visible focus, labelled controls, responsive grids, scrollable tables, mobile navigation focus handling, reduced-motion behavior and print rules, but CSS inspection is not a browser pass.

QR tests rasterize the generated SVG module paths and decode both images with `jsqr`, checking exact purpose-specific URLs. Printed-size/phone-camera scanning still needs physical testing.

## Browser acceptance checklist — not yet executed

Browser access to the local preview origin was denied in the earlier session. No alternate browser/HTTP automation was used to bypass that denial. These checks remain open:

- Desktop (1440px), mobile (390px and 320px), and 200% zoom: navigation, forms, long names/notes, tables, reports, consent/review and error layouts.
- Keyboard: skip link, mobile navigation trap/escape/return focus, search, pagination, forms, visible errors and route focus. Screen reader names/status announcements.
- Seller with real backend: login → create → print both codes → detail → dispatch → search/filter/page → return/redelivery → inspect source-labelled history → logout/session expiry.
- Two seller accounts: URL guessing never exposes another seller's orders, events, reports or rewards. This requires backend/API tests too.
- Customer/delivery after backend fixes: invalid/wrong-purpose/expired/out-of-state QR, OTP wrong/expired/throttled, accept/reject/reason/redelivery, active/approved partner required, no completion by scan, exactly one eligible credit under retries/concurrency.
- Demo: consent → synthetic contact → letter/badge → simulated failure → manual reviewer reason/approval → activation; customer OTP acceptance → delivery handoff → ₹5 **simulated** ledger; deactivation blocks delivery; reset/withdrawal deletes in-memory data.
- Reports: persisted activity reconciles with JSON and CSV; month boundary around midnight Asia/Kolkata, zero denominator, repeated dispatches, customer redelivery and failure outcomes.
- Print/PDF: navigation hidden, both separately labelled black/white QR images legible, full destination and concise instructions, no clipping; decode with a phone at actual printed size.
- Production build: `/demo` absent by default; direct routes served by SPA fallback; `/api` proxied; login cookies and origin checks work; production OTP never displayed. Opt-in demo deployment must retain all demo labels.

## Services needed

The frontend can run at `/demo` in development without the API. Real seller workflows require the existing backend, PostgreSQL, environment secrets and seed/migrations. Public writes and live partner identity additionally require the fixes and contract agreement in [BACKEND_DEPENDENCIES.md](BACKEND_DEPENDENCIES.md). Do not claim live integration completion from mocked tests alone.
