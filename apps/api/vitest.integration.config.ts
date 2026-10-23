import { defineConfig } from 'vitest/config';

export default defineConfig({ test: {
  include: ['test/**/*.integration.test.ts'],
  // Real bcrypt work and DB contention need a larger budget than pure unit tests.
  testTimeout: 15_000,
  hookTimeout: 15_000,
  maxWorkers: 2,
} });
