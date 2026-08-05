'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { and, desc, eq, ne, sql } from 'drizzle-orm';
import { getDb } from '@/lib/db/client';
import {
  accounts,
  balanceSnapshots,
  debtTerms,
  holdings,
  households,
  people,
  pensionContributions,
  regularContributions,
  type AccountTypeValue,
} from '@/lib/db/schema';
import { getSetupState } from '@/lib/household/queries';
import { isLiabilityType, taxWrapperForType } from '@/lib/accounts/types';
import {
  validateAccountCreate,
  validateAccountEdit,
  validateBalanceUpdate,
  validateEmergencyFundTarget,
  validateHolding,
  validateHouseholdName,
  validatePensionContribution,
  validatePerson,
  validateRegularContribution,
  type FieldErrors,
} from '@/lib/accounts/validation';
import { numericToPence, penceToNumeric } from '@/lib/money';

/**
 * Every Phase 1 mutation.
 *
 * These are Server Actions, which Next.js 14 restricts to POST and guards with a built-in
 * Origin/Host check — the app's CSRF defence for form submissions, exactly as Phase 0's
 * login action documents. `src/lib/auth/csrf.ts`'s `sameOriginGuard` stays unused: it is
 * for *route handlers*, which Server Action protection doesn't extend to, and Phase 1 adds
 * none. Phase 3's simulation-run endpoints are the first that will need it.
 *
 * Shape conventions:
 *  - Actions take `FormData` and return a serialisable `ActionResult`, so forms can render
 *    inline field errors and keep everything the user typed on failure — DESIGN_SPEC.md is
 *    explicit that a failed save must never clear the form. Client forms call these through
 *    `src/lib/ui/useActionForm.ts`; see that file for why not `useFormState`.
 *  - Validation is delegated wholly to src/lib/accounts/validation.ts. Nothing here decides
 *    what a valid balance is; this file decides what rows to write.
 *  - Anything that writes more than one table does so in a transaction, because a debt
 *    account with no opening balance, or a balance with no account, is not a state the
 *    household should ever be able to reach by closing a laptop lid mid-request.
 */

export type ActionResult =
  | { ok: true }
  | { ok: false; errors: FieldErrors; formError?: string }
  // Returned when validation passed but the write failed — the banner case.
  | { ok: false; errors: Record<string, never>; formError: string };

/** DESIGN_SPEC.md's generic load/save failure copy. */
const GENERIC_SAVE_ERROR = 'Couldn’t save this right now';

function fieldValues(formData: FormData): Record<string, unknown> {
  const values: Record<string, unknown> = {};
  for (const key of new Set(formData.keys())) {
    const all = formData.getAll(key);
    values[key] = all.length > 1 ? all.map(String) : String(all[0] ?? '');
  }
  // Owner chips submit repeated `ownerIds` entries; a single selection must still be an
  // array or the validator would see a bare string and count its characters.
  values.ownerIds = formData.getAll('ownerIds').map(String);
  return values;
}

/**
 * Resolve the household for a mutation.
 *
 * Throws rather than redirecting: a mutation arriving with no household is a bug or a
 * replayed request, not a user who needs guiding, and a thrown error surfaces it instead
 * of bouncing them into setup with their data dropped.
 */
async function requireHouseholdId(): Promise<number> {
  const state = await getSetupState();
  if (state.householdId === null) {
    throw new Error('No household exists yet. Complete guided setup first.');
  }
  return state.householdId;
}

function logAndWrap(scope: string, error: unknown): ActionResult {
  // Logged server-side with detail, surfaced to the user without it: the design spec asks
  // for plain copy and no technical error text, but a silent failure would be undiagnosable.
  console.error(`[household] ${scope} failed:`, error);
  return { ok: false, errors: {}, formError: GENERIC_SAVE_ERROR };
}

/* ---------------------------------------------------------------------------------
 * Guided setup
 * ------------------------------------------------------------------------------- */

/**
 * Step 1: create the household.
 *
 * Refuses to create a second one. There is exactly one household in this app's model, and
 * a double-submitted setup form is the obvious way to end up with two — after which every
 * `getSetupState()` would silently pick the lower id and the accounts attached to the other
 * would vanish from the dashboard.
 */
export async function createHousehold(formData: FormData): Promise<ActionResult> {
  const parsed = validateHouseholdName(fieldValues(formData));
  if (!parsed.ok) return parsed;

  try {
    const existing = await getSetupState();
    if (existing.householdId !== null) {
      return { ok: true }; // Already done; the page will move the user on.
    }
    await getDb().insert(households).values({ name: parsed.value.name });
  } catch (error) {
    // Two concurrent first-time-setup submissions can both pass the check above; the
    // `household_singleton` unique index lets only one insert land. The loser hitting that
    // constraint isn't a failure from the user's point of view — the household now exists,
    // just not from this request — so it's treated the same as the already-done check.
    // node-postgres surfaces this as a DatabaseError with SQLSTATE 23505 (unique_violation)
    // and the offending index name on `.constraint`.
    const pgError = error as { code?: string; constraint?: string };
    if (pgError.code === '23505' && pgError.constraint === 'household_singleton') {
      return { ok: true };
    }
    return logAndWrap('createHousehold', error);
  }

  revalidatePath('/setup');
  return { ok: true };
}

