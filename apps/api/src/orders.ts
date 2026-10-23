import type { Express } from 'express';
import type { Prisma, PrismaClient } from '@prisma/client';
import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import type { Config } from './config.js';
import { currentSeller, requireSeller } from './auth.js';
import { err } from './http.js';
import { hashToken } from './rules.js';
import { assertTransition, lockOrder, pagination, paginationSchema, reasonFields, statuses } from './domain.js';

const text = (max: number) => z.string().trim().min(1).max(max);
export const createOrderSchema = z.object({
  sellerReference: z.string().trim().max(100).optional(),
  customer: z.object({ name: text(160), phone: z.string().trim().regex(/^\+[1-9]\d{7,14}$/) }),
  deliveryAddress: z.object({ line1: text(200), line2: z.string().trim().max(200).optional(), city: text(160), state: text(160), postalCode: text(32) }),
});
const listSchema = paginationSchema.extend({ status: z.enum(statuses).optional(), q: z.string().trim().max(200).optional() });
const sellerTargets = new Set(['READY_FOR_DISPATCH','OUT_FOR_DELIVERY','REDELIVERY_REQUESTED','RETURN_INITIATED','RETURN_IN_TRANSIT','RETURNED_TO_SELLER','CANCELLED']);

export async function createOrder(prisma: PrismaClient, config: Config, sellerId: string, input: unknown) {
  const v = createOrderSchema.parse(input);
  const delivery = randomBytes(32).toString('base64url'), customer = randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + config.qrTokenTtlDays * 864e5);
  const order = await prisma.$transaction(async tx => {
    const order = await tx.order.create({ data: {
      sellerId, sellerReference: v.sellerReference || null, customerName: v.customer.name, customerPhone: v.customer.phone,
      addressLine1: v.deliveryAddress.line1, addressLine2: v.deliveryAddress.line2 || null,
      city: v.deliveryAddress.city, state: v.deliveryAddress.state, postalCode: v.deliveryAddress.postalCode,
    } });
    await tx.orderEvent.create({ data: { orderId: order.id, eventType: 'CREATED', toStatus: 'CREATED', actorType: 'SELLER', actorId: sellerId, source: config.demo ? 'DEMO' : 'MANUAL' } });
    await tx.qrToken.createMany({ data: [
      { orderId: order.id, purpose: 'DELIVERY', tokenHash: hashToken(delivery), expiresAt },
      { orderId: order.id, purpose: 'CUSTOMER', tokenHash: hashToken(customer), expiresAt },
    ] });
    return order;
  });
  return { order, qr: { deliveryUrl: `${config.appOrigin}/delivery/${delivery}`, customerUrl: `${config.appOrigin}/customer/${customer}` } };
}

export function registerOrderRoutes(app: Express, prisma: PrismaClient, config: Config) {
  const auth = requireSeller(prisma, config);
  app.get('/api/orders', auth, async (req, res) => {
    const { page, pageSize, status, q } = listSchema.parse(req.query);
    const where: Prisma.OrderWhereInput = { sellerId: currentSeller(res).id, status,
      ...(q ? { OR: [{ sellerReference: { contains: q, mode: 'insensitive' } }, { customerName: { contains: q, mode: 'insensitive' } }] } : {}),
    };
    const [items, total] = await prisma.$transaction([
      prisma.order.findMany({ where, skip: (page - 1) * pageSize, take: pageSize, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] }),
      prisma.order.count({ where }),
    ], { isolationLevel: 'RepeatableRead' });
    res.json({ items, page, pageSize, total });
  });
  app.post('/api/orders', auth, async (req, res) => res.status(201).json(await createOrder(prisma, config, currentSeller(res).id, req.body)));
  app.get('/api/orders/:id', auth, async (req, res) => {
    const result = await prisma.order.findFirst({ where: { id: String(req.params.id), sellerId: currentSeller(res).id }, include: { events: { orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] } } });
    if (!result) throw err('NOT_FOUND', 'Order not found', 404);
    const { events, ...order } = result;
    res.json({ order, events });
  });
  app.get('/api/orders/:id/events', auth, async (req, res) => {
    const { page, pageSize } = pagination(req.query), sellerId = currentSeller(res).id, orderId = String(req.params.id);
    const result = await prisma.$transaction(async tx => {
      if (!await tx.order.findFirst({ where: { id: orderId, sellerId } })) throw err('NOT_FOUND', 'Order not found', 404);
      const where = { orderId, order: { sellerId } };
      return { items: await tx.orderEvent.findMany({ where, skip: (page - 1) * pageSize, take: pageSize, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] }), total: await tx.orderEvent.count({ where }) };
    }, { isolationLevel: 'RepeatableRead' });
    res.json({ ...result, page, pageSize });
  });
  app.post('/api/orders/:id/transitions', auth, async (req, res) => {
    const v = z.object({ toStatus: z.enum(statuses), ...reasonFields }).parse(req.body);
    const sellerId = currentSeller(res).id;
    const result = await prisma.$transaction(async tx => {
      const before = await lockOrder(tx, String(req.params.id), sellerId);
      if (!sellerTargets.has(v.toStatus)) throw err('FORBIDDEN', 'This outcome requires the verified delivery/customer workflow', 403);
      assertTransition(before.status, v.toStatus);
      const order = await tx.order.update({ where: { id: before.id, sellerId }, data: { status: v.toStatus } });
      const event = await tx.orderEvent.create({ data: { orderId: order.id, eventType: v.toStatus, fromStatus: before.status, toStatus: v.toStatus, actorType: 'SELLER', actorId: sellerId, reasonCode: v.reasonCode, note: v.note, source: config.demo ? 'DEMO' : 'MANUAL' } });
      if (v.toStatus === 'CANCELLED') await tx.qrToken.updateMany({ where: { orderId: order.id }, data: { revokedAt: new Date() } });
      return { order, event };
    });
    res.json(result);
  });
}
