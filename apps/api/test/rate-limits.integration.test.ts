import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { createLogger } from '../src/logger.js';
import { PrismaRateLimitStore } from '../src/rate-limits.js';
import { listen, testConfig } from './helpers.js';
import { integrationDatabase } from './integration-helpers.js';

const database = integrationDatabase();
const prisma = database.prisma;
const logger = createLogger(() => {});
let config = database.config;
let servers: Awaited<ReturnType<typeof listen>>[];
let keys: Set<string>;
const headers = () => ({ Origin: config.appOrigin, 'Content-Type': 'application/json' });
function store(scope: string) { return new PrismaRateLimitStore(prisma, config.sessionSecret, scope); }
function track(scope: string, value: string) { keys.add(store(scope).key(value)); }
beforeEach(async () => {
  config = testConfig({ DATABASE_URL: database.config.databaseUrl });
  keys = new Set();
  servers = await Promise.all([listen(createApp({ prisma, config, logger })), listen(createApp({ prisma, config, logger }))]);
  for (const scope of ['login-ip', 'otp-request-ip', 'otp-verify-ip']) track(scope, '127.0.0.1');
});
afterEach(async () => {
  await Promise.all(servers.map(server => server.close()));
  await prisma.rateLimitBucket.deleteMany({ where: { key: { in: [...keys] } } });
});
afterAll(async () => { await prisma.$disconnect(); });

describe('shared persistent rate limits', () => {
  it('counts concurrent increments exactly once across independent stores and resets expired windows', async () => {
    const value = randomUUID(); track('atomic-test', value);
    const one = store('atomic-test'), two = store('atomic-test');
    const results = await Promise.all(Array.from({ length: 50 }, (_, index) => (index % 2 ? one : two).increment(value)));
    expect(results.map(row => row.totalHits).sort((a, b) => a - b)).toEqual(Array.from({ length: 50 }, (_, i) => i + 1));
    const next = await store('atomic-test').increment(value);
    expect(next.totalHits).toBe(51);
    expect(next.resetTime!.getTime() - Date.now()).toBeGreaterThan(0);
    expect(next.resetTime!.getTime() - Date.now()).toBeLessThanOrEqual(60_000);
    await prisma.rateLimitBucket.update({ where: { key: one.key(value) }, data: { resetAt: new Date(Date.now() - 1000) } });
    expect((await two.increment(value)).totalHits).toBe(1);
  });
  it('stores keyed digests rather than IPs, emails or token strings and parameterizes SQL', async () => {
    const value = `synthetic-${randomUUID()}@unloss.local'; DROP TABLE "Seller"; --`;
    track('privacy-test', value);
    const limiter = store('privacy-test');
    await limiter.increment(value);
    const row = await prisma.rateLimitBucket.findUniqueOrThrow({ where: { key: limiter.key(value) } });
    expect(row.key).toMatch(/^privacy-test:[a-f0-9]{64}$/);
    expect(JSON.stringify(row)).not.toContain(value);
    await expect(prisma.seller.count()).resolves.toBeTypeOf('number');
  });
  it('enforces the login IP budget across apps and ignores spoofed forwarding headers', async () => {
    for (let i = 0; i < 30; i++) {
      const response = await fetch(`${servers[i % 2]!.url}/api/auth/login`, {
        method: 'POST', headers: { ...headers(), 'X-Forwarded-For': `192.0.2.${i + 1}`, Forwarded: `for=192.0.2.${i + 1}` }, body: '{}',
      });
      expect(response.status).toBe(400);
    }
    const response = await fetch(`${servers[1]!.url}/api/auth/login`, { method: 'POST', headers: headers(), body: '{}' });
    expect(response.status).toBe(429);
    expect((await response.json()).error.code).toBe('RATE_LIMITED');
    expect(Number(response.headers.get('retry-after'))).toBeGreaterThan(0);
  });
  it('normalizes account limits and retains them across replacement app instances', async () => {
    const email = `missing-${randomUUID()}@unloss.local`; track('login-account', email);
    for (let i = 0; i < 10; i++) {
      const response = await fetch(`${servers[i % 2]!.url}/api/auth/login`, { method: 'POST', headers: headers(), body: JSON.stringify({ email: i % 2 ? ` ${email.toUpperCase()} ` : email, password: 'synthetic-invalid-password' }) });
      expect(response.status).toBe(401);
    }
    await servers[1]!.close();
    servers[1] = await listen(createApp({ prisma, config, logger }));
    const response = await fetch(`${servers[1].url}/api/auth/login`, { method: 'POST', headers: headers(), body: JSON.stringify({ email, password: 'synthetic-invalid-password' }) });
    expect(response.status).toBe(429);
    expect((await response.json()).requestId).toBe(response.headers.get('x-request-id'));
  });
  it('limits OTP requests by IP across different tokens', async () => {
    for (let i = 0; i < 6; i++) {
      const token = randomUUID(); track('otp-request-token', token);
      const response = await fetch(`${servers[i % 2]!.url}/api/customer/${token}/request-otp`, { method: 'POST', headers: headers(), body: '{}' });
      expect(response.status).toBe(i < 5 ? 503 : 429);
    }
  });
  it('limits OTP verification by token across app instances', async () => {
    const token = randomUUID(); track('otp-verify-token', token);
    for (let i = 0; i < 11; i++) {
      const response = await fetch(`${servers[i % 2]!.url}/api/customer/${token}/verify-otp`, { method: 'POST', headers: headers(), body: JSON.stringify({ challengeId: 'synthetic', code: '000000' }) });
      expect(response.status).toBe(i < 10 ? 503 : 429);
    }
  });
  it('enforces the separate OTP-request token budget before the IP budget is exhausted', async () => {
    const token = randomUUID(); track('otp-request-token', token);
    const first = await fetch(`${servers[0]!.url}/api/customer/${token}/request-otp`, { method: 'POST', headers: headers(), body: '{}' });
    expect(first.status).toBe(503);
    const key = store('otp-request-token').key(token);
    const row = await prisma.rateLimitBucket.findUniqueOrThrow({ where: { key } });
    expect(row.resetAt.getTime() - Date.now()).toBeGreaterThan(3_500_000);
    await prisma.rateLimitBucket.update({ where: { key }, data: { hits: 5 } });
    const limited = await fetch(`${servers[1]!.url}/api/customer/${token}/request-otp`, { method: 'POST', headers: headers(), body: '{}' });
    expect(limited.status).toBe(429);
    const ip = await prisma.rateLimitBucket.findUniqueOrThrow({ where: { key: store('otp-request-ip').key('127.0.0.1') } });
    expect(ip.hits).toBe(2);
  });
  it('limits OTP verification by IP even when tokens change', async () => {
    for (let i = 0; i < 31; i++) {
      const token = randomUUID(); track('otp-verify-token', token);
      const response = await fetch(`${servers[i % 2]!.url}/api/customer/${token}/verify-otp`, { method: 'POST', headers: headers(), body: '{}' });
      expect(response.status).toBe(i < 30 ? 503 : 429);
    }
  });
});
