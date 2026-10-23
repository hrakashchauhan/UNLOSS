import { afterEach, beforeEach, expect, it } from 'vitest';
import { workflowFixture } from './workflow-fixture.js';
let f: Awaited<ReturnType<typeof workflowFixture>>;
beforeEach(async () => { f = await workflowFixture(); });
afterEach(async () => { await f?.close(); });
async function dispatched() {
  const result = await f.create(); await f.dispatch(result.order.id);
  return { ...result, customer: new URL(result.qr.customerUrl).pathname, delivery: new URL(result.qr.deliveryUrl).pathname };
}
async function otp(path: string) {
  const response = await f.request(`${path}/request-otp`, {}, false); expect(response.status).toBe(202);
  const challenge = await response.json(); expect(challenge.demoLabel).toContain('no SMS sent');
  return challenge;
}
async function verify(path: string, challenge: {challengeId:string;devCode:string}) {
  const response = await f.request(`${path}/verify-otp`, { challengeId: challenge.challengeId, code: challenge.devCode }, false);
  expect(response.status).toBe(200); return (await response.json()).verificationToken as string;
}
const decision = (path: string, proof: string, action = 'ACCEPT', reasonCode?: string) => f.request(`${path}/decision`, { action, reasonCode, note: 'PRIVATE-CUSTOMER-NOTE' }, false, { 'X-Customer-Verification': proof });

