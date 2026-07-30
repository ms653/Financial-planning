'use server';

import { revalidatePath } from 'next/cache';
import { and, eq, inArray, ne, sql } from 'drizzle-orm';
import { getDb } from '@/lib/db/client';
import { people, retirementScenarios } from '@/lib/db/schema';
import { getSetupState } from '@/lib/household/queries';
import type { ActionResult } from '@/lib/household/actions';
import {
  parseScenarioAssumptions,
  ScenarioAssumptionsParseError,
  type ScenarioAssumptionsV1,
} from '@/lib/retirement/scenarioAssumptions';

/**
 * CRUD for `retirement_scenario` rows, mirroring `src/lib/household/actions.ts`'s exact
 * shape (`ActionResult` reused directly from there, not redefined, so M9's
 * `useActionForm` — currently hardcoded to that type — works with these unmodified).
 *
 * No UI exists yet (M9), so there is no real form to attach per-field errors to. Rather
 * than invent a `FieldErrors`-keyed validator ahead of a form that doesn't exist,
 * `createScenario`/`updateScenario` take the whole assumptions blob as one JSON-encoded
 * `assumptions` field and validate it through `parseScenarioAssumptions` — already the
 * single source of truth for `ScenarioAssumptionsV1`'s shape — surfacing any problem as
 * one `formError`. `name`/`isBaseline` stay ordinary scalar fields.
 */

const GENERIC_SAVE_ERROR = 'Couldn’t save this right now';

function fail(formError: string = GENERIC_SAVE_ERROR): ActionResult {
  return { ok: false, errors: {}, formError };
}

async function requireHouseholdId(): Promise<number> {
  const state = await getSetupState();
  if (state.householdId === null) {
    throw new Error('No household exists yet. Complete guided setup first.');
  }
  return state.householdId;
}

function logAndWrap(scope: string, error: unknown): ActionResult {
  console.error(`[retirement] ${scope} failed:`, error);
  return fail();
}

type ParsedAssumptions =
  | { ok: true; value: ScenarioAssumptionsV1 }
  | { ok: false; result: ActionResult };

function parseAssumptionsField(formData: FormData): ParsedAssumptions {
  const raw = formData.get('assumptions');
  if (typeof raw !== 'string' || raw === '') {
    return { ok: false, result: fail('Missing assumptions.') };
  }

  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return { ok: false, result: fail('Assumptions must be valid JSON.') };
  }

  try {
    return { ok: true, value: parseScenarioAssumptions(json) };
  } catch (error) {
    const message = error instanceof ScenarioAssumptionsParseError ? error.message : GENERIC_SAVE_ERROR;
    return { ok: false, result: fail(message) };
  }
}

/**
 * Confirms every `personId` the assumptions reference actually belongs to this
 * household — fail at the write boundary, not later when `resolveScenario` discovers a
 * dangling reference at run time.
 */
async function allPersonIdsBelongToHousehold(
  householdId: number,
  personIds: readonly number[],
): Promise<boolean> {
  if (personIds.length === 0) return true;
  const db = getDb();
  const rows = await db
    .select({ id: people.id })
    .from(people)
    .where(and(eq(people.householdId, householdId), inArray(people.id, [...personIds])));
  const found = new Set(rows.map((row) => row.id));
  return personIds.every((id) => found.has(id));
}

type Updatable = Pick<ReturnType<typeof getDb>, 'update'>;

/** Postgres surfaces the `retirement_scenario_one_baseline_per_household` partial
 * unique index (`schema.ts`) as SQLSTATE 23505 on the losing writer of two concurrent
 * baseline-setting calls — same shape `createHousehold` already checks for
 * `household_singleton`. */
function isBaselineConflict(error: unknown): boolean {
  const pgError = error as { code?: string; constraint?: string };
  return pgError.code === '23505' && pgError.constraint === 'retirement_scenario_one_baseline_per_household';
}

const BASELINE_CONFLICT_MESSAGE =
  'Another scenario just became the baseline. Reload and try again.';

