import { PrismaClient } from '@prisma/client';
import type { Config } from './config.js';

export function createDatabase(config: Config) {
  const url = new URL(config.databaseUrl);
  // Bound connection/query wait times; never print this URL or Prisma errors.
  if (!url.searchParams.has('connect_timeout')) url.searchParams.set('connect_timeout', '5');
  if (!url.searchParams.has('pool_timeout')) url.searchParams.set('pool_timeout', '5');
  if (!url.searchParams.has('socket_timeout')) url.searchParams.set('socket_timeout', '5');
  return new PrismaClient({ datasources: { db: { url: url.toString() } }, log: [] });
}

export async function checkDatabase(prisma: PrismaClient) {
  await prisma.$queryRaw`SELECT 1`;
  // Reachability alone is insufficient: a database without migrations is not ready.
  await prisma.seller.findFirst({ select: { id: true } });
}