export async function addPerson(formData: FormData): Promise<ActionResult> {
  const parsed = validatePerson(fieldValues(formData));
  if (!parsed.ok) return parsed;

  try {
    const householdId = await requireHouseholdId();
    await getDb()
      .insert(people)
      .values({
        householdId,
        name: parsed.value.name,
        dateOfBirth: parsed.value.dateOfBirth,
        annualGrossIncome: parsed.value.annualGrossIncome,
        hasFlexiblyAccessedPension: parsed.value.hasFlexiblyAccessedPension,
      });
  } catch (error) {
    return logAndWrap('addPerson', error);
  }

  revalidatePath('/setup');
  revalidatePath('/settings');
  revalidatePath('/');
  return { ok: true };
}

export async function updatePerson(formData: FormData): Promise<ActionResult> {
  const personId = Number.parseInt(String(formData.get('personId') ?? ''), 10);
  if (!Number.isInteger(personId)) {
    return { ok: false, errors: {}, formError: GENERIC_SAVE_ERROR };
  }

  const parsed = validatePerson(fieldValues(formData));
  if (!parsed.ok) return parsed;

  try {
    const householdId = await requireHouseholdId();
    await getDb()
      .update(people)
      .set({
        name: parsed.value.name,
        dateOfBirth: parsed.value.dateOfBirth,
        annualGrossIncome: parsed.value.annualGrossIncome,
        hasFlexiblyAccessedPension: parsed.value.hasFlexiblyAccessedPension,
        updatedAt: sql`now()`,
      })
      .where(and(eq(people.id, personId), eq(people.householdId, householdId)));
  } catch (error) {
    return logAndWrap('updatePerson', error);
  }

  revalidatePath('/settings');
  revalidatePath('/');
  return { ok: true };
}

/**
 * Set (or clear, on a blank submission) the household's emergency-fund target —
 * Phase 4.5's Cash Allocation Advisor, waterfall step 1. Household-level, not
 * per-person: an emergency fund is a shared buffer, the same framing `households`'
 * other fields already use.
 */
export async function updateEmergencyFundTarget(formData: FormData): Promise<ActionResult> {
  const parsed = validateEmergencyFundTarget(fieldValues(formData));
  if (!parsed.ok) return parsed;

  try {
    const householdId = await requireHouseholdId();
    await getDb()
      .update(households)
      .set({ emergencyFundTarget: parsed.value.emergencyFundTarget, updatedAt: sql`now()` })
      .where(eq(households.id, householdId));
  } catch (error) {
    return logAndWrap('updateEmergencyFundTarget', error);
  }

  revalidatePath('/settings');
  return { ok: true };
}

/**
 * Finish setup.
 *
 * Guarded rather than a bare redirect: the design spec's flow requires at least one person and
 * prompts for a first account, and letting "Finish" through with neither would land the user
 * on the dashboard's empty state — the exact outcome guided setup exists to prevent. A
 * double-submit, or a stale page whose data has since changed, is sent back to the step that
 * still needs doing instead of being shown an error it can't act on from here.
 *
 * Returns void, so it can be used directly as a `<form action>`: every path either redirects
 * or throws, and there is no result for a caller to render.
 */
export async function finishSetup(): Promise<void> {
  const state = await getSetupState();
  if (state.personCount === 0) redirect('/setup?step=people');
  if (state.accountCount === 0) redirect('/setup?step=accounts');
  redirect('/');
}

/* ---------------------------------------------------------------------------------
 * Pension contributions
 * ------------------------------------------------------------------------------- */

/**
 * Record a pension contribution.
 *
 * Nothing in Phase 1 reads these — the consumer is Phase 4.5's Cash Allocation Advisor,
 * which needs the method and the employer amount separately to derive a tax band and taper
 * position. Entry exists now because the schema is the expensive thing to get wrong later;
 * the UI around it is deliberately minimal (see /settings) rather than a workflow.
 */
