import { randomBytes, randomUUID } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { createDatabase } from '../src/database.js';
import { createLogger } from '../src/logger.js';
import { hashToken } from '../src/rules.js';
import { PrismaSessionStore } from '../src/sessions.js';
import { PrismaRateLimitStore } from '../src/rate-limits.js';
import { pruneExpiredSecurityRecords } from '../src/maintenance.js';
import { listen } from './helpers.js';
import { integrationDatabase, rawSessionId } from './integration-helpers.js';

const { prisma, config } = integrationDatabase();
const logger = createLogger(() => {});
const suffix = randomUUID();
const password = randomBytes(24).toString('base64url');
const passwordHash = bcrypt.hashSync(password, 12);
const owners = ['a', 'b'].map(name => ({ id: `phase2-${name}-${suffix}`, email: `phase2-${name}-${suffix}@unloss.local`, name: `Synthetic ${name}`, passwordHash }));
const ids = owners.map(owner => owner.id);
const orderIds = ids.map(id => `order-${id}`);
const headers = { Origin: config.appOrigin, 'Content-Type': 'application/json' };
let server: Awaited<ReturnType<typeof listen>>;
let cookieA: string;
let cookieB: string;
let deliveryToken: string;

async function login(index: number, cookie?: string, url = server.url) {
  const response = await fetch(`${url}/api/auth/login`, { method: 'POST', headers: { ...headers, ...(cookie ? { Cookie: cookie } : {}) }, body: JSON.stringify({ email: owners[index]!.email, password }) });
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ seller: { id: owners[index]!.id, email: owners[index]!.email, name: owners[index]!.name }, mode: 'demo' });
  return response.headers.get('set-cookie')!.split(';')[0]!;
}
const authHeaders = () => ({ ...headers, Cookie: cookieA });

beforeAll(async () => {
  await prisma.$connect();
  for (const [i, owner] of owners.entries()) {
    await prisma.seller.create({ data: owner });
    await prisma.order.create({ data: {
      id: orderIds[i], sellerId: owner.id, sellerReference: `REFERENCE-${i}-${suffix}`,
      customerName: `Synthetic Customer ${i}`, customerPhone: '+919999999999', addressLine1: 'Synthetic test address', city: 'Test', state: 'Test', postalCode: '000000',
      events: { create: { eventType: 'CREATED', actorType: 'SELLER', actorId: owner.id, source: 'DEMO', reasonCode: i === 0 ? 'OTHER' : 'ADDRESS_INCORRECT', createdAt: new Date('2026-10-15T10:00:00Z') } },
    } });
    await prisma.ledgerEntry.create({ data: { sellerId: owner.id, orderId: orderIds[i]!, amountPaise: 500, type: 'DELIVERY_REWARD', eligibilityReason: 'SYNTHETIC_ISOLATION_FIXTURE', createdAt: new Date('2026-10-15T10:00:00Z') } });
    await prisma.notification.create({ data: { sellerId: owner.id, title: `Fixture ${i}`, body: `Synthetic notification ${i}` } });
  }
  deliveryToken = randomBytes(32).toString('base64url');
  await prisma.qrToken.create({ data: { orderId: orderIds[1]!, purpose: 'DELIVERY', tokenHash: hashToken(deliveryToken), expiresAt: new Date(Date.now() + 60_000) } });
  server = await listen(createApp({ prisma, config, logger }));
  cookieA = await login(0); cookieB = await login(1);
});
afterAll(async () => {
  try {
    await server?.close();
    await prisma.ledgerEntry.deleteMany({ where: { sellerId: { in: ids } } });
    await prisma.notification.deleteMany({ where: { sellerId: { in: ids } } });
    await prisma.order.deleteMany({ where: { sellerId: { in: ids } } });
    await prisma.seller.deleteMany({ where: { id: { in: ids } } });
    for (const value of [owners[0]!.email, owners[1]!.email]) await new PrismaRateLimitStore(prisma, config.sessionSecret, 'login-account').resetKey(value);
    await new PrismaRateLimitStore(prisma, config.sessionSecret, 'login-ip').resetKey('127.0.0.1');
  } finally { await prisma.$disconnect(); }
});

