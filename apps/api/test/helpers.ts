import type { Express } from 'express';
import type { AddressInfo } from 'node:net';
import { randomBytes } from 'node:crypto';
import { loadConfig } from '../src/config.js';

export function testConfig(overrides: NodeJS.ProcessEnv = {}) {
  return loadConfig({
    NODE_ENV: 'test', DATABASE_URL: 'postgresql://test:test@127.0.0.1:5432/unloss_test',
    SESSION_SECRET: randomBytes(32).toString('hex'), APP_ORIGIN: 'http://localhost:5173', ...overrides,
  });
}

export async function listen(app: Express) {
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });
  return {
    url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    async close() {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    },
  };
}