it('requires customer OTP acceptance before handoff and never rewards acceptance alone', async () => {
  const o = await dispatched();
  expect((await f.request(o.delivery, { outcome: 'DELIVERED_VERIFIED' }, false)).status).toBe(409);
  const proof = await verify(o.customer, await otp(o.customer));
  const accepted = await decision(o.customer, proof); expect(accepted.status).toBe(201);
  expect(JSON.stringify(await accepted.json())).not.toMatch(/PRIVATE-CUSTOMER-NOTE|customerPhone|verificationHash|sellerId/);
  expect(await f.prisma.ledgerEntry.count({ where: { orderId: o.order.id } })).toBe(0);
  expect((await f.prisma.order.findUniqueOrThrow({ where: { id: o.order.id } })).status).toBe('OUT_FOR_DELIVERY');
  expect((await (await f.request(o.delivery, undefined, false)).json()).permittedOutcomes).toContain('DELIVERED_VERIFIED');
});
it('consumes a successful OTP once even with competing verification requests', async () => {
  const o = await dispatched(), ch = await otp(o.customer);
  const results = await Promise.all(Array.from({ length: 4 }, () => f.request(`${o.customer}/verify-otp`, { challengeId: ch.challengeId, code: ch.devCode }, false)));
  expect(results.filter(r => r.status === 200)).toHaveLength(1);
  expect(results.filter(r => r.status === 400)).toHaveLength(3);
});
it('commits failed attempts and enforces exactly five guesses under concurrency', async () => {
  const o = await dispatched(), ch = await otp(o.customer);
  const wrong = ch.devCode === '000000' ? '000001' : '000000';
  const results = await Promise.all(Array.from({ length: 8 }, () => f.request(`${o.customer}/verify-otp`, { challengeId: ch.challengeId, code: wrong }, false)));
  expect(results.every(r => r.status === 400)).toBe(true);
  expect((await f.prisma.otpChallenge.findUniqueOrThrow({ where: { id: ch.challengeId } })).attempts).toBe(5);
  expect((await f.request(`${o.customer}/verify-otp`, { challengeId: ch.challengeId, code: ch.devCode }, false)).status).toBe(400);
});
it('serializes resends so concurrent requests issue just one challenge', async () => {
  const o = await dispatched();
  const results = await Promise.all(Array.from({ length: 4 }, () => f.request(`${o.customer}/request-otp`, {}, false)));
  expect(results.filter(r => r.status === 202)).toHaveLength(1);
  expect(results.filter(r => r.status === 429)).toHaveLength(3);
  expect(results.filter(r => r.status === 429).every(r => Number(r.headers.get('retry-after')) > 0)).toBe(true);
  expect(await f.prisma.otpChallenge.count({ where: { orderId: o.order.id } })).toBe(1);
});
it('expires OTPs and verification proofs on the server', async () => {
  const a = await dispatched(), ch = await otp(a.customer);
  await f.prisma.otpChallenge.update({ where: { id: ch.challengeId }, data: { expiresAt: new Date(0) } });
  expect((await f.request(`${a.customer}/verify-otp`, { challengeId: ch.challengeId, code: ch.devCode }, false)).status).toBe(400);
  const b = await dispatched(), next = await otp(b.customer), proof = await verify(b.customer, next);
  await f.prisma.otpChallenge.update({ where: { id: next.challengeId }, data: { verificationExpiresAt: new Date(0) } });
  expect((await decision(b.customer, proof)).status).toBe(401);
});
it('rejects cross-order proof and consumes a decision once under concurrency', async () => {
  const a = await dispatched(), b = await dispatched(), ch = await otp(a.customer), proof = await verify(a.customer, ch);
  expect((await decision(b.customer, proof)).status).toBe(401);
  const results = await Promise.all(Array.from({ length: 4 }, () => decision(a.customer, proof)));
  expect(results.filter(r => r.status === 201)).toHaveLength(1);
  expect(results.filter(r => r.status === 401)).toHaveLength(3);
  expect(await f.prisma.orderEvent.count({ where: { orderId: a.order.id, eventType: 'ACCEPT' } })).toBe(1);
});
it('invalidates acceptance and outstanding proofs after another attempt', async () => {
  const o = await dispatched(), proof = await verify(o.customer, await otp(o.customer));
  expect((await decision(o.customer, proof)).status).toBe(201);
  expect((await f.request(o.delivery, { outcome: 'DELIVERY_ATTEMPTED' }, false)).status).toBe(201);
  expect((await f.transition(o.order.id, 'OUT_FOR_DELIVERY')).status).toBe(200);
  expect((await f.request(o.delivery, { outcome: 'DELIVERED_VERIFIED' }, false)).status).toBe(409);
  expect((await decision(o.customer, proof)).status).toBe(401);
  const order = await f.prisma.order.findUniqueOrThrow({ where: { id: o.order.id } });
  expect(order.deliveryAttempt).toBe(2); expect(order.acceptedAttempt).toBeNull();
});
it('checks state-specific decisions and requires a rejection reason', async () => {
  const o = await dispatched(), proof = await verify(o.customer, await otp(o.customer));
  expect((await decision(o.customer, proof, 'REJECT')).status).toBe(400);
  expect((await decision(o.customer, proof, 'REJECT', 'PACKAGE_DAMAGED')).status).toBe(201);
  await f.prisma.otpChallenge.updateMany({ where: { orderId: o.order.id }, data: { createdAt: new Date(Date.now() - 61_000) } });
  const nextProof = await verify(o.customer, await otp(o.customer));
  expect((await decision(o.customer, nextProof)).status).toBe(409);
  expect((await decision(o.customer, nextProof, 'REQUEST_REDELIVERY')).status).toBe(201);
  expect((await f.prisma.order.findUniqueOrThrow({ where: { id: o.order.id } })).status).toBe('REDELIVERY_REQUESTED');
});
it('completes exactly once under competing deliveries and rejects revoked retries', async () => {
  const o = await dispatched(), proof = await verify(o.customer, await otp(o.customer)); await decision(o.customer, proof);
  const results = await Promise.all(Array.from({ length: 8 }, () => f.request(o.delivery, { outcome: 'DELIVERED_VERIFIED' }, false)));
  expect(results.filter(r => r.status === 201)).toHaveLength(1);
  expect(results.filter(r => r.status === 404)).toHaveLength(7);
  expect(await f.prisma.orderEvent.count({ where: { orderId: o.order.id, eventType: 'DELIVERED_VERIFIED' } })).toBe(1);
  expect(await f.prisma.ledgerEntry.count({ where: { orderId: o.order.id } })).toBe(1);
  expect((await f.request(o.customer, undefined, false)).status).toBe(404);
});
it('expires customer acceptance before a late handoff', async () => {
  const o = await dispatched(), proof = await verify(o.customer, await otp(o.customer)); await decision(o.customer, proof);
  await f.prisma.order.update({ where: { id: o.order.id }, data: { acceptedUntil: new Date(0) } });
  expect((await f.request(o.delivery, { outcome: 'DELIVERED_VERIFIED' }, false)).status).toBe(409);
});
it('fails honestly when a real OTP provider is absent', async () => {
  const manual = await workflowFixture(false);
  try {
    const o = await manual.create();
    const response = await manual.request(`${new URL(o.qr.customerUrl).pathname}/request-otp`, {}, false);
    expect(response.status).toBe(503); expect((await response.json()).error.code).toBe('PROVIDER_UNAVAILABLE');
    expect(await manual.prisma.otpChallenge.count({ where: { orderId: o.order.id } })).toBe(0);
  } finally { await manual.close(); }
});
