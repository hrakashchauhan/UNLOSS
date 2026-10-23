import { afterEach, expect, it, vi } from 'vitest';
afterEach(() => { vi.unstubAllEnvs(); vi.resetModules(); });
it('disables synthetic routes in default production builds', async () => {
  vi.stubEnv('DEV', false); vi.stubEnv('VITE_ENABLE_DEMO', 'false'); vi.resetModules();
  expect((await import('./config')).DEMO_ENABLED).toBe(false);
});
it('allows explicit demo deployments and local development', async () => {
  vi.stubEnv('DEV', false); vi.stubEnv('VITE_ENABLE_DEMO', 'true'); vi.resetModules();
  expect((await import('./config')).DEMO_ENABLED).toBe(true);
  vi.stubEnv('DEV', true); vi.stubEnv('VITE_ENABLE_DEMO', 'false'); vi.resetModules();
  expect((await import('./config')).DEMO_ENABLED).toBe(true);
});
