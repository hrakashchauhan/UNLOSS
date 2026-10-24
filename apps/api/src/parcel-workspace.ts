import type { Express } from 'express';
import type { Prisma, PrismaClient } from '@prisma/client';
import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import type { Config } from './config.js';
import { currentSeller, currentUser, requireAnySession, requireSeller } from './auth.js';
import { err } from './http.js';
import { lockOrder, reasonFields } from './domain.js';
import { hashToken } from './rules.js';
import { sealToken, openToken } from './token-vault.js';
import { changeStatus } from './workflow.js';
import { broadcastLiveEvent } from './live-events.js';
import { completeVerifiedDelivery } from './rewards.js';
import { notifyEvent } from './notifications.js';

export const locationInput = z.object({ latitude: z.number().finite().min(-90).max(90), longitude: z.number().finite().min(-180).max(180), accuracyMeters: z.number().finite().positive().max(10000) });
export function nextPayoutMonday(now: Date) {
  const ist = new Date(now.getTime() + 330 * 60000);
  const days = 7 - ((ist.getUTCDay() + 6) % 7);
  return new Date(Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate() + days, 4, 30)); // Monday 10:00 IST
}
export function parcelScope(userId: string, sellerId?: string): Prisma.OrderWhereInput {
  return { OR: [...(sellerId ? [{ sellerId }] : []), { customerUserId: userId }, { claims: { some: { deliveryUserId: userId, status: 'APPROVED' } } }] };
}
const identity = { id: true, name: true, email: true } as const;
export function registerParcelWorkspace(app: Express, prisma: PrismaClient, config: Config) {
  const auth = requireAnySession(prisma, config);
  const signedIn: import('express').RequestHandler = (_req, res, next) => {
    if (!currentUser(res) && !res.locals.seller) return next(err('UNAUTHENTICATED', 'Sign in to access your parcels', 401));
    next();
  };
  const verified: import('express').RequestHandler = async (_req, res, next) => {
    try {
      const user = currentUser(res);
      const record = user && await prisma.user.findUnique({ where: { id: user.id }, select: { googleSubject: true } });
      if (!record?.googleSubject) throw err('VERIFIED_IDENTITY_REQUIRED', 'Use your assigned Google-verified account for parcel actions', 403);
      next();
    } catch (e) { next(e); }
  };
  const scope = (res: import('express').Response) => parcelScope(currentUser(res)?.id || '', res.locals.seller?.id);
  async function publish(orderId: string) {
    const order = await prisma.order.findUniqueOrThrow({ where: { id: orderId }, include: { claims: { where: { status: 'APPROVED' } } } });
    const userIds = [order.customerUserId, ...order.claims.map(c => c.deliveryUserId)].filter(Boolean);
    broadcastLiveEvent({ id: `parcel-${orderId}-${Date.now()}`, eventType: 'order.update', sellerId: order.sellerId, orderId, status: order.status, data: { userIds } });
  }
  app.get('/api/workspace/wallet', auth, signedIn, async (_req, res) => {
    const userId = currentUser(res)?.id;
    if (!userId) throw err('UNAUTHENTICATED', 'User account required', 401);
    if (!currentUser(res)?.roles.includes('DELIVERY')) throw err('FORBIDDEN', 'Courier dashboard access is required', 403);
    const [earnings, account, withdrawals] = await Promise.all([
      prisma.deliveryEarning.findMany({ where: { deliveryUserId: userId }, orderBy: { createdAt: 'desc' } }),
      prisma.payoutAccount.findUnique({ where: { userId }, select: { upiId: true, accountName: true, status: true } }),
      prisma.payoutTransfer.findMany({ where: { deliveryUserId: userId }, orderBy: { createdAt: 'desc' }, take: 50 }),
    ]);
    const now = new Date();
    res.json({ earnings, account, withdrawals, providerConnected: false,
      lockedPaise: earnings.filter(e => e.availableAt && e.availableAt > now && !e.payoutTransferId).reduce((n,e) => n+e.amountPaise,0),
      availablePaise: earnings.filter(e => e.availableAt && e.availableAt <= now && !e.payoutTransferId && ['PENDING','SIMULATED_CREDIT'].includes(e.status)).reduce((n,e) => n+e.amountPaise,0),
      totalPaise: earnings.reduce((n,e) => n+e.amountPaise,0) });
  });
  app.post('/api/workspace/wallet/account', auth, signedIn, verified, async (req, res) => {
    if (!currentUser(res)?.roles.includes('DELIVERY')) throw err('FORBIDDEN', 'Courier dashboard access is required', 403);
    const v = z.object({ upiId: z.string().trim().regex(/^[a-zA-Z0-9._-]{2,128}@[a-zA-Z0-9.-]{2,64}$/), accountName: z.string().trim().min(2).max(120) }).parse(req.body);
    await prisma.payoutAccount.upsert({ where: { userId: currentUser(res)!.id }, create: { userId: currentUser(res)!.id, method: 'UPI', ...v, status: 'PENDING' }, update: { ...v, method: 'UPI', status: 'PENDING', verifiedAt: null } });
    res.json({ status: 'PENDING_VERIFICATION' });
  });
  app.post('/api/workspace/wallet/withdraw', auth, signedIn, verified, async (req, res) => {
    if (!currentUser(res)?.roles.includes('DELIVERY')) throw err('FORBIDDEN', 'Courier dashboard access is required', 403);
    z.object({ simulate: z.literal(true) }).parse(req.body);
    const userId = currentUser(res)!.id;
    const transfer = await prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${userId} FOR UPDATE`;

      const eligible = await tx.deliveryEarning.findMany({ where: { deliveryUserId: userId, availableAt: { lte: new Date() }, payoutTransferId: null, status: { in: ['PENDING', 'SIMULATED_CREDIT'] } } });
      if (!eligible.length) throw err('HOLD_ACTIVE', 'No unrequested credit has completed the seven-day hold', 409);
      const amountPaise = eligible.reduce((n,e) => n + e.amountPaise, 0);
      const now = new Date(); const weekStart = new Date(Date.UTC(now.getUTCFullYear(),now.getUTCMonth(),now.getUTCDate()-((now.getUTCDay()+6)%7)));
      const batch = await tx.payoutBatch.upsert({ where: { weekStart }, update: {}, create: { weekStart, weekEnd: new Date(weekStart.getTime()+7*864e5), scheduledFor: nextPayoutMonday(now), status: 'PENDING_PROVIDER' } });
      const transfer = await tx.payoutTransfer.create({ data: { batchId: batch.id, deliveryUserId: userId, amountPaise, status: 'SIMULATED', processedAt: new Date(), idempotencyKey: randomBytes(24).toString('hex') } });
      await tx.deliveryEarning.updateMany({ where: { id: { in: eligible.map(e=>e.id) } }, data: { payoutTransferId: transfer.id, status: 'SIMULATED_PAYOUT' } });
      return transfer;
    });
    res.status(201).json({ transfer, message: 'Simulation complete. The withdrawal receipt is saved; no bank transfer was made and no real money was sent.' });
  });
  app.get('/api/workspace/parcels', auth, signedIn, async (_req, res) => {
    const items = await prisma.order.findMany({ where: scope(res), orderBy: { updatedAt: 'desc' }, take: 100, select: { id: true, sellerReference: true, itemName: true, status: true, updatedAt: true } });
    res.json({ items });
  });
  app.get('/api/workspace/resolve/:purpose/:token', auth, signedIn, async (req, res) => {
    const purpose = z.enum(['customer', 'delivery']).parse(req.params.purpose).toUpperCase();
    const token = await prisma.qrToken.findFirst({ where: { tokenHash: hashToken(String(req.params.token)), purpose, revokedAt: null, expiresAt: { gt: new Date() }, order: scope(res) }, select: { orderId: true } });
    if (!token) throw err('NOT_FOUND', 'This QR is unavailable or your account is not assigned to this parcel', 404);
    res.json(token);
  });
  app.post('/api/workspace/scan/:purpose/:token', auth, signedIn, verified, async (req, res) => {
    const purpose = z.enum(['customer','delivery']).parse(req.params.purpose).toUpperCase();
    const user = currentUser(res);
    if (!user) throw err('FORBIDDEN', 'QR checks require the assigned Google-verified customer or courier account', 403);
    const userId = user.id;
    const result = await prisma.$transaction(async tx => {
      const token = await tx.qrToken.findFirst({ where: { tokenHash: hashToken(String(req.params.token)), purpose, revokedAt: null, expiresAt: { gt: new Date() } } });
      if (!token) throw err('NOT_FOUND', 'QR unavailable', 404);
      const order = await lockOrder(tx, token.orderId);
      const permitted = purpose === 'CUSTOMER' ? order.customerUserId === userId : !!await tx.parcelClaim.findFirst({ where: { orderId: order.id, deliveryUserId: userId, status: 'APPROVED' } });
      if (!permitted) throw err('FORBIDDEN', 'Only the assigned account can confirm this QR', 403);
      if (order.status !== 'OUT_FOR_DELIVERY') throw err('CONFLICT', 'QR confirmation starts after dispatch', 409);
      const already = await tx.orderEvent.findFirst({ where: { orderId: order.id, actorId: userId, eventType: 'QR_CHECKED', metadata: { path: ['deliveryAttempt'], equals: order.deliveryAttempt } } });
      if (!already) await tx.orderEvent.create({ data: { orderId: order.id, eventType: 'QR_CHECKED', actorType: purpose, actorId: userId, source: 'MANUAL', metadata: { deliveryAttempt: order.deliveryAttempt, purpose } } });
      return { orderId: order.id };
    });
    await publish(result.orderId); res.json(result);
  });
  app.get('/api/workspace/parcels/:id', auth, signedIn, async (req, res) => {
    const order = await prisma.order.findFirst({ where: { id: String(req.params.id), ...scope(res) }, include: { customerUser: { select: identity }, claims: { where: { status: 'APPROVED' }, include: { deliveryUser: { select: identity } } }, locations: { where: { purgedAt: null, purgeAt: { gt: new Date() } }, orderBy: { createdAt: 'desc' }, take: 150 }, events: { orderBy: { createdAt: 'desc' }, take: 60 }, earning: true, reservation: true } });
    if (!order) throw err('NOT_FOUND', 'Parcel not found', 404);
    const userId = currentUser(res)?.id;
    const sellerAccess = order.sellerId === res.locals.seller?.id;
    const customerAccess = order.customerUserId === userId;
    const deliveryAccess = order.claims.some(c => c.deliveryUserId === userId);
    const safeOrder = sellerAccess ? order : {
      ...order,
      sellerId: undefined,
      customerPhone: undefined,
      reservation: undefined,
      earning: deliveryAccess ? order.earning : undefined,
      claims: order.claims.map(claim => ({ ...claim, deliveryUser: deliveryAccess ? claim.deliveryUser : { id: '', name: 'Assigned courier', email: '' } })),
      customerUser: customerAccess ? order.customerUser : { id: '', name: 'Recipient', email: '' },
    };
    res.json({ order: safeOrder, access: { seller: sellerAccess, customer: customerAccess, delivery: deliveryAccess }, nextPayoutAt: nextPayoutMonday(new Date()), paymentsEnabled: false });
  });
  app.get('/api/workspace/parcels/:id/qr', auth, signedIn, verified, async (req, res) => {
    const userId = currentUser(res)!.id;
    const order = await prisma.order.findFirst({ where: { id: String(req.params.id), ...scope(res) }, select: { id: true, customerUserId: true } });
    if (!order) throw err('NOT_FOUND', 'Parcel not found', 404);
    const purpose = order.customerUserId === userId ? 'CUSTOMER' : await prisma.parcelClaim.findFirst({ where: { orderId: order.id, deliveryUserId: userId, status: 'APPROVED' } }) ? 'DELIVERY' : null;
    if (!purpose) throw err('FORBIDDEN', 'Only the assigned recipient or courier can retrieve their QR', 403);
    const saved = await prisma.qrToken.findFirst({ where: { orderId: order.id, purpose, revokedAt: null, expiresAt: { gt: new Date() } }, orderBy: { createdAt: 'desc' } });
    if (!saved?.encryptedToken) throw err('QR_UNAVAILABLE', 'The seller must issue a current parcel QR label', 409);
    res.json({ url: `${config.appOrigin}/${purpose.toLowerCase()}/${openToken(saved.encryptedToken, config.sessionSecret)}` });
  });
  app.post('/api/orders/:id/participants', requireSeller(prisma, config), async (req, res) => {
    const v = z.object({ customerEmail: z.string().trim().toLowerCase().email(), courierEmail: z.string().trim().toLowerCase().email() }).parse(req.body);
    const sellerId = currentSeller(res).id;
    await prisma.$transaction(async tx => {
      const order = await lockOrder(tx, String(req.params.id), sellerId);
      if (!['CREATED', 'READY_FOR_DISPATCH', 'REDELIVERY_REQUESTED'].includes(order.status)) throw err('CONFLICT', 'Assign accounts before dispatch', 409);
      const customer = await tx.user.findUnique({ where: { email: v.customerEmail } });
      const courier = await tx.user.findUnique({ where: { email: v.courierEmail } });
      const seller = await tx.seller.findUniqueOrThrow({ where: { id: sellerId } });
      if (!customer?.googleSubject || !courier?.googleSubject || customer.status !== 'ACTIVE' || courier.status !== 'ACTIVE') throw err('VERIFIED_IDENTITY_REQUIRED', 'Both people must first sign in with Google using these email addresses', 400);
      const [customerMembership, courierMembership, courierProfile] = await Promise.all([
        tx.roleMembership.findFirst({ where: { userId: customer.id, role: 'CUSTOMER', status: 'ACTIVE' } }),
        tx.roleMembership.findFirst({ where: { userId: courier.id, role: 'DELIVERY', status: 'ACTIVE' } }),
        tx.deliveryProfile.findUnique({ where: { userId: courier.id }, select: { reviewStatus: true } }),
      ]);
      if (!customerMembership) throw err('FORBIDDEN', 'Recipient must have an active customer account', 400);
      if (!courierMembership || courierProfile?.reviewStatus !== 'APPROVED') throw err('FORBIDDEN', 'Courier account must be approved by an administrator before assignment', 400);
      if (customer.id === courier.id || customer.id === seller.userId || courier.id === seller.userId) throw err('CONFLICT', 'Seller, recipient and courier must be different people', 400);
      await tx.order.update({ where: { id: order.id }, data: { customerUserId: customer.id, acceptedAttempt: null, acceptedUntil: null, acceptedChallengeId: null } });
      await tx.parcelClaim.updateMany({ where: { orderId: order.id, status: { in: ['PENDING', 'APPROVED'] } }, data: { status: 'REPLACED', decidedAt: new Date() } });
      await tx.parcelClaim.create({ data: { orderId: order.id, deliveryUserId: courier.id, status: 'APPROVED', decidedBy: seller.userId, decidedAt: new Date(), note: 'Seller assigned this courier to this parcel only' } });
      await tx.orderEvent.create({ data: { orderId: order.id, eventType: 'PARTICIPANTS_ASSIGNED', actorType: 'SELLER', actorId: sellerId, source: 'MANUAL', metadata: { customerUserId: customer.id, deliveryUserId: courier.id } } });
      await tx.appNotification.createMany({ data: [customer.id, courier.id].map(userId => ({ userId, type: 'PARCEL_ASSIGNED', title: 'Parcel assigned', body: 'Open My parcels to view your delivery and next steps.', orderId: order.id })) });
    });
    await publish(String(req.params.id));
    res.json({ status: 'ASSIGNED' });
  });
  app.post('/api/orders/:id/qr', requireSeller(prisma, config), async (req, res) => {
    const qr = await prisma.$transaction(async tx => {
      const order = await lockOrder(tx, String(req.params.id), currentSeller(res).id);
      if (['CANCELLED', 'DELIVERED_VERIFIED'].includes(order.status)) throw err('CONFLICT', 'Completed or cancelled labels cannot be reissued', 409);
      const result: Record<string, string> = {};
      for (const purpose of ['DELIVERY', 'CUSTOMER']) {
        const saved = await tx.qrToken.findFirst({ where: { orderId: order.id, purpose, revokedAt: null, expiresAt: { gt: new Date() } }, orderBy: { createdAt: 'desc' } });
        let raw: string;
        if (saved?.encryptedToken) raw = openToken(saved.encryptedToken, config.sessionSecret);
        else {
          raw = randomBytes(32).toString('base64url');
          await tx.qrToken.updateMany({ where: { orderId: order.id, purpose }, data: { revokedAt: new Date() } });
          await tx.qrToken.create({ data: { orderId: order.id, purpose, tokenHash: hashToken(raw), encryptedToken: sealToken(raw, config.sessionSecret), expiresAt: new Date(Date.now() + config.qrTokenTtlDays * 864e5) } });
        }
        result[purpose === 'DELIVERY' ? 'deliveryUrl' : 'customerUrl'] = `${config.appOrigin}/${purpose.toLowerCase()}/${raw}`;
      }
      return result;
    });
    res.json({ qr });
  });
  app.post('/api/workspace/parcels/:id/location', auth, signedIn, verified, async (req, res) => {
    const v = locationInput.extend({ kind: z.enum(['DESTINATION', 'COURIER_LOCATION', 'CUSTOMER_LOCATION']), source: z.enum(['DEVICE', 'MAP_PIN']).default('DEVICE') }).parse(req.body);
    if (v.source === 'MAP_PIN' && v.kind !== 'DESTINATION') throw err('VALIDATION_ERROR', 'Only destination pins can be selected manually', 400);
    const userId = currentUser(res)!.id;
    const location = await prisma.$transaction(async tx => {
      const order = await lockOrder(tx, String(req.params.id));
      const seller = order.sellerId === res.locals.seller?.id;
      const claim = await tx.parcelClaim.findFirst({ where: { orderId: order.id, deliveryUserId: userId, status: 'APPROVED' } });
      const customer = order.customerUserId === userId;
      if (v.kind === 'DESTINATION' ? !seller && !customer : v.kind === 'COURIER_LOCATION' ? !claim : !customer) throw err('FORBIDDEN', 'You cannot update this parcel location', 403);
      if (['CANCELLED', 'DELIVERED_VERIFIED'].includes(order.status)) throw err('CONFLICT', 'Location sharing has ended for this parcel', 409);
      if (v.kind === 'COURIER_LOCATION' && order.status !== 'OUT_FOR_DELIVERY') throw err('CONFLICT', 'Courier location sharing starts after dispatch', 409);
      const recent = await tx.locationEvidence.findFirst({ where: { orderId: order.id, kind: v.kind, createdAt: { gt: new Date(Date.now() - 10000) } } });
      if (recent) throw err('RATE_LIMITED', 'Wait ten seconds before the next location update', 429);
      return tx.locationEvidence.create({ data: { orderId: order.id, deliveryUserId: claim?.deliveryUserId, claimId: claim?.id, kind: v.kind, status: v.source === 'MAP_PIN' ? 'MANUAL_PIN' : 'DEVICE_REPORTED', latitude: v.latitude, longitude: v.longitude, accuracyMeters: v.source === 'MAP_PIN' ? null : v.accuracyMeters, capturedAt: new Date(), purgeAt: new Date(Date.now() + 30 * 864e5) } });
    });
    await publish(String(req.params.id));
    res.status(201).json({ location });
  });
  app.post('/api/workspace/parcels/:id/decision', auth, signedIn, verified, async (req, res) => {
    const v = z.object({ action: z.enum(['ACCEPT', 'REJECT', 'REQUEST_REDELIVERY']), ...reasonFields }).parse(req.body);
    const userId = currentUser(res)!.id;
    await prisma.$transaction(async tx => {
      const order = await lockOrder(tx, String(req.params.id));
      if (order.customerUserId !== userId) throw err('FORBIDDEN', 'Only the assigned recipient can decide', 403);
      throw err('OTP_REQUIRED', 'Scan your recipient QR and confirm your decision with the delivery OTP', 409);
    });
    await publish(String(req.params.id)); res.json({ status: 'RECORDED' });
  });
  app.post('/api/workspace/parcels/:id/handoff', auth, signedIn, verified, async (req, res) => {
    const userId = currentUser(res)!.id;
    await prisma.$transaction(async tx => {
      const order = await lockOrder(tx, String(req.params.id));
      const claim = await tx.parcelClaim.findFirst({ where: { orderId: order.id, deliveryUserId: userId, status: 'APPROVED' } });
      if (!claim || order.customerUserId === userId) throw err('FORBIDDEN', 'Only the assigned courier can complete this delivery', 403);
      if (order.status === 'DELIVERED_VERIFIED') return;
      if (order.status !== 'OUT_FOR_DELIVERY' || order.acceptedAttempt !== order.deliveryAttempt || !order.acceptedUntil || order.acceptedUntil <= new Date() || !order.acceptedChallengeId) throw err('ACCEPTANCE_REQUIRED', 'The assigned recipient must accept this attempt after OTP verification', 409);
      const scan = await tx.orderEvent.findFirst({ where: { orderId: order.id, eventType: 'QR_CHECKED', actorId: userId, actorType: 'DELIVERY', metadata: { path: ['deliveryAttempt'], equals: order.deliveryAttempt } } });
      if (!scan) throw err('QR_REQUIRED', 'Open the parcel delivery QR and confirm the scan for this attempt before completing handoff', 409);
      const location = await tx.locationEvidence.findFirst({ where: { orderId: order.id, claimId: claim.id, kind: 'COURIER_LOCATION', purgedAt: null, capturedAt: { gt: new Date(Date.now() - 5 * 60000) }, accuracyMeters: { lte: 200 } } });
      if (!location) throw err('LOCATION_REQUIRED', 'Share a fresh location with accuracy of 200 metres or better before handoff', 409);
      const completed = await completeVerifiedDelivery(tx, order, 'MANUAL');
      const event = await tx.orderEvent.update({ where: { id: completed.event.id }, data: { actorId: userId, metadata: { deliveryAttempt: order.deliveryAttempt, claimId: claim.id, locationId: location.id, verification: 'OTP_AND_ASSIGNED_COURIER' } } });
      await notifyEvent(tx, completed.order, event);
      await tx.parcelClaim.update({ where: { id: claim.id }, data: { handoffAt: new Date() } });
      const reservation = await tx.budgetReservation.findUnique({ where: { orderId: order.id } });
      if (reservation?.status === 'RESERVED') {
        await tx.budgetReservation.update({ where: { id: reservation.id }, data: { status: 'CONSUMED', consumedAt: new Date() } });
        await tx.fundingAccount.update({ where: { sellerId: order.sellerId }, data: { reservedPaise: { decrement: reservation.totalPaise }, availablePaise: { increment: reservation.feeAllowancePaise } } });

      }
      await tx.deliveryEarning.create({ data: { orderId: order.id, sellerId: order.sellerId, deliveryUserId: userId, amountPaise: 500, status: reservation?.status === 'RESERVED' ? 'PENDING' : 'SIMULATED_CREDIT', availableAt: new Date(Date.now() + 7 * 864e5) } });
    });
    await publish(String(req.params.id)); res.json({ status: 'DELIVERED_VERIFIED' });
  });
}
