import { EventEmitter } from 'node:events';
import type { Express, Request, Response } from 'express';
import type { PrismaClient } from '@prisma/client';
import type { Config } from './config.js';
import { requireAnySession } from './auth.js';

export interface LiveEvent {
  id: string;
  eventType: string;
  orderId?: string;
  sellerId?: string;
  actorType?: string;
  status?: string;
  data?: Record<string, any>;
  createdAt: string;
}

class EventHub extends EventEmitter {
  constructor() {
    super();
    this.setMaxListeners(200);
  }

  broadcast(event: LiveEvent) {
    this.emit('live-event', event);
  }
}

export const eventHub = new EventHub();

export function broadcastLiveEvent(event: Omit<LiveEvent, 'createdAt'> & { createdAt?: string }) {
  const fullEvent: LiveEvent = {
    ...event,
    createdAt: event.createdAt || new Date().toISOString(),
  };
  eventHub.broadcast(fullEvent);
}

export function registerLiveEventRoutes(app: Express, prisma: PrismaClient, config: Config) {
  const auth = requireAnySession(prisma, config);

  // Server-Sent Events (SSE) Stream
  app.get('/api/events/live', auth, async (req: Request, res: Response) => {
    // Determine scope from session
    const sellerId = (res.locals as any).seller?.id as string | undefined;
    const user = (res.locals as any).authUser;
    const userId = user?.id as string | undefined;
    const userRoles: string[] = user?.roles || [];
    const isAdmin = userRoles.includes('ADMIN');

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    });

    const sendSse = (id: string, eventName: string, data: any) => {
      res.write(`id: ${id}\nevent: ${eventName}\ndata: ${JSON.stringify(data)}\n\n`);
    };

    sendSse('init', 'connected', {
      status: 'connected',
      timestamp: new Date().toISOString(),
      sellerId: sellerId || null,
      userId: userId || null,
    });

    // Reconnection & recovery of missed events
    const lastEventId = (req.headers['last-event-id'] as string) || (req.query.lastEventId as string);
    if (lastEventId && lastEventId !== 'init') {
      try {
        const lastRef = await prisma.orderEvent.findUnique({ where: { id: lastEventId } });
        const sinceTime = lastRef ? lastRef.createdAt : new Date(Date.now() - 3600_000);
        const missedEvents = await prisma.orderEvent.findMany({
          where: {
            createdAt: { gt: sinceTime },
            ...(sellerId && !isAdmin ? { order: { sellerId } } : {}),
          },
          include: { order: true },
          orderBy: { createdAt: 'asc' },
          take: 50,
        });

        for (const ev of missedEvents) {
          sendSse(ev.id, 'order.update', {
            id: ev.id,
            eventType: ev.eventType,
            orderId: ev.orderId,
            status: ev.toStatus || ev.order.status,
            actorType: ev.actorType,
            reasonCode: ev.reasonCode,
            note: ev.note,
            createdAt: ev.createdAt.toISOString(),
          });
        }
      } catch {
        // Continue streaming if recovery query fails
      }
    }

    // Heartbeat ping every 15 seconds to keep connection alive
    const pingTimer = setInterval(() => {
      res.write(': ping\n\n');
    }, 15_000);

    // Event listener
    const onEvent = (event: LiveEvent) => {
      // Permission filtering
      if (isAdmin) {
        sendSse(event.id, event.eventType, event);
        return;
      }
      if (sellerId && event.sellerId && event.sellerId === sellerId) {
        sendSse(event.id, event.eventType, event);
        return;
      }
      if (userId && event.data?.userId && event.data.userId === userId) {
        sendSse(event.id, event.eventType, event);
        return;
      }
      // Public / universal events (e.g. order status changes for claimed orders)
      if (!event.sellerId || event.sellerId === sellerId) {
        sendSse(event.id, event.eventType, event);
      }
    };

    eventHub.on('live-event', onEvent);

    req.on('close', () => {
      clearInterval(pingTimer);
      eventHub.off('live-event', onEvent);
      res.end();
    });
  });

  // Polling fallback endpoint for clients where SSE is unsupported or blocked
  app.get('/api/events/poll', auth, async (req: Request, res: Response) => {
    const sellerId = (res.locals as any).seller?.id as string | undefined;
    const user = (res.locals as any).authUser;
    const isAdmin = (user?.roles || []).includes('ADMIN');

    const sinceParam = req.query.since as string | undefined;
    const since = sinceParam ? new Date(sinceParam) : new Date(Date.now() - 30_000);

    const events = await prisma.orderEvent.findMany({
      where: {
        createdAt: { gt: since },
        ...(sellerId && !isAdmin ? { order: { sellerId } } : {}),
      },
      include: { order: true },
      orderBy: { createdAt: 'desc' },
      take: 30,
    });

    res.json({
      items: events.map(ev => ({
        id: ev.id,
        eventType: ev.eventType,
        orderId: ev.orderId,
        status: ev.toStatus || ev.order.status,
        actorType: ev.actorType,
        reasonCode: ev.reasonCode,
        note: ev.note,
        createdAt: ev.createdAt.toISOString(),
      })),
      timestamp: new Date().toISOString(),
    });
  });
}
