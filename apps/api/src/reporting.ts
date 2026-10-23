import type { Express } from 'express';
import type { PrismaClient } from '@prisma/client';
import { z } from 'zod';
import type { Config } from './config.js';
import { requireSeller, currentSeller } from './auth.js';
import { pagination } from './domain.js';
import { reportMonthBounds } from './rules.js';

const monthSchema = z.object({ month: z.string().regex(/^[1-9]\d{3}-(0[1-9]|1[0-2])$/) });
export async function monthlyReport(prisma: PrismaClient, sellerId: string, month: string) {
  const [start, end] = reportMonthBounds(month);
  return prisma.$transaction(async tx => {
    const where = { order: { sellerId }, createdAt: { gte: start, lt: end } };
    const groups = await tx.orderEvent.groupBy({ by: ['eventType','actorType'], where, _count: true });
    const reasonGroups = await tx.orderEvent.groupBy({ by: ['reasonCode'], where: { ...where, reasonCode: { not: null } }, _count: true, orderBy: { reasonCode: 'asc' } });
    const reward = await tx.ledgerEntry.aggregate({ where: { sellerId, type: 'DELIVERY_REWARD', createdAt: { gte: start, lt: end } }, _sum: { amountPaise: true }, _count: true });
    const count = (...types: string[]) => groups.filter(g => types.includes(g.eventType)).reduce((n, g) => n + g._count, 0);
    const deliveryAttempts = groups.filter(g => g.actorType === 'DELIVERY' && ['DELIVERY_ATTEMPTED','DELIVERY_FAILED','CUSTOMER_REJECTED','DELIVERED_VERIFIED'].includes(g.eventType)).reduce((n, g) => n + g._count, 0);
    const numerator = count('RETURNED_TO_SELLER'), denominator = count('OUT_FOR_DELIVERY');
    return {
      month, timezone: 'Asia/Kolkata', periodStart: start.toISOString(), periodEnd: end.toISOString(),
      totalOrdersCreated: count('CREATED'), ordersDispatched: denominator, deliveryAttempts,
      verifiedCompletions: count('DELIVERED_VERIFIED'), returnsToSeller: numerator,
      returnRate: denominator ? numerator / denominator : null, returnRateNumerator: numerator, returnRateDenominator: denominator,
      redeliveryRequests: count('REDELIVERY_REQUESTED','REQUEST_REDELIVERY'), rewardCreditCount: reward._count, rewardTotalPaise: reward._sum.amountPaise || 0,
      reasonCounts: Object.fromEntries(reasonGroups.map(g => [g.reasonCode!, g._count])),
    };
  }, { isolationLevel: 'RepeatableRead' });
}
export function csvCell(value: string | number) {
  const text = String(value);
  const safe = /^(\s*[=+\-@]|[\t\r\n])/.test(text) ? `'${text}` : text;
  return `"${safe.replaceAll('"', '""')}"`;
}
export function reportCsv(r: Awaited<ReturnType<typeof monthlyReport>>) {
  const headers = ['month','timezone','period_start','period_end','total_orders_created','orders_dispatched','delivery_attempts','verified_completions','returns_to_seller','return_rate','return_rate_numerator','return_rate_denominator','redelivery_requests','reward_credit_count','reward_total_paise','reason_code','reason_count'];
  const reasons: [string, number | string][] = Object.entries(r.reasonCounts);
  if (!reasons.length) reasons.push(['','']);
  return [headers.join(','), ...reasons.map(([code, count]) => [r.month,r.timezone,r.periodStart,r.periodEnd,r.totalOrdersCreated,r.ordersDispatched,r.deliveryAttempts,r.verifiedCompletions,r.returnsToSeller,r.returnRate ?? '',r.returnRateNumerator,r.returnRateDenominator,r.redeliveryRequests,r.rewardCreditCount,r.rewardTotalPaise,code,count].map(csvCell).join(','))].join('\r\n');
}
export function registerReportingRoutes(app: Express, prisma: PrismaClient, config: Config) {
  const auth = requireSeller(prisma, config);
  app.get('/api/dashboard/summary', auth, async (_req, res) => {
    const sellerId = currentSeller(res).id;
    const [totalOrders, groups, reward] = await prisma.$transaction([
      prisma.order.count({ where: { sellerId } }), prisma.order.groupBy({ by: ['status'], where: { sellerId }, _count: true, orderBy: { status: 'asc' } }),
      prisma.ledgerEntry.aggregate({ where: { sellerId, type: 'DELIVERY_REWARD' }, _sum: { amountPaise: true } }),
    ], { isolationLevel: 'RepeatableRead' });
    res.json({ totalOrders, statusCounts: Object.fromEntries(groups.map(g => [g.status, g._count])), rewardTotalPaise: reward._sum.amountPaise || 0 });
  });
  app.get('/api/rewards/ledger', auth, async (req, res) => {
    const { page, pageSize } = pagination(req.query), where = { sellerId: currentSeller(res).id };
    const [items, total] = await prisma.$transaction([
      prisma.ledgerEntry.findMany({ where, skip: (page - 1) * pageSize, take: pageSize, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] }), prisma.ledgerEntry.count({ where }),
    ], { isolationLevel: 'RepeatableRead' });
    res.json({ items, page, pageSize, total });
  });
  app.get('/api/rewards/summary', auth, async (_req, res) => {
    const a = await prisma.ledgerEntry.aggregate({ where: { sellerId: currentSeller(res).id, type: 'DELIVERY_REWARD' }, _sum: { amountPaise: true }, _count: true });
    res.json({ creditCount: a._count, totalPaise: a._sum.amountPaise || 0, currency: 'INR' });
  });
  app.get('/api/notifications', auth, async (req, res) => {
    const { page, pageSize } = pagination(req.query), where = { sellerId: currentSeller(res).id };
    const [items, total] = await prisma.$transaction([
      prisma.notification.findMany({ where, skip: (page - 1) * pageSize, take: pageSize, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], select: { id: true, sellerId: true, title: true, body: true, createdAt: true } }), prisma.notification.count({ where }),
    ], { isolationLevel: 'RepeatableRead' });
    res.json({ items, page, pageSize, total });
  });
  app.get('/api/reports/monthly', auth, async (req, res) => {
    res.json(await monthlyReport(prisma, currentSeller(res).id, monthSchema.parse(req.query).month));
  });
  app.get('/api/reports/monthly.csv', auth, async (req, res) => {
    const month = monthSchema.parse(req.query).month;
    const report = await monthlyReport(prisma, currentSeller(res).id, month);
    res.setHeader('Content-Disposition', `attachment; filename="unloss-${month}.csv"`);
    res.type('text/csv').send(reportCsv(report));
  });
}