/**
 * Best-effort application-level step: unsets whichever baseline row(s) this
 * transaction's own snapshot can see, so the common case (no concurrent writer) never
 * needs to touch the database twice. **This is not the actual invariant enforcement** —
 * Postgres's default READ COMMITTED isolation means a blocked `UPDATE` here only
 * re-evaluates the specific row it conflicted on, never a fresh scan for a row a
 * concurrent transaction inserted or changed after this one's own scan began, so two
 * concurrent callers can each fail to see the other's soon-to-be-true row. Verified
 * empirically by independent Fable review of Milestone 8 (reproduced 3/3 runs against a
 * real Postgres) before the real backstop — the partial unique index this file's own
 * `isBaselineConflict` catches — was added. Kept as the first line of defence anyway:
 * cheap, correct in the overwhelmingly common non-concurrent case, and the index is
 * what actually guarantees the invariant regardless of what this function sees.
 */
async function unsetOtherBaselines(
  db: Updatable,
  householdId: number,
  exceptScenarioId: number | null,
): Promise<void> {
  const condition =
    exceptScenarioId === null
      ? and(eq(retirementScenarios.householdId, householdId), eq(retirementScenarios.isBaseline, true))
      : and(
          eq(retirementScenarios.householdId, householdId),
          eq(retirementScenarios.isBaseline, true),
          ne(retirementScenarios.id, exceptScenarioId),
        );
  await db.update(retirementScenarios).set({ isBaseline: false }).where(condition);
}

export async function createScenario(formData: FormData): Promise<ActionResult> {
  const name = String(formData.get('name') ?? '').trim();
  if (name === '') return fail('Enter a name for this scenario.');
  const isBaseline = String(formData.get('isBaseline') ?? '') === 'true';

  const parsed = parseAssumptionsField(formData);
  if (!parsed.ok) return parsed.result;
  const assumptions = parsed.value;

  let newScenarioId: number;
  try {
    const householdId = await requireHouseholdId();
    const personIds = assumptions.people.map((person) => person.personId);
    if (!(await allPersonIdsBelongToHousehold(householdId, personIds))) {
      return fail('One of these people no longer exists in this household.');
    }

    const db = getDb();
    newScenarioId = await db.transaction(async (tx) => {
      if (isBaseline) await unsetOtherBaselines(tx, householdId, null);
      const [created] = await tx
        .insert(retirementScenarios)
        .values({ householdId, name, isBaseline, assumptions })
        .returning({ id: retirementScenarios.id });
      return created!.id;
    });
  } catch (error) {
    if (isBaselineConflict(error)) return fail(BASELINE_CONFLICT_MESSAGE);
    return logAndWrap('createScenario', error);
  }

  revalidatePath('/retirement');
  revalidatePath(`/retirement/${newScenarioId}`);
  return { ok: true };
}

export async function updateScenario(formData: FormData): Promise<ActionResult> {
  const scenarioId = Number.parseInt(String(formData.get('scenarioId') ?? ''), 10);
  if (!Number.isInteger(scenarioId)) return fail();

  const name = String(formData.get('name') ?? '').trim();
  if (name === '') return fail('Enter a name for this scenario.');
  const isBaseline = String(formData.get('isBaseline') ?? '') === 'true';

  const parsed = parseAssumptionsField(formData);
  if (!parsed.ok) return parsed.result;
  const assumptions = parsed.value;

  try {
    const householdId = await requireHouseholdId();
    const db = getDb();

    const [existing] = await db
      .select({ id: retirementScenarios.id })
      .from(retirementScenarios)
      .where(and(eq(retirementScenarios.id, scenarioId), eq(retirementScenarios.householdId, householdId)))
      .limit(1);
    if (!existing) return fail();

    const personIds = assumptions.people.map((person) => person.personId);
    if (!(await allPersonIdsBelongToHousehold(householdId, personIds))) {
      return fail('One of these people no longer exists in this household.');
    }

    await db.transaction(async (tx) => {
      if (isBaseline) await unsetOtherBaselines(tx, householdId, scenarioId);
      await tx
        .update(retirementScenarios)
        .set({ name, isBaseline, assumptions, updatedAt: sql`now()` })
        .where(and(eq(retirementScenarios.id, scenarioId), eq(retirementScenarios.householdId, householdId)));
    });
  } catch (error) {
    if (isBaselineConflict(error)) return fail(BASELINE_CONFLICT_MESSAGE);
    return logAndWrap('updateScenario', error);
  }

  revalidatePath('/retirement');
  revalidatePath(`/retirement/${scenarioId}`);
  return { ok: true };
}

