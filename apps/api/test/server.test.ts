import { afterEach, describe, expect, it, vi } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { createServer } from 'node:net';
import type { AddressInfo } from 'node:net';
import { startServer } from '../src/server.js';
import { createLogger } from '../src/logger.js';
import { testConfig } from './helpers.js';

describe('server lifecycle', () => {
  afterEach(() => vi.restoreAllMocks());
  const logger = createLogger(() => {});
  function database() {
    const prisma = new PrismaClient();
    vi.spyOn(prisma, '$connect').mockResolvedValue();
    vi.spyOn(prisma, '$disconnect').mockResolvedValue();
    vi.spyOn(prisma, '$queryRaw').mockResolvedValue([]);
    vi.spyOn(prisma.seller, 'findFirst').mockResolvedValue(null);
    return prisma;
  }
  it('does not open a port after failed connectivity and releases resources', async () => {
    const prisma = database();
    vi.mocked(prisma.$connect).mockRejectedValue(new Error('connection failed'));
    await expect(startServer(testConfig(), logger, prisma)).rejects.toThrow('connection failed');
    expect(prisma.$disconnect).toHaveBeenCalledOnce();
  });
  it('rejects a database without the migrated schema', async () => {
    const prisma = database();
    vi.mocked(prisma.seller.findFirst).mockRejectedValue(new Error('missing table'));
    await expect(startServer(testConfig(), logger, prisma)).rejects.toThrow('missing table');
    expect(prisma.$disconnect).toHaveBeenCalledOnce();
  });
  it('cleans up after a listener error instead of reporting startup success', async () => {
    const occupied = createServer().listen(0, '127.0.0.1');
    await new Promise<void>(resolve => occupied.once('listening', resolve));
    const prisma = database();
    try {
      await expect(startServer({ ...testConfig(), port: (occupied.address() as AddressInfo).port }, logger, prisma))
        .rejects.toMatchObject({ code: 'EADDRINUSE' });
      expect(prisma.$disconnect).toHaveBeenCalledOnce();
    } finally { await new Promise<void>(resolve => occupied.close(() => resolve())); }
  });
  it('serves health after database checks and drains/disconnects exactly once', async () => {
    const prisma = database();
    const runtime = await startServer({ ...testConfig(), port: 0 }, logger, prisma);
    try {
      const address = runtime.server.address() as AddressInfo;
      expect(address.address).toBe('127.0.0.1');
      expect((await fetch(`http://127.0.0.1:${address.port}/health/ready`)).status).toBe(200);
    } finally { await Promise.all([runtime.shutdown(), runtime.shutdown()]); }
    expect(prisma.$disconnect).toHaveBeenCalledOnce();
    expect(runtime.server.listening).toBe(false);
  });
});
