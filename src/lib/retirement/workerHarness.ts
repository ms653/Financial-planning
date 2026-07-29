/**
 * Spawns and cancels `simulationWorker.ts` runs. This is the real infrastructure M7's
 * route handlers will call directly (`POST` spawns, `POST .../cancel` cancels) — built
 * now, not as a throwaway test fixture, so M7 has a tested foundation rather than a
 * stub to rewrite.
 */

import path from 'node:path';
import { Worker } from 'node:worker_threads';
import { and, eq } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import * as schema from '@/lib/db/schema';
import type { SimulationWorkerData } from '@/workers/simulationWorker';

/**
 * Matches the layout `.next/standalone` has in production: `scripts/build-worker.ts`
 * writes the bundle to `.next/standalone/workers/simulationWorker.js`, and the
 * Dockerfile's `runner` stage copies `.next/standalone` to `/app`, so `server.js` and
 * `workers/simulationWorker.js` end up siblings under `process.cwd()`.
 */
const DEFAULT_WORKER_PATH = path.join(process.cwd(), 'workers/simulationWorker.js');

export interface SpawnSimulationWorkerOptions {
  /** Override for tests, where no `.next/standalone` build exists — points at a bundle
   * built directly by the test itself. */
  workerPath?: string;
  timeoutMs?: number;
}

export function spawnSimulationWorker(
  simulationRunId: number,
  options: SpawnSimulationWorkerOptions = {},
): Worker {
  const data: SimulationWorkerData = {
    simulationRunId,
    ...(options.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs } : {}),
  };
  return new Worker(options.workerPath ?? DEFAULT_WORKER_PATH, { workerData: data });
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
