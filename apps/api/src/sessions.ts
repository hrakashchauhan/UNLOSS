import session from 'express-session';
import type { PrismaClient } from '@prisma/client';
import type { Config } from './config.js';
import { err } from './http.js';
import { hashToken } from './rules.js';

export const SESSION_COOKIE = 'unloss.sid';
export const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const sessionCookieOptions = (config: Config) => ({
  path: '/', httpOnly: true, sameSite: 'lax' as const, secure: config.nodeEnv === 'production',
});
const unavailable = () => err('SESSION_UNAVAILABLE', 'Session service is unavailable', 503);
type Callback = (error?: Error) => void;

/** Immutable authenticated sessions; only login issues new rows. Ordinary saves cannot resurrect logout. */
export class PrismaSessionStore extends session.Store {
  constructor(private readonly prisma: PrismaClient, private readonly config: Config) { super(); }

  async issue(sid: string, data: session.SessionData) {
    if (!data.sellerId || !data.credentialVersion || !data.sessionExpiresAt || data.sessionExpiresAt <= Date.now()) {
      throw err('UNAUTHENTICATED', 'Sign in required', 401);
    }
    try {
      await this.prisma.session.create({ data: {
        sid: hashToken(sid), sellerId: data.sellerId, expiresAt: new Date(data.sessionExpiresAt),
        data: { credentialVersion: data.credentialVersion },
      } });
    } catch { throw unavailable(); }
  }

  override get(sid: string, callback: (error: Error | null, data?: session.SessionData | null) => void): void {
    void this.read(sid).then(data => callback(null, data), () => callback(unavailable()));
  }

  private async read(sid: string): Promise<session.SessionData | null> {
    const row = await this.prisma.session.findUnique({ where: { sid: hashToken(sid) } });
    if (!row) return null;
    if (row.expiresAt.getTime() <= Date.now()) {
      await this.prisma.session.deleteMany({ where: { sid: row.sid, expiresAt: { lte: new Date() } } });
      return null;
    }
    const data = row.data;
    if (!data || typeof data !== 'object' || Array.isArray(data) || typeof data.credentialVersion !== 'string') return null;
    const cookie = new session.Cookie();
    Object.assign(cookie, sessionCookieOptions(this.config), { expires: row.expiresAt });
    cookie.originalMaxAge = row.expiresAt.getTime() - Date.now();
    return { sellerId: row.sellerId, sessionExpiresAt: row.expiresAt.getTime(), credentialVersion: data.credentialVersion, cookie };
  }

  override set(sid: string, data: session.SessionData, callback: Callback = () => {}): void {
    if (!data.sellerId || !data.sessionExpiresAt) { callback(err('UNAUTHENTICATED', 'Sign in required', 401)); return; }
    // No upsert: a request loaded before logout/expiry must never recreate that session.
    void this.prisma.session.count({ where: {
      sid: hashToken(sid), sellerId: data.sellerId,
      expiresAt: { equals: new Date(data.sessionExpiresAt), gt: new Date() },
    } }).then(count => callback(count === 1 ? undefined : err('UNAUTHENTICATED', 'Sign in required', 401)), () => callback(unavailable()));
  }

  override destroy(sid: string, callback: Callback = () => {}): void {
    void this.prisma.session.deleteMany({ where: { sid: hashToken(sid) } })
      .then(() => callback(), () => callback(unavailable()));
  }

  override touch(_sid: string, _data: session.SessionData, callback: () => void = () => {}): void {
    // Fixed absolute lifetime. Browsing neither extends expiry nor resurrects a revoked session.
    callback();
  }
}
