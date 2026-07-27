import { expect, test } from '@playwright/test';
import { Pool } from 'pg';

/**
 * Phase 2's Portfolio journey, through a real browser:
 *
 *   nav unlock → empty state (no investment accounts) → a holding with no live price
 *   renders "Price unavailable", not a broken page → the same holding appears, aggregated,
 *   on /portfolio
 *
 * `ALPHA_VANTAGE_API_KEY` is deliberately left unset for this whole spec — CI has no real
 * key and no network access to spend on one, and that is exactly the case this spec exists
 * to prove doesn't break anything: docs/PROPOSAL.md's "the app works with zero provider
 * connected" posture, applied to market data the same way it applies to Open Banking. Live
 * pricing itself was verified by hand against the real Alpha Vantage API and is not
 * re-verified here — see docs/STATUS.md's Phase 2 section for that evidence.
 *
 * Same truncate-between-tests and `seedThroughSetup`-style pattern as
 * `setup-and-dashboard.spec.ts`, for the same reasons (fresh household per test; drive the
 * UI rather than inserting rows, so this can't pass against a schema the forms can't
 * actually populate).
 */

const DATABASE_URL = process.env.E2E_DATABASE_URL!;
const PASSPHRASE = process.env.E2E_PASSPHRASE ?? 'e2e-test-passphrase';

test.beforeEach(async () => {
  const pool = new Pool({ connectionString: DATABASE_URL, max: 1 });
  try {
    await pool.query(
      'TRUNCATE TABLE balance_snapshot, holding, debt_terms, account, pension_contribution, person, household, quote_cache RESTART IDENTITY CASCADE;',
    );
  } finally {
    await pool.end();
  }
});

async function logIn(page: import('@playwright/test').Page) {
  await page.goto('/');
  await expect(page.getByLabel(/passphrase/i)).toBeVisible();
  await page.getByLabel(/passphrase/i).fill(PASSPHRASE);
  await page.getByRole('button', { name: /unlock|sign in|continue/i }).click();
}

/** Minimal household with a person and one *non*-investment account — enough to clear
 * the /portfolio redirect-to-setup guard while genuinely having nothing to show. */
async function seedHouseholdWithNoInvestments(page: import('@playwright/test').Page) {
  await expect(page).toHaveURL(/\/setup/);
  await page.getByLabel('Household name').fill('The Elm Grove household');
  await page.getByRole('button', { name: 'Continue' }).click();

  await page.getByLabel('Name', { exact: true }).fill('Alex');
  await page.getByLabel('Date of birth').fill('1985-04-12');
  await page.getByRole('button', { name: 'Add person' }).click();
  await page.getByRole('link', { name: /next: add an account/i }).click();

  await page.getByRole('button', { name: 'Cash', exact: true }).click();
  await page.getByLabel('Account name').fill('Everyday current account');
  await page.getByRole('checkbox', { name: 'Alex' }).check();
  await page.getByLabel('Current balance').fill('2500');
  await page.getByRole('button', { name: 'Add account' }).click();
  await page.getByRole('button', { name: /finish setup/i }).click();
  await expect(page.getByRole('heading', { name: 'Net worth' })).toBeVisible();
}

/** A household with one investment account (S&S ISA), ready for a holding to be added. */
async function seedHouseholdWithInvestmentAccount(page: import('@playwright/test').Page) {
  await expect(page).toHaveURL(/\/setup/);
  await page.getByLabel('Household name').fill('The Elm Grove household');
  await page.getByRole('button', { name: 'Continue' }).click();

  await page.getByLabel('Name', { exact: true }).fill('Alex');
  await page.getByLabel('Date of birth').fill('1985-04-12');
  await page.getByRole('button', { name: 'Add person' }).click();
  await page.getByRole('link', { name: /next: add an account/i }).click();

  await page.getByRole('button', { name: 'S&S ISA' }).click();
  await page.getByLabel('Account name').fill('Vanguard S&S ISA');
  await page.getByRole('checkbox', { name: 'Alex' }).check();
  await page.getByLabel('Current balance').fill('15000');
  await page.getByRole('button', { name: 'Add account' }).click();
  await page.getByRole('button', { name: /finish setup/i }).click();
  await expect(page.getByRole('heading', { name: 'Net worth' })).toBeVisible();
}

test('Portfolio is a live nav link, not a reserved Phase slot', async ({ page }) => {
  await logIn(page);
  await seedHouseholdWithNoInvestments(page);

  const portfolioLink = page.getByRole('link', { name: 'Portfolio', exact: true });
  await expect(portfolioLink).toBeVisible();
  await portfolioLink.click();
  await expect(page).toHaveURL(/\/portfolio/);
  await expect(page.getByRole('heading', { name: 'Portfolio' })).toBeVisible();
});

test('shows the empty state with no investment accounts', async ({ page }) => {
  await logIn(page);
  await seedHouseholdWithNoInvestments(page);

  await page.goto('/portfolio');
  await expect(page.getByText('Add an investment account to see your portfolio here')).toBeVisible();
  await page.getByRole('link', { name: 'Go to Accounts' }).click();
  await expect(page).toHaveURL(/\/accounts/);
});

test('a holding with no live price renders gracefully, not broken', async ({ page }) => {
  await logIn(page);
  await seedHouseholdWithInvestmentAccount(page);

  await page.goto('/accounts');
  await page.getByRole('link', { name: /Vanguard S&S ISA/ }).click();

  await page.getByRole('button', { name: /add holding/i }).click();
  await page.getByLabel('Ticker').fill('VUAG');
  await page.getByLabel('Quantity').fill('50');
  await page.getByLabel('Cost basis').fill('5000');
  await page.getByRole('button', { name: 'Add holding' }).last().click();

  // No live key configured — this must read as "we don't know," never a broken cell, a
  // zero, or a thrown error.
  await expect(page.getByText('VUAG')).toBeVisible();
  await expect(page.getByText('Price unavailable').first()).toBeVisible();

  // The same holding, aggregated, on the Portfolio page.
  await page.goto('/portfolio');
  await expect(page.getByText('£0').first()).toBeVisible(); // total invested: nothing priced
  await expect(page.getByRole('button', { name: /VUAG/i })).toBeVisible();
  await expect(page.getByText('Price unavailable').first()).toBeVisible();

  // Expand-in-place still works with no price: the account breakdown is independent of
  // whether a live value exists.
  await page.getByRole('button', { name: /VUAG/i }).click();
  await expect(page.getByText(/Vanguard S&S ISA/)).toBeVisible();
});