export async function addPensionContribution(formData: FormData): Promise<ActionResult> {
  const personId = Number.parseInt(String(formData.get('personId') ?? ''), 10);
  if (!Number.isInteger(personId)) {
    return { ok: false, errors: {}, formError: GENERIC_SAVE_ERROR };
  }

  const parsed = validatePensionContribution(fieldValues(formData));
  if (!parsed.ok) return parsed;

  try {
    const householdId = await requireHouseholdId();
    const db = getDb();
    // Confirm the person belongs to this household before writing against their id.
    const [owner] = await db
      .select({ id: people.id })
      .from(people)
      .where(and(eq(people.id, personId), eq(people.householdId, householdId)))
      .limit(1);
    if (!owner) return { ok: false, errors: {}, formError: GENERIC_SAVE_ERROR };

    await db.insert(pensionContributions).values({
      personId,
      amount: parsed.value.amount,
      method: parsed.value.method,
      employerAmount: parsed.value.employerAmount,
    });
  } catch (error) {
    return logAndWrap('addPensionContribution', error);
  }

  revalidatePath('/settings');
  return { ok: true };
}

export async function deletePensionContribution(formData: FormData): Promise<ActionResult> {
  const contributionId = Number.parseInt(String(formData.get('contributionId') ?? ''), 10);
  if (!Number.isInteger(contributionId)) {
    return { ok: false, errors: {}, formError: GENERIC_SAVE_ERROR };
  }

  try {
    // A planning assumption someone typed by mistake, not financial history — this is the
    // one delete in Phase 1, and it is safe precisely because nothing derives from it yet.
    const householdId = await requireHouseholdId();
    const db = getDb();
    // Scoped by household, joining through the owning person, matching every other
    // mutation in this file. With exactly one household ever, a forged id could only ever
    // reach a row this household already owns — but the scoping is what makes that true by
    // construction rather than by the current threat model, and it keeps the pattern
    // uniform for whichever future change relies on it.
    const [owned] = await db
      .select({ id: pensionContributions.id })
      .from(pensionContributions)
      .innerJoin(people, eq(pensionContributions.personId, people.id))
      .where(and(eq(pensionContributions.id, contributionId), eq(people.householdId, householdId)))
      .limit(1);
    if (!owned) return { ok: false, errors: {}, formError: GENERIC_SAVE_ERROR };

    await db.delete(pensionContributions).where(eq(pensionContributions.id, contributionId));
  } catch (error) {
    return logAndWrap('deletePensionContribution', error);
  }

  revalidatePath('/settings');
  return { ok: true };
}

/* ---------------------------------------------------------------------------------
 * Accounts
 * ------------------------------------------------------------------------------- */

/**
 * Create an account, its opening balance snapshot, and its debt terms if it's a liability —
 * all in one transaction.
 *
 * The opening balance is written as a `balance_snapshot` row rather than a column on the
 * account, because the append-only dated-snapshot model is what the proposal chose over
 * mutable balances (it "eliminates most of the conflict surface rather than just handling it
 * well"). So an account's very first balance is just its first snapshot, with no special
 * case anywhere downstream.
 */
export async function createAccount(formData: FormData): Promise<ActionResult> {
  const parsed = validateAccountCreate(fieldValues(formData));
  if (!parsed.ok) return parsed;
  const input = parsed.value;

  let newAccountId: number;
  try {
    const householdId = await requireHouseholdId();
    const db = getDb();

    newAccountId = await db.transaction(async (tx) => {
      const [created] = await tx
        .insert(accounts)
        .values({
          householdId,
          personId: input.personId,
          name: input.name,
          type: input.type,
          // Derived from the type, never taken from the form — see accounts/types.ts.
          taxWrapper: taxWrapperForType(input.type),
          isEmergencyFund: input.isEmergencyFund,
        })
        .returning({ id: accounts.id });

      const accountId = created!.id;

      await tx.insert(balanceSnapshots).values({
        accountId,
        amount: input.openingBalance,
        snapshotDate: input.asOfDate,
      });

      if (input.debtTerms) {
        await tx.insert(debtTerms).values({
          accountId,
          ...input.debtTerms,
          // Kept as a positive figure, mirroring how a lender states it, while the snapshot
          // above is negative. Written from the same input so the two cannot disagree.
          currentBalance: penceToNumeric(-numericToPence(input.openingBalance)),
        });
      }

      return accountId;
    });
  } catch (error) {
    return logAndWrap('createAccount', error);
  }

  revalidatePath('/');
  revalidatePath('/accounts');
  revalidatePath('/setup');
  revalidatePath(`/accounts/${newAccountId}`);
  return { ok: true };
}

