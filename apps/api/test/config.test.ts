import { describe, expect, it } from 'vitest';
import { ConfigurationError, loadConfig, assertRuntimeSupported } from '../src/config.js';
import { seedSettings } from '../prisma/seed.js';
import { testConfig } from './helpers.js';

describe('configuration', () => {
  it('requires explicit database and secret instead of fallback credentials', () => {
    expect(() => loadConfig({})).toThrow('DATABASE_URL, SESSION_SECRET');
  });
  it('uses safe defaults and freezes the parsed config', () => {
    const config = testConfig();
    expect(config).toMatchObject({ demo: false, port: 3001, qrTokenTtlDays: 90 });
    expect(Object.isFrozen(config)).toBe(true);
  });
  it.each([
    ['NODE_ENV', 'preview'], ['API_PORT', '0'], ['API_PORT', '65536'], ['API_PORT', '1.5'],
    ['APP_ORIGIN', 'https://example.com/path'], ['APP_ORIGIN', 'https://user:pass@example.com'],
    ['APP_ORIGIN', 'https://example.com/'], ['DATABASE_URL', 'sqlite://local.db'],
    ['DATABASE_URL', 'postgresql://localhost'], ['SESSION_SECRET', 'short'],
    ['SESSION_SECRET', 'replace-with-at-least-32-random-characters'], ['DEMO_MODE', 'yes'],
    ['QR_TOKEN_TTL_DAYS', '0'], ['QR_TOKEN_TTL_DAYS', '1.5'],
  ])('rejects invalid %s', (key, value) => {
    expect(() => testConfig({ [key]: value })).toThrow(ConfigurationError);
  });
  it('never includes secret values in configuration errors', () => {
    const sensitive = 'postgresql://private-user:private-password@';
    try { testConfig({ DATABASE_URL: sensitive }); throw new Error('Expected rejection'); }
    catch (error) {
      expect(error).toBeInstanceOf(ConfigurationError);
      expect(String(error)).toBe('ConfigurationError: Invalid configuration: DATABASE_URL');
    }
  });
  it('forbids production demo OTP and insecure origins', () => {
    expect(() => testConfig({ NODE_ENV: 'production', DEMO_MODE: 'true' })).toThrow(ConfigurationError);
    expect(() => testConfig({ NODE_ENV: 'production' })).toThrow(ConfigurationError);
  });
  it('keeps production gated pending deployment and live integrations', () => {
    expect(() => assertRuntimeSupported(testConfig({ NODE_ENV: 'production', APP_ORIGIN: 'https://unloss.example' })))
      .toThrow('Production serving is disabled');
  });
});

describe('demo seed configuration', () => {
  it('requires explicit demo mode and credentials', () => {
    expect(() => seedSettings({})).toThrow();
    expect(() => seedSettings({ DEMO_MODE: 'true' })).toThrow();
    expect(() => seedSettings({ DEMO_MODE: 'true', NODE_ENV: 'production' })).toThrow();
  });
  it('does not accept template or bcrypt-truncated passwords', () => {
    const env = { DEMO_MODE: 'true', SEED_SELLER_EMAIL: 'demo@unloss.local' };
    expect(() => seedSettings({ ...env, SEED_SELLER_PASSWORD: 'replace-with-a-local-demo-password' })).toThrow();
    expect(() => seedSettings({ ...env, SEED_SELLER_PASSWORD: '🙂'.repeat(20) })).toThrow();
  });
});
