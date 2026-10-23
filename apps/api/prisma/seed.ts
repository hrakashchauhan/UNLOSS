import 'dotenv/config';
import { pathToFileURL } from 'node:url';
import type { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { loadConfig } from '../src/config.js';
import { createDatabase } from '../src/database.js';
import { createLogger } from '../src/logger.js';

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

async function main() {
  const logger = createLogger();
  let prisma: PrismaClient | undefined;
  try {
    seedSettings(process.env);
    prisma = createDatabase(loadConfig());
    await seedDemoSeller(prisma, process.env);
    logger.info('demo.seed_completed', { mode: 'demo' });
  } catch {
    logger.error('demo.seed_failed', { code: 'SEED_FAILED' });
    process.exitCode = 1;
  } finally { await prisma?.$disconnect(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
