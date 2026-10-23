import type { Express } from 'express';
import type { Prisma, PrismaClient } from '@prisma/client';
import { createHmac, randomBytes, randomInt, randomUUID, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import type { Config } from './config.js';
import { err } from './http.js';
import { hashToken } from './rules.js';
import { lockOrder, reasonFields } from './domain.js';
import { customerActions, deliveryOutcomes, getQrToken, publicEvent, publicOrder, type QrPurpose } from './qr.js';
import { changeStatus } from './workflow.js';

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
  app.get('/api/delivery/:token', async (req, res) => {
    const t = await getQrToken(prisma, String(req.params.token), 'DELIVERY');
    const accepted = t.order.acceptedAttempt === t.order.deliveryAttempt && t.order.acceptedUntil && t.order.acceptedUntil > new Date();
    res.json({ ...publicOrder(t.order), permittedOutcomes: deliveryOutcomes.filter(value => value !== 'DELIVERED_VERIFIED' || accepted) });
  });
  app.get('/api/customer/:token', async (req, res) => {
    const t = await getQrToken(prisma, String(req.params.token), 'CUSTOMER');
    res.json({ ...publicOrder(t.order), allowedActions: customerActions(t.order.status) });
  });
  app.post('/api/customer/:token/request-otp', async (req, res) => {
    const result = await prisma.$transaction(async tx => {
      const t = await lockedToken(tx, String(req.params.token), 'CUSTOMER');
      if (!config.demo) throw err('OTP_PROVIDER_UNAVAILABLE', 'No OTP provider is configured', 503);
      const now = new Date();
      const last = await tx.otpChallenge.findFirst({ where: { customerTokenId: t.id }, orderBy: { createdAt: 'desc' } });
      const count = await tx.otpChallenge.count({ where: { customerTokenId: t.id, createdAt: { gt: new Date(now.getTime() - 3600_000) } } });
      if (count >= 5 || (last && now.getTime() - last.createdAt.getTime() < 60_000)) throw err('RATE_LIMITED', 'OTP request limit reached; wait before retrying', 429);
      const id = randomUUID(), code = String(randomInt(0, 1_000_000)).padStart(6, '0');
      const expiresAt = new Date(now.getTime() + 300_000);
      await tx.otpChallenge.updateMany({ where: { customerTokenId: t.id, consumedAt: null }, data: { consumedAt: now } });
      await tx.otpChallenge.create({ data: { id, orderId: t.orderId, customerTokenId: t.id, deliveryAttempt: t.order.deliveryAttempt, codeHash: codeDigest(config.sessionSecret, id, code), expiresAt } });
      return { challengeId: id, expiresAt, devCode: code, demoLabel: 'DEMO TEST OTP — no SMS sent' };
    });
    res.status(202).json(result);
  });
  app.post('/api/customer/:token/verify-otp', async (req, res) => {
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
  });
  app.post('/api/customer/:token/decision', async (req, res) => {
    await getQrToken(prisma, String(req.params.token), 'CUSTOMER');
    const proof = req.get('X-Customer-Verification');
    if (!proof) throw err('VERIFICATION_REQUIRED', 'OTP verification required', 401);
    if (!/^[A-Za-z0-9_-]{43}$/.test(proof)) throw err('VERIFICATION_INVALID', 'Verification is invalid or expired', 401);
    const v = z.object({ action: z.enum(['ACCEPT','REJECT','REQUEST_REDELIVERY']), ...reasonFields }).parse(req.body);
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
        const event = await tx.orderEvent.create({ data: { ...data, orderId: t.orderId, fromStatus: order.status, toStatus: order.status } });
        return { order, event };
      }
      return changeStatus(tx, t.order, v.action === 'REJECT' ? 'CUSTOMER_REJECTED' : 'REDELIVERY_REQUESTED', data);
    });
    res.status(201).json({ order: publicOrder(result.order), event: publicEvent(result.event) });
  });
  app.post('/api/delivery/:token', async (req, res) => {
    await getQrToken(prisma, String(req.params.token), 'DELIVERY');
    const v = z.object({ outcome: z.enum(deliveryOutcomes), ...reasonFields }).parse(req.body);
    const result = await prisma.$transaction(async tx => {
      const t = await lockedToken(tx, String(req.params.token), 'DELIVERY');
      const to = v.outcome === 'CUSTOMER_UNAVAILABLE' || v.outcome === 'ADDRESS_ISSUE' ? 'DELIVERY_FAILED' : v.outcome;
      if (to === 'DELIVERED_VERIFIED') {
        if (t.order.acceptedAttempt !== t.order.deliveryAttempt || !t.order.acceptedUntil || t.order.acceptedUntil <= new Date() || !t.order.acceptedChallengeId) throw err('CUSTOMER_ACCEPTANCE_REQUIRED', 'Customer must accept after OTP verification for this attempt', 409);
      }
      const reasonCode = v.reasonCode || ({ CUSTOMER_UNAVAILABLE: 'CUSTOMER_UNAVAILABLE', CUSTOMER_REJECTED: 'CUSTOMER_REJECTED', ADDRESS_ISSUE: 'ADDRESS_INCORRECT' } as Record<string,string>)[v.outcome] || null;
      const out = await changeStatus(tx, t.order, to, { eventType: to, actorType: 'DELIVERY', reasonCode, note: v.note, source, metadata: { deliveryAttempt: t.order.deliveryAttempt, outcome: v.outcome } });
      if (to === 'DELIVERED_VERIFIED') await tx.ledgerEntry.create({ data: { sellerId: t.order.sellerId, orderId: t.orderId, amountPaise: 500, type: 'DELIVERY_REWARD', eligibilityReason: 'OTP_VERIFIED_CUSTOMER_ACCEPTANCE_AND_DELIVERY_HANDOFF' } });
      return out;
    });
    res.status(201).json({ order: publicOrder(result.order), event: publicEvent(result.event), ledgerEntry: null });
  });
}
