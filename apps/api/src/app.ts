import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import session from 'express-session';
import type { PrismaClient } from '@prisma/client';
import { assertRuntimeSupported, type Config } from './config.js';
import { checkDatabase } from './database.js';
import { errorHandler, err, notFound, requestContext } from './http.js';
import type { Logger } from './logger.js';
import { registerRoutes } from './routes.js';
import { PrismaSessionStore, SESSION_COOKIE, SESSION_TTL_MS, sessionCookieOptions } from './sessions.js';
import { registerAuthRoutes } from './auth.js';
import { createRateLimits } from './rate-limits.js';

export interface AppDependencies {
  config: Config;
  prisma: PrismaClient;
  logger: Logger;
  isShuttingDown?: () => boolean;
}

/** Construction has no listener or database side effects, so HTTP tests use real middleware. */
export function createApp({ config, prisma, logger, isShuttingDown = () => false }: AppDependencies) {
  assertRuntimeSupported(config);
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', false);
  app.use(requestContext(logger));
  app.use(helmet({ referrerPolicy: { policy: 'no-referrer' } }));
  app.use(cors({ origin: config.appOrigin, credentials: true }));
  app.get('/health/live', (_req, res) => res.json({ status: 'ok', mode: config.demo ? 'demo' : 'manual' }));
  app.get('/health/ready', async (_req, res, next) => {
    if (isShuttingDown()) { next(err('NOT_READY', 'Service is not ready', 503)); return; }
    try {
      await checkDatabase(prisma);
      res.json({ status: 'ready', mode: config.demo ? 'demo' : 'manual' });
    } catch { next(err('NOT_READY', 'Service is not ready', 503)); }
  });
  // Run before body parsing and session access; login also needs login-CSRF protection.
  app.use('/api', (req, _res, next) => {
    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method) && req.get('origin') !== config.appOrigin) {
      next(err('CSRF_REJECTED', 'Origin check failed', 403)); return;
    }
    next();
  });
  app.use(express.json({ limit: '32kb' }));
  const store = new PrismaSessionStore(prisma, config);
  app.use(session({
    name: SESSION_COOKIE, secret: config.sessionSecret, store, resave: false, saveUninitialized: false,
    cookie: { ...sessionCookieOptions(config), maxAge: SESSION_TTL_MS },
  }));
  const limits = createRateLimits(prisma, config, logger);
  registerAuthRoutes(app, prisma, config, store, limits);
  app.post('/api/customer/:token/request-otp', limits.otpRequestIp, limits.otpRequestToken);
  app.post('/api/customer/:token/verify-otp', limits.otpVerifyIp, limits.otpVerifyToken);
  app.post('/api/customer/:token/decision', limits.decisionIp, limits.decisionToken);
  app.post('/api/delivery/:token', limits.deliveryIp, limits.deliveryToken);
  registerRoutes(app, prisma, config);
  app.use(notFound);
  app.use(errorHandler(logger));
  return app;
}
