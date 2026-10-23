import { afterEach, beforeEach, expect, it } from 'vitest';
import { workflowFixture, orderInput } from './workflow-fixture.js';
import { seedDemoOrders } from '../prisma/seed.js';
import { PrismaRateLimitStore } from '../src/rate-limits.js';
let f: Awaited<ReturnType<typeof workflowFixture>>;
beforeEach(async () => { f = await workflowFixture(); });
afterEach(async () => { await f?.close(); });

it('seeds optional synthetic examples idempotently without changing existing records or crediting rewards', async () => {
  await Promise.all([seedDemoOrders(f.prisma, f.config, f.seller.id), seedDemoOrders(f.prisma, f.config, f.seller.id)]);
  const orders = await f.prisma.order.findMany({ where: { sellerId: f.seller.id } });
  expect(orders.map(o => o.status).sort()).toEqual(['CREATED','OUT_FOR_DELIVERY','RETURNED_TO_SELLER']);
  const first = orders[0]!;
  await f.prisma.order.update({ where: { id: first.id }, data: { customerName: 'Preserved synthetic edit' } });
  const count = await f.prisma.orderEvent.count({ where: { order: { sellerId: f.seller.id } } });
  await seedDemoOrders(f.prisma, f.config, f.seller.id);
  expect((await f.prisma.order.findUniqueOrThrow({ where: { id: first.id } })).customerName).toBe('Preserved synthetic edit');
  expect(await f.prisma.orderEvent.count({ where: { order: { sellerId: f.seller.id } } })).toBe(count);
  expect(await f.prisma.orderEvent.count({ where: { order: { sellerId: f.seller.id }, source: { not: 'DEMO' } } })).toBe(0);
  expect(await f.prisma.ledgerEntry.count({ where: { sellerId: f.seller.id } })).toBe(0);
  await expect(seedDemoOrders(f.prisma, { ...f.config, demo: false }, f.seller.id)).rejects.toThrow('local demo');
  await expect(seedDemoOrders(f.prisma, { ...f.config, nodeEnv: 'production' }, f.seller.id)).rejects.toThrow('local demo');
});
it('returns exactly the agreed flat order fields without internal verification state', async () => {
  const { order } = await f.create();
  expect(Object.keys(order).sort()).toEqual(['id','sellerId','sellerReference','status','customerName','customerPhone','addressLine1','addressLine2','city','state','postalCode','createdAt','updatedAt'].sort());
  expect((await (await f.request(`/orders/${order.id}`)).json()).order).toEqual(order);
});
it('enforces durable delivery and decision token budgets without revealing invalid token details', async () => {
  const token = 't'.repeat(43);
  for (const [scope, hits, path] of [['delivery-token',20,`/delivery/${token}`],['decision-token',10,`/customer/${token}/decision`],['delivery-ip',60,`/delivery/${token}`],['decision-ip',30,`/customer/${token}/decision`]] as const) {
    const store = new PrismaRateLimitStore(f.prisma, f.config.sessionSecret, scope);
    const identity = scope.endsWith('-ip') ? '127.0.0.1' : token;
    await f.prisma.rateLimitBucket.upsert({ where: { key: store.key(identity) }, create: { key: store.key(identity), hits, resetAt: new Date(Date.now() + 60_000) }, update: { hits, resetAt: new Date(Date.now() + 60_000) } });
    const response = await f.request(path, {}, false);
    expect(response.status).toBe(429); expect(Number(response.headers.get('retry-after'))).toBeGreaterThan(0);
    expect((await response.json()).error.code).toBe('RATE_LIMITED');
    await store.resetKey(identity);
  }
});
it('rejects forged actor, source, acceptance and reward flags in a create request', async () => {
  const result = await f.request('/orders', { ...orderInput, status: 'DELIVERED_VERIFIED', actorType: 'DELIVERY', source: 'INTEGRATION', acceptedAttempt: 0, acceptedChallengeId: 'forged', amountPaise: 500 });
  expect(result.status).toBe(201);
  const { order } = await result.json();
  expect(order.status).toBe('CREATED');
  expect((await f.prisma.order.findUniqueOrThrow({ where: { id: order.id } })).acceptedChallengeId).toBeNull();
  expect(await f.prisma.orderEvent.findFirst({ where: { orderId: order.id } })).toMatchObject({ actorType: 'SELLER', source: 'DEMO' });
  await f.dispatch(order.id);
  const response = await f.transition(order.id, 'DELIVERED_VERIFIED');
  expect(response.status).toBe(403);
  expect(await f.prisma.ledgerEntry.count({ where: { orderId: order.id } })).toBe(0);
});
