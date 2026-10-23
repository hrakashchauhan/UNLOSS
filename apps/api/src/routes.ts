import type { Express } from 'express';
import type { PrismaClient } from '@prisma/client';
import type { Config } from './config.js';
import { registerOrderRoutes } from './orders.js';
import { registerPublicRoutes } from './public-flows.js';
import { registerReportingRoutes } from './reporting.js';

export function registerRoutes(app: Express, prisma: PrismaClient, config: Config) {
  registerOrderRoutes(app, prisma, config);
  registerPublicRoutes(app, prisma, config);
  registerReportingRoutes(app, prisma, config);
}
