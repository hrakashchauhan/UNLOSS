import { afterEach, beforeEach, expect, it } from 'vitest';
import { workflowFixture } from './workflow-fixture.js';
import { createOrder } from '../src/orders.js';
import { orderInput } from './workflow-fixture.js';
let f: Awaited<ReturnType<typeof workflowFixture>>;
beforeEach(async () => { f = await workflowFixture(); });
afterEach(async () => { await f?.close(); });
const month = '2040-02', mid = new Date('2040-02-10T00:00:00Z');
async function decide(path: string, action: string) {
  const ch = await (await f.request(`${path}/request-otp`, {}, false)).json();
  const proof = await (await f.request(`${path}/verify-otp`, { challengeId: ch.challengeId, code: ch.devCode }, false)).json();
  expect((await f.request(`${path}/decision`, { action }, false, { 'X-Customer-Verification': proof.verificationToken })).status).toBe(201);
}
it('reconciles real return/redelivery/completion workflows with JSON, CSV and notifications', async () => {
  const a = await f.create(); await f.dispatch(a.order.id);
  const customer = new URL(a.qr.customerUrl).pathname, delivery = new URL(a.qr.deliveryUrl).pathname;
  expect((await f.request(delivery, { outcome: 'CUSTOMER_UNAVAILABLE' }, false)).status).toBe(201);
  await decide(customer, 'REQUEST_REDELIVERY'); await f.dispatch(a.order.id);
  await f.prisma.otpChallenge.updateMany({ where: { orderId: a.order.id }, data: { createdAt: new Date(Date.now() - 61_000) } });
  await decide(customer, 'ACCEPT');
  expect((await f.request(delivery, { outcome: 'DELIVERED_VERIFIED' }, false)).status).toBe(201);
  const b = await f.create(); await f.dispatch(b.order.id);
  await f.request(new URL(b.qr.deliveryUrl).pathname, { outcome: 'DELIVERY_ATTEMPTED' }, false);
  await f.transition(b.order.id, 'RETURN_INITIATED', 'PACKAGE_DAMAGED'); await f.transition(b.order.id, 'RETURN_IN_TRANSIT');
  await f.transition(b.order.id, 'RETURNED_TO_SELLER'); await f.transition(b.order.id, 'REDELIVERY_REQUESTED', 'OTHER');
  await f.prisma.orderEvent.updateMany({ where: { order: { sellerId: f.seller.id } }, data: { createdAt: mid } });
  await f.prisma.ledgerEntry.updateMany({ where: { sellerId: f.seller.id }, data: { createdAt: mid } });
  const report = await (await f.request(`/reports/monthly?month=${month}`)).json();
  expect(report).toEqual({ month, timezone: 'Asia/Kolkata', periodStart: '2040-01-31T18:30:00.000Z', periodEnd: '2040-02-29T18:30:00.000Z', totalOrdersCreated: 2, ordersDispatched: 3, deliveryAttempts: 3, verifiedCompletions: 1, returnsToSeller: 1, returnRate: 1 / 3, returnRateNumerator: 1, returnRateDenominator: 3, redeliveryRequests: 2, rewardCreditCount: 1, rewardTotalPaise: 500, reasonCounts: { CUSTOMER_UNAVAILABLE: 1, CUSTOMER_REQUESTED_REDELIVERY: 1, PACKAGE_DAMAGED: 1, OTHER: 1 } });
  const csv = await f.request(`/reports/monthly.csv?month=${month}`);
  expect(csv.headers.get('content-type')).toContain('text/csv'); expect(csv.headers.get('content-disposition')).toContain('unloss-2040-02.csv');
  const text = await csv.text(); expect(text.split('\r\n')).toHaveLength(5);
  expect(text).toContain('"2","3","3","1","1","0.3333333333333333","1","3","2","1","500"');
  expect(text).not.toMatch(/Synthetic Customer|9999999999|Synthetic address/);
  const notifications = await (await f.request('/notifications')).json();
  expect(notifications.total).toBe(await f.prisma.orderEvent.count({ where: { order: { sellerId: f.seller.id } } }));
  expect(notifications.items.every((n: {title:string;body:string}) => n.title.startsWith('DEMO') && n.body.includes('In-app notification only'))).toBe(true);
  expect(notifications.items.some((n: {body:string}) => n.body.includes('no payout'))).toBe(true);
});
it('uses inclusive start and exclusive end and a null rate when no dispatch exists', async () => {
  const { order } = await f.create();
  for (const [eventType, createdAt] of [
    ['CREATED','2040-01-31T18:29:59.999Z'], ['RETURNED_TO_SELLER','2040-01-31T18:30:00.000Z'],
    ['RETURNED_TO_SELLER','2040-02-29T18:29:59.999Z'], ['OUT_FOR_DELIVERY','2040-02-29T18:30:00.000Z'],
  ]) await f.prisma.orderEvent.create({ data: { orderId: order.id, eventType: eventType!, actorType: 'SELLER', source: 'DEMO', createdAt: new Date(createdAt!) } });
  expect(await (await f.request(`/reports/monthly?month=${month}`)).json()).toMatchObject({ totalOrdersCreated: 0, ordersDispatched: 0, returnsToSeller: 2, returnRate: null, returnRateDenominator: 0 });
});
it('emits an empty report row with both reason fields blank', async () => {
  const response = await f.request(`/reports/monthly.csv?month=${month}`), csv = await response.text();
  expect(csv.split('\r\n')).toHaveLength(2); expect(csv).toMatch(/,"",""$/);
  expect(await (await f.request(`/reports/monthly?month=${month}`)).json()).toMatchObject({ reasonCounts: {}, returnRate: null, rewardTotalPaise: 0 });
});
it.each(['2026-00','2026-13','26-01','0000-01','2026-1','2026-02&month=2026-03'])('rejects invalid month %s in JSON and CSV', async invalid => {
  for (const suffix of ['', '.csv']) expect((await f.request(`/reports/monthly${suffix}?month=${invalid}`)).status).toBe(400);
});
it('rolls back creation if its in-app notification cannot be saved', async () => {
  const failing = f.prisma.$extends({ query: { notification: { async create() { throw new Error('Injected notification failure'); } } } });
  await expect(createOrder(failing as unknown as typeof f.prisma, f.config, f.seller.id, orderInput)).rejects.toThrow('Injected notification failure');
  expect(await f.prisma.order.count({ where: { sellerId: f.seller.id } })).toBe(0);
});
