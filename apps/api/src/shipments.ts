import type { Express } from 'express';
import type { PrismaClient } from '@prisma/client';
import { z } from 'zod';
import type { Config } from './config.js';
import { currentSeller, requireSeller } from './auth.js';
import { err } from './http.js';
import { lockOrder } from './domain.js';

export function registerShipmentRoutes(app: Express, prisma: PrismaClient, config: Config) {
  const auth = requireSeller(prisma, config);

  app.post('/api/orders/:id/shipment', auth, async (req, res) => {
    const sellerId = currentSeller(res).id;
    const v = z.object({ courier: z.string().trim().min(1).max(80), trackingNumber: z.string().trim().min(1).max(80) }).parse(req.body);
    const result = await prisma.$transaction(async tx => {
      await lockOrder(tx, String(req.params.id), sellerId);
      const order = await tx.order.findUniqueOrThrow({ where: { id: String(req.params.id) } });
      const shipment = await tx.shipment.upsert({ where: { orderId: order.id }, update: { courier: v.courier, trackingNumber: v.trackingNumber, registeredAt: new Date(), lastSyncedAt: null }, create: { orderId: order.id, courier: v.courier, trackingNumber: v.trackingNumber, registeredAt: new Date() } });
      await tx.orderEvent.create({ data: { orderId: order.id, eventType: 'SHIPMENT_REGISTERED', toStatus: order.status, actorType: 'SELLER', actorId: sellerId, source: config.demo ? 'DEMO' : 'MANUAL', metadata: { courier: v.courier, trackingNumber: v.trackingNumber, provider: 'AFTERSHIP' } } });
      return shipment;
    });
    res.status(201).json({ shipment: result, provider: 'AFTERSHIP' });
  });

  app.post('/api/integrations/aftership/webhook', async (req, res) => {
    if (!config.demo) throw err('PROVIDER_UNAVAILABLE', 'Verified courier webhooks are not configured', 503);
    // Signed webhook verification to be enforced in production; in local demo we accept structured updates with idempotency
    const v = z.object({ trackingNumber: z.string(), providerShipmentId: z.string().optional(), status: z.string(), message: z.string().optional(), occurredAt: z.string(), providerEventId: z.string() }).parse(req.body);
    const shipment = await prisma.shipment.findFirst({ where: { trackingNumber: v.trackingNumber } });
    if (!shipment) return res.status(202).json({ accepted: false });
    const occurredAt = new Date(v.occurredAt);
    const existing = await prisma.shipmentEvent.findUnique({ where: { providerEventId: v.providerEventId } });
    if (existing) return res.status(200).json({ accepted: true, duplicate: true });
    await prisma.$transaction(async tx => {
      await tx.shipmentEvent.create({ data: { shipmentId: shipment.id, providerEventId: v.providerEventId, status: v.status, message: v.message, occurredAt, metadata: req.body as object } });
      await tx.shipment.update({ where: { id: shipment.id }, data: { courierStatus: v.status, lastCourierEventAt: occurredAt, lastSyncedAt: new Date() } });
      await tx.orderEvent.create({ data: { orderId: shipment.orderId, eventType: 'COURIER_UPDATE', toStatus: (await tx.order.findUnique({ where: { id: shipment.orderId } }))?.status, actorType: 'SYSTEM', source: 'INTEGRATION', metadata: { courierStatus: v.status, provider: 'AFTERSHIP', occurredAt: occurredAt.toISOString() } } });
    });
    res.status(200).json({ accepted: true });
  });

  app.get('/api/orders/:id/shipment', auth, async (req, res) => {
    const sellerId = currentSeller(res).id;
    const order = await prisma.order.findFirst({ where: { id: String(req.params.id), sellerId }, include: { shipment: { include: { events: { orderBy: { occurredAt: 'desc' }, take: 20 } } } } });
    if (!order) throw err('NOT_FOUND', 'Order not found', 404);
    res.json({ shipment: order.shipment });
  });
}
