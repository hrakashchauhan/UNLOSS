import type { Order, OrderEvent, Prisma, PrismaClient } from '@prisma/client';
import { hashToken } from './rules.js';
import { err } from './http.js';

export type QrPurpose = 'DELIVERY' | 'CUSTOMER';
export const deliveryOutcomes = ['DELIVERY_ATTEMPTED','CUSTOMER_UNAVAILABLE','CUSTOMER_REJECTED','ADDRESS_ISSUE','DELIVERED_VERIFIED'] as const;
export function customerActions(status: string) {
  if (status === 'OUT_FOR_DELIVERY') return ['ACCEPT', 'REJECT', 'REQUEST_REDELIVERY'];
  if (['DELIVERY_ATTEMPTED','CUSTOMER_REJECTED','DELIVERY_FAILED','RETURNED_TO_SELLER'].includes(status)) return ['REQUEST_REDELIVERY'];
  return [];
}
export const tokenInvalid = () => err('TOKEN_INVALID', 'Token is invalid', 404);
export async function getQrToken(db: PrismaClient | Prisma.TransactionClient, value: string, purpose: QrPurpose) {
  if (!/^[A-Za-z0-9_-]{43}$/.test(value)) throw tokenInvalid();
  const token = await db.qrToken.findUnique({ where: { tokenHash: hashToken(value) }, include: { order: true } });
  const eligible = token && (purpose === 'DELIVERY' ? token.order.status === 'OUT_FOR_DELIVERY' : customerActions(token.order.status).length > 0);
  if (!token || token.purpose !== purpose || token.revokedAt || token.expiresAt <= new Date() || !eligible) throw tokenInvalid();
  return token;
}
export const publicOrder = (order: Order) => ({ orderReference: order.sellerReference || order.id.slice(-8), status: order.status });
export const publicEvent = (event: OrderEvent) => ({
  id: event.id, eventType: event.eventType, fromStatus: event.fromStatus, toStatus: event.toStatus,
  actorType: event.actorType, reasonCode: event.reasonCode, source: event.source, createdAt: event.createdAt,
});
