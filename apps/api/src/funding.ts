import type { Express } from 'express';
import type { PrismaClient } from '@prisma/client';
import { randomBytes, randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { Config } from './config.js';
import { currentSeller, currentUser, requireAnySession, requireRole, requireSeller } from './auth.js';
import { err } from './http.js';
import { nextPayoutMonday } from './parcel-workspace.js';
import { lockOrder } from './domain.js';

export function registerFundingRoutes(app: Express, prisma: PrismaClient, config: Config) {
  const sellerAuth = requireSeller(prisma, config);
  const userAuth = requireAnySession(prisma, config);

  app.get('/api/seller/funding', sellerAuth, async (req, res) => {
    const sellerId = currentSeller(res).id;
    const [account, txns, reservations, earnings] = await Promise.all([
      prisma.fundingAccount.findUnique({ where: { sellerId } }),
      prisma.fundingTransaction.findMany({ where: { sellerId }, orderBy: { createdAt: 'desc' }, take: 20 }),
      prisma.budgetReservation.findMany({ where: { sellerId }, include: { order: true }, orderBy: { createdAt: 'desc' } }),
      prisma.deliveryEarning.findMany({ where: { sellerId }, include: { order: true, deliveryUser: { select: { id: true, name: true, email: true } } }, orderBy: { createdAt: 'desc' }, take: 30 }),
    ]);
    res.json({ account: account || { availablePaise: 0, reservedPaise: 0, refundedPaise: 0 }, txns, reservations, earnings });
  });

  app.post('/api/seller/funding/checkout', sellerAuth, async (req, res) => {
    if (!config.demo) throw err('PROVIDER_UNAVAILABLE', 'Verified payment processing is not configured', 503);
    const sellerId = currentSeller(res).id;
    const v = z.object({ amountPaise: z.coerce.number().int().min(500).max(10000000) }).parse(req.body);
    const feePaise = Math.ceil(v.amountPaise * 0.02);
    const totalPaise = v.amountPaise + feePaise;
    const idempotencyKey = randomUUID();
    const providerOrderId = `rzp_${randomBytes(12).toString('hex')}`;
    await prisma.$transaction(async tx => {
      await tx.fundingTransaction.create({ data: { sellerId, providerOrderId, principalPaise: v.amountPaise, feePaise, totalPaise, status: 'CREATED', idempotencyKey } });
    });
    res.json({ provider: 'RAZORPAY', mode: 'CHECKOUT', providerOrderId, principalPaise: v.amountPaise, feePaise, totalPaise, currency: 'INR' });
  });

  app.post('/api/seller/funding/capture', sellerAuth, async (req, res) => {
    if (!config.demo) throw err('PROVIDER_UNAVAILABLE', 'Verified payment processing is not configured', 503);
    const sellerId = currentSeller(res).id;
    const v = z.object({ providerOrderId: z.string(), providerPaymentId: z.string() }).parse(req.body);
    const result = await prisma.$transaction(async tx => {
      const txn = await tx.fundingTransaction.findFirst({ where: { sellerId, providerOrderId: v.providerOrderId, status: 'CREATED' } });
      if (!txn) throw err('NOT_FOUND', 'Funding transaction not found', 404);
      await tx.fundingTransaction.update({ where: { id: txn.id }, data: { status: 'CAPTURED', providerPaymentId: v.providerPaymentId, capturedAt: new Date() } });
      await tx.fundingAccount.upsert({ where: { sellerId }, update: { availablePaise: { increment: txn.principalPaise }, updatedAt: new Date() }, create: { sellerId, availablePaise: txn.principalPaise } });
      return txn;
    });
    res.json({ status: 'CAPTURED', transaction: result });
  });

  app.post('/api/orders/:id/fund-reserve', sellerAuth, async (req, res) => {
    const sellerId = currentSeller(res).id;
    const orderId = String(req.params.id);
    const rewardPaise = 500, feeAllowancePaise = 100, totalPaise = rewardPaise + feeAllowancePaise;
    const result = await prisma.$transaction(async tx => {
      const order = await lockOrder(tx, orderId, sellerId);
      if (['CANCELLED','DELIVERED_VERIFIED'].includes(order.status)) throw err('CONFLICT', 'This parcel no longer accepts a reward reservation', 409);
      const existing = await tx.budgetReservation.findUnique({ where: { orderId } });
      if (existing) return existing;
      await tx.$queryRaw`SELECT id FROM "FundingAccount" WHERE "sellerId" = ${sellerId} FOR UPDATE`;
      const account = await tx.fundingAccount.findUnique({ where: { sellerId } });
      if (!account || account.availablePaise < totalPaise) throw err('INSUFFICIENT_FUNDS', 'Add reward budget to cover ₹6 (₹5 + fee allowance) before activation', 409);
      await tx.fundingAccount.update({ where: { sellerId }, data: { availablePaise: { decrement: totalPaise }, reservedPaise: { increment: totalPaise } } });
      return tx.budgetReservation.create({ data: { sellerId, orderId, rewardPaise, feeAllowancePaise, totalPaise, status: 'RESERVED' } });
    });
    res.status(201).json({ reservation: result });
  });

  app.get('/api/delivery/earnings', userAuth, requireRole(['DELIVERY']), async (req, res) => {
    const user = currentUser(res)!;
    const [items, account] = await Promise.all([
      prisma.deliveryEarning.findMany({ where: { deliveryUserId: user.id }, include: { order: true }, orderBy: { createdAt: 'desc' } }),
      prisma.payoutAccount.findUnique({ where: { userId: user.id } }),
    ]);
    const eligible = items.filter((i: any) => i.status === 'PENDING' && i.availableAt && i.availableAt <= new Date());
    res.json({ items, eligiblePaise: eligible.reduce((s: number, i: any) => s + i.amountPaise, 0), payoutAccount: account });
  });

  app.post('/api/delivery/payout-account', userAuth, requireRole(['DELIVERY']), async (req, res) => {
    const user = currentUser(res)!;
    const v = z.object({ method: z.enum(['UPI', 'BANK']), upiId: z.string().optional(), accountName: z.string().optional(), accountNumberLast4: z.string().optional(), ifsc: z.string().optional() }).parse(req.body);
    const account = await prisma.payoutAccount.upsert({ where: { userId: user.id }, update: { ...v, status: 'PENDING', updatedAt: new Date() } as any, create: { userId: user.id, ...v, status: 'PENDING' } as any });
    res.json({ account });
  });

  app.post('/api/admin/payouts/run', userAuth, requireRole(['ADMIN']), async (_req, res) => {
    const now = new Date();
    const weekStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - ((now.getUTCDay() + 6) % 7)));
    const weekEnd = new Date(weekStart.getTime() + 7 * 864e5);
    const scheduledFor = nextPayoutMonday(now);
    const batch = await prisma.payoutBatch.upsert({ where: { weekStart }, update: {}, create: { weekStart, weekEnd, scheduledFor, status: 'SCHEDULED' } });
    res.json({ batch, scheduledFor: scheduledFor.toISOString(), note: 'Payout preparation only. Monday 10:00 AM IST (04:30 UTC). No bank transfer is executed without a configured verified payment provider.' });
  });
}
