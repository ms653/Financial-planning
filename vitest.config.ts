import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'node:path';

export default defineConfig({
  plugins: [react()],
  test: {
    /*
     * Most tests are pure logic — auth, money, validation, net worth aggregation — and run
     * fastest in plain Node. Only the component tests need a DOM, so jsdom is applied
     * per-file by extension rather than globally: standing up jsdom for the money tests
     * would cost time and buy nothing.
     */
    environment: 'node',
    environmentMatchGlobs: [['src/**/*.test.tsx', 'jsdom']],
    setupFiles: ['./vitest.setup.ts'],
    globals: true,
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    /*
     * Test files run one at a time.
     *
     * The two `*.integration.test.ts` files share a single scratch Postgres, and each starts by
     * dropping and recreating its schema. Run in parallel, one file wipes the schema out from
     * under the other — which showed up as a confusing spread of failures in unrelated
     * assertions rather than as an obvious conflict. The alternative (a database per file) is
     * more machinery than a suite this size needs; the whole run is a few seconds either way.
     */
    fileParallelism: false,
    /*
     * Playwright's E2E specs live in e2e/ and are run by `npm run test:e2e`. Excluded here
     * because Playwright's `test` export and Vitest's collide, and a Vitest run that tried
     * to collect them would fail confusingly rather than usefully.
     */
    exclude: ['node_modules', 'e2e/**'],
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});
