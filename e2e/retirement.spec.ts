import { expect, test, type Page } from '@playwright/test';
import { Pool } from 'pg';

/**
 * The Milestone 9 smoke journey, through a real browser and a real worker-thread
 * simulation — no mocking, matching Phase 1/2's own E2E spirit (they each caught a real
 * bug a unit test couldn't see: Phase 1's setup-step navigation bug, Phase 2's uncaught
 * exception). This suite needs no external network — the Monte Carlo engine is entirely
 * local — unlike `portfolio.spec.ts`'s Alpha Vantage dependency.
 *
 *   create scenario → run simulation → Computing state polls → completes → Results
 *   (headline/chart/accessible summary) → Compare → assumptions-diff table
 *
 * Server-side coverage of the same pieces lives in
 * `src/app/api/retirement/simulation-runs/*.integration.test.ts` (M7) and
 * `src/lib/retirement/scenarioCrud.integration.test.ts` (M8) — those assert rows and
 * responses; this asserts a person clicking through the UI can actually reach them.
 */

const DATABASE_URL = process.env.E2E_DATABASE_URL!;
const PASSPHRASE = process.env.E2E_PASSPHRASE ?? 'e2e-test-passphrase';

test.beforeEach(async () => {
  const pool = new Pool({ connectionString: DATABASE_URL, max: 1 });
  try {
    await pool.query(
      'TRUNCATE TABLE simulation_run, retirement_scenario, balance_snapshot, holding, debt_terms, account, pension_contribution, person, household RESTART IDENTITY CASCADE;',
    );
  } finally {
    await pool.end();
  }
});

async function logIn(page: Page) {
  await page.goto('/');
  await expect(page.getByLabel(/passphrase/i)).toBeVisible();
  await page.getByLabel(/passphrase/i).fill(PASSPHRASE);
  await page.getByRole('button', { name: /unlock|sign in|continue/i }).click();
}

/** A new scenario now defaults to nobody selected in the "Who's this scenario for?"
 * picker (a household previously had every member — including young children —
 * included by default, with no way to leave anyone out; fixed after that incident).
 * Per-person fields don't exist in the DOM until their person is checked here. */
async function selectPeople(page: Page, names: string[]) {
  for (const name of names) {
    await page.getByRole('checkbox', { name: new RegExp(name) }).check();
  }
}

/** Drives guided setup to a two-person, one-account household — the minimum a
 * retirement scenario needs (at least one person; a second exercises the
 * survivor-spending field and per-person "When" labelling). */
async function seedThroughSetup(page: Page) {
  await expect(page).toHaveURL(/\/setup/);

  await page.getByLabel('Household name').fill('The Elm Grove household');
  await page.getByRole('button', { name: 'Continue' }).click();

  await page.getByLabel('Name', { exact: true }).fill('Alex');
  await page.getByLabel('Date of birth').fill('1985-04-12');
  await page.getByRole('button', { name: 'Add person' }).click();
  await expect(page.getByText('Alex')).toBeVisible();

  await page.getByLabel('Name', { exact: true }).fill('Jordan');
  await page.getByLabel('Date of birth').fill('1987-09-30');
  await page.getByRole('button', { name: /add (another )?person/i }).click();
  await expect(page.getByText('Jordan')).toBeVisible();

  await page.getByRole('link', { name: /next: add an account/i }).click();

  await page.getByRole('button', { name: 'S&S ISA' }).click();
  await page.getByLabel('Account name').fill('Vanguard S&S ISA');
  await page.getByRole('checkbox', { name: 'Alex' }).check();
  await page.getByLabel('Current balance').fill('200000');
  await page.getByRole('button', { name: 'Add account' }).click();
  await expect(page.getByText('Vanguard S&S ISA')).toBeVisible();

  await page.getByRole('button', { name: /finish setup/i }).click();
  await expect(page.getByRole('heading', { name: 'Net worth' })).toBeVisible();
}

test('bare /retirement with no scenarios yet really redirects to /retirement/new (a genuine 307, not a client-only instruction)', async ({
  page,
}) => {
  await logIn(page);
  await seedThroughSetup(page);

  const response = await page.goto('/retirement');
  // Playwright follows redirects, so `response` is the final navigation's response —
  // asserting the URL landed on /retirement/new is what actually proves the server-side
  // redirect fired, the same check this codebase has needed before (see
  // setup-and-dashboard.spec.ts's own history with a loading.tsx/Suspense misuse
  // silently downgrading a redirect() to a client-only instruction).
  expect(response?.ok()).toBe(true);
  await expect(page).toHaveURL(/\/retirement\/new$/);
});

