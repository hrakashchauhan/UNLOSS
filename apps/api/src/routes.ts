import type { Express } from 'express';
import type { PrismaClient } from '@prisma/client';
import type { Config } from './config.js';
import { registerOrderRoutes } from './orders.js';
import { registerPublicRoutes } from './public-flows.js';
import { registerReportingRoutes } from './reporting.js';
import { registerProductRoutes } from './products.js';
import { registerShipmentRoutes } from './shipments.js';
import { registerDeliveryClaimRoutes } from './delivery-claims.js';
import { registerFundingRoutes } from './funding.js';
import { registerAppNotificationRoutes } from './notifications-app.js';
import { registerLiveEventRoutes } from './live-events.js';

export function registerRoutes(app: Express, prisma: PrismaClient, config: Config) {
  registerOrderRoutes(app, prisma, config);
  registerPublicRoutes(app, prisma, config);
  registerReportingRoutes(app, prisma, config);
  registerProductRoutes(app, prisma, config);
  registerShipmentRoutes(app, prisma, config);
  registerDeliveryClaimRoutes(app, prisma, config);
  registerFundingRoutes(app, prisma, config);
  registerAppNotificationRoutes(app, prisma, config);
  registerLiveEventRoutes(app, prisma, config);
}
