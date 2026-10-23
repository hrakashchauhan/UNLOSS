import type { Order, OrderEvent, Prisma } from '@prisma/client';

/** In-app records only. No SMS/email/provider delivery is implied. */
export async function notifyEvent(tx: Prisma.TransactionClient, order: Order, event: OrderEvent) {
  const demo = event.source === 'DEMO' ? 'DEMO — ' : '';
  const reward = event.eventType === 'DELIVERED_VERIFIED' ? ' Internal reward ledger credit: INR 5; no payout.' : '';
  await tx.notification.create({ data: {
    sellerId: order.sellerId, title: `${demo}${event.eventType.replaceAll('_', ' ')}`,
    body: `Order ${order.id.slice(-8)}: ${event.eventType.replaceAll('_', ' ')} recorded by ${event.actorType}.${reward} In-app notification only.`,
    createdAt: new Date(),
  } });
}
