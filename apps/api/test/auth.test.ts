import { randomBytes } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { PrismaClient } from '@prisma/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app.js';
import { createLogger } from '../src/logger.js';
import { hashToken } from '../src/rules.js';
import { sessionCookieOptions, SESSION_TTL_MS } from '../src/sessions.js';
import { listen, testConfig } from './helpers.js';

describe('authentication failure handling', () => {
  const config = testConfig();
  const password = randomBytes(18).toString('base64url');
  const seller = { id: 'synthetic-seller', email: 'synthetic@unloss.local', name: 'Synthetic Seller', passwordHash: bcrypt.hashSync(password, 12), userId: null, createdAt: new Date() };
  const headers = { Origin: config.appOrigin, 'Content-Type': 'application/json' };
  let prisma: PrismaClient;
  let server: Awaited<ReturnType<typeof listen>>;
  let logs: string[];

  beforeEach(async () => {
    prisma = new PrismaClient();
    vi.spyOn(prisma, '$queryRaw').mockResolvedValue([{ hits: 1, resetAt: new Date(Date.now() + 60_000) }]);
    vi.spyOn(prisma.seller, 'findUnique').mockResolvedValue(seller);
    vi.spyOn(prisma.user, 'findFirst').mockResolvedValue(null);
    vi.spyOn(prisma.session, 'create').mockResolvedValue({ sid: 'hashed-id', sellerId: seller.id, userId: null, data: {}, expiresAt: new Date(Date.now() + SESSION_TTL_MS) });
    vi.spyOn(prisma.session, 'count').mockResolvedValue(1);
    vi.spyOn(prisma.session, 'deleteMany').mockResolvedValue({ count: 1 });
    vi.spyOn(prisma.session, 'findUnique').mockResolvedValue({
      sid: 'hashed-id', sellerId: seller.id, userId: null, data: { credentialVersion: hashToken(seller.passwordHash) }, expiresAt: new Date(Date.now() + SESSION_TTL_MS),
    });
    logs = [];
    server = await listen(createApp({ config, prisma, logger: createLogger(line => logs.push(line)) }));
  });
  afterEach(async () => { await server.close(); await prisma.$disconnect(); vi.restoreAllMocks(); });
  const loginBody = () => JSON.stringify({ email: seller.email, password });
  it('rejects simulated Google identity and disables test OTP outside demo mode', async () => {
    const google = await fetch(`${server.url}/api/auth/google`, { method: 'POST', headers, body: JSON.stringify({ email: seller.email, name: 'Impersonator' }) });
    expect(google.status).toBe(400);
    for (const path of ['otp-request', 'otp-login']) {
      const otp = await fetch(`${server.url}/api/auth/phone/${path}`, { method: 'POST', headers, body: JSON.stringify({ phone: '+15555550123', code: '123456' }) });
      expect(otp.status).toBe(503);
      expect(await otp.text()).not.toContain('devCode');
    }
    expect(prisma.session.create).not.toHaveBeenCalled();
  });
  async function loginCookie() {
    const response = await fetch(`${server.url}/api/auth/login`, { method: 'POST', headers, body: loginBody() });
    expect(response.status).toBe(200);
    expect((await response.json()).mode).toBe('manual');
    return response.headers.get('set-cookie')!.split(';')[0]!;
  }

  it('compares a password for unknown emails and returns the same credential error', async () => {
    const compare = vi.spyOn(bcrypt, 'compare');
    const bad = await fetch(`${server.url}/api/auth/login`, { method: 'POST', headers, body: JSON.stringify({ email: seller.email, password: 'incorrect' }) });
    vi.mocked(prisma.seller.findUnique).mockResolvedValue(null);
    const unknown = await fetch(`${server.url}/api/auth/login`, { method: 'POST', headers, body: loginBody() });
    expect(bad.status).toBe(401); expect(unknown.status).toBe(401);
    expect((await bad.json()).error).toEqual((await unknown.json()).error);
    expect(compare).toHaveBeenCalledTimes(2);
    expect(prisma.session.create).not.toHaveBeenCalled();
    expect(unknown.headers.get('set-cookie')).toBeNull();
  });
  it.each(['x'.repeat(73), '🙂'.repeat(19)])('rejects passwords exceeding bcrypt byte limits', async password => {
    const response = await fetch(`${server.url}/api/auth/login`, { method: 'POST', headers, body: JSON.stringify({ email: seller.email, password }) });
    expect(response.status).toBe(400);
    expect(prisma.seller.findUnique).not.toHaveBeenCalled();
  });
  it('does not return success or an authenticated cookie when persistence fails', async () => {
    vi.mocked(prisma.session.create).mockRejectedValue(new Error('private-database-url'));
    const response = await fetch(`${server.url}/api/auth/login`, { method: 'POST', headers, body: loginBody() });
    expect(response.status).toBe(503);
    expect((await response.json()).error.code).toBe('SESSION_UNAVAILABLE');
    expect(response.headers.get('set-cookie')).toBeNull();
    expect(logs.join('')).not.toContain('private-database-url');
  });
  it('fails login when the explicit save cannot confirm the issued session', async () => {
    vi.mocked(prisma.session.count).mockRejectedValue(new Error('database unavailable'));
    const response = await fetch(`${server.url}/api/auth/login`, { method: 'POST', headers, body: loginBody() });
    expect(response.status).toBe(503);
    expect(response.headers.get('set-cookie')).toBeNull();
    expect(prisma.session.deleteMany).toHaveBeenCalledTimes(2);
  });
  it('propagates session read failures and returns no private seller data', async () => {
    const cookie = await loginCookie();
    vi.mocked(prisma.session.findUnique).mockRejectedValue(new Error('private-session-error'));
    const response = await fetch(`${server.url}/api/auth/me`, { headers: { Cookie: cookie } });
    expect(response.status).toBe(503);
    expect((await response.json()).error.code).toBe('SESSION_UNAVAILABLE');
    expect(logs.join('')).not.toContain('private-session-error');
  });
  it('does not claim logout or clear the cookie when revocation fails', async () => {
    const cookie = await loginCookie();
    vi.mocked(prisma.session.deleteMany).mockRejectedValue(new Error('private-revocation-error'));
    const response = await fetch(`${server.url}/api/auth/logout`, { method: 'POST', headers: { ...headers, Cookie: cookie } });
    expect(response.status).toBe(503);
    expect((await response.json()).error.code).toBe('SESSION_UNAVAILABLE');
    expect(response.headers.get('set-cookie')).toBeNull();
    expect(logs.join('')).not.toContain('private-revocation-error');
  });
  it('fails closed when rate-limit storage fails before password lookup', async () => {
    vi.mocked(prisma.$queryRaw).mockRejectedValue(new Error('private-rate-error'));
    const response = await fetch(`${server.url}/api/auth/login`, { method: 'POST', headers, body: loginBody() });
    expect(response.status).toBe(503);
    expect((await response.json()).error.code).toBe('RATE_LIMIT_UNAVAILABLE');
    expect(prisma.seller.findUnique).not.toHaveBeenCalled();
    expect(logs.join('')).not.toContain('private-rate-error');
  });
  it('retains secure, host-only cookie attributes for the future production deployment', () => {
    expect(sessionCookieOptions({ ...config, nodeEnv: 'production' })).toEqual({ path: '/', httpOnly: true, sameSite: 'lax', secure: true, hostOnly: true });
  });
});
