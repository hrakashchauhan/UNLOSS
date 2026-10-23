import { randomBytes, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import bcrypt from 'bcryptjs';
import { createApp } from '../src/app.js';
import { checkDatabase, createDatabase } from '../src/database.js';
import { createLogger } from '../src/logger.js';
import { seedDemoSeller } from '../prisma/seed.js';
import { listen, testConfig } from './helpers.js';

// Separate command, never silently skipped or run against the application database.
const databaseUrl = process.env.TEST_DATABASE_URL;
if (!databaseUrl) throw new Error('TEST_DATABASE_URL is required; migrate a dedicated local unloss_test_* database first');
const target = new URL(databaseUrl);
if (!['localhost', '127.0.0.1', '[::1]'].includes(target.hostname) || !/^\/unloss_test_[a-z0-9_]+$/i.test(target.pathname)) {
  throw new Error('Integration tests require a loopback database named unloss_test_*');
}
const config = testConfig({ DATABASE_URL: databaseUrl, DEMO_MODE: 'true' });
const prisma = createDatabase(config);
const fixtureEmail = `phase1-${randomUUID()}@unloss.local`;
const fixturePassword = randomBytes(24).toString('base64url');
const seedEnv = { NODE_ENV: 'test', DEMO_MODE: 'true', SEED_SELLER_EMAIL: fixtureEmail, SEED_SELLER_PASSWORD: fixturePassword };
let fixtureSellerId: string | undefined;
let server: Awaited<ReturnType<typeof listen>> | undefined;

beforeAll(async () => {
  await prisma.$connect();
  await checkDatabase(prisma);
  server = await listen(createApp({ config, prisma, logger: createLogger(() => {}) }));
});
afterAll(async () => {
  try {
    await server?.close();
    // Only rows belonging to the seller created by this test run are removed.
    if (fixtureSellerId) {
      await prisma.notification.deleteMany({ where: { sellerId: fixtureSellerId } });
      await prisma.order.deleteMany({ where: { sellerId: fixtureSellerId } });
      await prisma.seller.delete({ where: { id: fixtureSellerId } });
    }
  } finally { await prisma.$disconnect(); }
});

describe('migrated PostgreSQL foundation', () => {
  it('has all existing model tables and supports real readiness', async () => {
    const response = await fetch(`${server!.url}/health/ready`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: 'ready', mode: 'demo' });
    await Promise.all([
      prisma.session.count(), prisma.order.count(), prisma.orderEvent.count(), prisma.qrToken.count(),
      prisma.otpChallenge.count(), prisma.ledgerEntry.count(), prisma.notification.count(),
    ]);
  });
  it('seeds an explicit demo seller idempotently without resetting their password', async () => {
    const seller = await seedDemoSeller(prisma, seedEnv);
    fixtureSellerId = seller.id;
    expect(await bcrypt.compare(fixturePassword, seller.passwordHash)).toBe(true);
    const again = await seedDemoSeller(prisma, { ...seedEnv, SEED_SELLER_PASSWORD: randomBytes(24).toString('base64url') });
    expect(again.id).toBe(seller.id);
    expect(again.passwordHash).toBe(seller.passwordHash);
  });
  it('retains the frontend login, cookie, flat order and event contracts against persisted data', async () => {
    const headers = { Origin: config.appOrigin, 'Content-Type': 'application/json' };
    const login = await fetch(`${server!.url}/api/auth/login`, {
      method: 'POST', headers, body: JSON.stringify({ email: fixtureEmail, password: fixturePassword }),
    });
    expect(login.status).toBe(200);
    expect(await login.json()).toEqual({ seller: { id: fixtureSellerId, email: fixtureEmail, name: 'Demo Seller' } });
    const sessionCookie = login.headers.get('set-cookie');
    expect(sessionCookie).toMatch(/HttpOnly/i);
    expect(sessionCookie).toMatch(/SameSite=Lax/i);
    const authenticated = { ...headers, Cookie: sessionCookie!.split(';')[0]! };
    const me = await fetch(`${server!.url}/api/auth/me`, { headers: authenticated });
    expect((await me.json()).seller.id).toBe(fixtureSellerId);
    const created = await fetch(`${server!.url}/api/orders`, {
      method: 'POST', headers: authenticated,
      body: JSON.stringify({
        sellerReference: 'SYNTHETIC-FOUNDATION-TEST', customer: { name: 'Synthetic Customer', phone: '+919999999999' },
        deliveryAddress: { line1: 'Synthetic test address', city: 'Test City', state: 'Test State', postalCode: '000000' },
      }),
    });
    expect(created.status).toBe(201);
    const payload = await created.json();
    expect(payload.order).toMatchObject({ sellerId: fixtureSellerId, customerName: 'Synthetic Customer', status: 'CREATED' });
    expect(payload.qr.deliveryUrl).toContain('/delivery/');
    expect(payload.qr.customerUrl).toContain('/customer/');
    const listed = await fetch(`${server!.url}/api/orders`, { headers: authenticated });
    expect(await listed.json()).toMatchObject({ page: 1, pageSize: 25, total: 1, items: [payload.order] });
    const detail = await fetch(`${server!.url}/api/orders/${payload.order.id}`, { headers: authenticated });
    expect((await detail.json()).events).toHaveLength(1);
    const logout = await fetch(`${server!.url}/api/auth/logout`, { method: 'POST', headers: authenticated });
    expect(logout.status).toBe(204);
    expect((await fetch(`${server!.url}/api/auth/me`, { headers: authenticated })).status).toBe(401);
  });
  it('rolls back related writes when a database transaction fails', async () => {
    const reference = `rollback-${randomUUID()}`;
    await expect(prisma.$transaction(async tx => {
      const order = await tx.order.create({ data: {
        sellerId: fixtureSellerId!, sellerReference: reference, customerName: 'Synthetic Customer', customerPhone: '+919999999999',
        addressLine1: 'Synthetic test address', city: 'Test City', state: 'Test State', postalCode: '000000',
      } });
      await tx.orderEvent.create({ data: { orderId: order.id, eventType: 'CREATED', actorType: 'SELLER', source: 'DEMO' } });
      throw new Error('Intentional rollback');
    })).rejects.toThrow('Intentional rollback');
    expect(await prisma.order.count({ where: { sellerId: fixtureSellerId!, sellerReference: reference } })).toBe(0);
  });
});
