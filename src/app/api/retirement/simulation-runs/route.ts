import { eq } from 'drizzle-orm';
import { sameOriginGuard } from '@/lib/auth/csrf';
import { getDb } from '@/lib/db/client';
import { simulationRuns } from '@/lib/db/schema';
import { getSetupState } from '@/lib/household/queries';
import { MAX_ITERATIONS } from '@/lib/retirement/engine/bootstrapEngine';
import { resolveScenario } from '@/lib/retirement/resolveScenario';
import { serializeSimulationRun } from '@/lib/retirement/simulationRunView';
import { spawnSimulationWorker } from '@/lib/retirement/workerHarness';

/**
 * Starts a retirement Monte Carlo run: `POST { scenarioId, iterations? }`.
 *
 * The first mutating route handler in this codebase — `sameOriginGuard` is called
 * first, per `src/lib/auth/csrf.ts`'s own doc comment naming this exact endpoint as the
 * reason it exists. Session auth is already enforced upstream by `src/middleware.ts`
 * for every non-public path, this one included.
 *
 * compute → persist → poll, not request-response-with-result-in-body
 * (`docs/PROPOSAL.md`'s Compute execution model): inserts a `running` row, spawns a
 * `worker_thread` to do the CPU-bound work off this request, and returns immediately —
 * the client polls `GET .../[id]` for the outcome.
 */

export const dynamic = 'force-dynamic';

/** M5's own measured, documented recommended production default — variance already
 * within about ±1.1 percentage points of the true success rate, comfortably sub-100ms
 * even single-threaded. */
const DEFAULT_ITERATIONS = 2000;

interface CreateRunBody {
  scenarioId?: unknown;
  iterations?: unknown;
}

function jsonError(status: number, error: string): Response {
  return Response.json({ error }, { status });
}

export async function POST(request: Request): Promise<Response> {
  const guard = sameOriginGuard(request);
  if (guard) return guard;

  let body: CreateRunBody;
  try {
    body = await request.json();
  } catch {
    return jsonError(400, 'Request body must be JSON');
  }

  const scenarioId = body.scenarioId;
  if (typeof scenarioId !== 'number' || !Number.isInteger(scenarioId) || scenarioId <= 0) {
    return jsonError(400, 'scenarioId must be a positive integer');
  }

  let iterations = DEFAULT_ITERATIONS;
  if (body.iterations !== undefined) {
    if (
      typeof body.iterations !== 'number' ||
      !Number.isInteger(body.iterations) ||
      body.iterations <= 0 ||
      body.iterations > MAX_ITERATIONS
    ) {
      return jsonError(400, `iterations must be a positive integer up to ${MAX_ITERATIONS}`);
    }
    iterations = body.iterations;
  }

  const { householdId } = await getSetupState();
  if (householdId === null) {
    return jsonError(400, 'No household exists yet. Complete guided setup first.');
  }

  let scenario;
  try {
    scenario = await resolveScenario(scenarioId, householdId);
  } catch (error) {
    // A scenario referencing a deleted person, or a malformed assumptions blob, is a
    // real bug, not a client input error — logged in full server-side, generic to the
    // caller, matching household/actions.ts's logAndWrap posture.
    console.error('[retirement] resolveScenario failed:', error);
    return jsonError(500, 'Could not resolve this scenario.');
  }
  if (!scenario) {
    return jsonError(404, 'Scenario not found');
  }

  // Not cryptographically random, deliberately — src/lib/retirement/rng.ts already
  // documents this module's RNG as not crypto-strength, and this seed is chosen purely
  // so re-running the same scenario resamples rather than always landing identically.
  const seed = Math.floor(Math.random() * 2 ** 31);

  const db = getDb();
  const [run] = await db
    .insert(simulationRuns)
    .values({ retirementScenarioId: scenarioId, seed, iterationCount: iterations })
    .returning();

  try {
    spawnSimulationWorker(run!.id, { scenario, iterations, seed });
  } catch (error) {
    // A synchronous spawn failure (e.g. the worker bundle is missing) is caught and
    // written back immediately, rather than left as a `running` row for staleness
    // reconciliation to eventually notice on some future poll.
    console.error('[retirement] spawnSimulationWorker failed:', error);
    await db
      .update(simulationRuns)
      .set({
        status: 'failed',
        errorDetail: 'Could not start the simulation worker.',
        completedAt: new Date(),
      })
      .where(eq(simulationRuns.id, run!.id));
    return jsonError(500, 'Could not start the simulation.');
  }

  return Response.json(serializeSimulationRun(run!), { status: 202 });
}
