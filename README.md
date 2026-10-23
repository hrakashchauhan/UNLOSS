# UNLOSS

UNLOSS is a seller-focused parcel delivery verification and return-tracking MVP. The master product reference is [`UNLOSS_Master_Build_Reference_and_Parallel_Codex_Guide.md`](UNLOSS_Master_Build_Reference_and_Parallel_Codex_Guide.md); the current HTTP interface is documented in [`docs/API_CONTRACT.md`](docs/API_CONTRACT.md).

## Requirements

- A Node.js version supported by the installed Vite release and npm (Node 22.12+ recommended).
- PostgreSQL 15 or newer.

## Local setup

1. Install API dependencies: `npm --prefix apps/api install`.
2. Copy `apps/api/.env.example` to `apps/api/.env`. Set `DATABASE_URL` to a local PostgreSQL database and replace `SESSION_SECRET` with at least 32 random characters.
3. Generate Prisma Client and apply the migration: `npm --prefix apps/api run prisma:generate` then `npm --prefix apps/api run db:migrate`.
4. Seed the development seller: `npm --prefix apps/api run db:seed`.
5. In one terminal run `npm run dev:api`; in another run `npm --prefix apps/web install` and `npm run dev:web`.
6. Open the Vite URL (normally `http://localhost:5173`). Local seed login: `demo@unloss.local` / `Demo-Only-Change-Me-2026!`.

On Windows PowerShell, use `npm.cmd` if script execution policy blocks `npm.ps1`. The frontend defaults to `/api`; Vite proxies it to `http://localhost:3001`. Keep `APP_ORIGIN` equal to the exact browser origin used for the frontend (for example, `http://localhost:5173`). For a separately hosted frontend, set `VITE_API_BASE_URL` to the public HTTPS API URL ending in `/api` and configure the API's cookie/CORS origin accordingly. A production web server also needs to forward `/api` and serve `index.html` for frontend routes.

`DEMO_MODE=true` enables the development-only OTP disclosure. Keep it disabled outside local development. There is no real courier, SMS/WhatsApp, GPS, or money transfer integration. Rewards are internal ledger entries only.

## Commands

- `npm run build:api`, `npm run build:web`
- `npm run typecheck:api`, `npm run typecheck:web`
- `npm run test:api`
- `npm.cmd --prefix apps/web test`, `npm.cmd --prefix apps/web run lint`

## Notes

The frontend and backend are separate npm applications under `apps/`. Configure `APP_ORIGIN` in the API environment to match the Vite origin. For contract details and report calculations, see `docs/API_CONTRACT.md`.

Frontend work and actual check results are tracked in [`docs/FRONTEND_PROGRESS.md`](docs/FRONTEND_PROGRESS.md). Seller screens now cover order creation/search/filter/pagination/details, returns/redelivery, chronological events, notifications, the internal ledger, and monthly reports/CSV. Creation produces two scannable purpose-specific QR codes and a printable order sheet. Save/print it before leaving: the API exposes those links once and has no reissue endpoint.

Live public links remain read-only until the backend fixes in [`docs/BACKEND_DEPENDENCIES.md`](docs/BACKEND_DEPENDENCIES.md) are complete. Backend source was left unchanged at the user's request. No claim of working production delivery verification or identity verification is made.

## Isolated frontend demo

Run `npm.cmd --prefix apps/web ci`, then `npm.cmd --prefix apps/web run dev`, and open `/demo` on the Vite URL. No backend or seller login is required for this **synthetic** preview. Follow the links in one tab: partner consent/contact/evidence/reviewer/activation → customer demo OTP acceptance → delivery outcome. The demo records a simulated ₹5 ledger value after the qualifying handoff. Reset or withdraw consent to delete its in-memory data; refreshing also clears it.

It uses no real identity documents, government IDs, biometric data, SMS, courier integration or payouts. Demo approval cannot authorize live requests. Default production builds hide demo routes; set `VITE_ENABLE_DEMO=true` only for an intentionally labelled demo deployment. `DEMO_MODE` on the backend is a separate setting; neither setting enables real public writes in this frontend.

See [`docs/FRONTEND_QA.md`](docs/FRONTEND_QA.md) for the unexecuted real-browser/integration checklist and [`docs/PARTNER_VERIFICATION_PROPOSAL.md`](docs/PARTNER_VERIFICATION_PROPOSAL.md) for the pending partner contract.
