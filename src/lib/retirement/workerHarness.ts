/**
 * Spawns and cancels `simulationWorker.ts` runs. This is the real infrastructure M7's
 * route handlers call directly (`POST /simulation-runs` spawns,
 * `POST /simulation-runs/[id]/cancel` cancels).
 */

import path from 'node:path';
import { Worker } from 'node:worker_threads';
import { and, eq } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import * as schema from '@/lib/db/schema';
import type { ResolvedScenario } from '@/lib/retirement/engineTypes';
import type { SimulationWorkerData } from '@/workers/simulationWorker';

/**
 * Matches the layout `.next/standalone` has in production: `scripts/build-worker.ts`
 * writes the bundle to `.next/standalone/workers/simulationWorker.js`, and the
 * Dockerfile's `runner` stage copies `.next/standalone` to `/app`, so `server.js` and
 * `workers/simulationWorker.js` end up siblings under `process.cwd()`.
 *
 * `SIMULATION_WORKER_BUNDLE_PATH` overrides this — not a real deployment knob, only for
 * the route-handler tests, which call `POST /simulation-runs` directly and so can't pass
 * `workerPath` through `spawnSimulationWorker`'s options the way the M6/M7 worker-level
 * tests do (the route handler itself takes no such parameter; adding one would leak a
 * test-only concern into real API surface). Read at call time, not module-load time, so
 * a test's `beforeAll` setting it before the route handler runs is honoured — matching
 * `src/lib/env.ts`'s own "validated at point of use, not import time" posture.
 */
function defaultWorkerPath(): string {
  return process.env.SIMULATION_WORKER_BUNDLE_PATH ?? path.join(process.cwd(), 'workers/simulationWorker.js');
}

/**
 * Live `Worker` instances, keyed by `simulation_run.id`, for the lifetime of this Node
 * process. Needed because `POST /simulation-runs` (which creates the `Worker`) and
 * `POST /simulation-runs/[id]/cancel` (which needs to call `.terminate()` on that same
 * instance) are two separate HTTP requests — the object itself only lives in the first
 * request's JS heap unless something keeps a reference. `globalThis`-cached the same
 * way `src/lib/db/client.ts` caches its connection pool, so it survives Next.js
 * module re-evaluation in dev. Entries are removed automatically once a worker exits,
 * however it exits — normal completion, failure, or termination.
 *
 * A run with no entry here (the process restarted since it started, killing the old
 * worker with it) isn't an error case `cancelSimulationRun` needs to special-case: it
 * separates "write `cancelled`" from "terminate the thread" precisely so cancelling a
 * run with nothing left to terminate still works.
 */
const globalForWorkers = globalThis as unknown as { __hfSimulationWorkers?: Map<number, Worker> };

function workerRegistry(): Map<number, Worker> {
  if (!globalForWorkers.__hfSimulationWorkers) {
    globalForWorkers.__hfSimulationWorkers = new Map();
  }
  return globalForWorkers.__hfSimulationWorkers;
}

/** The live `Worker` for a run, if this process spawned it and it hasn't exited yet. */
export function getRegisteredWorker(simulationRunId: number): Worker | undefined {
  return workerRegistry().get(simulationRunId);
}

export interface SpawnSimulationWorkerOptions {
  scenario: ResolvedScenario;
  iterations: number;
  seed: number;
  /** Override for tests, where no `.next/standalone` build exists — points at a bundle
   * built directly by the test itself. */
  workerPath?: string;
  timeoutMs?: number;
  /** Test-only — see `SimulationWorkerData`'s own doc comment. Never set in production. */
  testOnlyDelayMs?: number;
}

export function spawnSimulationWorker(
  simulationRunId: number,
  options: SpawnSimulationWorkerOptions,
): Worker {
  const data: SimulationWorkerData = {
    simulationRunId,
    scenario: options.scenario,
    iterations: options.iterations,
    seed: options.seed,
    ...(options.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs } : {}),
    ...(options.testOnlyDelayMs !== undefined ? { testOnlyDelayMs: options.testOnlyDelayMs } : {}),
  };
  const worker = new Worker(options.workerPath ?? defaultWorkerPath(), { workerData: data });

  workerRegistry().set(simulationRunId, worker);
  worker.once('exit', () => {
    // Only delete our own entry — guards the (currently unreachable, since run ids are
    // never reused) case of a second worker having already overwritten this one.
    if (workerRegistry().get(simulationRunId) === worker) {
      workerRegistry().delete(simulationRunId);
    }
  });

  return worker;
}

/**
 * Cancels a running simulation. The `cancelled` status is written here, by the caller,
 * *before* asking the worker to stop — not inside the worker's own cleanup.
 * `worker.terminate()` stops the thread "as soon as possible" with no guaranteed
 * graceful `finally`, so a worker can't reliably report its own cancellation once asked
 * to stop. The `WHERE status = 'running'` guard (shared with `simulationWorker.ts`'s own
 * completion/failure writes) means whichever write actually lands first — this one, or
 * the worker finishing a moment before it's told to stop — wins cleanly: the loser's
 * `UPDATE` matches zero rows instead of overwriting a terminal status.
 */
export async function cancelSimulationRun(
  db: NodePgDatabase<typeof schema>,
  worker: Worker,
  simulationRunId: number,
): Promise<void> {
  await db
    .update(schema.simulationRuns)
    .set({ status: 'cancelled', completedAt: new Date() })
    .where(
      and(eq(schema.simulationRuns.id, simulationRunId), eq(schema.simulationRuns.status, 'running')),
    );

  await worker.terminate();
}