/**
 * Update an account's static details.
 *
 * No balance here — that's the "Update balance" flow, which appends a snapshot. See the
 * note on `validateAccountEdit`.
 *
 * Changing the type **across the asset/liability boundary** (e.g. `cash` → `debt`, or
 * `debt` → anything else) is refused outright, rather than allowed with the old `debt_terms`
 * row left in place. Every stored `balance_snapshot` for the account was signed at write
 * time under the *old* type's convention — a liability negative, an asset positive — and
 * there is no snapshot column recording which convention applied. Silently relabelling the
 * type would leave the whole history signed under a convention its new type no longer
 * matches: net worth would double-count the balance in the new type's direction, and the
 * asset-class breakdown would show a liability as a positive slice or vice versa.
 * Re-creating the account (a fresh row, its own signed history from the point it's added) is
 * the correct fix for "I picked the wrong type," not an in-place edit.
 *
 * This is a deliberate narrowing of DESIGN_SPEC.md's edge case, which described the switch
 * as allowed with terms "hidden (not deleted, in case they switch back)". That wording
 * covers what happens to the *form fields*; it doesn't resolve what happens to the *signed
 * balance history*, and there's no correct answer to that within a single in-place edit — so
 * the edit is refused instead of shipping a switch that quietly corrupts net worth. A type
 * change that stays on the same side of the boundary (e.g. Cash ISA → GIA) is unaffected.
 */
export async function updateAccount(formData: FormData): Promise<ActionResult> {
  const accountId = Number.parseInt(String(formData.get('accountId') ?? ''), 10);
  if (!Number.isInteger(accountId)) {
    return { ok: false, errors: {}, formError: GENERIC_SAVE_ERROR };
  }

  const parsed = validateAccountEdit(fieldValues(formData));
  if (!parsed.ok) return parsed;
  const input = parsed.value;

  try {
    const householdId = await requireHouseholdId();
    const db = getDb();

    const [existing] = await db
      .select({ type: accounts.type })
      .from(accounts)
      .where(and(eq(accounts.id, accountId), eq(accounts.householdId, householdId)))
      .limit(1);
    if (!existing) return { ok: false, errors: {}, formError: GENERIC_SAVE_ERROR };

    if (isLiabilityType(existing.type) !== isLiabilityType(input.type)) {
      return {
        ok: false,
        errors: {},
        formError:
          'An account can’t change between debt and non-debt types — its balance history was recorded the other way. Archive this account and add a new one instead.',
      };
    }

    // Same reasoning as the asset/liability boundary above, for a narrower case:
    // addRegularContribution refuses debt/property/sipp_pension outright, but an edit
    // could previously retype an account *into* one of those after a contribution
    // already existed on it — resolveScenario.ts would then either silently drop the
    // contribution or, worse, merge it into an unrelated pension_contribution row on
    // the same wrapper key. Refused here instead, matching this function's own
    // "re-create the account instead" posture.
    if (REGULAR_CONTRIBUTION_INELIGIBLE_TYPES.has(input.type)) {
      const [hasContribution] = await db
        .select({ id: regularContributions.id })
        .from(regularContributions)
        .where(eq(regularContributions.accountId, accountId))
        .limit(1);
      if (hasContribution) {
        return {
          ok: false,
          errors: {},
          formError:
            'This account has a regular contribution recorded, which isn’t valid for that type. Remove the contribution first, or archive this account and add a new one instead.',
        };
      }
    }

    await db.transaction(async (tx) => {
      await tx
        .update(accounts)
        .set({
          name: input.name,
          type: input.type,
          taxWrapper: taxWrapperForType(input.type),
          personId: input.personId,
          isEmergencyFund: input.isEmergencyFund,
          updatedAt: sql`now()`,
        })
        .where(and(eq(accounts.id, accountId), eq(accounts.householdId, householdId)));

      if (input.debtTerms) {
        await tx
          .insert(debtTerms)
          .values({ accountId, ...input.debtTerms })
          .onConflictDoUpdate({
            target: debtTerms.accountId,
            set: { ...input.debtTerms, updatedAt: sql`now()` },
          });
      }
    });
  } catch (error) {
    return logAndWrap('updateAccount', error);
  }

  revalidatePath('/');
  revalidatePath('/accounts');
  revalidatePath(`/accounts/${accountId}`);
  return { ok: true };
}

/**
 * Archive or restore an account. There is no delete.
 *
 * DESIGN_SPEC.md: "an account that's closed (e.g. an old ISA transferred elsewhere)
 * shouldn't be hard-deleted, since its balance history is part of the household's net worth
 * trend. Decision: accounts get an 'Archived' state (excluded from current totals,
 * filterable back in), never a destructive delete from this screen."
 *
 * Archiving is therefore a flag flip, and reversible — which is also why the confirmation
 * copy isn't styled as destructive.
 */
