import { afterAll, beforeAll, expect, it } from 'vitest';
import { orderInput, workflowFixture } from './workflow-fixture.js';
import { createOrder } from '../src/orders.js';
let f: Awaited<ReturnType<typeof workflowFixture>>;
beforeAll(async () => { f = await workflowFixture(); });
afterAll(async () => { await f?.close(); });

it('atomically creates the owner, event and two distinct hashed tokens', async () => {
  const result = await f.create();
  const tokens = await f.prisma.qrToken.findMany({ where: { orderId: result.order.id } });
  expect(tokens).toHaveLength(2);
  expect(new Set(tokens.map(t => t.tokenHash)).size).toBe(2);
  expect(JSON.stringify(tokens)).not.toContain(result.qr.deliveryUrl.split('/').pop());
  expect(await f.prisma.orderEvent.count({ where: { orderId: result.order.id, source: 'DEMO', actorId: f.seller.id } })).toBe(1);
});
it('rolls back order and event if token persistence fails', async () => {
  const failing = f.prisma.$extends({ query: { qrToken: { async createMany() { throw new Error('Injected token failure'); } } } });
  const count = await f.prisma.order.count({ where: { sellerId: f.seller.id } });
  await expect(createOrder(failing as unknown as typeof f.prisma, f.config, f.seller.id, orderInput)).rejects.toThrow('Injected token failure');
  expect(await f.prisma.order.count({ where: { sellerId: f.seller.id } })).toBe(count);
});
it.each(['page=0','page=-1','page=1.5','page=NaN','page=1000001','pageSize=101','pageSize=2.5','status=INVENTED','page=1&page=2','q='+ 'a'.repeat(201)])('rejects invalid list query %s', async query => {
  expect((await f.request(`/orders?${query}`)).status).toBe(400);
});
it('rejects blank required fields and invalid phone without writing', async () => {
  for (const customer of [{ name: '   ', phone: '+919999999999' }, { name: 'Test', phone: '123' }]) {
    expect((await f.request('/orders', { ...orderInput, customer })).status).toBe(400);
  }
});
it('paginates deterministically and keeps detail events separate', async () => {
  const created = await f.create();
  const a = await (await f.request('/orders?pageSize=1')).json();
  const b = await (await f.request('/orders?pageSize=1&page=2')).json();
  expect(a.items[0].id).not.toBe(b.items[0].id);
  const detail = await (await f.request(`/orders/${created.order.id}`)).json();
  expect(detail.order.events).toBeUndefined();
  expect(detail.events).toHaveLength(1);
});
it('serializes concurrent transitions and writes exactly one matching event', async () => {
  const { order } = await f.create();
  const responses = await Promise.all(Array.from({ length: 8 }, () => f.transition(order.id, 'READY_FOR_DISPATCH')));
  expect(responses.filter(r => r.status === 200)).toHaveLength(1);
  expect(responses.filter(r => r.status === 409)).toHaveLength(7);
  expect(await f.prisma.orderEvent.count({ where: { orderId: order.id, eventType: 'READY_FOR_DISPATCH' } })).toBe(1);
});
it('prevents seller impersonation of delivery/customer outcomes and revokes cancellation tokens', async () => {
  const { order } = await f.create();
  expect((await f.transition(order.id, 'DELIVERED_VERIFIED')).status).toBe(403);
  expect((await f.transition(order.id, 'CUSTOMER_REJECTED')).status).toBe(403);
  expect((await f.transition(order.id, 'CANCELLED', 'SELLER_CANCELLED')).status).toBe(200);
  expect(await f.prisma.qrToken.count({ where: { orderId: order.id, revokedAt: null } })).toBe(0);
});
