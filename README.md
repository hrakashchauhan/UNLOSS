# UNLOSS

UNLOSS records seller-owned orders, delivery attempts, customer decisions, returns and redelivery. It includes separate delivery/customer QR codes, an internal ₹5 ledger, notifications and monthly JSON/CSV reports. A QR scan is not proof of physical delivery.

The frontend and cumulative backend are integrated for a **local, database-backed demo**. Production deployment, real OTP delivery and official delivery-partner verification remain gated. No courier, GPS, SMS or payout integration is claimed.

Requirements: [master reference](UNLOSS_Master_Build_Reference_and_Parallel_Codex_Guide.md). Interface: [API contract](docs/API_CONTRACT.md). Evidence and remaining work: [frontend progress](docs/FRONTEND_PROGRESS.md), [backend progress](docs/BACKEND_PROGRESS.md), [integration dependencies](docs/BACKEND_DEPENDENCIES.md).

## This configured workspace

Open **http://127.0.0.1:5173**. The generated seller login is in ignored [local access instructions](.local/LOCAL_ACCESS.txt). That file and apps/api/.env stay on this computer and are never committed. There is no built-in/default password.

The API uses port 3001 and the retained PostgreSQL test installation uses port 55432. The separate databases are **unloss_local_demo** for interactive testing and **unloss_test_phase1** for automated tests. A completed **SYNTHETIC-SMOKE-*** order and one 500-paise internal demo credit were retained for inspection. This is not a payout.

If Node services have stopped, with PostgreSQL running, use two terminals from the repository root:

~~~powershell
npm.cmd run dev:api
~~~

~~~powershell
npm.cmd run dev:web
~~~

Use the exact 127.0.0.1 URL above to match APP_ORIGIN. Do not start duplicate services on occupied ports. For this machine's PostgreSQL restart command, see ignored .local/START_DATABASE.ps1. The retained database is local test infrastructure, not production hosting.

## Fresh local setup

Requirements: Node.js 22.12+ (verified with 24.19), npm and PostgreSQL 15+ (verified with 17.11). Each app has its own lockfile.

1. Run `npm.cmd --prefix apps/api ci` and `npm.cmd --prefix apps/web ci`.
2. Create a local PostgreSQL database. Copy apps/api/.env.example to apps/api/.env only if the latter does not already exist. Set DATABASE_URL, a random SESSION_SECRET of at least 32 bytes, and APP_ORIGIN=http://127.0.0.1:5173.
3. For synthetic local testing set DEMO_MODE=true, choose SEED_SELLER_EMAIL and a non-placeholder SEED_SELLER_PASSWORD of 12–72 UTF-8 bytes. Optionally set SEED_SAMPLE_ORDERS=true for three labelled synthetic orders. Seed reruns preserve existing passwords and order changes.
4. Run `npm.cmd --prefix apps/api run prisma:generate`, `npm.cmd --prefix apps/api run db:validate`, `npm.cmd --prefix apps/api run db:migrate`, then `npm.cmd --prefix apps/api run db:seed`.
5. Start both services using the terminal commands above. Sign in with your configured seed credentials.

The frontend defaults to /api; Vite proxies it to http://127.0.0.1:3001 and uses strict port 5173. Both services bind loopback. Every mutating API request requires the exact configured Origin; browser requests supply it. The API refuses NODE_ENV=production while deployment/provider/partner requirements remain incomplete. A successful frontend build does not remove that restriction.

## Try the persisted workflow

1. Sign in → Orders → Create an order using synthetic recipient data.
2. Save/print the two QR links **before leaving the creation sheet**. Links are shown once; there is no recovery/reissue endpoint.
3. Open the order and record Ready for Dispatch, then Out for Delivery. Public links become eligible according to backend state.
4. Open the customer link, request the labelled test OTP, verify it and accept. No SMS is sent. Acceptance alone does not complete delivery.
5. Open or refresh the delivery link, select Delivered Verified and confirm the demo handoff. The backend checks current acceptance, records the event, closes both links and credits the internal ledger once.
6. Refresh seller details, rewards, notifications and the monthly report. Export CSV. For returns, use a separate order, record failure/rejection, then permitted return/redelivery steps and reasons.

The customer/delivery pages and seller shell show a **database-backed demo** banner, including on printed seller pages. Local delivery is authorized by a narrowly scoped QR token; it does not authenticate official partner identity. Manual/production public forms remain disabled.

## Isolated partner/UI demo

Development also exposes /demo without seller login. It uses synthetic data in memory, never the API: consent → fictional contact → synthetic evidence → reviewer decision → activation, then customer/delivery simulations. Refresh/reset/withdrawal clears this data. No real identity upload, government ID or biometric collection is enabled.

Default production web builds hide these routes. VITE_ENABLE_DEMO=true explicitly opts into an isolated demonstration build. Backend DEMO_MODE is separate; browser demo approval never authorizes backend operations.

## Checks

~~~powershell
npm.cmd --prefix apps/web test
npm.cmd --prefix apps/web run lint
npm.cmd --prefix apps/web run typecheck
npm.cmd --prefix apps/web run build
npm.cmd --prefix apps/api test
npm.cmd --prefix apps/api run lint
npm.cmd --prefix apps/api run typecheck
npm.cmd --prefix apps/api run build
npm.cmd --prefix apps/api run test:integration
npm.cmd --prefix apps/api run test:frontend -- "D:\path\to\UNLOSS\apps\web"
~~~

Database tests require an explicitly migrated loopback database named unloss_test_* in TEST_DATABASE_URL. They clean only their synthetic fixture rows. Never point tests at real user data. The adapter test uses real HTTP/PostgreSQL with a Node cookie/Origin shim; it is not a browser test.

Current results: **49 frontend tests, 62 backend unit tests, 95 database integration tests**, actual adapter workflow and local compiled API smoke passed. Both apps' lint/typecheck/build passed; dependency audits reported zero vulnerabilities. Desktop/mobile/zoom/keyboard/visual/physical-print acceptance remains unverified because browser-tool access is blocked. Follow [the remaining QA checklist](docs/FRONTEND_QA.md) once that permission is available.