export async function setAccountArchived(formData: FormData): Promise<ActionResult> {
  const accountId = Number.parseInt(String(formData.get('accountId') ?? ''), 10);
  const archived = String(formData.get('archived') ?? '') === 'true';
  if (!Number.isInteger(accountId)) {
    return { ok: false, errors: {}, formError: GENERIC_SAVE_ERROR };
  }

  try {
    const householdId = await requireHouseholdId();
    await getDb()
      .update(accounts)
      .set({ archived, updatedAt: sql`now()` })
      .where(and(eq(accounts.id, accountId), eq(accounts.householdId, householdId)));
  } catch (error) {
    return logAndWrap('setAccountArchived', error);
  }

  revalidatePath('/');
  revalidatePath('/accounts');
  revalidatePath(`/accounts/${accountId}`);
  return { ok: true };
}

/* ---------------------------------------------------------------------------------
 * Balances
 * ------------------------------------------------------------------------------- */

/**
 * Manual balance update — the one write the household will do routinely.
 *
 * Phase 1 does this as a plain server round trip. The optimistic-UI, IndexedDB write-queue
 * and idempotency-key machinery described in the proposal's Mobile/tablet access section is
 * **Phase 6**, and building it now would mean building offline infrastructure before there
 * is a service worker to flush it.
 *
 * What is here now, and is not premature, is the **upsert on `(account_id, snapshot_date)`**.
 * That constraint already exists (the proposal asks for it), the app has to do something
 * sane when a balance is entered twice for the same date, and "the later entry wins" is the
 * correct answer for a corrected typo. It also happens to be exactly the idempotent write
 * Phase 6's retry-after-ambiguous-failure case will need, so the durable half of that design
 * lands in the schema and the write path without any of the client machinery.
 */

/** Anything with `.select()`/`.insert()` — satisfied by both `getDb()` and a `db.transaction`
 * callback's `tx`, so this can run either standalone or as part of a larger transaction. */
type Queryable = Pick<ReturnType<typeof getDb>, 'select' | 'insert'>;

/**
 * Keep a debt account's `debt_terms.current_balance` mirrored to whichever snapshot is
 * *actually* its latest, by re-reading the snapshot series rather than trusting the
 * caller's own write to be the latest one.
 *
 * `updateBalance`'s original inline version of this assumed the write it had just made
 * was always the latest — true only because the date input is capped at `max={today}`, so
 * a plain "Update balance" call can never be backdated past an existing later entry...
 * except it already could be backdated *before* one, which this assumption silently got
 * wrong (a debt balance backfilled to an earlier date would clobber `current_balance` with
 * the older figure). That gap gets wider once `updateBalanceSnapshot`/`deleteBalanceSnapshot`
 * can touch an arbitrary historical row, so this is now a real re-read rather than an
 * inline assumption. No-ops for a non-liability account type. `null` (not left stale) once
 * no snapshots remain at all.
 */
async function syncDebtCurrentBalance(
  db: Queryable,
  accountId: number,
  accountType: AccountTypeValue,
): Promise<void> {
  if (!isLiabilityType(accountType)) return;

  const [latest] = await db
    .select({ amount: balanceSnapshots.amount })
    .from(balanceSnapshots)
    .where(eq(balanceSnapshots.accountId, accountId))
    .orderBy(desc(balanceSnapshots.snapshotDate), desc(balanceSnapshots.capturedAt))
    .limit(1);

  const currentBalance = latest ? penceToNumeric(-numericToPence(latest.amount)) : null;

  // Upsert, not a plain update — see updateBalance's original note: a debt account can
  // legitimately have no debt_terms row yet (createAccount only inserts one when terms
  // were provided at creation).
  await db
    .insert(debtTerms)
    .values({ accountId, currentBalance })
    .onConflictDoUpdate({
      target: debtTerms.accountId,
      set: { currentBalance, updatedAt: sql`now()` },
    });
}

export async function updateBalance(formData: FormData): Promise<ActionResult> {
  const accountId = Number.parseInt(String(formData.get('accountId') ?? ''), 10);
  if (!Number.isInteger(accountId)) {
    return { ok: false, errors: {}, formError: GENERIC_SAVE_ERROR };
  }

  try {
    const householdId = await requireHouseholdId();
    const db = getDb();

    const [account] = await db
      .select({ id: accounts.id, type: accounts.type })
      .from(accounts)
      .where(and(eq(accounts.id, accountId), eq(accounts.householdId, householdId)))
      .limit(1);
    if (!account) return { ok: false, errors: {}, formError: GENERIC_SAVE_ERROR };

    // Validation needs the type: whether a negative balance is legitimate, and whether the
    // entered figure is an "amount outstanding" to be negated, both depend on it.
    const parsed = validateBalanceUpdate(fieldValues(formData), account.type);
    if (!parsed.ok) return parsed;

    await db.transaction(async (tx) => {
      await tx
        .insert(balanceSnapshots)
        .values({
          accountId,
          amount: parsed.value.amount,
          snapshotDate: parsed.value.snapshotDate,
        })
        .onConflictDoUpdate({
          target: [balanceSnapshots.accountId, balanceSnapshots.snapshotDate],
          set: { amount: parsed.value.amount, capturedAt: sql`now()` },
        });

      // Keep debt_terms.current_balance in step with the snapshot series, so Phase 4.5
      // can't read a stale figure. Positive there, negative in the snapshot.
      await syncDebtCurrentBalance(tx, accountId, account.type);
    });
  } catch (error) {
    return logAndWrap('updateBalance', error);
  }

  revalidatePath('/');
  revalidatePath('/accounts');
  revalidatePath(`/accounts/${accountId}`);
  return { ok: true };
}

