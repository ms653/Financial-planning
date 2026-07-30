import { and, asc, desc, eq } from 'drizzle-orm';
import { getDb } from '@/lib/db/client';
import { retirementScenarios, simulationRuns } from '@/lib/db/schema';
import type { SimulationRun } from '@/lib/db/schema';

/**
 * Read queries for retirement scenarios, following `src/lib/household/queries.ts`'s
 * exact convention: plain functions taking an already-resolved `householdId`, `null`
 * for not-found-or-not-owned rather than throwing, NUMERIC/JSONB columns left as the
 * driver returns them (nothing here parses `assumptions` — that's
 * `scenarioAssumptions.ts`'s job, at the point something actually needs the typed
 * shape, not on every list read).
 */

export interface ScenarioSummary {
  id: number;
  name: string;
  isBaseline: boolean;
  createdAt: Date;
  updatedAt: Date;
}

/** Every scenario for the household, baseline first, then newest first. */
export async function getScenarios(householdId: number): Promise<ScenarioSummary[]> {
  const db = getDb();
  return db
    .select({
      id: retirementScenarios.id,
      name: retirementScenarios.name,
      isBaseline: retirementScenarios.isBaseline,
      createdAt: retirementScenarios.createdAt,
      updatedAt: retirementScenarios.updatedAt,
    })
    .from(retirementScenarios)
    .where(eq(retirementScenarios.householdId, householdId))
    .orderBy(desc(retirementScenarios.isBaseline), desc(retirementScenarios.createdAt));
}

export interface ScenarioDetail {
  id: number;
  householdId: number;
  name: string;
  isBaseline: boolean;
  /** Raw JSONB — parse via `parseScenarioAssumptions` before trusting its shape. */
  assumptions: unknown;
  createdAt: Date;
  updatedAt: Date;
}

/** One scenario, scoped to the household. `null` for not-found-or-not-owned, matching
 * `getAccountDetail`'s collapsing of the two — a stale bookmark to a deleted or
 * someone-else's scenario should read the same either way. */
export async function getScenario(
  scenarioId: number,
  householdId: number,
): Promise<ScenarioDetail | null> {
  const db = getDb();
  const [row] = await db
    .select()
    .from(retirementScenarios)
    .where(and(eq(retirementScenarios.id, scenarioId), eq(retirementScenarios.householdId, householdId)))
    .limit(1);
  return row ?? null;
}

export interface ScenarioWithLatestRun extends ScenarioDetail {
  /** Most recent `simulation_run` for this scenario (any status), or `null` if it has
   * never been run — serves `docs/DESIGN_SPEC.md`'s own flow text: "shows the most
   * recent scenario's assumptions and its last-computed results (if any)." */
  latestRun: SimulationRun | null;
}

export async function getScenarioWithLatestRun(
  scenarioId: number,
  householdId: number,
): Promise<ScenarioWithLatestRun | null> {
  const scenario = await getScenario(scenarioId, householdId);
  if (!scenario) return null;

  const db = getDb();
  const [latestRun] = await db
    .select()
    .from(simulationRuns)
    .where(eq(simulationRuns.retirementScenarioId, scenarioId))
    .orderBy(desc(simulationRuns.createdAt))
    .limit(1);

  return { ...scenario, latestRun: latestRun ?? null };
}
