import type { Express } from 'express';
import type { PrismaClient } from '@prisma/client';
import { currentUser, requireAnySession } from './auth.js';

import type { Config } from './config.js';
export function registerAppNotificationRoutes(app: Express, prisma: PrismaClient, config: Config) {
  const auth = requireAnySession(prisma, config);
  app.get('/api/notifications/app', auth, async (_req, res) => {
    const user = currentUser(res);
    if (!user) return res.json({ items: [], unread: 0 });
    const items = await prisma.appNotification.findMany({ where: { userId: user.id }, orderBy: { createdAt: 'desc' }, take: 50 });
    const unread = await prisma.appNotification.count({ where: { userId: user.id, readAt: null } });
    res.json({ items, unread });
  });
  app.post('/api/notifications/app/:id/read', auth, async (req, res) => {
    const user = currentUser(res);
    if (!user) return res.status(204).end();
    await prisma.appNotification.updateMany({ where: { id: String(req.params.id), userId: user.id }, data: { readAt: new Date() } });
    res.status(204).end();
  });
}