/**
 * Edit an existing balance entry in place — both its amount and its date.
 *
 * `updateBalance` above already upserts on `(account_id, snapshot_date)`, so "resubmit
 * with the same date" was always technically an edit — but it isn't discoverable (you'd
 * have to already know the exact date to overwrite), and it can't retarget a snapshot to
 * a *different* date at all. This is the explicit version of that: a household member
 * browsing a Balance history list can correct a specific entry directly, including
 * fixing a snapshot recorded against the wrong day.
 *
 * Retargeting onto a date some *other* snapshot already owns is refused with a field
 * error rather than silently colliding with `updateBalance`'s own upsert (which would
 * overwrite that other row) or hitting the raw unique-constraint violation.
 */
export async function updateBalanceSnapshot(formData: FormData): Promise<ActionResult> {
  const snapshotId = Number.parseInt(String(formData.get('snapshotId') ?? ''), 10);
  if (!Number.isInteger(snapshotId)) {
    return { ok: false, errors: {}, formError: GENERIC_SAVE_ERROR };
  }

  try {
    const householdId = await requireHouseholdId();
    const db = getDb();

    // Scoped by household, joining through the owning account — same pattern as
    // `updateHolding`/`deleteHolding`. Also resolves the real accountId/type from the
    // row itself rather than trusting the form's copy of either.
    const [owned] = await db
      .select({ accountId: balanceSnapshots.accountId, accountType: accounts.type })
      .from(balanceSnapshots)
      .innerJoin(accounts, eq(balanceSnapshots.accountId, accounts.id))
      .where(and(eq(balanceSnapshots.id, snapshotId), eq(accounts.householdId, householdId)))
      .limit(1);
    if (!owned) return { ok: false, errors: {}, formError: GENERIC_SAVE_ERROR };

    const parsed = validateBalanceUpdate(fieldValues(formData), owned.accountType);
    if (!parsed.ok) return parsed;

    const [conflict] = await db
      .select({ id: balanceSnapshots.id })
      .from(balanceSnapshots)
      .where(
        and(
          eq(balanceSnapshots.accountId, owned.accountId),
          eq(balanceSnapshots.snapshotDate, parsed.value.snapshotDate),
          ne(balanceSnapshots.id, snapshotId),
        ),
      )
      .limit(1);
    if (conflict) {
      return {
        ok: false,
        errors: { snapshotDate: 'A balance already exists for that date — edit that entry instead, or use a different date.' },
      };
    }

    await db.transaction(async (tx) => {
      await tx
        .update(balanceSnapshots)
        .set({
          amount: parsed.value.amount,
          snapshotDate: parsed.value.snapshotDate,
          capturedAt: sql`now()`,
        })
        .where(eq(balanceSnapshots.id, snapshotId));

      await syncDebtCurrentBalance(tx, owned.accountId, owned.accountType);
    });

    revalidatePath('/');
    revalidatePath('/accounts');
    revalidatePath(`/accounts/${owned.accountId}`);
  } catch (error) {
    return logAndWrap('updateBalanceSnapshot', error);
  }

  return { ok: true };
}

export async function deleteBalanceSnapshot(formData: FormData): Promise<ActionResult> {
  const snapshotId = Number.parseInt(String(formData.get('snapshotId') ?? ''), 10);
  if (!Number.isInteger(snapshotId)) {
    return { ok: false, errors: {}, formError: GENERIC_SAVE_ERROR };
  }

  try {
    const householdId = await requireHouseholdId();
    const db = getDb();

    const [owned] = await db
      .select({ accountId: balanceSnapshots.accountId, accountType: accounts.type })
      .from(balanceSnapshots)
      .innerJoin(accounts, eq(balanceSnapshots.accountId, accounts.id))
      .where(and(eq(balanceSnapshots.id, snapshotId), eq(accounts.householdId, householdId)))
      .limit(1);
    if (!owned) return { ok: false, errors: {}, formError: GENERIC_SAVE_ERROR };

    await db.transaction(async (tx) => {
      await tx.delete(balanceSnapshots).where(eq(balanceSnapshots.id, snapshotId));
      // Deleting an account's only snapshot is a supported state, not an edge case to
      // special-case here — src/lib/networth/breakdown.test.ts already asserts a
      // no-snapshot account contributes £0 to net worth rather than erroring.
      await syncDebtCurrentBalance(tx, owned.accountId, owned.accountType);
    });

    revalidatePath('/');
    revalidatePath('/accounts');
    revalidatePath(`/accounts/${owned.accountId}`);
  } catch (error) {
    return logAndWrap('deleteBalanceSnapshot', error);
  }

  return { ok: true };
}

