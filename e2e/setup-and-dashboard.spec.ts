import { expect, test } from '@playwright/test';
import { Pool } from 'pg';

/**
 * The Phase 1 smoke journey, through a real browser:
 *
 *   passphrase gate → no household → guided setup → household, people, accounts → dashboard
 *   showing real figures → breakdown toggle → account detail → manual balance update → total moves
 *
 * This is the one test that proves the pieces are actually wired to each other: that the redirect
 * out of an empty household lands in setup, that the type-picker tiles and owner chips submit what
 * the Server Actions expect, that the breakdown toggle re-renders without navigating, and that a
 * balance written through the drawer shows up in the hero figure.
 *
 * The server-side half of the same journey is covered by
 * `src/lib/household/flow.integration.test.ts`, which runs in CI without needing a browser. The
 * two are complementary: that one asserts rows and totals, this one asserts that a person clicking
 * through the UI can actually reach them.
 */

const DATABASE_URL = process.env.E2E_DATABASE_URL!;
const PASSPHRASE = process.env.E2E_PASSPHRASE ?? 'e2e-test-passphrase';

/**
 * Truncate between tests so each starts from no household — which is the precondition for the
 * guided-setup redirect being observable at all. The config refuses to run unless
 * E2E_DATABASE_URL is set and differs from DATABASE_URL.
 */
test.beforeEach(async () => {
  const pool = new Pool({ connectionString: DATABASE_URL, max: 1 });
  try {
    await pool.query(
      'TRUNCATE TABLE balance_snapshot, holding, debt_terms, account, pension_contribution, person, household RESTART IDENTITY CASCADE;',
    );
  } finally {
    await pool.end();
  }
});

async function logIn(page: import('@playwright/test').Page) {
  await page.goto('/');
  // Unauthenticated: middleware sends every route to the gate.
  await expect(page.getByLabel(/passphrase/i)).toBeVisible();
  await page.getByLabel(/passphrase/i).fill(PASSPHRASE);
  await page.getByRole('button', { name: /unlock|sign in|continue/i }).click();
}

test('first login with no household leads to guided setup, not an empty dashboard', async ({ page }) => {
  await logIn(page);

  await expect(page).toHaveURL(/\/setup/);
  await expect(page.getByRole('heading', { name: /let’s set up your household/i })).toBeVisible();
});

