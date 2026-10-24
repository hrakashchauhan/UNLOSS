import type { Express } from 'express';
import type { PrismaClient } from '@prisma/client';
import { z } from 'zod';
import type { Config } from './config.js';
import { currentSeller, currentUser, requireAnySession, requireRole, requireSeller } from './auth.js';
import { err } from './http.js';
import { lockOrder } from './domain.js';
import { broadcastLiveEvent } from './live-events.js';

const retentionDays = 30;

export function registerDeliveryClaimRoutes(app: Express, prisma: PrismaClient, config: Config) {
  const auth = requireAnySession(prisma, config);
  const deliveryOnly = [auth, requireRole(['DELIVERY'])];
  const sellerOnly = [requireSeller(prisma, config)];
  const adminOnly = [auth, requireRole(['ADMIN'])];

  app.get('/api/delivery/pending', ...deliveryOnly, async (req, res) => {
    const user = currentUser(res)!;
    if (!config.demo) {
      const profile = await prisma.deliveryProfile.findUnique({ where: { userId: user.id } });
      if (profile?.reviewStatus !== 'APPROVED') throw err('FORBIDDEN', 'Delivery account requires review', 403);
      const orders = await prisma.order.findMany({ where: { status: 'OUT_FOR_DELIVERY', claims: { some: { deliveryUserId: user.id, status: 'APPROVED' } } }, include: { shipment: true }, take: 50 });
      res.json({ items: orders });
      return;
    }
    const orders = await prisma.order.findMany({ where: { status: 'OUT_FOR_DELIVERY', claims: { none: { deliveryUserId: user.id, status: { in: ['PENDING', 'APPROVED'] } } } }, include: { shipment: true }, take: 50, orderBy: { createdAt: 'desc' } });
    res.json({ items: orders });
  });

  app.post('/api/orders/:id/claim', ...deliveryOnly, async (req, res) => {
    const user = currentUser(res)!;
    const orderId = String(req.params.id);
    const v = z.object({ latitude: z.number().optional(), longitude: z.number().optional(), accuracyMeters: z.number().optional() }).parse(req.body || {});
    const profile = await prisma.deliveryProfile.findUnique({ where: { userId: user.id } });
    if (!profile || profile.reviewStatus !== 'APPROVED') throw err('FORBIDDEN', 'Delivery account pending review or not approved', 403);
    const result = await prisma.$transaction(async tx => {
      await lockOrder(tx, orderId);
      const order = await tx.order.findUnique({ where: { id: orderId } });
      if (!order || order.status !== 'OUT_FOR_DELIVERY') throw err('CONFLICT', 'Order not claimable', 409);
      const existing = await tx.parcelClaim.findFirst({ where: { orderId, status: { in: ['PENDING', 'APPROVED'] } } });
      if (existing) throw err('CONFLICT', 'A claim is already pending or approved', 409);
      const claim = await tx.parcelClaim.create({ data: { orderId, deliveryUserId: user.id, status: 'PENDING' } });
      const purgeAt = new Date(Date.now() + retentionDays * 864e5);
      await tx.locationEvidence.create({ data: { orderId, deliveryUserId: user.id, claimId: claim.id, kind: 'CLAIM_SUBMISSION', status: v.latitude !== undefined ? 'CAPTURED' : 'DENIED', latitude: v.latitude, longitude: v.longitude, accuracyMeters: v.accuracyMeters, capturedAt: v.latitude !== undefined ? new Date() : null, failureReason: v.latitude === undefined ? 'PERMISSION_DENIED' : null, purgeAt } });
      await tx.orderEvent.create({ data: { orderId, eventType: 'CLAIM_SUBMITTED', toStatus: order.status, actorType: 'DELIVERY', actorId: user.id, source: config.demo ? 'DEMO' : 'MANUAL' } });
      return { claim, sellerId: order.sellerId };
    });
    broadcastLiveEvent({
      id: `claim-${result.claim.id}`,
      eventType: 'claim.submitted',
      orderId,
      sellerId: result.sellerId,
      actorType: 'DELIVERY',
      data: { claimId: result.claim.id, deliveryUserId: user.id },
    });
    res.status(201).json({ claim: result.claim });
  });

  app.get('/api/seller/claims', ...sellerOnly, async (req, res) => {
    const seller = currentSeller(res);
    const claims = await prisma.parcelClaim.findMany({ where: { order: { sellerId: seller.id }, status: 'PENDING' }, include: { order: true, deliveryUser: { select: { id: true, name: true, email: true } } }, orderBy: { claimedAt: 'asc' } });
    res.json({ items: claims });
  });

  app.post('/api/seller/claims/:id/decide', ...sellerOnly, async (req, res) => {
    const seller = currentSeller(res);
    const v = z.object({ action: z.enum(['APPROVE', 'REJECT']), reason: z.string().trim().max(500).optional() }).parse(req.body);
    if (v.action === 'REJECT' && !v.reason) throw err('REASON_REQUIRED', 'Rejection reason required', 400);
    const result = await prisma.$transaction(async tx => {
      const claim = await tx.parcelClaim.findFirst({ where: { id: String(req.params.id), status: 'PENDING', order: { sellerId: seller.id } }, include: { order: true } });
      if (!claim) throw err('NOT_FOUND', 'Claim not found', 404);
      const sellerRecord = await tx.seller.findUnique({ where: { id: seller.id }, select: { userId: true } });
      const updated = await tx.parcelClaim.update({
        where: { id: claim.id },
        data: {
          status: v.action === 'APPROVE' ? 'APPROVED' : 'REJECTED',
          decidedAt: new Date(),
          decidedBy: sellerRecord?.userId || null,
          rejectionReason: v.reason || null,
        },
      });
      await tx.orderEvent.create({
        data: {
          orderId: claim.orderId,
          eventType: v.action === 'APPROVE' ? 'CLAIM_APPROVED' : 'CLAIM_REJECTED',
          toStatus: claim.order.status,
          actorType: 'SELLER',
          actorId: seller.id,
          reasonCode: v.reason ? 'OTHER' : null,
          note: v.reason || null,
          source: config.demo ? 'DEMO' : 'MANUAL',
        },
      });
      return updated;
    });
    broadcastLiveEvent({
      id: `decision-${result.id}`,
      eventType: 'claim.decided',
      orderId: result.orderId,
      sellerId: seller.id,
      actorType: 'SELLER',
      data: { claimId: result.id, status: result.status, deliveryUserId: result.deliveryUserId },
    });
    res.json({ claim: result });
  });

  app.get('/api/admin/delivery-accounts', ...adminOnly, async (_req, res) => {
    const items = await prisma.deliveryProfile.findMany({ include: { user: { select: { id: true, name: true, email: true } } }, orderBy: { createdAt: 'asc' } });
    res.json({ items });
  });

  app.post('/api/admin/delivery-accounts/:id/review', ...adminOnly, async (req, res) => {
    const v = z.object({ action: z.enum(['APPROVE', 'REJECT']), reason: z.string().trim().max(500).optional() }).parse(req.body);
    if (v.action === 'REJECT' && !v.reason) throw err('REASON_REQUIRED', 'Rejection reason required', 400);
    const reviewer = currentUser(res)!;
    const profile = await prisma.$transaction(async tx => {
      const current = await tx.deliveryProfile.findUnique({ where: { id: String(req.params.id) } });
      if (!current) throw err('NOT_FOUND', 'Delivery application not found', 404);
      const status = v.action === 'APPROVE' ? 'APPROVED' : 'REJECTED';
      const updated = await tx.deliveryProfile.update({ where: { id: current.id }, data: { reviewStatus: status, reviewedBy: reviewer.id, reviewedAt: new Date(), rejectionReason: v.reason || null } });
      await tx.roleMembership.upsert({ where: { userId_role: { userId: current.userId, role: 'DELIVERY' } }, create: { userId: current.userId, role: 'DELIVERY', status: status === 'APPROVED' ? 'ACTIVE' : 'REJECTED', grantedBy: reviewer.id }, update: { status: status === 'APPROVED' ? 'ACTIVE' : 'REJECTED', grantedBy: reviewer.id, grantedAt: new Date() } });
      await tx.auditLog.create({ data: { actorUserId: reviewer.id, actorRole: 'ADMIN', action: `DELIVERY_APPLICATION_${v.action}`, entityType: 'DeliveryProfile', entityId: updated.id, metadata: { userId: current.userId, reason: v.reason || null } } });
      await tx.appNotification.create({ data: { userId: current.userId, type: 'DELIVERY_APPLICATION_REVIEWED', title: status === 'APPROVED' ? 'Delivery account approved' : 'Delivery application update', body: status === 'APPROVED' ? 'Your delivery account is approved. Sign in to open your delivery dashboard.' : `Your delivery application was not approved. ${v.reason || 'Contact support for next steps.'}` } });
      return updated;
    });
    res.json({ profile });
  });
}