/* ---------------------------------------------------------------------------------
 * Holdings
 * ------------------------------------------------------------------------------- */

/**
 * Add a holding. Manual and display-only in Phase 1 — no price, no valuation, because live
 * pricing is Phase 2 and depends on a provider whose GBX-vs-GBP behaviour is itself a
 * blocking verification task there.
 */
export async function addHolding(formData: FormData): Promise<ActionResult> {
  const accountId = Number.parseInt(String(formData.get('accountId') ?? ''), 10);
  if (!Number.isInteger(accountId)) {
    return { ok: false, errors: {}, formError: GENERIC_SAVE_ERROR };
  }

  const parsed = validateHolding(fieldValues(formData));
  if (!parsed.ok) return parsed;

  try {
    const householdId = await requireHouseholdId();
    const db = getDb();
    const [account] = await db
      .select({ id: accounts.id })
      .from(accounts)
      .where(and(eq(accounts.id, accountId), eq(accounts.householdId, householdId)))
      .limit(1);
    if (!account) return { ok: false, errors: {}, formError: GENERIC_SAVE_ERROR };

    await db.insert(holdings).values({
      accountId,
      ticker: parsed.value.ticker,
      quantity: parsed.value.quantity,
      costBasis: parsed.value.costBasis,
    });
  } catch (error) {
    return logAndWrap('addHolding', error);
  }

  revalidatePath(`/accounts/${accountId}`);
  return { ok: true };
}

/**
 * Edit a holding's ticker, quantity or cost basis in place.
 *
 * A holding is current composition, not history (same reasoning `deleteHolding` already
 * documents), so unlike a balance there's no append-only model to protect — a plain
 * `UPDATE` is the correct shape, not a new dated row.
 */
export async function updateHolding(formData: FormData): Promise<ActionResult> {
  const holdingId = Number.parseInt(String(formData.get('holdingId') ?? ''), 10);
  if (!Number.isInteger(holdingId)) {
    return { ok: false, errors: {}, formError: GENERIC_SAVE_ERROR };
  }

  const parsed = validateHolding(fieldValues(formData));
  if (!parsed.ok) return parsed;

  try {
    // Scoped by household, joining through the owning account — same pattern as
    // `deleteHolding`, and the real accountId is resolved from the row itself rather than
    // trusted from the form, so the revalidated path is always the one that actually changed.
    const householdId = await requireHouseholdId();
    const db = getDb();
    const [owned] = await db
      .select({ accountId: holdings.accountId })
      .from(holdings)
      .innerJoin(accounts, eq(holdings.accountId, accounts.id))
      .where(and(eq(holdings.id, holdingId), eq(accounts.householdId, householdId)))
      .limit(1);
    if (!owned) return { ok: false, errors: {}, formError: GENERIC_SAVE_ERROR };

    await db
      .update(holdings)
      .set({
        ticker: parsed.value.ticker,
        quantity: parsed.value.quantity,
        costBasis: parsed.value.costBasis,
      })
      .where(eq(holdings.id, holdingId));

    revalidatePath(`/accounts/${owned.accountId}`);
  } catch (error) {
    return logAndWrap('updateHolding', error);
  }

  return { ok: true };
}

export async function deleteHolding(formData: FormData): Promise<ActionResult> {
  const holdingId = Number.parseInt(String(formData.get('holdingId') ?? ''), 10);
  if (!Number.isInteger(holdingId)) {
    return { ok: false, errors: {}, formError: GENERIC_SAVE_ERROR };
  }

  let accountId: number;
  try {
    // A holding is current composition, not history: removing one you no longer hold is
    // the correct operation, unlike an account, whose history the trend chart still needs.
    //
    // Scoped by household, joining through the owning account, matching every other
    // mutation in this file — see the note on `deletePensionContribution`. This also
    // resolves the real `accountId` from the holding itself rather than trusting the
    // form's copy of it, so the revalidated path is always the one that actually changed.
    const householdId = await requireHouseholdId();
    const db = getDb();
    const [owned] = await db
      .select({ accountId: holdings.accountId })
      .from(holdings)
      .innerJoin(accounts, eq(holdings.accountId, accounts.id))
      .where(and(eq(holdings.id, holdingId), eq(accounts.householdId, householdId)))
      .limit(1);
    if (!owned) return { ok: false, errors: {}, formError: GENERIC_SAVE_ERROR };
    accountId = owned.accountId;

    await db.delete(holdings).where(eq(holdings.id, holdingId));
  } catch (error) {
    return logAndWrap('deleteHolding', error);
  }

  revalidatePath(`/accounts/${accountId}`);
  return { ok: true };
}

