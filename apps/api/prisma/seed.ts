import 'dotenv/config';
import { pathToFileURL } from 'node:url';
import type { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { randomBytes } from 'node:crypto';
import { loadConfig, type Config } from '../src/config.js';
import { createDatabase } from '../src/database.js';
import { createLogger } from '../src/logger.js';
import { hashToken } from '../src/rules.js';
import { changeStatus } from '../src/workflow.js';
import { notifyEvent } from '../src/notifications.js';

export function seedSettings(env: NodeJS.ProcessEnv) {
  if (env.NODE_ENV === 'production' || env.DEMO_MODE !== 'true') {
    throw new Error('Seeding requires explicit non-production demo mode');
  }
  const result = z.object({
    SEED_SELLER_EMAIL: z.email(),
    SEED_SELLER_PASSWORD: z.string().min(12).max(72).refine(value =>
      Buffer.byteLength(value, 'utf8') <= 72 && !/replace|change[-_ ]?me/i.test(value)),
  }).safeParse(env);
  if (!result.success) throw new Error('Explicit demo seller email and password are required');
  return { email: result.data.SEED_SELLER_EMAIL.toLowerCase(), password: result.data.SEED_SELLER_PASSWORD };
}

export async function seedDemoSeller(prisma: PrismaClient, env: NodeJS.ProcessEnv) {
  const { email, password } = seedSettings(env);
  const passwordHash = await bcrypt.hash(password, 12);
  // Rerunning setup must not reset an existing seller's password or alter their data.
  return prisma.seller.upsert({ where: { email }, update: {}, create: { email, passwordHash, name: 'Demo Seller' } });
}

export async function seedDemoOrders(prisma: PrismaClient, config: Config, sellerId: string) {
  if (!config.demo || config.nodeEnv === 'production') throw new Error('Sample orders require local demo mode');
  await prisma.$transaction(async tx => {
    // Serialize reruns, preserve existing records, and never manufacture verified deliveries/credits.
    const sellers = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM "Seller" WHERE id = ${sellerId} FOR UPDATE`;
    if (!sellers.length) throw new Error('Demo seller not found');
    for (const scenario of ['created','dispatched','returned']) {
      const id = `demo-${hashToken(sellerId).slice(0, 16)}-${scenario}`;
      if (await tx.order.findUnique({ where: { id } })) continue;
      let order = await tx.order.create({ data: {
        id, sellerId, sellerReference: `DEMO-${scenario.toUpperCase()}`, customerName: 'Synthetic Demo Customer', customerPhone: '+919999999999',
        addressLine1: 'Fictional demo address', city: 'Demo City', state: 'Demo State', postalCode: '000000',
      } });
      const event = await tx.orderEvent.create({ data: { orderId: id, eventType: 'CREATED', toStatus: 'CREATED', actorType: 'SELLER', actorId: sellerId, source: 'DEMO', note: 'Synthetic seed example' } });
      await notifyEvent(tx, order, event);
      await tx.qrToken.createMany({ data: ['DELIVERY','CUSTOMER'].map(purpose => ({ orderId: id, purpose, tokenHash: hashToken(randomBytes(32).toString('base64url')), expiresAt: new Date(Date.now() + config.qrTokenTtlDays * 864e5) })) });
      const steps = scenario === 'created' ? [] : scenario === 'dispatched' ? ['READY_FOR_DISPATCH','OUT_FOR_DELIVERY'] : ['READY_FOR_DISPATCH','OUT_FOR_DELIVERY','DELIVERY_FAILED','RETURN_INITIATED','RETURN_IN_TRANSIT','RETURNED_TO_SELLER'];
      for (const to of steps) {
        const delivery = to === 'DELIVERY_FAILED';
        order = (await changeStatus(tx, order, to, { eventType: to, actorType: delivery ? 'DELIVERY' : 'SELLER', actorId: delivery ? null : sellerId, source: 'DEMO', reasonCode: ['DELIVERY_FAILED','RETURN_INITIATED'].includes(to) ? 'CUSTOMER_UNAVAILABLE' : null, note: 'Synthetic seed example' })).order;
      }
    }
  });
}

async function main() {
  const logger = createLogger();
  let prisma: PrismaClient | undefined;
  try {
    seedSettings(process.env);
    const config = loadConfig();
    const samples = z.enum(['true','false']).default('false').parse(process.env.SEED_SAMPLE_ORDERS);
    prisma = createDatabase(config);
    const seller = await seedDemoSeller(prisma, process.env);
    if (samples === 'true') await seedDemoOrders(prisma, config, seller.id);
    logger.info('demo.seed_completed', { mode: 'demo' });
  } catch {
    logger.error('demo.seed_failed', { code: 'SEED_FAILED' });
    process.exitCode = 1;
  } finally { await prisma?.$disconnect(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
