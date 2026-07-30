import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';

// The actions call revalidatePath, which needs a Next request scope that doesn't exist
// in a plain test — same convention as household/flow.integration.test.ts.
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

import { Pool } from 'pg';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import * as schema from '@/lib/db/schema';
import { households, people, retirementScenarios, simulationRuns } from '@/lib/db/schema';
import {
  createScenario,
  deleteScenario,
  duplicateScenario,
  updateScenario,
} from '@/lib/retirement/actions';
import { getScenario, getScenarioWithLatestRun, getScenarios } from '@/lib/retirement/queries';

/**
 * Exercises the real exported Server Actions and read queries directly against a real
 * Postgres — following `household/flow.integration.test.ts`'s convention of driving the
 * actual functions a form/page would call, not re-implementing their logic in the test.
 */

const connectionString = process.env.TEST_DATABASE_URL;

describe.skipIf(!connectionString)('retirement scenario CRUD against a real Postgres', () => {
  let pool: Pool;
  let db: NodePgDatabase<typeof schema>;
  let personId: number;

  beforeAll(async () => {
    pool = new Pool({ connectionString, max: 4 });
    db = drizzle(pool, { schema });
    await pool.query('DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;');
    await pool.query('DROP SCHEMA IF EXISTS drizzle CASCADE;');
    await migrate(db, { migrationsFolder: './drizzle' });
    process.env.DATABASE_URL = connectionString;
  }, 60_000);

  afterAll(async () => {
    await pool?.end();
  });

  beforeEach(async () => {
    await pool.query(
      'TRUNCATE TABLE simulation_run, retirement_scenario, person, household RESTART IDENTITY CASCADE;',
    );
    const [household] = await db.insert(households).values({ name: 'Test household' }).returning();
    const [person] = await db
      .insert(people)
      .values({ householdId: household!.id, name: 'Alex', dateOfBirth: '1985-06-15' })
      .returning();
    personId = person!.id;
  });

  function assumptionsJson(overrides: Partial<Record<string, unknown>> = {}): string {
    return JSON.stringify({
      schemaVersion: 1,
      annualSpending: '30000.00',
      inflationPct: '2.500',
      equityAllocationPct: '60.000',
      targetSuccessRatePct: '90.000',
      flatEffectiveTaxRatePct: '20.000',
      wrapperWithdrawalOrder: ['gia'],
      people: [{ personId, retirementAge: 65, planEndAge: 90 }],
      ...overrides,
    });
  }

  function form(fields: Record<string, string>): FormData {
    const formData = new FormData();
    for (const [key, value] of Object.entries(fields)) formData.set(key, value);
    return formData;
  }

  describe('createScenario', () => {
    it('creates a scenario with valid assumptions', async () => {
      const result = await createScenario(form({ name: 'Baseline', assumptions: assumptionsJson() }));
      expect(result.ok).toBe(true);

      const [household] = await db.select().from(households);
      const list = await getScenarios(household!.id);
      expect(list).toHaveLength(1);
      expect(list[0]!.name).toBe('Baseline');
      expect(list[0]!.isBaseline).toBe(false);
    });

    it('rejects a missing name', async () => {
      const result = await createScenario(form({ name: '', assumptions: assumptionsJson() }));
      expect(result.ok).toBe(false);
    });

    it('rejects malformed assumptions JSON', async () => {
      const result = await createScenario(form({ name: 'Baseline', assumptions: '{not json' }));
      expect(result.ok).toBe(false);
    });

    it('rejects assumptions parseScenarioAssumptions itself would reject', async () => {
      const result = await createScenario(
        form({ name: 'Baseline', assumptions: assumptionsJson({ inflationPct: 'not-a-percent' }) }),
      );
      expect(result.ok).toBe(false);
    });

    it('rejects a personId that does not belong to this household', async () => {
      const result = await createScenario(
        form({
          name: 'Baseline',
          assumptions: assumptionsJson({ people: [{ personId: 424_242, retirementAge: 65, planEndAge: 90 }] }),
        }),
      );
      expect(result.ok).toBe(false);
    });

    it('unsets any other baseline scenario when creating a new baseline', async () => {
      const first = await createScenario(
        form({ name: 'First', isBaseline: 'true', assumptions: assumptionsJson() }),
      );
      expect(first.ok).toBe(true);

      const second = await createScenario(
        form({ name: 'Second', isBaseline: 'true', assumptions: assumptionsJson() }),
      );
      expect(second.ok).toBe(true);

      const [household] = await db.select().from(households);
      const list = await getScenarios(household!.id);
      const baselines = list.filter((s) => s.isBaseline);
      expect(baselines).toHaveLength(1);
      expect(baselines[0]!.name).toBe('Second');
    });

    // Regression test for a real bug independent Fable review found and reproduced
    // 3/3 runs against a real Postgres: two concurrent baseline-setting writers could
    // both commit successfully under READ COMMITTED, since a blocked UPDATE's WHERE
    // clause only re-evaluates the row it conflicted on, never a fresh scan for a row
    // the other transaction inserted after its own scan began. Fixed with a database
    // backstop (schema.ts's retirement_scenario_one_baseline_per_household partial
    // unique index) — the invariant this test actually checks is "at most one baseline
    // survives," not "exactly one of the two calls must fail": whether a real race
    // materialises depends on scheduling this test can't force deterministically
    // through the exported action alone (Promise.all doesn't guarantee two Node
    // requests' underlying Postgres transactions genuinely overlap), but the database
    // constraint holds regardless of timing, which the next test proves directly and
    // deterministically without depending on any race actually occurring.
    it('never leaves more than one baseline scenario, however two concurrent baseline-setting creates interleave', async () => {
      const [a, b] = await Promise.all([
        createScenario(form({ name: 'A', isBaseline: 'true', assumptions: assumptionsJson() })),
        createScenario(form({ name: 'B', isBaseline: 'true', assumptions: assumptionsJson() })),
      ]);

      // Whichever one lost a genuine race gets a clear, actionable conflict message,
      // not the generic save-failure banner — checked only for whichever result (if
      // either) actually failed, since real overlap isn't guaranteed by Promise.all.
      for (const result of [a, b]) {
        if (!result.ok) expect(result.formError).toMatch(/Reload and try again/);
      }

      const [household] = await db.select().from(households);
      const list = await getScenarios(household!.id);
      expect(list.filter((s) => s.isBaseline)).toHaveLength(1);
    });

    it('the database itself rejects a second baseline row for a household, deterministically — the actual fix, independent of any race timing', async () => {
      const [household] = await db.select().from(households);
      // No household seeded yet at this point in the file's beforeEach (only the
      // top-level one from `people`'s own beforeEach) — reuse it directly.
      await db.insert(retirementScenarios).values({
        householdId: household!.id,
        name: 'A',
        isBaseline: true,
        assumptions: JSON.parse(assumptionsJson()),
      });

      await expect(
        db.insert(retirementScenarios).values({
          householdId: household!.id,
          name: 'B',
          isBaseline: true,
          assumptions: JSON.parse(assumptionsJson()),
        }),
      ).rejects.toMatchObject({
        code: '23505',
        constraint: 'retirement_scenario_one_baseline_per_household',
      });
    });
  });

  describe('updateScenario', () => {
    it('updates name, isBaseline, and assumptions', async () => {
      await createScenario(form({ name: 'Original', assumptions: assumptionsJson() }));
      const [household] = await db.select().from(households);
      const [scenario] = await getScenarios(household!.id);

      const result = await updateScenario(
        form({
          scenarioId: String(scenario!.id),
          name: 'Renamed',
          isBaseline: 'true',
          assumptions: assumptionsJson({ annualSpending: '35000.00' }),
        }),
      );
      expect(result.ok).toBe(true);

      const detail = await getScenario(scenario!.id, household!.id);
      expect(detail!.name).toBe('Renamed');
      expect(detail!.isBaseline).toBe(true);
      expect((detail!.assumptions as { annualSpending: string }).annualSpending).toBe('35000.00');
    });

    it('unsets another scenario\'s baseline flag when this one becomes the baseline', async () => {
      await createScenario(form({ name: 'A', isBaseline: 'true', assumptions: assumptionsJson() }));
      await createScenario(form({ name: 'B', assumptions: assumptionsJson() }));
      const [household] = await db.select().from(households);
      const [a, b] = await getScenarios(household!.id);
      const bRow = [a, b].find((s) => s!.name === 'B')!;

      await updateScenario(
        form({ scenarioId: String(bRow.id), name: 'B', isBaseline: 'true', assumptions: assumptionsJson() }),
      );

      const list = await getScenarios(household!.id);
      const baselines = list.filter((s) => s.isBaseline);
      expect(baselines).toHaveLength(1);
      expect(baselines[0]!.name).toBe('B');
    });

    it('fails for a scenario id that does not exist', async () => {
      const result = await updateScenario(
        form({ scenarioId: '999999', name: 'X', assumptions: assumptionsJson() }),
      );
      expect(result.ok).toBe(false);
    });
  });

  describe('duplicateScenario', () => {
    it('copies assumptions into a new row, always starting non-baseline', async () => {
      await createScenario(form({ name: 'Source', isBaseline: 'true', assumptions: assumptionsJson() }));
      const [household] = await db.select().from(households);
      const [source] = await getScenarios(household!.id);

      const result = await duplicateScenario(
        form({ scenarioId: String(source!.id), name: 'Retire at 60' }),
      );
      expect(result.ok).toBe(true);

      const list = await getScenarios(household!.id);
      expect(list).toHaveLength(2);
      const copy = list.find((s) => s.name === 'Retire at 60')!;
      expect(copy.isBaseline).toBe(false);

      const copyDetail = await getScenario(copy.id, household!.id);
      const sourceDetail = await getScenario(source!.id, household!.id);
      expect(copyDetail!.assumptions).toEqual(sourceDetail!.assumptions);
    });

    // Regression test for a real gap independent Fable review found: createScenario and
    // updateScenario both re-check personId household-membership on every write, but the
    // first version of duplicateScenario never did — a dangling personId (e.g. the
    // referenced person deleted since the source scenario was last saved) would have
    // propagated silently into the new row instead of being rejected at the boundary.
    it('rejects duplicating a scenario whose referenced person no longer exists in the household', async () => {
      await createScenario(form({ name: 'Source', assumptions: assumptionsJson() }));
      const [household] = await db.select().from(households);
      const [source] = await getScenarios(household!.id);

      // No deletePerson action exists in this codebase yet — remove directly to
      // simulate the dangling-reference state a future one would create.
      await db.delete(people).where(eq(people.id, personId));

      const result = await duplicateScenario(form({ scenarioId: String(source!.id), name: 'Copy' }));
      expect(result.ok).toBe(false);

      const list = await getScenarios(household!.id);
      expect(list).toHaveLength(1); // no copy was created
    });

    // Regression test for a second gap the same review found: duplicateScenario's
    // re-validation failure fell through to the generic save-failure message instead of
    // the specific parseScenarioAssumptions error createScenario/updateScenario surface.
    it('surfaces the specific parse error when the source\'s stored assumptions are no longer valid', async () => {
      const [household] = await db.select().from(households);
      // Bypasses the action layer deliberately, to simulate a row that was valid under
      // an earlier version of parseScenarioAssumptions's rules and has since become
      // invalid — not reachable through createScenario/updateScenario today, which
      // both validate on every write.
      const [source] = await db
        .insert(retirementScenarios)
        .values({
          householdId: household!.id,
          name: 'Stale',
          assumptions: { ...JSON.parse(assumptionsJson()), annualSpending: 'not-a-decimal' },
        })
        .returning();

      const result = await duplicateScenario(form({ scenarioId: String(source!.id), name: 'Copy' }));
      expect(result.ok).toBe(false);
      expect((result as { formError: string }).formError).toMatch(/annualSpending/);
    });

    it('fails for a source scenario id that does not exist', async () => {
      const result = await duplicateScenario(form({ scenarioId: '999999', name: 'Copy' }));
      expect(result.ok).toBe(false);
    });
  });

  describe('deleteScenario', () => {
    it('deletes the scenario and cascades to its simulation runs', async () => {
      await createScenario(form({ name: 'Baseline', assumptions: assumptionsJson() }));
      const [household] = await db.select().from(households);
      const [scenario] = await getScenarios(household!.id);

      await db
        .insert(simulationRuns)
        .values({ retirementScenarioId: scenario!.id, seed: 1, iterationCount: 200 });

      const result = await deleteScenario(form({ scenarioId: String(scenario!.id) }));
      expect(result.ok).toBe(true);

      expect(await getScenario(scenario!.id, household!.id)).toBeNull();
      const [run] = await db.select().from(simulationRuns).where(eq(simulationRuns.retirementScenarioId, scenario!.id));
      expect(run).toBeUndefined();
    });

    it('fails for a scenario id that does not exist', async () => {
      const result = await deleteScenario(form({ scenarioId: '999999' }));
      expect(result.ok).toBe(false);
    });
  });

  describe('getScenarioWithLatestRun', () => {
    it('returns null latestRun for a never-run scenario, and the most recent run once one exists', async () => {
      await createScenario(form({ name: 'Baseline', assumptions: assumptionsJson() }));
      const [household] = await db.select().from(households);
      const [scenario] = await getScenarios(household!.id);

      const beforeRun = await getScenarioWithLatestRun(scenario!.id, household!.id);
      expect(beforeRun!.latestRun).toBeNull();

      await db.insert(simulationRuns).values({
        retirementScenarioId: scenario!.id,
        seed: 1,
        iterationCount: 200,
        status: 'complete',
      });

      const afterRun = await getScenarioWithLatestRun(scenario!.id, household!.id);
      expect(afterRun!.latestRun).not.toBeNull();
      expect(afterRun!.latestRun!.status).toBe('complete');
    });
  });
});
