import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { createApp } from '../src/app.js';
import { broadcastLiveEvent } from '../src/live-events.js';
import { createLogger } from '../src/logger.js';
import { listen, testConfig } from './helpers.js';

vi.mock('../src/auth.js', async importOriginal => {
  const original = await importOriginal<typeof import('../src/auth.js')>();
  return { ...original, requireAnySession: () => (req: any, res: any, next: any) => {
    if (req.get('x-test-session') === 'seller-1') res.locals.seller = { id: 'seller-1' };
    next();
  } };
});

describe('Server-Sent Events (SSE) and live event stream', () => {
  let prisma: PrismaClient;
  let server: Awaited<ReturnType<typeof listen>>;
  const config = testConfig();

  beforeEach(async () => {
    prisma = new PrismaClient();
    vi.spyOn(prisma, '$queryRaw').mockResolvedValue([{ hits: 1, resetAt: new Date(Date.now() + 60_000) }]);
    vi.spyOn(prisma.seller, 'findFirst').mockResolvedValue(null);
    vi.spyOn(prisma.seller, 'findUnique').mockResolvedValue(null);
    vi.spyOn(prisma.session, 'findFirst').mockResolvedValue(null);
    vi.spyOn(prisma.session, 'findUnique').mockResolvedValue(null);
    vi.spyOn(prisma.order, 'findFirst').mockResolvedValue({ id: 'order-1' } as any);
    vi.spyOn(prisma.orderEvent, 'findMany').mockResolvedValue([]);
    vi.spyOn(prisma.orderEvent, 'findUnique').mockResolvedValue(null);
    vi.spyOn(prisma.rateLimitBucket, 'findFirst').mockResolvedValue(null);
    server = await listen(createApp({ config, prisma, logger: createLogger(() => {}) }));
  });

  afterEach(async () => {
    await server.close();
    await prisma.$disconnect();
    vi.restoreAllMocks();
  });

  it('rejects unsigned event polling and streaming', async () => {
    for (const path of ['poll','live']) expect((await fetch(`${server.url}/api/events/${path}`)).status).toBe(401);
  });

  it('exposes /api/events/poll returning recent order events and timestamp', async () => {
    const res = await fetch(`${server.url}/api/events/poll`, {
      headers: { 'x-test-session': 'seller-1', Origin: config.appOrigin },
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toHaveProperty('items');
    expect(json).toHaveProperty('timestamp');
    expect(Array.isArray(json.items)).toBe(true);
    expect(prisma.orderEvent.findMany).toHaveBeenCalledWith(expect.objectContaining({where: expect.objectContaining({order: expect.objectContaining({OR: expect.arrayContaining([{sellerId:'seller-1'}])})})}));
  });

  it('exposes /api/events/live with text/event-stream headers and sends initial connected event', async () => {
    const controller = new AbortController();
    const res = await fetch(`${server.url}/api/events/live`, {
      headers: { 'x-test-session': 'seller-1', Origin: config.appOrigin, Accept: 'text/event-stream' },
      signal: controller.signal,
    });

    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/event-stream');
    expect(res.headers.get('cache-control')).toContain('no-cache');

    const reader = res.body?.getReader();
    expect(reader).toBeDefined();

    if (reader) {
      const { value } = await reader.read();
      const text = new TextDecoder().decode(value);
      expect(text).toContain('event: connected');
      expect(text).toContain('"status":"connected"');
      controller.abort();
    }
  });

  it('broadcasts live events to active SSE subscribers', async () => {
    const controller = new AbortController();
    const res = await fetch(`${server.url}/api/events/live`, {
      headers: { 'x-test-session': 'seller-1', Origin: config.appOrigin, Accept: 'text/event-stream' },
      signal: controller.signal,
    });

    const reader = res.body?.getReader();
    expect(reader).toBeDefined();

    if (reader) {
      // Read initial connection event
      await reader.read();

      // Broadcast test event
      broadcastLiveEvent({
        id: 'test-event-123',
        eventType: 'order.update',
        orderId: 'order-1',
        status: 'OUT_FOR_DELIVERY',
        actorType: 'SELLER',
      });

      // Read broadcast event
      const { value } = await reader.read();
      const text = new TextDecoder().decode(value);
      expect(text).toContain('event: order.update');
      expect(text).toContain('test-event-123');
      expect(text).toContain('OUT_FOR_DELIVERY');
      controller.abort();
    }
  });
});
