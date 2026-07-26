import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright configuration.
 *
 * PROPOSAL.md's testing strategy is specific about one thing here: "Playwright E2E needs its own
 * ephemeral Postgres (a compose profile or testcontainers) with seed fixtures — otherwise E2E
 * runs end up hitting real household data, which is both a correctness and a privacy problem."
 *
 * The E2E specs truncate every table before each run, so pointing this at the household's real
 * database would destroy it. That makes a guard worth more than a comment: `E2E_DATABASE_URL`
 * must be set explicitly, and it must not be the same URL the app runs on.
 *
 * Run it with:
 *   E2E_DATABASE_URL=postgresql://postgres:postgres@localhost:5432/financial_planning_e2e \
 *   E2E_PASSPHRASE='your-test-passphrase' \
 *   APP_PASSPHRASE_HASH='<hash of that passphrase, from npm run passphrase:hash>' \
 *   SESSION_SECRET="$(openssl rand -base64 48)" \
 *   npm run test:e2e
 */

const e2eDatabaseUrl = process.env.E2E_DATABASE_URL;

if (!e2eDatabaseUrl) {
  throw new Error(
    'E2E_DATABASE_URL must be set to a scratch database. These tests truncate every table — never point them at real household data. See playwright.config.ts.',
  );
}

if (process.env.DATABASE_URL && process.env.DATABASE_URL === e2eDatabaseUrl) {
  throw new Error(
    'E2E_DATABASE_URL is the same as DATABASE_URL. Refusing to run: these tests would truncate the database the app is using.',
  );
}

const PORT = Number(process.env.E2E_PORT ?? 3100);

export default defineConfig({
  testDir: './e2e',
  // Serial: the specs share one database and truncate it, so parallel workers would race.
  workers: 1,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: process.env.CI ? 'list' : [['list'], ['html', { open: 'never' }]],

  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },

  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],

  /**
   * A production build, not `next dev`. The dev server's on-demand compilation makes the first
   * navigation to each route slow enough to look like a hang, and Server Actions behave
   * marginally differently under it — the point of E2E here is to exercise what actually ships.
   */
  webServer: {
    command: 'npm run build && npm run start',
    url: `http://127.0.0.1:${PORT}/api/health`,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    env: {
      DATABASE_URL: e2eDatabaseUrl,
      PORT: String(PORT),
      // The app is served over plain HTTP locally, so a Secure cookie would be discarded by the
      // browser and every login would bounce straight back to the gate.
      COOKIE_SECURE: 'false',
      NODE_ENV: 'production',
    },
  },
});