/* ---------------------------------------------------------------------------------
 * Regular contributions
 * ------------------------------------------------------------------------------- */

/** `debt`/`property` aren't drawdown wrappers at all; `sipp_pension` already has
 * `pension_contribution` — one mechanism per wrapper, not two competing ones. Checked
 * here (not a DB constraint), matching `addHolding`'s own posture toward its
 * account-type assumptions. */
const REGULAR_CONTRIBUTION_INELIGIBLE_TYPES: ReadonlySet<AccountTypeValue> = new Set([
  'debt',
  'property',
  'sipp_pension',
]);

export async function addRegularContribution(formData: FormData): Promise<ActionResult> {
  const accountId = Number.parseInt(String(formData.get('accountId') ?? ''), 10);
  if (!Number.isInteger(accountId)) {
    return { ok: false, errors: {}, formError: GENERIC_SAVE_ERROR };
  }

  const parsed = validateRegularContribution(fieldValues(formData));
  if (!parsed.ok) return parsed;

  try {
    const householdId = await requireHouseholdId();
    const db = getDb();
    const [account] = await db
      .select({ id: accounts.id, type: accounts.type })
      .from(accounts)
      .where(and(eq(accounts.id, accountId), eq(accounts.householdId, householdId)))
      .limit(1);
    if (!account || REGULAR_CONTRIBUTION_INELIGIBLE_TYPES.has(account.type)) {
      return { ok: false, errors: {}, formError: GENERIC_SAVE_ERROR };
    }

    await db.insert(regularContributions).values({
      accountId,
      ticker: parsed.value.ticker === '' ? null : parsed.value.ticker,
      amount: parsed.value.amount,
    });
  } catch (error) {
    return logAndWrap('addRegularContribution', error);
  }

  revalidatePath(`/accounts/${accountId}`);
  revalidatePath('/portfolio');
  return { ok: true };
}

export async function updateRegularContribution(formData: FormData): Promise<ActionResult> {
  const contributionId = Number.parseInt(String(formData.get('contributionId') ?? ''), 10);
  if (!Number.isInteger(contributionId)) {
    return { ok: false, errors: {}, formError: GENERIC_SAVE_ERROR };
  }

  const parsed = validateRegularContribution(fieldValues(formData));
  if (!parsed.ok) return parsed;

  try {
    // Scoped by household, joining through the owning account — same pattern as
    // updateHolding, and the real accountId is resolved from the row itself rather
    // than trusted from the form.
    const householdId = await requireHouseholdId();
    const db = getDb();
    const [owned] = await db
      .select({ accountId: regularContributions.accountId })
      .from(regularContributions)
      .innerJoin(accounts, eq(regularContributions.accountId, accounts.id))
      .where(and(eq(regularContributions.id, contributionId), eq(accounts.householdId, householdId)))
      .limit(1);
    if (!owned) return { ok: false, errors: {}, formError: GENERIC_SAVE_ERROR };

    await db
      .update(regularContributions)
      .set({
        ticker: parsed.value.ticker === '' ? null : parsed.value.ticker,
        amount: parsed.value.amount,
        updatedAt: new Date(),
      })
      .where(eq(regularContributions.id, contributionId));

    revalidatePath(`/accounts/${owned.accountId}`);
    revalidatePath('/portfolio');
  } catch (error) {
    return logAndWrap('updateRegularContribution', error);
  }

  return { ok: true };
}

export async function deleteRegularContribution(formData: FormData): Promise<ActionResult> {
  const contributionId = Number.parseInt(String(formData.get('contributionId') ?? ''), 10);
  if (!Number.isInteger(contributionId)) {
    return { ok: false, errors: {}, formError: GENERIC_SAVE_ERROR };
  }

  let accountId: number;
  try {
    const householdId = await requireHouseholdId();
    const db = getDb();
    const [owned] = await db
      .select({ accountId: regularContributions.accountId })
      .from(regularContributions)
      .innerJoin(accounts, eq(regularContributions.accountId, accounts.id))
      .where(and(eq(regularContributions.id, contributionId), eq(accounts.householdId, householdId)))
      .limit(1);
    if (!owned) return { ok: false, errors: {}, formError: GENERIC_SAVE_ERROR };
    accountId = owned.accountId;

    await db.delete(regularContributions).where(eq(regularContributions.id, contributionId));
  } catch (error) {
    return logAndWrap('deleteRegularContribution', error);
  }

  revalidatePath(`/accounts/${accountId}`);
  revalidatePath('/portfolio');
  return { ok: true };
}
