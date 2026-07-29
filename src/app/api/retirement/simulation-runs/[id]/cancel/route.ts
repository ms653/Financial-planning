import { and, eq } from 'drizzle-orm';
import { sameOriginGuard } from '@/lib/auth/csrf';
import { getDb } from '@/lib/db/client';
import { retirementScenarios, simulationRuns } from '@/lib/db/schema';
import { getSetupState } from '@/lib/household/queries';
import { cancelSimulationRun, getRegisteredWorker } from '@/lib/retirement/workerHarness';
import { serializeSimulationRun } from '@/lib/retirement/simulationRunView';

/**
 * Cancels a running simulation. `DESIGN_SPEC.md`'s Scenario Editor "Running" state
 * requires an explicit cancel ("can navigate away... but can't edit further until it
 * resolves or they explicitly cancel"); this is that endpoint.
 *
 * Idempotent: cancelling a run that's already `complete`/`failed`/`cancelled` just
 * returns its current state rather than erroring — matches the Milestone 6 Fable
 * review's own finding that terminating/cancelling an already-finished run is harmless.
 *
 * If this process spawned the worker and it's still registered
 * (`workerHarness.ts`'s in-memory registry), the real `cancelSimulationRun` both writes
 * the guarded `cancelled` status and calls `worker.terminate()`. If not — the app
 * restarted since the run started, so whatever worker there was already died with the
 * old process — there's nothing left to terminate, so this just does the same guarded
 * DB write directly.
 */

export const dynamic = 'force-dynamic';

function jsonError(status: number, error: string): Response {
  return Response.json({ error }, { status });
}

export async function POST(
  request: Request,
  { params }: { params: { id: string } },
): Promise<Response> {
  const guard = sameOriginGuard(request);
  if (guard) return guard;

  const id = Number(params.id);
  if (!Number.isInteger(id) || id <= 0) {
    return jsonError(400, 'Invalid run id');
  }

  const { householdId } = await getSetupState();
  if (householdId === null) {
    return jsonError(404, 'Simulation run not found');
  }

  const db = getDb();

  const [row] = await db
    .select({ run: simulationRuns })
    .from(simulationRuns)
    .innerJoin(retirementScenarios, eq(retirementScenarios.id, simulationRuns.retirementScenarioId))
    .where(and(eq(simulationRuns.id, id), eq(retirementScenarios.householdId, householdId)));

  if (!row) {
    return jsonError(404, 'Simulation run not found');
  }

  if (row.run.status !== 'running') {
    return Response.json(serializeSimulationRun(row.run));
  }

  const worker = getRegisteredWorker(id);
  if (worker) {
    await cancelSimulationRun(db, worker, id);
  } else {
    await db
      .update(simulationRuns)
      .set({ status: 'cancelled', completedAt: new Date() })
      .where(and(eq(simulationRuns.id, id), eq(simulationRuns.status, 'running')));
  }

  const [updated] = await db.select().from(simulationRuns).where(eq(simulationRuns.id, id));
  return Response.json(serializeSimulationRun(updated!));
}
