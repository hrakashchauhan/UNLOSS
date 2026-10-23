# UNLOSS deployment and verification

Updated: 24 October 2026 (Asia/Calcutta).

This replaces the earlier demo walkthrough. The requested target is a real-user service; simulated Google login and browser-displayed OTPs must not be used as real verification.

## Deployment record

- Repository: https://github.com/hrakashchauhan/UNLOSS (main).
- Frontend: https://unloss-web.vercel.app — Vercel project `unloss-web`, root `apps/web`, Vite, build `npm run build`, output `dist`.
- Backend: https://unloss-api.onrender.com — Render service `unloss-api`, root `apps/api`.
- Database: existing Supabase project `pmzjwuouygbgjvylpifq`, Singapore.
- Database connection verified; public schema was empty before deployment. All six versioned Prisma migrations applied successfully. No demo seed was applied to this database.
- Google project: `unloss-parcel-verification`. OAuth branding and web client created with owner approval.
- OAuth client ID: `139401934145-t0iuiterjuba0hf2ncnmt8fuhb94sq33.apps.googleusercontent.com` (public identifier).
- Application changes: `b183ddc`; approved privacy notice: `29d0318`; successful backend deployment with bounded database connections: `5df250a`.
- Frontend deployment and live privacy notice verified HTTP 200. Backend readiness and password/session checks passed through the production URLs.

## 1. Database

Use the Supabase **session pooler** (IPv4-compatible):

```text
postgresql://postgres.pmzjwuouygbgjvylpifq:<URL_ENCODED_PASSWORD>@aws-0-ap-southeast-1.pooler.supabase.com:5432/postgres?sslmode=require
```

Store the real URL only in Render's secret environment settings. Do not commit it or put it in frontend variables. The existing password worked; it was not reset.

For future releases, review migration SQL, inspect the target database and run `npm run db:migrate` from `apps/api` with the intended DATABASE_URL. This runs `prisma migrate deploy`. Do not use `db push` to replace managed migration history. `npm run build` generates the Prisma client.

## 2. Render backend

- Plan: existing Free web service.
- Root: `apps/api`.
- Build: `npm ci --include=dev && npm run build`.
- Start: `node dist/server.js`.
- Health-check path saved as `/health/ready`; deployment succeeded.
- Render supplies PORT; the application now respects it.

```dotenv
NODE_ENV=production
DEMO_MODE=false
API_HOST=0.0.0.0
TRUST_PROXY_HOPS=1
PRODUCTION_ENABLED=true
APP_ORIGIN=https://unloss-web.vercel.app
DATABASE_URL=<SECRET_SUPABASE_SESSION_POOLER_URL>
SESSION_SECRET=<RENDER_GENERATED_RANDOM_SECRET>
GOOGLE_CLIENT_ID=139401934145-t0iuiterjuba0hf2ncnmt8fuhb94sq33.apps.googleusercontent.com
QR_TOKEN_TTL_DAYS=90
```

The Prisma pool defaults to three connections per instance so overlapping deployments fit the shared session pooler. Two replacement starts failed before this limit was added; the subsequent deployment succeeded. Prisma startup error codes are logged without error messages or secrets.

`--include=dev` is required during the TypeScript build even when NODE_ENV is production. The original `server.js` start command was invalid. An explicit cloud opt-in, HTTPS origin, public listener and one trusted proxy hop are required. Do not set DEMO_MODE=true in production.

## 3. Vercel frontend

```dotenv
VITE_API_BASE_URL=/api
VITE_GOOGLE_CLIENT_ID=139401934145-t0iuiterjuba0hf2ncnmt8fuhb94sq33.apps.googleusercontent.com
VITE_ENABLE_DEMO=false
```

`apps/web/vercel.json` sends `/api/*` to Render and provides SPA deep links. Keep frontend API requests same-origin so secure HttpOnly SameSite=Lax cookies work. The old VITE_API_ORIGIN variable is unused. Never put a database URL, session secret or Google client secret in VITE variables.

## 4. Verified Google authentication

Authorized JavaScript origin: `https://unloss-web.vercel.app`.

The browser loads Google Identity Services and sends its credential to the backend. The backend uses Google's official library to validate signature, expiry, audience and verified email. Accounts are identified by Google's stable subject. Existing password accounts are not silently linked by matching email. Existing Google accounts cannot gain roles merely by changing a login request.

Google Audience shows **In production**, with External audience. Homepage and privacy URL are saved; https://unloss-web.vercel.app/privacy.html returns the published notice. Genuine Google sign-in verified end to end on 24 October 2026: the owner account reached the seller dashboard, a full page reload restored the authenticated session, and the live event stream connected. The stalled popup was recovered by restarting sign-in with a live parent tab, reloading the Google chooser and completing account selection. No authentication checks were bypassed.

## 5. SMS deferred by owner; courier and payments incomplete

The owner chose Google/password login and explicitly deferred SMS. Twilio Verify is the suggested managed OTP provider if SMS is added later. Its trial is limited; real production SMS is paid. Firebase phone verification also requires a billing-enabled plan. No paid plan, SMS provider account, courier API or payment provider was purchased/configured in this deployment.

Until real providers and workflow authorization are implemented and tested:

- Phone OTP sign-in returns an unavailable response outside demo mode.
- Public QR pages can be previewed; public delivery/customer mutations are disabled outside demo mode.
- Courier registrations remain pending review and do not imply verified phone ownership.
- Couriers cannot enumerate all sellers' live orders.
- Unsigned courier webhook updates and simulated payment checkout/capture are disabled outside demo mode.
- Internal reward records are not bank payouts.

Do not label browser GPS as proof that a courier physically visited an address; browser-reported coordinates are evidence supplied by the device.

## 6. Verification checklist

- [x] Supabase connection and managed schema migration.
- [x] Backend unit tests: 71 passed.
- [x] Frontend tests: 53 passed.
- [x] API and frontend TypeScript checks.
- [x] Vercel production deployment ready; direct `/login` returns HTTP 200.
- [x] Render `/health/ready` returns HTTP 200.
- [x] Proxied `/api/auth/me` returns 401 when signed out.
- [x] Registration/login sets a Secure, HttpOnly, SameSite=Lax session cookie.
- [x] Session restoration and logout invalidation verified via production HTTP requests. Temporary verification account removed afterward.
- [x] Genuine Google account sign-in, dashboard loading, session restoration after reload and live event stream verified.
- [x] Seller order/QR creation returned 201; direct customer/delivery pages returned 200. Preview APIs correctly rejected CREATED parcels (404) and returned 200 for the disposable OUT_FOR_DELIVERY fixture. Test records were removed.
- Deferred by owner: real SMS verification; production endpoint correctly returns 503.
- [ ] Customer decision and authorized courier completion verified across devices.
- [ ] Physical print layout verified.

## Provider references

- Render Node deployment: https://render.com/docs/deploy-node-express-app
- Vercel rewrites: https://vercel.com/docs/routing/rewrites
- Vercel Vite routing: https://vercel.com/docs/frameworks/frontend/vite
- Google server token verification: https://developers.google.com/identity/gsi/web/guides/verify-google-id-token
- Twilio Verify pricing: https://www.twilio.com/en-us/verify/pricing
- Firebase phone limits: https://firebase.google.com/docs/auth/limits

Free Render instances sleep when idle and can take time to wake. Check provider dashboard limits before expecting continuous availability.