/**
 * Copies a scenario's assumptions into a new row — the literal mechanism for "retire at
 * 60 vs. 65": duplicate, then separately `updateScenario` the copy's retirement age, and
 * run both independently. Deliberately just a copy: fusing "duplicate" and "override one
 * field" into a single action would need to know in advance which field a comparison
 * wants to vary, which isn't this action's job to guess.
 *
 * The copy always starts `isBaseline: false`, regardless of the source — duplicating is
 * for a comparison variant, never for silently creating a second baseline.
 */
export async function duplicateScenario(formData: FormData): Promise<ActionResult> {
  const sourceScenarioId = Number.parseInt(String(formData.get('scenarioId') ?? ''), 10);
  if (!Number.isInteger(sourceScenarioId)) return fail();

  const name = String(formData.get('name') ?? '').trim();
  if (name === '') return fail('Enter a name for the new scenario.');

  let newScenarioId: number;
  try {
    const householdId = await requireHouseholdId();
    const db = getDb();

    const [source] = await db
      .select({ assumptions: retirementScenarios.assumptions })
      .from(retirementScenarios)
      .where(and(eq(retirementScenarios.id, sourceScenarioId), eq(retirementScenarios.householdId, householdId)))
      .limit(1);
    if (!source) return fail();

    // Re-validated, not blindly copied: the source row was valid when it was written,
    // but parseScenarioAssumptions stays the single source of truth for what's safe to
    // persist under a new row. The specific parse error is surfaced (matching
    // parseAssumptionsField's own createScenario/updateScenario behaviour), not
    // swallowed into the generic save-failure message.
    let assumptions: ScenarioAssumptionsV1;
    try {
      assumptions = parseScenarioAssumptions(source.assumptions);
    } catch (error) {
      const message = error instanceof ScenarioAssumptionsParseError ? error.message : GENERIC_SAVE_ERROR;
      return fail(message);
    }

    // Re-checked here too, not just at the source's own creation time: createScenario/
    // updateScenario re-validate on every write, and duplicateScenario is a write of a
    // new row, so it holds to the same standard rather than implicitly trusting a check
    // that ran whenever the source scenario happened to be last saved.
    const personIds = assumptions.people.map((person) => person.personId);
    if (!(await allPersonIdsBelongToHousehold(householdId, personIds))) {
      return fail('One of these people no longer exists in this household.');
    }

    newScenarioId = await db.transaction(async (tx) => {
      const [created] = await tx
        .insert(retirementScenarios)
        .values({ householdId, name, isBaseline: false, assumptions })
        .returning({ id: retirementScenarios.id });
      return created!.id;
    });
  } catch (error) {
    return logAndWrap('duplicateScenario', error);
  }

  revalidatePath('/retirement');
  revalidatePath(`/retirement/${newScenarioId}`);
  return { ok: true };
}

/**
 * `simulation_run` is `ON DELETE CASCADE` to its scenario (M1's own design: "a run has
 * no meaning without the scenario it simulated") — deleting a scenario deletes its run
 * history too. Not special-cased here; the consequence belongs in whatever confirmation
 * copy M9's UI shows before calling this, not in the action itself.
 */
export async function deleteScenario(formData: FormData): Promise<ActionResult> {
  const scenarioId = Number.parseInt(String(formData.get('scenarioId') ?? ''), 10);
  if (!Number.isInteger(scenarioId)) return fail();

  try {
    const householdId = await requireHouseholdId();
    const db = getDb();

    const [owned] = await db
      .select({ id: retirementScenarios.id })
      .from(retirementScenarios)
      .where(and(eq(retirementScenarios.id, scenarioId), eq(retirementScenarios.householdId, householdId)))
      .limit(1);
    if (!owned) return fail();

    await db.delete(retirementScenarios).where(eq(retirementScenarios.id, scenarioId));
  } catch (error) {
    return logAndWrap('deleteScenario', error);
  }

  revalidatePath('/retirement');
  return { ok: true };
}
