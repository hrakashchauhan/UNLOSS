# UNLOSS

UNLOSS is a seller-focused parcel delivery verification and return-tracking MVP. The master product reference is [`UNLOSS_Master_Build_Reference_and_Parallel_Codex_Guide.md`](UNLOSS_Master_Build_Reference_and_Parallel_Codex_Guide.md); the current HTTP interface is documented in [`docs/API_CONTRACT.md`](docs/API_CONTRACT.md).

## Requirements

- Node.js 20 or newer and npm.
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

Frontend work is tracked in [`docs/FRONTEND_PROGRESS.md`](docs/FRONTEND_PROGRESS.md). Phase 1 exposes public QR links as read-only previews until backend token eligibility, status validation, and public-response privacy fixes are complete. QR images, delivery/customer actions, and full print sheets remain for later phases.
