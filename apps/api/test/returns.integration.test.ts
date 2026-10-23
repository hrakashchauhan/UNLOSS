import { afterEach, beforeEach, expect, it } from 'vitest';
import { workflowFixture } from './workflow-fixture.js';
let f: Awaited<ReturnType<typeof workflowFixture>>;
beforeEach(async () => { f = await workflowFixture(); });
afterEach(async () => { await f?.close(); });

it('enforces cancellation and return/redelivery reasons without partial writes', async () => {
  const { order } = await f.create();
  expect((await f.transition(order.id, 'CANCELLED')).status).toBe(400);
  await f.dispatch(order.id);
  for (const to of ['RETURN_INITIATED','REDELIVERY_REQUESTED']) {
    const response = await f.transition(order.id, to); expect(response.status).toBe(400);
    expect((await response.json()).error.code).toBe('REASON_REQUIRED');
  }
  expect(await f.prisma.orderEvent.count({ where: { orderId: order.id } })).toBe(3);
  expect((await f.prisma.order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe('OUT_FOR_DELIVERY');
});
it('preserves a sourced return timeline through redelivery and requires new verification', async () => {
  const { order, qr } = await f.create(); await f.dispatch(order.id);
  const delivery = new URL(qr.deliveryUrl).pathname, customer = new URL(qr.customerUrl).pathname;
  expect((await f.request(delivery, { outcome: 'ADDRESS_ISSUE', reasonCode: 'ADDRESS_INCOMPLETE', note: 'Synthetic reported reason' }, false)).status).toBe(201);
  expect((await f.transition(order.id, 'RETURN_INITIATED', 'ADDRESS_INCOMPLETE')).status).toBe(200);
  for (const path of [delivery, customer]) expect((await f.request(path, undefined, false)).status).toBe(404);
  expect((await f.transition(order.id, 'OUT_FOR_DELIVERY')).status).toBe(409);
  expect((await f.transition(order.id, 'RETURNED_TO_SELLER')).status).toBe(409);
  expect((await f.transition(order.id, 'RETURN_IN_TRANSIT')).status).toBe(200);
  expect((await f.transition(order.id, 'RETURNED_TO_SELLER')).status).toBe(200);
  expect((await f.transition(order.id, 'REDELIVERY_REQUESTED', 'CUSTOMER_REQUESTED_REDELIVERY')).status).toBe(200);
  await f.dispatch(order.id);
  expect((await f.request(delivery, { outcome: 'DELIVERED_VERIFIED' }, false)).status).toBe(409);
  const detail = await (await f.request(`/orders/${order.id}`)).json();
  expect(detail.order.status).toBe('OUT_FOR_DELIVERY');
  expect(detail.events.map((e: {eventType:string}) => e.eventType)).toEqual(['CREATED','READY_FOR_DISPATCH','OUT_FOR_DELIVERY','DELIVERY_FAILED','RETURN_INITIATED','RETURN_IN_TRANSIT','RETURNED_TO_SELLER','REDELIVERY_REQUESTED','READY_FOR_DISPATCH','OUT_FOR_DELIVERY']);
  expect(detail.events[3]).toMatchObject({ actorType: 'DELIVERY', source: 'DEMO', reasonCode: 'ADDRESS_INCOMPLETE', note: 'Synthetic reported reason' });
  expect(detail.events[4]).toMatchObject({ actorType: 'SELLER', actorId: f.seller.id, reasonCode: 'ADDRESS_INCOMPLETE' });
  expect(await f.prisma.ledgerEntry.count({ where: { orderId: order.id } })).toBe(0);
});
it('cannot skip or duplicate return legs under concurrency', async () => {
  const { order } = await f.create(); await f.dispatch(order.id);
  await f.transition(order.id, 'RETURN_INITIATED', 'PACKAGE_DAMAGED'); await f.transition(order.id, 'RETURN_IN_TRANSIT');
  const results = await Promise.all(Array.from({ length: 6 }, () => f.transition(order.id, 'RETURNED_TO_SELLER')));
  expect(results.filter(r => r.status === 200)).toHaveLength(1);
  expect(results.filter(r => r.status === 409)).toHaveLength(5);
  expect(await f.prisma.orderEvent.count({ where: { orderId: order.id, eventType: 'RETURNED_TO_SELLER' } })).toBe(1);
});
it('requires an explicit address reason and rejects unknown reason codes', async () => {
  const { order, qr } = await f.create(); await f.dispatch(order.id);
  const path = new URL(qr.deliveryUrl).pathname;
  for (const reasonCode of [undefined, 'OTHER', 'INVENTED']) expect((await f.request(path, { outcome: 'ADDRESS_ISSUE', reasonCode }, false)).status).toBe(400);
  expect((await f.prisma.order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe('OUT_FOR_DELIVERY');
});
it('keeps return writes and history isolated between sellers', async () => {
  const other = await workflowFixture();
  try {
    const { order } = await f.create(); await f.dispatch(order.id);
    expect((await other.transition(order.id, 'RETURN_INITIATED', 'PACKAGE_DAMAGED')).status).toBe(404);
    expect((await other.request(`/orders/${order.id}/events`)).status).toBe(404);
    expect((await f.prisma.order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe('OUT_FOR_DELIVERY');
  } finally { await other.close(); }
});
