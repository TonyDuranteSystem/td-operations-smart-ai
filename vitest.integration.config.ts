import { defineConfig } from 'vitest/config';
import path from 'node:path';

/**
 * Integration-test config. Separate from vitest.config.ts so `npm run test:unit`
 * never accidentally hits the sandbox DB. Requires SUPABASE_DB_URL in env to
 * run; individual test files guard with `describe.skipIf(!SUPABASE_DB_URL)`
 * so running without credentials produces a clean no-op rather than a failure.
 */
export default defineConfig({
  test: {
    include: ['tests/integration/**/*.test.ts'],
    environment: 'node',
    globals: false,
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
    },
  },
});
