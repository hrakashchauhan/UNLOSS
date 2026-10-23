import { afterAll, beforeAll, expect, it } from 'vitest';
import { workflowFixture } from './workflow-fixture.js';
let f: Awaited<ReturnType<typeof workflowFixture>>;
beforeAll(async () => { f = await workflowFixture(); });
afterAll(async () => { await f?.close(); });
const paths = (qr: { deliveryUrl: string; customerUrl: string }) => [new URL(qr.deliveryUrl).pathname, new URL(qr.customerUrl).pathname];
it('rejects pre-dispatch and wrong-purpose scans without changing any state', async () => {
  const { order, qr } = await f.create();
  for (const path of paths(qr)) expect((await f.request(path, undefined, false)).status).toBe(404);
  await f.dispatch(order.id);
  for (const path of paths(qr)) {
    const wrong = path.includes('/delivery/') ? path.replace('/delivery/', '/customer/') : path.replace('/customer/', '/delivery/');
    const result = await f.request(wrong, undefined, false);
    expect(result.status).toBe(404);
    expect((await result.json()).error.code).toBe('TOKEN_INVALID');
  }
  for (let i = 0; i < 3; i++) for (const path of paths(qr)) {
    const result = await f.request(path, undefined, false);
    expect(result.status).toBe(200);
    const payload = await result.json();
    expect(Object.keys(payload).sort()).toEqual(path.includes('/delivery/') ? ['orderReference','permittedOutcomes','status'] : ['allowedActions','orderReference','status']);
    expect(result.headers.get('cache-control')).toBe('no-store');
    expect(result.headers.get('referrer-policy')).toBe('no-referrer');
  }
  expect(await f.prisma.orderEvent.count({ where: { orderId: order.id } })).toBe(3);
  expect(await f.prisma.ledgerEntry.count({ where: { orderId: order.id } })).toBe(0);
});
it('makes expiry, revocation, unknown and malformed tokens indistinguishable', async () => {
  const { order, qr } = await f.create(); await f.dispatch(order.id);
  await f.prisma.qrToken.updateMany({ where: { orderId: order.id, purpose: 'DELIVERY' }, data: { expiresAt: new Date(0) } });
  await f.prisma.qrToken.updateMany({ where: { orderId: order.id, purpose: 'CUSTOMER' }, data: { revokedAt: new Date() } });
  for (const path of [...paths(qr), '/delivery/' + 'z'.repeat(43), '/delivery/malformed']) {
    const response = await f.request(path, undefined, false);
    expect(response.status).toBe(404);
    expect((await response.json()).error).toEqual({ code: 'TOKEN_INVALID', message: 'Token is invalid' });
  }
});
it('never returns customer details, private notes or ledger data from a public outcome', async () => {
  const { order, qr } = await f.create(); await f.dispatch(order.id);
  const response = await f.request(paths(qr)[0]!, { outcome: 'CUSTOMER_UNAVAILABLE', note: 'PRIVATE-NOTE', reasonCode: 'CUSTOMER_UNAVAILABLE' }, false);
  expect(response.status).toBe(201);
  const payload = await response.json();
  expect(payload.order).toEqual({ orderReference: 'SYNTHETIC-WORKFLOW', status: 'DELIVERY_FAILED' });
  expect(payload.ledgerEntry).toBeNull();
  expect(JSON.stringify(payload)).not.toMatch(/PRIVATE-NOTE|customerPhone|addressLine|sellerId|amountPaise/);
  expect((await f.request(paths(qr)[0]!, undefined, false)).status).toBe(404);
  expect((await (await f.request(paths(qr)[1]!, undefined, false)).json()).allowedActions).toEqual(['REQUEST_REDELIVERY']);
});
