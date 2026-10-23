import { afterEach, beforeEach, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { createLogger } from '../src/logger.js';
import { listen } from './helpers.js';
import { workflowFixture } from './workflow-fixture.js';
let f: Awaited<ReturnType<typeof workflowFixture>>;
beforeEach(async () => { f = await workflowFixture(); });
afterEach(async () => { await f?.close(); });
async function acceptedOrder() {
  const o = await f.create(); await f.dispatch(o.order.id);
  const customer = new URL(o.qr.customerUrl).pathname, delivery = new URL(o.qr.deliveryUrl).pathname;
  const challenge = await (await f.request(`${customer}/request-otp`, {}, false)).json();
  const proof = await (await f.request(`${customer}/verify-otp`, { challengeId: challenge.challengeId, code: challenge.devCode }, false)).json();
  expect((await f.request(`${customer}/decision`, { action: 'ACCEPT' }, false, { 'X-Customer-Verification': proof.verificationToken })).status).toBe(201);
  return { ...o, delivery, challenge };
}
it('rolls back completion, revocation and history if ledger persistence fails, then safely retries', async () => {
  const o = await acceptedOrder();
  const failing = f.prisma.$extends({ query: { ledgerEntry: { async create() { throw new Error('Injected private ledger failure'); } } } });
  const server = await listen(createApp({ config: f.config, prisma: failing as unknown as typeof f.prisma, logger: createLogger(() => {}) }));
  try {
    const result = await fetch(`${server.url}/api${o.delivery}`, { method: 'POST', headers: { Origin: f.config.appOrigin, 'Content-Type': 'application/json' }, body: JSON.stringify({ outcome: 'DELIVERED_VERIFIED' }) });
    expect(result.status).toBe(500); expect(JSON.stringify(await result.json())).not.toContain('private ledger');
  } finally { await server.close(); }
  expect((await f.prisma.order.findUniqueOrThrow({ where: { id: o.order.id } })).status).toBe('OUT_FOR_DELIVERY');
  expect(await f.prisma.qrToken.count({ where: { orderId: o.order.id, revokedAt: null } })).toBe(2);
  expect(await f.prisma.orderEvent.count({ where: { orderId: o.order.id, eventType: 'DELIVERED_VERIFIED' } })).toBe(0);
  expect(await f.prisma.ledgerEntry.count({ where: { orderId: o.order.id } })).toBe(0);
  expect((await f.request(o.delivery, { outcome: 'DELIVERED_VERIFIED', amountPaise: 900000 }, false)).status).toBe(201);
  const ledger = await f.prisma.ledgerEntry.findMany({ where: { orderId: o.order.id } });
  expect(ledger).toHaveLength(1); expect(ledger[0]).toMatchObject({ sellerId: f.seller.id, amountPaise: 500, currency: 'INR', type: 'DELIVERY_REWARD' });
  expect(await (await f.request('/rewards/summary')).json()).toEqual({ creditCount: 1, totalPaise: 500, currency: 'INR' });
  expect((await (await f.request('/dashboard/summary')).json()).rewardTotalPaise).toBe(500);
});
it('requires consumed verified challenge evidence even if an acceptance event/flag exists', async () => {
  const { order, qr } = await f.create(); await f.dispatch(order.id);
  await f.prisma.order.update({ where: { id: order.id }, data: { acceptedAttempt: 1, acceptedUntil: new Date(Date.now() + 900_000), acceptedChallengeId: 'synthetic-missing-proof' } });
  await f.prisma.orderEvent.create({ data: { orderId: order.id, eventType: 'ACCEPT', actorType: 'CUSTOMER', source: 'DEMO', fromStatus: 'OUT_FOR_DELIVERY', toStatus: 'OUT_FOR_DELIVERY', metadata: { deliveryAttempt: 1 } } });
  expect((await f.request(new URL(qr.deliveryUrl).pathname, { outcome: 'DELIVERED_VERIFIED' }, false)).status).toBe(409);
  expect(await f.prisma.ledgerEntry.count({ where: { orderId: order.id } })).toBe(0);
});
it('requires recorded acceptance as well as a consumed challenge', async () => {
  const o = await acceptedOrder();
  // Delete only this test's synthetic evidence to simulate an incomplete legacy record.
  await f.prisma.orderEvent.deleteMany({ where: { orderId: o.order.id, eventType: 'ACCEPT' } });
  expect((await f.request(o.delivery, { outcome: 'DELIVERED_VERIFIED' }, false)).status).toBe(409);
});
it('enforces INR 500-paise credit, unique order/type and matching seller in PostgreSQL', async () => {
  const { order } = await f.create(); const other = await workflowFixture();
  const data = { sellerId: f.seller.id, orderId: order.id, type: 'DELIVERY_REWARD', amountPaise: 500, currency: 'INR', eligibilityReason: 'SYNTHETIC_CONSTRAINT_TEST' };
  try {
    await expect(f.prisma.ledgerEntry.create({ data: { ...data, amountPaise: 499 } })).rejects.toThrow();
    await expect(f.prisma.ledgerEntry.create({ data: { ...data, currency: 'USD' } })).rejects.toThrow();
    await expect(f.prisma.ledgerEntry.create({ data: { ...data, sellerId: other.seller.id } })).rejects.toThrow();
    await f.prisma.ledgerEntry.create({ data });
    await expect(f.prisma.ledgerEntry.create({ data })).rejects.toThrow();
  } finally { await other.close(); }
});