describe('persistent seller sessions', () => {
  it('stores only a digest of the session ID, excluding passwords and raw cookies', async () => {
    const sid = rawSessionId(cookieA);
    const row = await prisma.session.findUniqueOrThrow({ where: { sid: hashToken(sid) } });
    expect(row.sellerId).toBe(ids[0]);
    expect(row.data).toEqual({ credentialVersion: hashToken(passwordHash) });
    expect(JSON.stringify(row)).not.toContain(sid);
    expect(JSON.stringify(row)).not.toContain(passwordHash);
    expect(row.expiresAt.getTime() - Date.now()).toBeGreaterThan(6.9 * 864e5);
  });
  it('works in a fresh app/database-client instance and keeps its original expiry', async () => {
    const before = await prisma.session.findUniqueOrThrow({ where: { sid: hashToken(rawSessionId(cookieA)) } });
    const otherDatabase = createDatabase(config);
    const other = await listen(createApp({ config, prisma: otherDatabase, logger }));
    try {
      const response = await fetch(`${other.url}/api/auth/me`, { headers: { Cookie: cookieA } });
      expect(response.status).toBe(200); expect((await response.json()).seller.id).toBe(ids[0]);
      expect(response.headers.get('set-cookie')).toBeNull();
      const after = await prisma.session.findUniqueOrThrow({ where: { sid: before.sid } });
      expect(after.expiresAt).toEqual(before.expiresAt);
    } finally { await other.close(); await otherDatabase.$disconnect(); }
  });
  it('rotates and revokes the old session on a subsequent login', async () => {
    const old = cookieA;
    cookieA = await login(0, old);
    expect(cookieA).not.toBe(old);
    expect((await fetch(`${server.url}/api/auth/me`, { headers: { Cookie: old } })).status).toBe(401);
    expect(await prisma.session.findUnique({ where: { sid: hashToken(rawSessionId(old)) } })).toBeNull();
  });
  it('rejects a tampered signed cookie', async () => {
    const forged = cookieA.slice(0, -5) + 'wrong';
    expect((await fetch(`${server.url}/api/orders`, { headers: { Cookie: forged } })).status).toBe(401);
  });
  it('rejects expired sessions even when a browser sends the old cookie', async () => {
    const expired = await login(0);
    const sid = hashToken(rawSessionId(expired));
    await prisma.session.update({ where: { sid }, data: { expiresAt: new Date(Date.now() - 1000) } });
    expect((await fetch(`${server.url}/api/auth/me`, { headers: { Cookie: expired } })).status).toBe(401);
    expect(await prisma.session.findUnique({ where: { sid } })).toBeNull();
  });
  it('revokes logout durably and refuses an old in-flight save/touch', async () => {
    const cookie = await login(0);
    const store = new PrismaSessionStore(prisma, config);
    const sid = rawSessionId(cookie);
    const loaded = await new Promise<import('express-session').SessionData>((resolve, reject) => store.get(sid, (error, data) => error ? reject(error) : resolve(data!)));
    const response = await fetch(`${server.url}/api/auth/logout`, { method: 'POST', headers: { ...headers, Cookie: cookie } });
    expect(response.status).toBe(204);
    expect(response.headers.get('set-cookie')).toMatch(/unloss.sid=;.*Path=\/.*HttpOnly.*SameSite=Lax/i);
    await expect(new Promise<void>((resolve, reject) => store.set(sid, loaded, error => error ? reject(error) : resolve()))).rejects.toMatchObject({ status: 401 });
    await new Promise<void>(resolve => store.touch(sid, loaded, resolve));
    expect(await prisma.session.findUnique({ where: { sid: hashToken(sid) } })).toBeNull();
    expect((await fetch(`${server.url}/api/auth/me`, { headers: { Cookie: cookie } })).status).toBe(401);
  });
  it('invalidates sessions after a password hash changes', async () => {
    const cookie = await login(0);
    await prisma.seller.update({ where: { id: ids[0] }, data: { passwordHash: bcrypt.hashSync(randomBytes(24).toString('hex'), 12) } });
    try { expect((await fetch(`${server.url}/api/auth/me`, { headers: { Cookie: cookie } })).status).toBe(401); }
    finally { await prisma.seller.update({ where: { id: ids[0] }, data: { passwordHash } }); }
  });
  it('denies a deleted seller and removes their session via the existing foreign key', async () => {
    const id = `phase2-deleted-${suffix}`;
    await prisma.seller.create({ data: { id, email: `${id}@unloss.local`, passwordHash, name: 'Synthetic deleted seller' } });
    const response = await fetch(`${server.url}/api/auth/login`, { method: 'POST', headers, body: JSON.stringify({ email: `${id}@unloss.local`, password }) });
    expect(response.status).toBe(200);
    const cookie = response.headers.get('set-cookie')!.split(';')[0]!;
    const sid = rawSessionId(cookie);
    await prisma.seller.delete({ where: { id } });
    expect((await fetch(`${server.url}/api/auth/me`, { headers: { Cookie: cookie } })).status).toBe(401);
    expect(await prisma.session.findUnique({ where: { sid: hashToken(sid) } })).toBeNull();
    await new PrismaRateLimitStore(prisma, config.sessionSecret, 'login-account').resetKey(`${id}@unloss.local`);
  });
  it('prunes expired security records while retaining active sessions', async () => {
    const expired = hashToken(randomUUID());
    await prisma.session.create({ data: { sid: expired, sellerId: ids[0]!, data: {}, expiresAt: new Date(Date.now() - 1000) } });
    const bucket = `expired-${suffix}`;
    await prisma.rateLimitBucket.create({ data: { key: bucket, hits: 1, resetAt: new Date(Date.now() - 1000) } });
    await pruneExpiredSecurityRecords(prisma);
    expect(await prisma.session.findUnique({ where: { sid: expired } })).toBeNull();
    expect(await prisma.rateLimitBucket.findUnique({ where: { key: bucket } })).toBeNull();
    expect(await prisma.session.findUnique({ where: { sid: hashToken(rawSessionId(cookieA)) } })).not.toBeNull();
  });
});

