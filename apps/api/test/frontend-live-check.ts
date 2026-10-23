import 'dotenv/config';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join, basename, dirname } from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import type { AddressInfo } from 'node:net';
import bcrypt from 'bcryptjs';
import { integrationDatabase } from './integration-helpers.js';
import { startServer } from '../src/server.js';
import { createLogger } from '../src/logger.js';
import { orderInput } from './workflow-fixture.js';

// Explicit standalone command; uses the actual frontend adapters without changing their release gate.
const frontendRoot = resolve(process.argv[2] || '../web');
const requireFrontend = createRequire(join(frontendRoot, 'package.json'));
const { createServer } = await import(pathToFileURL(requireFrontend.resolve('vite')).href);
const cacheDir = await mkdtemp(join(tmpdir(), 'unloss-adapter-check-'));
const { prisma, config } = integrationDatabase();
const password = randomBytes(24).toString('base64url');
const seller = await prisma.seller.create({ data: { email: `${randomUUID()}@unloss.local`, passwordHash: await bcrypt.hash(password, 4), name: 'Synthetic Adapter Seller' } });
const originalFetch = globalThis.fetch;
let cookie = '', runtime: Awaited<ReturnType<typeof startServer>> | undefined;
let vite: { close(): Promise<void>; ssrLoadModule(path: string): Promise<Record<string, any>> } | undefined;
try {
  runtime = await startServer({ ...config, port: 0 }, createLogger(() => {}), prisma);
  const base = `http://127.0.0.1:${(runtime.server.address() as AddressInfo).port}`;
  // Node has no browser cookie jar. This shim supplies browser Origin/cookie transport only.
  globalThis.fetch = async (input, init) => {
    const path = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const url = new URL(path, base);
    assert.equal(url.origin, base, 'Adapter must call only the isolated test API');
    const headers = new Headers(init?.headers);
    headers.set('Origin', config.appOrigin);
    if (cookie) headers.set('Cookie', cookie);
    const response = await originalFetch(url, { ...init, headers });
    const setCookie = response.headers.get('set-cookie');
    if (setCookie) cookie = setCookie.split(';')[0]!;
    return response;
  };
  vite = await createServer({ root: frontendRoot, configFile: false, envDir: false, cacheDir, appType: 'custom', server: { middlewareMode: true, hmr: false }, define: { 'import.meta.env.VITE_API_BASE_URL': JSON.stringify('/api') } });
  const { api, ordersApi } = await vite!.ssrLoadModule('/src/api.ts');
  const { liveWorkflowApi: workflow, LIVE_PUBLIC_WRITES_READY } = await vite!.ssrLoadModule('/src/features/public/workflowApi.ts');
  assert.equal(LIVE_PUBLIC_WRITES_READY, false, 'Partner/public UI gate must remain unchanged');
  assert.equal((await api('/auth/login', { method: 'POST', body: JSON.stringify({ email: seller.email, password }) })).seller.id, seller.id);
  const created = await ordersApi.create(orderInput);
  assert.equal(created.order.customer.name, orderInput.customer.name);
  const id = created.order.id, delivery = new URL(created.qr.deliveryUrl).pathname.split('/').pop(), customer = new URL(created.qr.customerUrl).pathname.split('/').pop();
  assert.equal((await ordersApi.list({ page: 1, pageSize: 25 })).total, 1);
  for (const toStatus of ['READY_FOR_DISPATCH','OUT_FOR_DELIVERY']) await ordersApi.transition(id, { toStatus, reasonCode: null, note: null });
  assert.equal((await workflow.preview('delivery', delivery)).status, 'OUT_FOR_DELIVERY');
  await assert.rejects(workflow.deliver(delivery, { outcome: 'DELIVERED_VERIFIED', reasonCode: null, note: null }), { status: 409 });
  const ch = await workflow.requestOtp(customer), proof = await workflow.verifyOtp(customer, ch.challengeId, ch.devCode);
  await workflow.decide(customer, proof.verificationToken, { action: 'ACCEPT', reasonCode: null, note: null });
  assert.equal((await workflow.deliver(delivery, { outcome: 'DELIVERED_VERIFIED', reasonCode: null, note: null })).order.status, 'DELIVERED_VERIFIED');
  await assert.rejects(workflow.deliver(delivery, { outcome: 'DELIVERED_VERIFIED', reasonCode: null, note: null }), { status: 404 });
  assert.equal((await ordersApi.detail(id)).events.at(-1).eventType, 'DELIVERED_VERIFIED');
  assert.deepEqual(await api('/rewards/summary'), { creditCount: 1, totalPaise: 500, currency: 'INR' });
  const reportMonth = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit' }).format(new Date());
  assert.equal((await api(`/reports/monthly?month=${reportMonth}`)).rewardTotalPaise, 500);
  assert.ok((await api(`/reports/monthly.csv?month=${reportMonth}`)).includes('reward_total_paise'));
  assert.ok((await api('/notifications')).total >= 5);
  await api('/auth/logout', { method: 'POST' });
  await assert.rejects(api('/auth/me'), { status: 401 });
  console.log('PASS: actual frontend auth/order/public/reward/report/CSV/notification adapters against PostgreSQL; release gate unchanged.');
} finally {
  globalThis.fetch = originalFetch;
  await vite?.close();
  // Only this command's synthetic seller is removed. Stop the server after cleanup.
  await prisma.ledgerEntry.deleteMany({ where: { sellerId: seller.id } });
  await prisma.notification.deleteMany({ where: { sellerId: seller.id } });
  await prisma.order.deleteMany({ where: { sellerId: seller.id } });
  await prisma.seller.delete({ where: { id: seller.id } });
  await runtime?.shutdown();
  await prisma.$disconnect();
  // Verify the resolved deletion target is this command's temporary directory, never a workspace.
  const cacheTarget = await realpath(cacheDir);
  assert.equal(dirname(cacheTarget).toLowerCase(), (await realpath(tmpdir())).toLowerCase());
  assert.match(basename(cacheTarget), /^unloss-adapter-check-/);
  await rm(cacheTarget, { recursive: true, force: true });
}
