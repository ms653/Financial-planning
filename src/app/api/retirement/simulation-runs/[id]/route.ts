import { and, eq } from 'drizzle-orm';
import { getDb } from '@/lib/db/client';
import { retirementScenarios, simulationRuns } from '@/lib/db/schema';
import { getSetupState } from '@/lib/household/queries';
import { serializeSimulationRun } from '@/lib/retirement/simulationRunView';

/**
 * Polls a simulation run's status/result. Read-only — no `sameOriginGuard` needed (that
 * guard is for mutating requests; see `src/lib/auth/csrf.ts`), but still auth-gated
 * upstream by `src/middleware.ts` like every non-public path.
 *
 * **Staleness reconciliation** (per the Milestone 7 plan's own required item): a
 * `running` row older than `STALE_THRESHOLD_MS` is rewritten to `failed` before being
 * returned, rather than left for a client to poll forever. The threshold is double the
 * worker's own `DEFAULT_TIMEOUT_MS` compute budget (`simulationWorker.ts`), so a
 * legitimately-still-computing run — which self-reports `failed` on overrun well before
 * this fires — is never mistaken for an abandoned one. This exists for the case the
 * worker's *process* died entirely (crash, restart) and never got the chance to report
 * anything at all.
 */

export const dynamic = 'force-dynamic';

const STALE_THRESHOLD_MS = 60_000;

function jsonError(status: number, error: string): Response {
  return Response.json({ error }, { status });
}

export async function GET(
  _request: Request,
  { params }: { params: { id: string } },
): Promise<Response> {
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

  let run = row.run;

  if (run.status === 'running') {
    const ageMs = Date.now() - run.createdAt.getTime();
    if (ageMs > STALE_THRESHOLD_MS) {
      const [reconciled] = await db
        .update(simulationRuns)
        .set({
          status: 'failed',
          errorDetail: `Stalled — no result after ${Math.round(ageMs / 1000)}s. The worker likely never completed (e.g. a server restart mid-run).`,
          completedAt: new Date(),
        })
        .where(and(eq(simulationRuns.id, id), eq(simulationRuns.status, 'running')))
        .returning();
      // The guard can match zero rows if the worker finished (or was cancelled) in the
      // moment between the read above and this write — re-read rather than trust a
      // stale local guess about which branch actually won.
      if (reconciled) {
        run = reconciled;
      } else {
        const [refreshed] = await db.select().from(simulationRuns).where(eq(simulationRuns.id, id));
        run = refreshed!;
      }
    }
  }

  return Response.json(serializeSimulationRun(run));
}