describe('seller isolation across the complete seller route surface', () => {
  const protectedRoutes = [
    ['GET', '/api/auth/me'], ['POST', '/api/auth/logout'], ['GET', '/api/orders'], ['POST', '/api/orders'],
    ['GET', '/api/orders/ORDER'], ['GET', '/api/orders/ORDER/events'], ['POST', '/api/orders/ORDER/transitions'],
    ['GET', '/api/dashboard/summary'], ['GET', '/api/rewards/ledger'], ['GET', '/api/rewards/summary'],
    ['GET', '/api/notifications'], ['GET', '/api/reports/monthly?month=2026-10'], ['GET', '/api/reports/monthly.csv?month=2026-10'],
  ];
  it.each(protectedRoutes)('requires a seller cookie for %s %s, including when a public token is supplied', async (method, path) => {
    const response = await fetch(`${server.url}${path!.replace('ORDER', orderIds[0]!)}`, {
      method, headers: { ...headers, Authorization: `Bearer ${deliveryToken}`, 'X-Customer-Verification': deliveryToken },
      ...(method === 'POST' ? { body: '{}' } : {}),
    });
    expect(response.status).toBe(401);
  });
  it('isolates lists/search, ignoring seller IDs supplied in headers or query strings', async () => {
    const list = await fetch(`${server.url}/api/orders?sellerId=${ids[1]}`, { headers: { ...authHeaders(), 'X-Seller-Id': ids[1]! } });
    const body = await list.json();
    expect(body.items.map((item: { sellerId: string }) => item.sellerId)).toEqual([ids[0]]);
    const search = await fetch(`${server.url}/api/orders?q=${encodeURIComponent(`REFERENCE-1-${suffix}`)}`, { headers: authHeaders() });
    expect((await search.json()).total).toBe(0);
  });
  it.each(['', '/events'])('returns the same 404 for foreign and nonexistent order%s', async suffix => {
    const foreign = await fetch(`${server.url}/api/orders/${orderIds[1]}${suffix}`, { headers: authHeaders() });
    const missing = await fetch(`${server.url}/api/orders/not-found${suffix}`, { headers: authHeaders() });
    expect(foreign.status).toBe(404); expect(missing.status).toBe(404);
    expect((await foreign.json()).error).toEqual((await missing.json()).error);
    const own = await fetch(`${server.url}/api/orders/${orderIds[0]}${suffix}`, { headers: authHeaders() });
    expect(own.status).toBe(200);
  });
  it('denies a cross-seller write without changing status, events or ledger', async () => {
    const response = await fetch(`${server.url}/api/orders/${orderIds[1]}/transitions`, { method: 'POST', headers: authHeaders(), body: JSON.stringify({ toStatus: 'READY_FOR_DISPATCH', sellerId: ids[1] }) });
    expect(response.status).toBe(404);
    expect((await prisma.order.findUniqueOrThrow({ where: { id: orderIds[1] } })).status).toBe('CREATED');
    expect(await prisma.orderEvent.count({ where: { orderId: orderIds[1] } })).toBe(1);
    expect(await prisma.ledgerEntry.count({ where: { orderId: orderIds[1] } })).toBe(1);
  });
  it('isolates dashboard, ledger, notifications, monthly JSON and CSV', async () => {
    const dashboard = await fetch(`${server.url}/api/dashboard/summary`, { headers: authHeaders() });
    expect(await dashboard.json()).toMatchObject({ totalOrders: 1, rewardTotalPaise: 500 });
    const ledger = await fetch(`${server.url}/api/rewards/ledger`, { headers: authHeaders() });
    expect((await ledger.json()).items.map((item: { sellerId: string }) => item.sellerId)).toEqual([ids[0]]);
    const summary = await fetch(`${server.url}/api/rewards/summary`, { headers: authHeaders() });
    expect(await summary.json()).toEqual({ creditCount: 1, totalPaise: 500, currency: 'INR' });
    const notifications = await fetch(`${server.url}/api/notifications`, { headers: authHeaders() });
    expect((await notifications.json()).items.map((item: { sellerId: string }) => item.sellerId)).toEqual([ids[0]]);
    const report = await fetch(`${server.url}/api/reports/monthly?month=2026-10`, { headers: authHeaders() });
    expect(await report.json()).toMatchObject({ totalOrdersCreated: 1, rewardCreditCount: 1, rewardTotalPaise: 500, reasonCounts: { OTHER: 1 } });
    const csv = await fetch(`${server.url}/api/reports/monthly.csv?month=2026-10`, { headers: authHeaders() });
    const text = await csv.text();
    expect(text).toContain('"OTHER"'); expect(text).not.toContain('ADDRESS_INCORRECT'); expect(text).not.toContain('Synthetic Customer');
  });
  it('checks exact origins on authenticated writes and leaves the session valid after rejection', async () => {
    const response = await fetch(`${server.url}/api/auth/logout`, { method: 'POST', headers: { ...authHeaders(), Origin: 'https://attacker.example', 'X-Forwarded-Host': 'localhost:5173' } });
    expect(response.status).toBe(403);
    expect((await fetch(`${server.url}/api/auth/me`, { headers: authHeaders() })).status).toBe(200);
  });
  it('creates under the session seller despite forged ownership fields', async () => {
    const response = await fetch(`${server.url}/api/orders`, { method: 'POST', headers: authHeaders(), body: JSON.stringify({
      sellerId: ids[1], customer: { name: 'Synthetic Customer', phone: '+919999999999' },
      deliveryAddress: { line1: 'Synthetic test address', city: 'Test', state: 'Test', postalCode: '000000' },
    }) });
    expect(response.status).toBe(201); expect((await response.json()).order.sellerId).toBe(ids[0]);
  });
  it('allows an owned dispatch transition but denies seller-forged verified completion', async () => {
    const own = await fetch(`${server.url}/api/orders/${orderIds[0]}/transitions`, { method: 'POST', headers: authHeaders(), body: JSON.stringify({ toStatus: 'READY_FOR_DISPATCH' }) });
    expect(own.status).toBe(200); expect((await own.json()).event.actorId).toBe(ids[0]);
    await prisma.order.update({ where: { id: orderIds[0] }, data: { status: 'OUT_FOR_DELIVERY' } });
    const completed = await fetch(`${server.url}/api/orders/${orderIds[0]}/transitions`, { method: 'POST', headers: authHeaders(), body: JSON.stringify({ toStatus: 'DELIVERED_VERIFIED' }) });
    expect(completed.status).toBe(403);
    expect((await prisma.order.findUniqueOrThrow({ where: { id: orderIds[0] } })).status).toBe('OUT_FOR_DELIVERY');
    const b = await fetch(`${server.url}/api/orders/${orderIds[0]}`, { headers: { Cookie: cookieB } });
    expect(b.status).toBe(404);
  });
});
