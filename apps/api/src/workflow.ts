import type { Order, Prisma } from '@prisma/client';
import { assertTransition } from './domain.js';
import { err } from './http.js';

export const clearAcceptance = { acceptedAttempt: null, acceptedUntil: null, acceptedChallengeId: null };
// Caller holds the order row lock. This is the only status-changing write service.
export async function changeStatus(tx: Prisma.TransactionClient, before: Order, to: string, event: Omit<Prisma.OrderEventUncheckedCreateInput, 'orderId' | 'fromStatus' | 'toStatus'>) {
  assertTransition(before.status, to);
  if (['RETURN_INITIATED', 'REDELIVERY_REQUESTED', 'CANCELLED', 'CUSTOMER_REJECTED', 'DELIVERY_FAILED'].includes(to) && !event.reasonCode) {
    throw err('REASON_REQUIRED', 'This change requires a structured reason', 400);
  }
  const order = await tx.order.update({ where: { id: before.id, sellerId: before.sellerId }, data: {
    status: to, ...clearAcceptance, ...(to === 'OUT_FOR_DELIVERY' ? { deliveryAttempt: { increment: 1 } } : {}),
  } });
  const recorded = await tx.orderEvent.create({ data: { ...event, orderId: before.id, fromStatus: before.status, toStatus: to, createdAt: new Date() } });
  // A change of lifecycle invalidates every outstanding OTP/proof, including earlier dispatches.
  await tx.otpChallenge.updateMany({ where: { orderId: before.id, consumedAt: null }, data: { consumedAt: new Date() } });
  if (to === 'CANCELLED' || to === 'DELIVERED_VERIFIED') {
    await tx.qrToken.updateMany({ where: { orderId: before.id }, data: { revokedAt: new Date() } });
  }
  return { order, event: recorded };
}
