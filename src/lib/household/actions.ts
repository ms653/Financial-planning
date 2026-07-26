'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { and, eq, sql } from 'drizzle-orm';
import { getDb } from '@/lib/db/client';
import {
  accounts,
  balanceSnapshots,
  debtTerms,
  holdings,
  households,
  people,
  pensionContributions,
} from '@/lib/db/schema';
import { getSetupState } from '@/lib/household/queries';
import { isLiabilityType, taxWrapperForType } from '@/lib/accounts/types';
import {
  validateAccountCreate,
  validateAccountEdit,
  validateBalanceUpdate,
  validateHolding,
  validateHouseholdName,
  validatePensionContribution,
  validatePerson,
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
    await getDb().delete(pensionContributions).where(eq(pensionContributions.id, contributionId));
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
 * Changing the type away from `debt` leaves any existing `debt_terms` row in place rather
 * than deleting it. DESIGN_SPEC.md's edge case asks for a confirmation that those fields
 * "will be hidden (not deleted, in case they switch back)", so the row is retained and
 * simply stops being rendered. It is also what keeps a mistaken type change from destroying
 * mortgage terms someone typed off their paperwork.
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

    await db.transaction(async (tx) => {
      await tx
        .update(accounts)
        .set({
          name: input.name,
          type: input.type,
          taxWrapper: taxWrapperForType(input.type),
          personId: input.personId,
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
      if (isLiabilityType(account.type)) {
        await tx
          .update(debtTerms)
          .set({
            currentBalance: penceToNumeric(-numericToPence(parsed.value.amount)),
            updatedAt: sql`now()`,
          })
          .where(eq(debtTerms.accountId, accountId));
      }
    });
  } catch (error) {
    return logAndWrap('updateBalance', error);
  }

  revalidatePath('/');
  revalidatePath('/accounts');
  revalidatePath(`/accounts/${accountId}`);
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

export async function deleteHolding(formData: FormData): Promise<ActionResult> {
  const holdingId = Number.parseInt(String(formData.get('holdingId') ?? ''), 10);
  const accountId = Number.parseInt(String(formData.get('accountId') ?? ''), 10);
  if (!Number.isInteger(holdingId)) {
    return { ok: false, errors: {}, formError: GENERIC_SAVE_ERROR };
  }

  try {
    // A holding is current composition, not history: removing one you no longer hold is
    // the correct operation, unlike an account, whose history the trend chart still needs.
    await getDb().delete(holdings).where(eq(holdings.id, holdingId));
  } catch (error) {
    return logAndWrap('deleteHolding', error);
  }

  if (Number.isInteger(accountId)) revalidatePath(`/accounts/${accountId}`);
  return { ok: true };
}
