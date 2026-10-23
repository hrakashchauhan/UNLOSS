import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { createApp } from '../src/app.js';
import { createLogger } from '../src/logger.js';
import { listen, testConfig } from './helpers.js';

describe('HTTP foundation', () => {
  let prisma: PrismaClient;
  let server: Awaited<ReturnType<typeof listen>>;
  let logs: string[];
  let shuttingDown: boolean;
  const config = testConfig();
  const jsonHeaders = { Origin: config.appOrigin, 'Content-Type': 'application/json' };

  beforeEach(async () => {
    prisma = new PrismaClient();
    vi.spyOn(prisma, '$queryRaw').mockResolvedValue([{ '?column?': 1 }]);
    vi.spyOn(prisma.seller, 'findFirst').mockResolvedValue(null);
    logs = []; shuttingDown = false;
    server = await listen(createApp({ config, prisma, logger: createLogger(line => logs.push(line)), isShuttingDown: () => shuttingDown }));
  });
  afterEach(async () => { await server.close(); await prisma.$disconnect(); vi.restoreAllMocks(); });

  it('exposes live/ready checks without creating sessions or disclosing infrastructure', async () => {
    const live = await fetch(`${server.url}/health/live`);
    expect(await live.json()).toEqual({ status: 'ok', mode: 'manual' });
    expect(live.headers.get('set-cookie')).toBeNull();
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
    const ready = await fetch(`${server.url}/health/ready`);
    expect(await ready.json()).toEqual({ status: 'ready', mode: 'manual' });
    expect(prisma.$queryRaw).toHaveBeenCalledOnce();
    expect(prisma.seller.findFirst).toHaveBeenCalledOnce();
    expect(ready.headers.get('cache-control')).toBe('no-store');
    expect(ready.headers.get('x-powered-by')).toBeNull();
    expect(ready.headers.get('referrer-policy')).toBe('no-referrer');
  });
  it('fails readiness safely for database/schema failures while liveness stays available', async () => {
    vi.mocked(prisma.seller.findFirst).mockRejectedValue(new Error('private-db-password and schema path'));
    const ready = await fetch(`${server.url}/health/ready`);
    expect(ready.status).toBe(503);
    const body = await ready.json();
    expect(body.error).toEqual({ code: 'NOT_READY', message: 'Service is not ready' });
    expect(JSON.stringify(body) + logs.join('')).not.toContain('private-db-password');
    expect((await fetch(`${server.url}/health/live`)).status).toBe(200);
  });
  it('fails readiness when draining without querying the database', async () => {
    shuttingDown = true;
    expect((await fetch(`${server.url}/health/ready`)).status).toBe(503);
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
  });
  it.each([undefined, 'https://attacker.example', 'null'])('rejects missing/untrusted origin on login: %s', async origin => {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (origin) headers.Origin = origin;
    const response = await fetch(`${server.url}/api/auth/login`, { method: 'POST', headers, body: '{}' });
    expect(response.status).toBe(403);
    expect((await response.json()).error.code).toBe('CSRF_REJECTED');
  });
  it('answers credentialed CORS preflight only for the configured origin', async () => {
    const response = await fetch(`${server.url}/api/auth/login`, {
      method: 'OPTIONS', headers: { Origin: config.appOrigin, 'Access-Control-Request-Method': 'POST' },
    });
    expect(response.status).toBe(204);
    expect(response.headers.get('access-control-allow-origin')).toBe(config.appOrigin);
    expect(response.headers.get('access-control-allow-credentials')).toBe('true');
  });
  it('correlates malformed JSON errors without reflecting raw bodies or trusting incoming IDs', async () => {
    const response = await fetch(`${server.url}/api/auth/login`, {
      method: 'POST', headers: { ...jsonHeaders, 'X-Request-Id': 'untrusted-private-data' }, body: '{"password":"private-password",',
    });
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toEqual({ code: 'INVALID_JSON', message: 'Request body must be valid JSON' });
    expect(body.requestId).toBe(response.headers.get('x-request-id'));
    expect(body.requestId).not.toBe('untrusted-private-data');
    expect(JSON.stringify(body) + logs.join('')).not.toContain('private-password');
  });
  it('limits body size with the common error envelope', async () => {
    const response = await fetch(`${server.url}/api/auth/login`, {
      method: 'POST', headers: jsonHeaders, body: JSON.stringify({ password: 'x'.repeat(33 * 1024) }),
    });
    expect(response.status).toBe(413);
    expect((await response.json()).error.code).toBe('PAYLOAD_TOO_LARGE');
  });
  it('returns field paths/codes for validation failures without sensitive values', async () => {
    const response = await fetch(`${server.url}/api/auth/login`, {
      method: 'POST', headers: jsonHeaders, body: JSON.stringify({ email: 'sensitive-invalid-email', password: '' }),
    });
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error.code).toBe('VALIDATION_ERROR');
    expect(body.error.details).toContainEqual({ path: 'email', code: 'invalid_format' });
    expect(JSON.stringify(body) + logs.join('')).not.toContain('sensitive-invalid-email');
  });
  it('preserves the unauthenticated seller response and JSON 404 envelope', async () => {
    expect((await fetch(`${server.url}/api/auth/me`)).status).toBe(401);
    const response = await fetch(`${server.url}/api/unknown/private-value`);
    expect(response.status).toBe(404);
    expect((await response.json()).error.code).toBe('NOT_FOUND');
    expect(logs.join('')).not.toContain('private-value');
  });
  it('masks database error codes, stack traces and credentials', async () => {
    vi.spyOn(prisma.seller, 'findUnique').mockRejectedValue(Object.assign(new Error('private-database-password'), { code: 'P1001', status: 400 }));
    const response = await fetch(`${server.url}/api/auth/login`, {
      method: 'POST', headers: jsonHeaders, body: JSON.stringify({ email: 'private@unloss.local', password: 'private-password' }),
    });
    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body.error).toEqual({ code: 'INTERNAL_ERROR', message: 'Internal server error' });
    expect(JSON.stringify(body) + logs.join('')).not.toMatch(/private|P1001|stack/);
  });
  it('logs route templates rather than QR tokens, query strings, cookies or OTP headers', async () => {
    vi.spyOn(prisma.qrToken, 'findUnique').mockResolvedValue(null);
    await fetch(`${server.url}/api/delivery/private-qr-token?phone=private-phone`, {
      headers: { Cookie: 'private-cookie', 'X-Customer-Verification': 'private-proof' },
    });
    expect(logs.join('')).toContain('/api/delivery/:token');
    expect(logs.join('')).not.toContain('private-');
  });
});
