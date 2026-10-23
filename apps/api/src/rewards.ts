import type { Order, Prisma } from '@prisma/client';
import { err } from './http.js';
import { changeStatus } from './workflow.js';

/** Caller holds the order lock. Evidence, completion, event and credit share one transaction. */
export async function completeVerifiedDelivery(tx: Prisma.TransactionClient, before: Order, source: 'DEMO' | 'MANUAL', note?: string | null) {
  const now = new Date();
  const ineligible = () => err('CUSTOMER_ACCEPTANCE_REQUIRED', 'Customer must accept after OTP verification for this attempt', 409);
  if (before.status !== 'OUT_FOR_DELIVERY' || before.acceptedAttempt !== before.deliveryAttempt || !before.acceptedUntil || before.acceptedUntil <= now || !before.acceptedChallengeId) throw ineligible();
  const challenge = await tx.otpChallenge.findFirst({ where: {
    id: before.acceptedChallengeId, orderId: before.id, deliveryAttempt: before.deliveryAttempt,
    verifiedAt: { not: null }, consumedAt: { not: null }, verificationExpiresAt: { gt: now },
  } });
  if (!challenge || !challenge.verificationHash || !challenge.verifiedAt || !challenge.consumedAt || challenge.verifiedAt > challenge.consumedAt || challenge.verifiedAt >= challenge.expiresAt) throw ineligible();
  const customerToken = await tx.qrToken.findFirst({ where: { id: challenge.customerTokenId, orderId: before.id, purpose: 'CUSTOMER', revokedAt: null, expiresAt: { gt: now } } });
  const acceptance = await tx.orderEvent.findFirst({ where: {
    orderId: before.id, eventType: 'ACCEPT', actorType: 'CUSTOMER', fromStatus: 'OUT_FOR_DELIVERY', toStatus: 'OUT_FOR_DELIVERY',
    metadata: { path: ['deliveryAttempt'], equals: before.deliveryAttempt }, createdAt: { gte: challenge.verifiedAt },
  } });
  if (!customerToken || !acceptance) throw ineligible();
  const result = await changeStatus(tx, before, 'DELIVERED_VERIFIED', {
    eventType: 'DELIVERED_VERIFIED', actorType: 'DELIVERY', source, note,
    metadata: { deliveryAttempt: before.deliveryAttempt, outcome: 'DELIVERED_VERIFIED', acceptanceEventId: acceptance.id },
  });
  await tx.ledgerEntry.create({ data: {
    sellerId: before.sellerId, orderId: before.id, amountPaise: 500, currency: 'INR', type: 'DELIVERY_REWARD',
    eligibilityReason: 'OTP_VERIFIED_CUSTOMER_ACCEPTANCE_AND_DELIVERY_HANDOFF', createdAt: new Date(),
  } });
  return result;
}
