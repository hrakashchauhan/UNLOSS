import type { PrismaClient } from '@prisma/client';
import type { Logger } from './logger.js';

export async function pruneExpiredSecurityRecords(prisma: PrismaClient) {
  const now = new Date();
  await prisma.$transaction([
    prisma.session.deleteMany({ where: { expiresAt: { lte: now } } }),
    prisma.rateLimitBucket.deleteMany({ where: { resetAt: { lte: now } } }),
  ]);
}

export function startSecurityMaintenance(prisma: PrismaClient, logger: Logger) {
  let pending: Promise<void> | undefined;
  const timer = setInterval(() => {
    if (pending) return;
    pending = pruneExpiredSecurityRecords(prisma)
      .catch(() => logger.error('security.cleanup_failed', { code: 'CLEANUP_FAILED' }))
      .finally(() => { pending = undefined; });
  }, 15 * 60_000);
  timer.unref();
  return async () => { clearInterval(timer); await pending; };
}
