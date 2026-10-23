import type { Express } from 'express';
import type { Prisma, PrismaClient } from '@prisma/client';
import { createHmac, randomBytes, randomInt, randomUUID, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import type { Config } from './config.js';
import { err, HttpError } from './http.js';
import { hashToken } from './rules.js';
import { lockOrder, reasonFields } from './domain.js';
import { customerActions, deliveryOutcomes, getQrToken, publicEvent, publicOrder, type QrPurpose } from './qr.js';
import { changeStatus } from './workflow.js';
import { completeVerifiedDelivery } from './rewards.js';
import { notifyEvent } from './notifications.js';

const randomToken = () => randomBytes(32).toString('base64url');
const codeDigest = (secret: string, id: string, code: string) => createHmac('sha256', secret).update(`otp\0${id}\0${code}`).digest('hex');
// Revalidate token *after* the order lock: cancellation/expiry/status can change while waiting.
async function lockedToken(tx: Prisma.TransactionClient, raw: string, purpose: QrPurpose) {
  const first = await getQrToken(tx, raw, purpose);
  await lockOrder(tx, first.orderId);
  return getQrToken(tx, raw, purpose);
}
export function registerPublicRoutes(app: Express, prisma: PrismaClient, config: Config) {
  const source = config.demo ? 'DEMO' : 'MANUAL';
  // Public token mutations require a live identity/provider workflow, which is
  // not configured in manual mode. Preview routes remain available.
  app.use(['/api/delivery/:token', '/api/customer/:token'], (req, _res, next) => {
    if (!config.demo && req.method !== 'GET' && req.method !== 'HEAD') {
      next(err('PROVIDER_UNAVAILABLE', 'Live delivery authorization and customer SMS verification are not configured', 503));
      return;
    }
    next();
  });
  app.get('/api/delivery/:token', async (req, res) => {
    const t = await getQrToken(prisma, String(req.params.token), 'DELIVERY');
    const accepted = t.order.acceptedAttempt === t.order.deliveryAttempt && t.order.acceptedUntil && t.order.acceptedUntil > new Date();
    res.json({ ...publicOrder(t.order), mode: config.demo ? 'demo' : 'manual', permittedOutcomes: deliveryOutcomes.filter(value => value !== 'DELIVERED_VERIFIED' || accepted) });
  });
  app.get('/api/customer/:token', async (req, res) => {
    const t = await getQrToken(prisma, String(req.params.token), 'CUSTOMER');
    res.json({ ...publicOrder(t.order), mode: config.demo ? 'demo' : 'manual', allowedActions: customerActions(t.order.status) });
  });

  const locationSchema = z.object({
    latitude: z.number().min(-90).max(90),
    longitude: z.number().min(-180).max(180),
    accuracyMeters: z.number().positive().max(100000).optional(),
  });

  app.post('/api/delivery/:token/location', async (req, res) => {
    const t = await getQrToken(prisma, String(req.params.token), 'DELIVERY');
    const v = locationSchema.parse(req.body);
    const loc = await prisma.locationEvidence.create({
      data: {
        orderId: t.orderId,
        kind: 'DELIVERY_SCAN',
        status: 'CAPTURED',
        latitude: v.latitude,
        longitude: v.longitude,
        accuracyMeters: v.accuracyMeters || 10,
        capturedAt: new Date(),
        purgeAt: new Date(Date.now() + 30 * 864e5),
      },
    });
    await prisma.orderEvent.create({
      data: {
        orderId: t.orderId,
        eventType: 'LOCATION_CAPTURED',
        actorType: 'DELIVERY',
        note: `Courier GPS verified at QR scan: ${v.latitude.toFixed(5)}, ${v.longitude.toFixed(5)} (±${Math.round(v.accuracyMeters || 10)}m)`,
        metadata: { latitude: v.latitude, longitude: v.longitude, accuracy: v.accuracyMeters },
        source,
      },
    });
    res.status(201).json({ success: true, location: loc });
  });

  app.post('/api/customer/:token/location', async (req, res) => {
    const t = await getQrToken(prisma, String(req.params.token), 'CUSTOMER');
    const v = locationSchema.parse(req.body);
    const loc = await prisma.locationEvidence.create({
      data: {
        orderId: t.orderId,
        kind: 'CUSTOMER_SCAN',
        status: 'CAPTURED',
        latitude: v.latitude,
        longitude: v.longitude,
        accuracyMeters: v.accuracyMeters || 10,
        capturedAt: new Date(),
        purgeAt: new Date(Date.now() + 30 * 864e5),
      },
    });
    await prisma.orderEvent.create({
      data: {
        orderId: t.orderId,
        eventType: 'LOCATION_CAPTURED',
        actorType: 'CUSTOMER',
        note: `Recipient GPS verified at QR scan: ${v.latitude.toFixed(5)}, ${v.longitude.toFixed(5)} (±${Math.round(v.accuracyMeters || 10)}m)`,
        metadata: { latitude: v.latitude, longitude: v.longitude, accuracy: v.accuracyMeters },
        source,
      },
    });
    res.status(201).json({ success: true, location: loc });
  });
  const requestOtpHandler = async (req: any, res: any) => {
    const result = await prisma.$transaction(async tx => {
      const t = await lockedToken(tx, String(req.params.token), 'CUSTOMER');
      if (!config.demo) throw err('OTP_PROVIDER_UNAVAILABLE', 'No OTP provider is configured', 503);
      const now = new Date();
      const last = await tx.otpChallenge.findFirst({ where: { customerTokenId: t.id }, orderBy: { createdAt: 'desc' } });
      const count = await tx.otpChallenge.count({ where: { customerTokenId: t.id, createdAt: { gt: new Date(now.getTime() - 3600_000) } } });
      if (count >= 5 || (last && now.getTime() - last.createdAt.getTime() < 60_000)) {
        const wait = count >= 5 ? 3600 : Math.max(1, Math.ceil((60_000 - (now.getTime() - last!.createdAt.getTime())) / 1000));
        throw new HttpError('RATE_LIMITED', 'OTP request limit reached; wait before retrying', 429, wait);
      }
      const id = randomUUID(), code = String(randomInt(0, 1_000_000)).padStart(6, '0');
      const expiresAt = new Date(now.getTime() + 300_000);
      await tx.otpChallenge.updateMany({ where: { customerTokenId: t.id, consumedAt: null }, data: { consumedAt: now } });
      await tx.otpChallenge.create({ data: { id, orderId: t.orderId, customerTokenId: t.id, deliveryAttempt: t.order.deliveryAttempt, codeHash: codeDigest(config.sessionSecret, id, code), expiresAt } });
      return { challengeId: id, expiresAt, devCode: code, demoLabel: 'DEMO TEST OTP — no SMS sent' };
    });
    res.status(202).json(result);
  };
  app.post('/api/customer/:token/request-otp', requestOtpHandler);
  app.post('/api/customer/:token/otp', requestOtpHandler);

  const verifyOtpHandler = async (req: any, res: any) => {
    await getQrToken(prisma, String(req.params.token), 'CUSTOMER');
    const v = z.object({ challengeId: z.string().min(1).max(100), code: z.string().regex(/^\d{6}$/) }).parse(req.body);
    const result = await prisma.$transaction(async tx => {
      const t = await lockedToken(tx, String(req.params.token), 'CUSTOMER'), now = new Date();
      const ch = await tx.otpChallenge.findFirst({ where: { id: v.challengeId, orderId: t.orderId, customerTokenId: t.id, deliveryAttempt: t.order.deliveryAttempt } });
      if (!ch || ch.consumedAt || ch.verifiedAt || ch.expiresAt <= now || ch.attempts >= 5) return null;
      const expected = codeDigest(config.sessionSecret, ch.id, v.code);
      const valid = ch.codeHash.length === expected.length && timingSafeEqual(Buffer.from(ch.codeHash), Buffer.from(expected));
      // Failed attempts must commit, so errors are raised outside the transaction.
      await tx.otpChallenge.update({ where: { id: ch.id }, data: { attempts: { increment: 1 } } });
      if (!valid) return null;
      const verificationToken = randomToken(), expiresAt = new Date(now.getTime() + 900_000);
      await tx.otpChallenge.update({ where: { id: ch.id }, data: { verifiedAt: now, verificationHash: hashToken(verificationToken), verificationExpiresAt: expiresAt } });
      return { verificationToken, expiresAt };
    });
    if (!result) throw err('OTP_INVALID', 'OTP is invalid or expired', 400);
    res.json(result);
  };
  app.post('/api/customer/:token/verify-otp', verifyOtpHandler);
  app.post('/api/customer/:token/otp/verify', verifyOtpHandler);

  app.post('/api/customer/:token/decision', async (req, res) => {
    await getQrToken(prisma, String(req.params.token), 'CUSTOMER');
    const proof = req.get('X-Customer-Verification') || (req.body && typeof req.body.verificationToken === 'string' ? req.body.verificationToken : undefined);
    if (!proof) throw err('VERIFICATION_REQUIRED', 'OTP verification required', 401);
    if (!/^[A-Za-z0-9_-]{43}$/.test(proof)) throw err('VERIFICATION_INVALID', 'Verification is invalid or expired', 401);
    const v = z.object({ action: z.enum(['ACCEPT','REJECT','REQUEST_REDELIVERY']), verificationToken: z.string().optional(), ...reasonFields }).parse(req.body);
    if (v.action === 'REJECT' && !v.reasonCode) throw err('REASON_REQUIRED', 'Reject requires a reason', 400);
    const result = await prisma.$transaction(async tx => {
      const t = await lockedToken(tx, String(req.params.token), 'CUSTOMER'), now = new Date();
      const ch = await tx.otpChallenge.findFirst({ where: { orderId: t.orderId, customerTokenId: t.id, deliveryAttempt: t.order.deliveryAttempt, verificationHash: hashToken(proof), verifiedAt: { not: null }, verificationExpiresAt: { gt: now }, consumedAt: null } });
      if (!ch) throw err('VERIFICATION_INVALID', 'Verification is invalid or expired', 401);
      if (!customerActions(t.order.status).includes(v.action)) throw err('INVALID_TRANSITION', 'Decision is not permitted for current status', 409);
      const data = { eventType: v.action, actorType: 'CUSTOMER', reasonCode: v.reasonCode || (v.action === 'REQUEST_REDELIVERY' ? 'CUSTOMER_REQUESTED_REDELIVERY' : null), note: v.note, source, metadata: { deliveryAttempt: t.order.deliveryAttempt } };
      await tx.otpChallenge.update({ where: { id: ch.id }, data: { consumedAt: now } });
      if (v.action === 'ACCEPT') {
        if (t.order.acceptedAttempt === t.order.deliveryAttempt && t.order.acceptedUntil && t.order.acceptedUntil > now) throw err('ALREADY_ACCEPTED', 'Customer has already accepted this attempt', 409);
        const order = await tx.order.update({ where: { id: t.orderId }, data: { acceptedAttempt: t.order.deliveryAttempt, acceptedUntil: ch.verificationExpiresAt, acceptedChallengeId: ch.id } });
        const event = await tx.orderEvent.create({ data: { ...data, orderId: t.orderId, fromStatus: order.status, toStatus: order.status, createdAt: new Date() } });
        await notifyEvent(tx, order, event);
        return { order, event };
      }
      return changeStatus(tx, t.order, v.action === 'REJECT' ? 'CUSTOMER_REJECTED' : 'REDELIVERY_REQUESTED', data);
    });
    res.status(201).json({ order: publicOrder(result.order), event: publicEvent(result.event) });
  });
  app.post('/api/delivery/:token', async (req, res) => {
    await getQrToken(prisma, String(req.params.token), 'DELIVERY');
    const v = z.object({ outcome: z.enum(deliveryOutcomes), ...reasonFields }).parse(req.body);
    if (v.outcome === 'ADDRESS_ISSUE' && !['ADDRESS_INCORRECT', 'ADDRESS_INCOMPLETE'].includes(v.reasonCode || '')) {
      throw err('REASON_REQUIRED', 'Select the reported address issue', 400);
    }
    if (v.outcome === 'DELIVERED_VERIFIED' && v.reasonCode) throw err('VALIDATION_ERROR', 'Completion cannot include a failure reason', 400);
    const result = await prisma.$transaction(async tx => {
      const t = await lockedToken(tx, String(req.params.token), 'DELIVERY');
      const to = v.outcome === 'CUSTOMER_UNAVAILABLE' || v.outcome === 'ADDRESS_ISSUE' ? 'DELIVERY_FAILED' : v.outcome;
      if (to === 'DELIVERED_VERIFIED') return completeVerifiedDelivery(tx, t.order, source, v.note);
      const reasonCode = v.reasonCode || ({ CUSTOMER_UNAVAILABLE: 'CUSTOMER_UNAVAILABLE', CUSTOMER_REJECTED: 'CUSTOMER_REJECTED', ADDRESS_ISSUE: 'ADDRESS_INCORRECT' } as Record<string,string>)[v.outcome] || null;
      const out = await changeStatus(tx, t.order, to, { eventType: to, actorType: 'DELIVERY', reasonCode, note: v.note, source, metadata: { deliveryAttempt: t.order.deliveryAttempt, outcome: v.outcome } });
      return out;
    });
    res.status(201).json({ order: publicOrder(result.order), event: publicEvent(result.event), ledgerEntry: null });
  });
}
