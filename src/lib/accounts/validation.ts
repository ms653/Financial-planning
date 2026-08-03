import { accountType, overpaymentAllowanceBasis, pensionContributionMethod } from '@/lib/db/schema';
import type {
  AccountTypeValue,
  OverpaymentAllowanceBasisValue,
  PensionContributionMethodValue,
} from '@/lib/db/schema';
import { isLiabilityType } from '@/lib/accounts/types';
import { parseMoneyInput, penceToNumeric } from '@/lib/money';

/**
 * Validation for every Phase 1 write.
 *
 * All of it is pure: input is a plain record of strings (what `FormData` gives a Server
 * Action), output is either parsed, database-ready values or a map of field-keyed
 * messages. Nothing here touches the database or `cookies()`, which is what makes the
 * rules testable directly — and these rules are worth testing directly, because they are
 * the only thing standing between a mistyped figure and the household's net worth.
 *
 * Two conventions:
 *  - Error messages are **the exact copy from DESIGN_SPEC.md** where that document
 *    specifies it (e.g. "Balance can't be negative for this account type"). Where it
 *    doesn't, messages follow the same voice: what's wrong, in plain words, no field
 *    names or type names leaking through.
 *  - Errors are keyed by form field name so the same object drives both the inline
 *    on-blur message under a field and the error banner at the top of the form, per the
 *    Add/Edit Account states.
 */

export type FieldErrors = Record<string, string>;

export type Validated<T> = { ok: true; value: T } | { ok: false; errors: FieldErrors };

const MAX_NAME_LENGTH = 120;

/* ---------------------------------------------------------------------------------
 * Shared field parsers
 * ------------------------------------------------------------------------------- */

function cleanString(raw: unknown): string {
  return typeof raw === 'string' ? raw.trim() : '';
}

/**
 * An ISO `YYYY-MM-DD` date, validated as a real calendar date.
 *
 * `new Date('2025-02-30')` rolls over to 2 March rather than failing, so the parsed date
 * is re-serialised and compared: a rolled-over date won't match what was typed. This
 * matters more than it looks — a snapshot silently landing on the wrong day would break
 * the `(account_id, snapshot_date)` uniqueness that Phase 6's write idempotency relies on.
 */