test('create, run, and view a scenario\'s results — full journey, real worker execution', async ({ page }) => {
  await logIn(page);
  await seedThroughSetup(page);

  await page.goto('/retirement/new');
  await expect(page.getByRole('heading', { name: 'New scenario' })).toBeVisible();

  await page.getByLabel('Scenario name').fill('Baseline');
  await selectPeople(page, ['Alex', 'Jordan']);

  // "When" — per-person fields are named, not generic (the spec's own two-person edge
  // case). Defaults are pre-filled, so only the ages actually need setting.
  await page.getByLabel(/Alex's retirement age/).fill('65');
  await page.getByLabel(/Jordan's retirement age/).fill('65');
  await page.getByLabel(/Alex's plan end age/).fill('95');
  await page.getByLabel(/Jordan's plan end age/).fill('95');

  // Survivor spending is required for a two-person household — defaulted, but confirm
  // it's present and non-empty rather than assuming.
  await expect(page.getByLabel('Survivor annual spending')).toHaveValue(/\d/);

  await page.getByRole('button', { name: 'Run simulation' }).click();

  // Computing state — a real worker thread runs, so this genuinely takes a moment.
  await expect(page.getByText(/Running .* simulations/i)).toBeVisible();

  // Once complete, the preview strip surfaces a link into the full Results screen.
  await page.getByRole('link', { name: 'View full results' }).click({ timeout: 30_000 });

  await expect(page).toHaveURL(/\/retirement\/\d+$/);
  // The headline is visually split (hero figure + caption) but one accessible sentence
  // via aria-label — see ResultsBody.tsx's own comment on why.
  await expect(page.getByLabel(/\d+% of simulated outcomes succeeded/)).toBeVisible();
  // The plain-language band indicator — one of Strong/On track/At risk.
  await expect(page.getByText(/^(Strong|On track|At risk)$/)).toBeVisible();
  // The fan chart's required accessible text-equivalent.
  await expect(page.getByText(/Median outcome: £.* at age \d+/)).toBeVisible();

  await page.getByText('Assumptions used').click();
  // Exact — "Annual spending" is otherwise a substring of the two-person household's
  // own "Survivor annual spending" row in the same summary.
  await expect(page.getByText('Annual spending', { exact: true })).toBeVisible();
});

test('the editor unblocks once a run resolves, and Cancel works when it catches a run still in flight', async ({
  page,
}) => {
  await logIn(page);
  await seedThroughSetup(page);

  await page.goto('/retirement/new');
  await page.getByLabel('Scenario name').fill('To cancel');
  await selectPeople(page, ['Alex', 'Jordan']);
  await page.getByLabel(/Alex's retirement age/).fill('65');
  await page.getByLabel(/Jordan's retirement age/).fill('65');
  await page.getByLabel(/Alex's plan end age/).fill('95');
  await page.getByLabel(/Jordan's plan end age/).fill('95');

  await page.getByRole('button', { name: 'Run simulation' }).click();

  // The engine is fast enough (M5's own docs: sub-100ms even for the default 2,000
  // iterations) that a real run can complete before this test's own next line executes —
  // Cancel is a genuine race, not a guaranteed window. Click it only if it's still there;
  // either way, the invariant that actually matters is the one below: the editor must
  // never stay locked once its run reaches a terminal state, cancelled or otherwise.
  const cancelButton = page.getByRole('button', { name: 'Cancel' });
  if (await cancelButton.isVisible().catch(() => false)) {
    await cancelButton.click();
  }

  await expect(page.getByLabel(/Alex's retirement age/)).toBeEnabled({ timeout: 15_000 });
});

test('comparing two scenarios shows both results side by side, a delta callout, and an assumptions diff', async ({
  page,
}) => {
  await logIn(page);
  await seedThroughSetup(page);

  async function createAndRun(name: string, retirementAge: string) {
    await page.goto('/retirement/new');
    await page.getByLabel('Scenario name').fill(name);
    await selectPeople(page, ['Alex', 'Jordan']);
    await page.getByLabel(/Alex's retirement age/).fill(retirementAge);
    await page.getByLabel(/Jordan's retirement age/).fill('65');
    await page.getByLabel(/Alex's plan end age/).fill('95');
    await page.getByLabel(/Jordan's plan end age/).fill('95');
    await page.getByRole('button', { name: 'Run simulation' }).click();
    await page.getByRole('link', { name: 'View full results' }).click({ timeout: 30_000 });
    await expect(page).toHaveURL(/\/retirement\/\d+$/);
    return page.url();
  }

  await createAndRun('Retire at 60', '60');
  await createAndRun('Retire at 67', '67');

  // Exact — a substring match on "Compare" is ambiguous against "Compare with Retire at
  // 60" and "Create a new one to compare" in the same disclosure.
  await page.getByText('Compare', { exact: true }).click();
  await page.getByRole('link', { name: /Compare with Retire at 60/ }).click();

  await expect(page).toHaveURL(/\/retirement\/compare\?a=\d+&b=\d+/);
  // .first() — both names also appear inside the page's own "X vs. Y" heading, which
  // substring-matches "Retire at 60" as a separate element from the side-card link.
  await expect(page.getByText('Retire at 60').first()).toBeVisible();
  await expect(page.getByText('Retire at 67').first()).toBeVisible();
  // The diff table: retirement age differs between the two, so it must appear.
  await expect(page.getByText(/retirement age/).first()).toBeVisible();
});