test('guided setup builds a household and the dashboard shows real figures', async ({ page }) => {
  await logIn(page);
  await expect(page).toHaveURL(/\/setup/);

  // Step 1 — the household.
  await page.getByLabel('Household name').fill('The Elm Grove household');
  await page.getByRole('button', { name: 'Continue' }).click();

  // Step 2 — people. Date of birth is required, so this also proves the field is wired.
  await expect(page.getByRole('heading', { name: /who’s in the household/i })).toBeVisible();
  await page.getByLabel('Name').fill('Alex');
  await page.getByLabel('Date of birth').fill('1985-04-12');
  await page.getByRole('button', { name: 'Add person' }).click();
  await expect(page.getByText('Alex')).toBeVisible();

  await page.getByLabel('Name').fill('Jordan');
  await page.getByLabel('Date of birth').fill('1987-09-30');
  await page.getByRole('button', { name: /add (another )?person/i }).click();
  await expect(page.getByText('Jordan')).toBeVisible();

  await page.getByRole('link', { name: /next: add an account/i }).click();

  // Step 3 — a first account, owned by one person.
  await expect(page.getByRole('heading', { name: /add your first account/i })).toBeVisible();
  await page.getByRole('button', { name: 'S&S ISA' }).click();
  await page.getByLabel('Account name').fill('Vanguard S&S ISA');
  await page.getByRole('checkbox', { name: 'Alex' }).check();
  await page.getByLabel('Current balance').fill('54110');
  await page.getByRole('button', { name: 'Add account' }).click();

  // The running list the design spec asks for.
  await expect(page.getByText('Vanguard S&S ISA')).toBeVisible();
  await expect(page.getByText('£54,110')).toBeVisible();

  // A joint account: selecting both people is what makes it joint.
  await page.getByRole('button', { name: 'Cash' }).click();
  await page.getByLabel('Account name').fill('Joint current account');
  await page.getByRole('checkbox', { name: 'Alex' }).check();
  await page.getByRole('checkbox', { name: 'Jordan' }).check();
  await expect(page.getByText(/recorded as a joint account/i)).toBeVisible();
  await page.getByLabel('Current balance').fill('6180');
  await page.getByRole('button', { name: /add another account/i }).click();
  await expect(page.getByText('Joint current account')).toBeVisible();

  // A mortgage, entered as a positive amount outstanding.
  await page.getByRole('button', { name: 'Debt' }).click();
  await page.getByLabel('Account name').fill('Mortgage — 14 Elm Grove');
  await page.getByRole('checkbox', { name: 'Alex' }).check();
  await page.getByRole('checkbox', { name: 'Jordan' }).check();
  await page.getByLabel('Amount outstanding').fill('36500');
  await page.getByLabel('Interest rate').fill('4.25');
  await page.getByRole('button', { name: /add another account/i }).click();

  await page.getByRole('button', { name: /finish setup/i }).click();

  // Exit point: the dashboard, with real data.
  await expect(page).toHaveURL(/\/(\?.*)?$/);
  await expect(page.getByRole('heading', { name: 'Net worth' })).toBeVisible();

  // 54,110 + 6,180 − 36,500
  await expect(page.getByText('£23,790')).toBeVisible();

  // Grouped by owner, with a Joint group for the accounts nobody individually owns.
  await expect(page.getByRole('heading', { name: 'Alex' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Joint' })).toBeVisible();

  // The mortgage shows as negative, once, under Joint.
  await expect(page.getByText('−£36,500')).toBeVisible();
});

test('the breakdown toggle re-renders in place', async ({ page }) => {
  await logIn(page);
  await seedThroughSetup(page);

  await expect(page.getByRole('tab', { name: 'By person' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('tabpanel').getByText('Alex')).toBeVisible();

  const url = page.url();
  await page.getByRole('tab', { name: 'By asset class' }).click();

  await expect(page.getByRole('tabpanel').getByText('Cash')).toBeVisible();
  // No navigation: the whole point of the spec's "re-renders in place, no reload".
  expect(page.url()).toBe(url);

  await page.getByRole('tab', { name: 'By tax wrapper' }).click();
  await expect(page.getByRole('tabpanel').getByText('ISA')).toBeVisible();

  // Operable from the keyboard, per the accessibility requirements.
  await page.getByRole('tab', { name: 'By tax wrapper' }).focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('tab', { name: 'By person' })).toHaveAttribute('aria-selected', 'true');
});

test('a manual balance update moves the household total', async ({ page }) => {
  await logIn(page);
  await seedThroughSetup(page);

  await page.getByRole('link', { name: 'Accounts' }).first().click();
  await expect(page.getByRole('heading', { name: 'Accounts' })).toBeVisible();

  await page.getByRole('link', { name: /Vanguard S&S ISA/ }).click();
  await expect(page.getByRole('heading', { name: 'Vanguard S&S ISA' })).toBeVisible();

  await page.getByRole('button', { name: 'Update balance' }).click();
  const drawer = page.getByRole('dialog', { name: /update balance/i });
  await expect(drawer).toBeVisible();
  // Focus lands on the amount field so the drawer is usable without reaching for a mouse.
  await expect(page.getByLabel('New balance')).toBeFocused();

  await page.getByLabel('New balance').fill('60000');
  await page.getByRole('button', { name: 'Save balance' }).click();
  await expect(drawer).not.toBeVisible();

  await expect(page.getByText('£60,000').first()).toBeVisible();

  // And the dashboard total has moved with it: 60,000 + 6,180 − 36,500.
  await page.getByRole('link', { name: 'Net Worth' }).first().click();
  await expect(page.getByText('£29,680')).toBeVisible();
});

test('archiving takes an account out of the totals but keeps it recoverable', async ({ page }) => {
  await logIn(page);
  await seedThroughSetup(page);

  await page.goto('/accounts');
  await page.getByRole('link', { name: /Joint current account/ }).click();
  await page.getByRole('button', { name: 'Archive' }).click();

  await expect(page.getByText('Archived')).toBeVisible();

  await page.goto('/');
  // 54,110 − 36,500, with the £6,180 current account excluded.
  await expect(page.getByText('£17,610')).toBeVisible();

  // Still there, filterable back in — never deleted.
  await page.goto('/accounts');
  await page.getByRole('link', { name: /show 1 archived account/i }).click();
  await expect(page.getByRole('heading', { name: 'Archived' })).toBeVisible();
  await expect(page.getByRole('link', { name: /Joint current account/ })).toBeVisible();
});

test('a non-debt account refuses a negative balance', async ({ page }) => {
  await logIn(page);
  await seedThroughSetup(page);

  await page.goto('/accounts/new');
  await page.getByRole('button', { name: 'Cash' }).click();
  await page.getByLabel('Current balance').fill('-100');
  await page.getByLabel('Account name').click();

  await expect(page.getByText('Balance can’t be negative for this account type')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Add account' })).toBeDisabled();
});

/**
 * Drive guided setup to a known three-account household, for the tests whose subject is what
 * happens afterwards. Deliberately goes through the UI rather than inserting rows directly, so
 * these tests can't pass against a schema the forms can't actually populate.
 */
async function seedThroughSetup(page: import('@playwright/test').Page) {
  await expect(page).toHaveURL(/\/setup/);

  await page.getByLabel('Household name').fill('The Elm Grove household');
  await page.getByRole('button', { name: 'Continue' }).click();

  await page.getByLabel('Name').fill('Alex');
  await page.getByLabel('Date of birth').fill('1985-04-12');
  await page.getByRole('button', { name: 'Add person' }).click();
  await expect(page.getByText('Alex')).toBeVisible();

  await page.getByLabel('Name').fill('Jordan');
  await page.getByLabel('Date of birth').fill('1987-09-30');
  await page.getByRole('button', { name: /add (another )?person/i }).click();
  await expect(page.getByText('Jordan')).toBeVisible();

  await page.getByRole('link', { name: /next: add an account/i }).click();

  await page.getByRole('button', { name: 'S&S ISA' }).click();
  await page.getByLabel('Account name').fill('Vanguard S&S ISA');
  await page.getByRole('checkbox', { name: 'Alex' }).check();
  await page.getByLabel('Current balance').fill('54110');
  await page.getByRole('button', { name: 'Add account' }).click();
  await expect(page.getByText('Vanguard S&S ISA')).toBeVisible();

  await page.getByRole('button', { name: 'Cash' }).click();
  await page.getByLabel('Account name').fill('Joint current account');
  await page.getByRole('checkbox', { name: 'Alex' }).check();
  await page.getByRole('checkbox', { name: 'Jordan' }).check();
  await page.getByLabel('Current balance').fill('6180');
  await page.getByRole('button', { name: /add another account/i }).click();
  await expect(page.getByText('Joint current account')).toBeVisible();

  await page.getByRole('button', { name: 'Debt' }).click();
  await page.getByLabel('Account name').fill('Mortgage — 14 Elm Grove');
  await page.getByRole('checkbox', { name: 'Alex' }).check();
  await page.getByRole('checkbox', { name: 'Jordan' }).check();
  await page.getByLabel('Amount outstanding').fill('36500');
  await page.getByRole('button', { name: /add another account/i }).click();

  await page.getByRole('button', { name: /finish setup/i }).click();
  await expect(page.getByRole('heading', { name: 'Net worth' })).toBeVisible();
}
