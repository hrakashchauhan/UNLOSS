import { randomBytes } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import type { PrismaClient } from '@prisma/client';
import type { Express, RequestHandler, Response } from 'express';
import type { Config } from './config.js';
import { err } from './http.js';
import { hashToken } from './rules.js';
import { PrismaSessionStore, SESSION_COOKIE, SESSION_TTL_MS, sessionCookieOptions } from './sessions.js';
import type { createRateLimits } from './rate-limits.js';

export type PublicSeller = { id: string; email: string; name: string };
export const currentSeller = (res: Response): PublicSeller => res.locals.seller as PublicSeller;
// Equal-cost comparison for unknown emails. This is a random dummy, never an account credential.
const dummyHash = bcrypt.hashSync(randomBytes(32).toString('base64url'), 12);
const credentials = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  password: z.string().min(1).max(72).refine(value => Buffer.byteLength(value, 'utf8') <= 72),
});

export function requireSeller(prisma: PrismaClient, config: Config): RequestHandler {
  return async (req, res, next) => {
    try {
      if (!req.session?.sellerId || !req.session.sessionExpiresAt || req.session.sessionExpiresAt <= Date.now()) {
        res.clearCookie(SESSION_COOKIE, sessionCookieOptions(config));
        throw err('UNAUTHENTICATED', 'Sign in required', 401);
      }
      const seller = await prisma.seller.findUnique({ where: { id: req.session.sellerId } });
      if (!seller || hashToken(seller.passwordHash) !== req.session.credentialVersion) {
        await new Promise<void>((resolve, reject) => req.session.destroy(error => error ? reject(error) : resolve()));
        res.clearCookie(SESSION_COOKIE, sessionCookieOptions(config));
        throw err('UNAUTHENTICATED', 'Sign in required', 401);
      }
      res.locals.seller = { id: seller.id, email: seller.email, name: seller.name } satisfies PublicSeller;
      next();
    } catch (error) { next(error); }
  };
}

export function registerAuthRoutes(app: Express, prisma: PrismaClient, config: Config, store: PrismaSessionStore, limits: ReturnType<typeof createRateLimits>) {
  const validate: RequestHandler = (req, _res, next) => {
    try { req.body = credentials.parse(req.body); next(); } catch (error) { next(error); }
  };
  app.post('/api/auth/login', limits.loginIp, validate, limits.loginAccount, async (req, res) => {
    const { email, password } = credentials.parse(req.body);
    const seller = await prisma.seller.findUnique({ where: { email } });
    const matched = await bcrypt.compare(password, seller?.passwordHash ?? dummyHash);
    if (!seller || !matched) throw err('INVALID_CREDENTIALS', 'Email or password is incorrect', 401);
    try {
      await new Promise<void>((resolve, reject) => req.session.regenerate(error => error ? reject(error) : resolve()));
      req.session.sellerId = seller.id;
      req.session.credentialVersion = hashToken(seller.passwordHash);
      req.session.sessionExpiresAt = Date.now() + SESSION_TTL_MS;
      req.session.cookie.expires = new Date(req.session.sessionExpiresAt);
      await store.issue(req.sessionID, req.session);
      // Wait for persistence verification before success/cookie; response-end errors are too late.
      await new Promise<void>((resolve, reject) => req.session.save(error => error ? reject(error) : resolve()));
    } catch (error) {
      if (req.session) await new Promise<void>(resolve => req.session.destroy(() => resolve()));
      throw error;
    }
    res.json({ seller: { id: seller.id, email: seller.email, name: seller.name }, mode: config.demo ? 'demo' : 'manual' });
  });
  const auth = requireSeller(prisma, config);
  app.get('/api/auth/me', auth, (_req, res) => res.json({ seller: currentSeller(res), mode: config.demo ? 'demo' : 'manual' }));
  app.post('/api/auth/logout', auth, async (req, res) => {
    await new Promise<void>((resolve, reject) => req.session.destroy(error => error ? reject(error) : resolve()));
    res.clearCookie(SESSION_COOKIE, sessionCookieOptions(config));
    res.status(204).end();
  });
}
