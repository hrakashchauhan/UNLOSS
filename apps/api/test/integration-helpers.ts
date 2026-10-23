import 'dotenv/config';
import { createDatabase } from '../src/database.js';
import { testConfig } from './helpers.js';

export function integrationDatabase() {
  const value = process.env.TEST_DATABASE_URL;
  if (!value) throw new Error('TEST_DATABASE_URL is required; use a migrated local unloss_test_* database');
  const target = new URL(value);
  if (!['localhost', '127.0.0.1', '[::1]'].includes(target.hostname) || !/^\/unloss_test_[a-z0-9_]+$/i.test(target.pathname)) {
    throw new Error('Integration tests require a loopback database named unloss_test_*');
  }
  const config = testConfig({ DATABASE_URL: value, DEMO_MODE: 'true' });
  return { config, prisma: createDatabase(config) };
}

export function rawSessionId(cookie: string) {
  return decodeURIComponent(cookie.slice(cookie.indexOf('=') + 1)).slice(2).split('.')[0]!;
}
