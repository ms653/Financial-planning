/**
 * The JSON shape both `GET /api/retirement/simulation-runs/[id]` and
 * `POST /api/retirement/simulation-runs/[id]/cancel` return for a `simulation_run` row.
 * `result` is passed through exactly as stored — already the JSON-safe string-encoded
 * form `simulationResultCodec.ts` writes — rather than run through
 * `deserializeSimulationResult` first, which would produce real `bigint`s only to have
 * `Response.json`'s own `JSON.stringify` immediately reject them.
 */

import type { SimulationRun } from '@/lib/db/schema';

export function serializeSimulationRun(run: SimulationRun) {
  return {
    id: run.id,
    scenarioId: run.retirementScenarioId,
    status: run.status,
    seed: run.seed,
    iterationCount: run.iterationCount,
    result: run.result,
    errorDetail: run.errorDetail,
    createdAt: run.createdAt,
    completedAt: run.completedAt,
  };
}