export function parseIsoDate(raw: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;
  const parsed = new Date(`${raw}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return null;
  if (parsed.toISOString().slice(0, 10) !== raw) return null;
  return parsed;
}

/** Today in ISO form, in UTC. Used for "as of" defaults and future-date checks. */
export function todayIso(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

/**
 * A percentage, as NUMERIC(6,3): interest rates, overpayment allowances, ERC rates.
 *
 * Capped at 100 because every one of these fields is a rate a lender quotes, and a
 * three-digit entry is a decimal-point error (`4.5` typed as `450`) far more often than a
 * real 450% rate. Rejecting it surfaces the typo; accepting it would feed Phase 4.5's
 * advisor a number that produces confidently wrong advice.
 */
function parsePercentField(raw: string): { ok: true; value: string } | { ok: false; reason: string } {
  const cleaned = raw.replace(/%/g, '').trim();
  if (!/^\d+(\.\d{1,3})?$/.test(cleaned)) {
    return { ok: false, reason: 'Enter a rate like 4.25.' };
  }
  const asNumber = Number(cleaned);
  if (asNumber > 100) return { ok: false, reason: 'Enter a rate between 0 and 100.' };
  return { ok: true, value: cleaned };
}

/* ---------------------------------------------------------------------------------
 * Person
 * ------------------------------------------------------------------------------- */

export interface PersonInput {
  name: string;
  dateOfBirth: string;
  /** NUMERIC string, or null when not entered — an editable planning assumption. */
  annualGrossIncome: string | null;
}

export function validatePerson(
  raw: Record<string, unknown>,
  now: Date = new Date(),
): Validated<PersonInput> {
  const errors: FieldErrors = {};

  const name = cleanString(raw.name);
  if (name === '') errors.name = 'Enter a name.';
  else if (name.length > MAX_NAME_LENGTH) errors.name = 'That name is too long.';

  const dobRaw = cleanString(raw.dateOfBirth);
  let dateOfBirth = '';
  if (dobRaw === '') {
    // Required, per the proposal: State Pension age, LISA age gates and the 2027 Cash
    // ISA cap all derive from it, so a person without one is unusable to later phases.
    errors.dateOfBirth = 'Enter a date of birth — it sets State Pension age and ISA age limits.';
  } else {
    const parsed = parseIsoDate(dobRaw);
    if (!parsed) {
      errors.dateOfBirth = 'Enter a date like 1985-04-12.';
    } else if (parsed.toISOString().slice(0, 10) > todayIso(now)) {
      errors.dateOfBirth = 'A date of birth can’t be in the future.';
    } else if (now.getUTCFullYear() - parsed.getUTCFullYear() > 120) {
      errors.dateOfBirth = 'Check that date — it’s more than 120 years ago.';
    } else {
      dateOfBirth = dobRaw;
    }
  }

  let annualGrossIncome: string | null = null;
  const incomeRaw = cleanString(raw.annualGrossIncome);
  if (incomeRaw !== '') {
    const parsed = parseMoneyInput(incomeRaw);
    if (!parsed.ok) {
      errors.annualGrossIncome = 'Enter an amount like 52000.';
    } else if (parsed.pence < 0n) {
      errors.annualGrossIncome = 'Income can’t be negative.';
    } else {
      annualGrossIncome = penceToNumeric(parsed.pence);
    }
  }

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return { ok: true, value: { name, dateOfBirth, annualGrossIncome } };
}

/* ---------------------------------------------------------------------------------
 * Pension contribution
 * ------------------------------------------------------------------------------- */

export interface PensionContributionInput {
  amount: string;
  method: PensionContributionMethodValue;
  employerAmount: string;
}

function isPensionMethod(value: string): value is PensionContributionMethodValue {
  return (pensionContributionMethod.enumValues as readonly string[]).includes(value);
}

export const PENSION_METHOD_LABELS: Record<PensionContributionMethodValue, string> = {
  relief_at_source: 'Relief at source',
  net_pay: 'Net pay',
  salary_sacrifice: 'Salary sacrifice',
};

/**
 * Method is required with no default. The three methods are treated differently by
 * adjusted net income and by threshold/adjusted income, so guessing one would produce a
 * confidently wrong tax band in Phase 4.5 — worse than having no contribution recorded.
 */
export function validatePensionContribution(
  raw: Record<string, unknown>,
): Validated<PensionContributionInput> {
  const errors: FieldErrors = {};

  const amountRaw = cleanString(raw.amount);
  let amount = '';
  if (amountRaw === '') {
    errors.amount = 'Enter a yearly contribution amount.';
  } else {
    const parsed = parseMoneyInput(amountRaw);
    if (!parsed.ok) errors.amount = 'Enter an amount like 4800.';
    else if (parsed.pence < 0n) errors.amount = 'A contribution can’t be negative.';
    else amount = penceToNumeric(parsed.pence);
  }

  const methodRaw = cleanString(raw.method);
  let method: PensionContributionMethodValue | '' = '';
  if (methodRaw === '') errors.method = 'Choose how this contribution is made.';
  else if (!isPensionMethod(methodRaw)) errors.method = 'Choose how this contribution is made.';
  else method = methodRaw;

  // Required input, not optional: an explicit 0 is a different statement from a blank.
  const employerRaw = cleanString(raw.employerAmount);
  let employerAmount = '';
  if (employerRaw === '') {
    errors.employerAmount = 'Enter the employer’s yearly contribution, or 0 if there isn’t one.';
  } else {
    const parsed = parseMoneyInput(employerRaw);
    if (!parsed.ok) errors.employerAmount = 'Enter an amount like 3200, or 0.';
    else if (parsed.pence < 0n) errors.employerAmount = 'A contribution can’t be negative.';
    else employerAmount = penceToNumeric(parsed.pence);
  }

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return {
    ok: true,
    value: { amount, method: method as PensionContributionMethodValue, employerAmount },
  };
}

/* ---------------------------------------------------------------------------------
 * Account
 * ------------------------------------------------------------------------------- */

export interface DebtTermsInput {
  interestRate: string | null;
  minimumPayment: string | null;
  overpaymentAllowancePct: string | null;
  overpaymentAllowanceBalanceBasis: OverpaymentAllowanceBasisValue | null;
  ercRatePct: string | null;
  ercPeriodEnd: string | null;
}

export interface AccountInput {
  name: string;
  type: AccountTypeValue;
  /** Resolved ownership: a person id, or null meaning jointly owned by the household. */
  personId: number | null;
  /** Every person the user selected — >1 is what makes it joint. */
  ownerIds: number[];
  debtTerms: DebtTermsInput | null;
}

/** Create additionally captures an opening balance; edit doesn't. See below. */
export interface AccountCreateInput extends AccountInput {
  /** Signed NUMERIC string — negative for a liability. */
  openingBalance: string;
  asOfDate: string;
}

function isAccountType(value: string): value is AccountTypeValue {
  return (accountType.enumValues as readonly string[]).includes(value);
}

function isBasis(value: string): value is OverpaymentAllowanceBasisValue {
  return (overpaymentAllowanceBasis.enumValues as readonly string[]).includes(value);
}

export const OVERPAYMENT_BASIS_LABELS: Record<OverpaymentAllowanceBasisValue, string> = {
  original_balance: 'the original loan amount',
  current_balance: 'the balance outstanding',
  annual_opening_balance: 'the balance at the start of each year',
};

/**
 * Resolve the multi-select owner chips into a `person_id`.
 *
 * DESIGN_SPEC.md: "a multi-select chip control (not radio buttons) — selecting more than
 * one person marks it a joint account. Defaults to unselected (forces an explicit choice)
 * rather than defaulting to the first household member, to avoid silent misattribution."
 *
 * So: exactly one selected → that person owns it; two or more → NULL, meaning the
 * household owns it jointly (the nullable-`person_id` case the proposal calls a UK norm);
 * none → a validation error rather than a guess.
 *
 * Note what is deliberately *not* modelled: which specific people share a joint account.
 * The schema has one nullable owner column, so "joint between A and B" and "joint between
 * A, B and C" are the same row. In a single-household app where joint means "not one
 * person's", that distinction has no consumer — and inventing a join table for it now
 * would be building for Phase 4.7's reporting on a guess about what it needs.
 */
export function resolveOwnership(ownerIds: number[]): number | null {
  if (ownerIds.length === 1) return ownerIds[0] ?? null;
  return null;
}

function validateDebtTerms(raw: Record<string, unknown>, errors: FieldErrors): DebtTermsInput {
  const result: DebtTermsInput = {
    interestRate: null,
    minimumPayment: null,
    overpaymentAllowancePct: null,
    overpaymentAllowanceBalanceBasis: null,
    ercRatePct: null,
    ercPeriodEnd: null,
  };

  // Every debt field is optional. DESIGN_SPEC.md marks overpayment allowance and ERC as
  // "optional, add later" because they only pay off in Phase 4.5, and the same argument
  // covers rate and minimum payment: someone adding a mortgage to see their net worth
  // tonight shouldn't have to find the paperwork first.
  const interestRaw = cleanString(raw.interestRate);
  if (interestRaw !== '') {
    const parsed = parsePercentField(interestRaw);
    if (!parsed.ok) errors.interestRate = parsed.reason;
    else result.interestRate = parsed.value;
  }

  const minimumRaw = cleanString(raw.minimumPayment);
  if (minimumRaw !== '') {
    const parsed = parseMoneyInput(minimumRaw);
    if (!parsed.ok) errors.minimumPayment = 'Enter an amount like 1450.';
    else if (parsed.pence < 0n) errors.minimumPayment = 'A payment can’t be negative.';
    else result.minimumPayment = penceToNumeric(parsed.pence);
  }

  const allowanceRaw = cleanString(raw.overpaymentAllowancePct);
  if (allowanceRaw !== '') {
    const parsed = parsePercentField(allowanceRaw);
    if (!parsed.ok) errors.overpaymentAllowancePct = parsed.reason;
    else result.overpaymentAllowancePct = parsed.value;
  }

  const basisRaw = cleanString(raw.overpaymentAllowanceBalanceBasis);
  if (basisRaw !== '') {
    if (!isBasis(basisRaw)) errors.overpaymentAllowanceBalanceBasis = 'Choose what the allowance applies to.';
    else result.overpaymentAllowanceBalanceBasis = basisRaw;
  }

  // A percentage with no stated basis can't be turned into an amount, so Phase 4.5 would
  // have to guess which of three quite different bases the lender meant. Ask now.
  if (result.overpaymentAllowancePct !== null && result.overpaymentAllowanceBalanceBasis === null) {
    errors.overpaymentAllowanceBalanceBasis = 'Choose what that percentage applies to.';
  }

  const ercRaw = cleanString(raw.ercRatePct);
  if (ercRaw !== '') {
    const parsed = parsePercentField(ercRaw);
    if (!parsed.ok) errors.ercRatePct = parsed.reason;
    else result.ercRatePct = parsed.value;
  }

  const ercEndRaw = cleanString(raw.ercPeriodEnd);
  if (ercEndRaw !== '') {
    // Past dates are allowed and meaningful: an expired ERC period is exactly what
    // Phase 4.5 needs to know to advise overpaying freely.
    if (!parseIsoDate(ercEndRaw)) errors.ercPeriodEnd = 'Enter a date like 2028-06-30.';
    else result.ercPeriodEnd = ercEndRaw;
  }

  return result;
}

function validateAccountCore(
  raw: Record<string, unknown>,
  errors: FieldErrors,
): { name: string; type: AccountTypeValue | ''; ownerIds: number[] } {
  const name = cleanString(raw.name);
  if (name === '') errors.name = 'Give this account a name.';
  else if (name.length > MAX_NAME_LENGTH) errors.name = 'That name is too long.';

  const typeRaw = cleanString(raw.type);
  let type: AccountTypeValue | '' = '';
  if (typeRaw === '') errors.type = 'Choose an account type.';
  else if (!isAccountType(typeRaw)) errors.type = 'Choose an account type.';
  else type = typeRaw;

  const ownerIds = (Array.isArray(raw.ownerIds) ? raw.ownerIds : [])
    .map((value) => Number.parseInt(String(value), 10))
    .filter((value) => Number.isInteger(value) && value > 0);

  if (ownerIds.length === 0) errors.ownerIds = 'Choose who owns this account.';

  return { name, type, ownerIds };
}

/**
 * Validate a new account, including its opening balance.
 *
 * **Balance sign convention.** A liability is stored as a negative amount, so that net
 * worth is a plain sum over accounts and no query has to remember a per-type sign rule.
 * But the *form* asks for "amount outstanding" as a positive number, because that is how
 * a mortgage statement reads and how a user will type it — a household typing 376500 for
 * a mortgage and getting a £376,500 asset would be the single worst correctness bug
 * available in this screen. So a negative entry for a debt account is rejected rather
 * than passed through, and the sign is applied here.
 *
 * For every other type the rule is DESIGN_SPEC.md's, with its copy: balances can't be
 * negative.
 */
export function validateAccountCreate(
  raw: Record<string, unknown>,
  now: Date = new Date(),
): Validated<AccountCreateInput> {
  const errors: FieldErrors = {};
  const { name, type, ownerIds } = validateAccountCore(raw, errors);

  const isLiability = type !== '' && isLiabilityType(type);

  const balanceRaw = cleanString(raw.openingBalance);
  let openingBalance = '';
  if (balanceRaw === '') {
    errors.openingBalance = isLiability
      ? 'Enter how much is outstanding.'
      : 'Enter the current balance.';
  } else {
    const parsed = parseMoneyInput(balanceRaw);
    if (!parsed.ok) {
      errors.openingBalance = 'Enter an amount like 12500.';
    } else if (isLiability) {
      if (parsed.pence < 0n) {
        errors.openingBalance = 'Enter the amount outstanding as a positive number.';
      } else {
        openingBalance = penceToNumeric(-parsed.pence);
      }
    } else if (parsed.pence < 0n) {
      errors.openingBalance = 'Balance can’t be negative for this account type';
    } else {
      openingBalance = penceToNumeric(parsed.pence);
    }
  }

  const asOfRaw = cleanString(raw.asOfDate);
  let asOfDate = '';
  if (asOfRaw === '') {
    errors.asOfDate = 'Choose the date this balance is from.';
  } else if (!parseIsoDate(asOfRaw)) {
    errors.asOfDate = 'Enter a date like 2026-07-26.';
  } else if (asOfRaw > todayIso(now)) {
    // A balance "as of" a future date can't be an observation of anything.
    errors.asOfDate = 'That date is in the future.';
  } else {
    asOfDate = asOfRaw;
  }

  const debtTerms = isLiability ? validateDebtTerms(raw, errors) : null;

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return {
    ok: true,
    value: {
      name,
      type: type as AccountTypeValue,
      personId: resolveOwnership(ownerIds),
      ownerIds,
      debtTerms,
      openingBalance,
      asOfDate,
    },
  };
}

/**
 * Validate an edit.
 *
 * No balance or as-of date here, deliberately. DESIGN_SPEC.md scopes this screen to an
 * account's "**static** details (type, owner, wrapper-specific fields)", and balance
 * changes have their own dedicated flow ("Update balance" on Account Detail) which
 * appends a snapshot. Letting the edit form rewrite the opening balance would give two
 * different ways to change the same figure, one of which silently rewrites history rather
 * than appending to it — the exact thing the append-only snapshot model exists to avoid.
 */
export function validateAccountEdit(raw: Record<string, unknown>): Validated<AccountInput> {
  const errors: FieldErrors = {};
  const { name, type, ownerIds } = validateAccountCore(raw, errors);
  const debtTerms = type !== '' && isLiabilityType(type) ? validateDebtTerms(raw, errors) : null;

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return {
    ok: true,
    value: {
      name,
      type: type as AccountTypeValue,
      personId: resolveOwnership(ownerIds),
      ownerIds,
      debtTerms,
    },
  };
}

/* ---------------------------------------------------------------------------------
 * Balance update
 * ------------------------------------------------------------------------------- */

export interface BalanceUpdateInput {
  /** Signed NUMERIC string, ready for `balance_snapshot.amount`. */
  amount: string;
  snapshotDate: string;
}

/**
 * Validate a manual balance update.
 *
 * DESIGN_SPEC.md's Manual balance update flow: "System validates (numeric, non-negative
 * unless account type is `debt`)". Same sign convention as account creation — the user
 * types a positive amount outstanding for a debt, and it is stored negative.
 */
export function validateBalanceUpdate(
  raw: Record<string, unknown>,
  accountTypeValue: AccountTypeValue,
  now: Date = new Date(),
): Validated<BalanceUpdateInput> {
  const errors: FieldErrors = {};
  const isLiability = isLiabilityType(accountTypeValue);

  const amountRaw = cleanString(raw.amount);
  let amount = '';
  if (amountRaw === '') {
    errors.amount = isLiability ? 'Enter how much is outstanding.' : 'Enter a balance.';
  } else {
    const parsed = parseMoneyInput(amountRaw);
    if (!parsed.ok) {
      errors.amount = 'Enter an amount like 12500.';
    } else if (isLiability) {
      if (parsed.pence < 0n) {
        errors.amount = 'Enter the amount outstanding as a positive number.';
      } else {
        amount = penceToNumeric(-parsed.pence);
      }
    } else if (parsed.pence < 0n) {
      errors.amount = 'Balance can’t be negative for this account type';
    } else {
      amount = penceToNumeric(parsed.pence);
    }
  }

  const dateRaw = cleanString(raw.snapshotDate);
  let snapshotDate = '';
  if (dateRaw === '') {
    errors.snapshotDate = 'Choose the date this balance is from.';
  } else if (!parseIsoDate(dateRaw)) {
    errors.snapshotDate = 'Enter a date like 2026-07-26.';
  } else if (dateRaw > todayIso(now)) {
    errors.snapshotDate = 'That date is in the future.';
  } else {
    snapshotDate = dateRaw;
  }

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return { ok: true, value: { amount, snapshotDate } };
}

/* ---------------------------------------------------------------------------------
 * Holding
 * ------------------------------------------------------------------------------- */

export interface HoldingInput {
  ticker: string;
  quantity: string;
  costBasis: string;
}

/**
 * Validate a manually-entered holding. Phase 1 is display-only — there is no price to
 * validate against and no attempt to check the ticker exists, because that needs the
 * market-data provider that Phase 2 selects (and whose GBX/GBP behaviour is itself a
 * blocking verification task). Accepting a ticker the provider later rejects is a Phase 2
 * problem to surface, not a Phase 1 field to guess at.
 */
export function validateHolding(raw: Record<string, unknown>): Validated<HoldingInput> {
  const errors: FieldErrors = {};

  const ticker = cleanString(raw.ticker).toUpperCase();
  if (ticker === '') errors.ticker = 'Enter a ticker, like VWRL.';
  else if (!/^[A-Z0-9.\-:]{1,20}$/.test(ticker)) errors.ticker = 'Tickers are letters, digits, dots and dashes.';

  const quantityRaw = cleanString(raw.quantity);
  let quantity = '';
  if (quantityRaw === '') {
    errors.quantity = 'Enter how many units you hold.';
  } else if (!/^\d+(\.\d{1,6})?$/.test(quantityRaw)) {
    // Up to 6dp, matching NUMERIC(18,6) — fractional-share dealing is common.
    errors.quantity = 'Enter a quantity like 120 or 12.5.';
  } else if (Number(quantityRaw) === 0) {
    errors.quantity = 'A holding needs a quantity above zero.';
  } else {
    quantity = quantityRaw;
  }

  const costRaw = cleanString(raw.costBasis);
  let costBasis = '';
  if (costRaw === '') {
    errors.costBasis = 'Enter what you paid in total.';
  } else {
    const parsed = parseMoneyInput(costRaw);
    if (!parsed.ok) errors.costBasis = 'Enter an amount like 9400.';
    else if (parsed.pence < 0n) errors.costBasis = 'Cost can’t be negative.';
    else costBasis = penceToNumeric(parsed.pence);
  }

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return { ok: true, value: { ticker, quantity, costBasis } };
}

/* ---------------------------------------------------------------------------------
 * Regular contribution
 * ------------------------------------------------------------------------------- */

export interface RegularContributionInput {
  amount: string;
  /** `''` (blank) means a plain cash contribution — never stored as `''` itself, the
   * caller maps that to `null` for the nullable `ticker` column. */
  ticker: string;
}

/**
 * Ticker is optional here, unlike `validateHolding`'s required one: blank means "this
 * money just adds to the account's cash balance," which is the only sensible meaning
 * for a `cash`/`cash_isa` account (never has a `holding` row to attach a ticker to)
 * and a legitimate choice for an investment account too (uninvested cash sitting
 * there before the household decides what to buy).
 */
export function validateRegularContribution(raw: Record<string, unknown>): Validated<RegularContributionInput> {
  const errors: FieldErrors = {};

  const amountRaw = cleanString(raw.amount);
  let amount = '';
  if (amountRaw === '') {
    errors.amount = 'Enter a yearly contribution amount.';
  } else {
    const parsed = parseMoneyInput(amountRaw);
    if (!parsed.ok) errors.amount = 'Enter an amount like 2400.';
    else if (parsed.pence <= 0n) errors.amount = 'A contribution needs to be above zero.';
    else amount = penceToNumeric(parsed.pence);
  }

  const tickerRaw = cleanString(raw.ticker).toUpperCase();
  let ticker = '';
  if (tickerRaw !== '' && !/^[A-Z0-9.\-:]{1,20}$/.test(tickerRaw)) {
    errors.ticker = 'Tickers are letters, digits, dots and dashes — or leave blank for cash.';
  } else {
    ticker = tickerRaw;
  }

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return { ok: true, value: { amount, ticker } };
}

/* ---------------------------------------------------------------------------------
 * Household
 * ------------------------------------------------------------------------------- */

export function validateHouseholdName(raw: Record<string, unknown>): Validated<{ name: string }> {
  const name = cleanString(raw.name);
  if (name === '') return { ok: false, errors: { name: 'Give your household a name.' } };
  if (name.length > MAX_NAME_LENGTH) return { ok: false, errors: { name: 'That name is too long.' } };
  return { ok: true, value: { name } };
}
