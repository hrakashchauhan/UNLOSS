import { createHmac } from 'node:crypto';
import type { Request, RequestHandler } from 'express';
import { ipKeyGenerator, rateLimit, type Store, type Options } from 'express-rate-limit';
import type { PrismaClient } from '@prisma/client';
import type { Config } from './config.js';
import type { Logger } from './logger.js';
import { err } from './http.js';

export class PrismaRateLimitStore implements Store {
  readonly localKeys = false;
  private windowMs = 60_000;
  constructor(private readonly prisma: PrismaClient, private readonly secret: string, public readonly prefix: string) {}
  init(options: Options) { this.windowMs = options.windowMs; }
  key(value: string) { return `${this.prefix}:${createHmac('sha256', this.secret).update(`${this.prefix}\0${value}`).digest('hex')}`; }

  async increment(value: string) {
    try {
      // One PostgreSQL statement locks/upserts the bucket atomically across concurrent processes.
      const rows = await this.prisma.$queryRaw<{ hits: number; resetAt: Date }[]>`
        INSERT INTO "RateLimitBucket" ("key", "hits", "resetAt")
        VALUES (${this.key(value)}, 1, CURRENT_TIMESTAMP + ${this.windowMs} * INTERVAL '1 millisecond')
        ON CONFLICT ("key") DO UPDATE SET
          "hits" = CASE WHEN "RateLimitBucket"."resetAt" <= CURRENT_TIMESTAMP THEN 1
                        ELSE LEAST("RateLimitBucket"."hits", 2147483646) + 1 END,
          "resetAt" = CASE WHEN "RateLimitBucket"."resetAt" <= CURRENT_TIMESTAMP
                           THEN CURRENT_TIMESTAMP + ${this.windowMs} * INTERVAL '1 millisecond'
                           ELSE "RateLimitBucket"."resetAt" END
        RETURNING "hits", "resetAt"`;
      const row = rows[0];
      if (!row) throw new Error('Missing bucket');
      return { totalHits: row.hits, resetTime: row.resetAt };
    } catch { throw err('RATE_LIMIT_UNAVAILABLE', 'Request protection is unavailable', 503); }
  }

  async decrement(value: string) {
    await this.prisma.rateLimitBucket.updateMany({ where: { key: this.key(value), hits: { gt: 0 } }, data: { hits: { decrement: 1 } } });
  }
  async resetKey(value: string) { await this.prisma.rateLimitBucket.deleteMany({ where: { key: this.key(value) } }); }
}

export const remoteAddressKey = (req: Request) => ipKeyGenerator(req.socket.remoteAddress ?? 'unknown');

export function createRateLimits(prisma: PrismaClient, config: Config, logger: Logger) {
  const limit = (scope: string, count: number, windowMs: number, keyGenerator: (req: Request) => string): RequestHandler => rateLimit({
    windowMs, limit: count, store: new PrismaRateLimitStore(prisma, config.sessionSecret, scope), keyGenerator,
    standardHeaders: 'draft-7', legacyHeaders: false, passOnStoreError: false,
    handler: (_req, _res, next) => next(err('RATE_LIMITED', 'Too many requests; try again later', 429)),
    logger: {
      error: () => logger.error('rate_limit.error', { code: 'RATE_LIMIT_ERROR' }),
      warn: () => logger.info('rate_limit.warning', { code: 'RATE_LIMIT_WARNING' }),
    },
  });
  return {
    loginIp: limit('login-ip', 30, 15 * 60_000, remoteAddressKey),
    loginAccount: limit('login-account', 10, 15 * 60_000, req => String(req.body.email)),
    otpRequestIp: limit('otp-request-ip', 5, 60 * 60_000, remoteAddressKey),
    otpRequestToken: limit('otp-request-token', 5, 60 * 60_000, req => String(req.params.token)),
    otpVerifyIp: limit('otp-verify-ip', 30, 15 * 60_000, remoteAddressKey),
    otpVerifyToken: limit('otp-verify-token', 10, 15 * 60_000, req => String(req.params.token)),
  };
}
