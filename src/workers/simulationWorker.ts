/**
 * `node:worker_threads` entry point for the compute-persist-poll pattern
 * (`simulation_run`'s own doc comment in `src/lib/db/schema.ts`): a caller inserts a
 * `running` row, spawns this worker via `workerHarness.ts`'s `spawnSimulationWorker`,
 * and this file does the CPU-bound work off the request thread, writing the outcome
 * back to that same row.
 *
 * Milestone 6 proved the deployment path with a hand-built fixture scenario. Milestone
 * 7 wires in the real thing: the caller (`POST /api/retirement/simulation-runs`)
 * resolves a real `ResolvedScenario` via `resolveScenario.ts` and passes it through
 * `workerData` as-is — no bigint-to-string codec needed for this direction, since
 * `new Worker(path, { workerData })` uses Node's structured-clone algorithm, which
 * natively supports `bigint` (unlike `JSON.stringify`, which is exactly why
 * `simulationResultCodec.ts` exists for the *outbound* result write below).
 */

import { parentPort, workerData } from 'node:worker_threads';
import { and, eq } from 'drizzle-orm';
import { getDb, getPool } from '@/lib/db/client';
import { simulationRuns } from '@/lib/db/schema';
import { runSimulation } from '@/lib/retirement/engine/bootstrapEngine';
import type { ResolvedScenario } from '@/lib/retirement/engineTypes';
import { serializeSimulationResult } from '@/lib/retirement/simulationResultCodec';

export interface SimulationWorkerData {
  simulationRunId: number;
  scenario: ResolvedScenario;
  iterations: number;
  seed: number;
  /** Wall-clock compute budget, checked *after* the computation finishes — see
   * `runWithBudgetCheck`'s doc comment for why this can only detect an overrun, not
   * prevent one. */
  timeoutMs?: number;
  /** Test-only: delays the start of computation by this many ms, so the integration
   * test's termination case has a deterministic window to call `cancelSimulationRun`
   * mid-run without racing a computation fast enough to finish first. Never set outside
   * tests — the delay is an `await`ed timer, not simulated CPU work. */
  testOnlyDelayMs?: number;
}

const DEFAULT_TIMEOUT_MS = 30_000;

class WorkerTimeoutError extends Error {
  constructor(timeoutMs: number, elapsedMs: number) {
    super(`Simulation took ${elapsedMs.toFixed(1)}ms, exceeding its ${timeoutMs}ms compute budget`);
    this.name = 'WorkerTimeoutError';
  }
}

/**
 * Runs the (synchronous, CPU-bound) computation and checks *afterward* whether it
 * exceeded its budget. **This detects an overrun after the fact — it cannot prevent
 * one.** An earlier version of this function raced `run()` against a `setTimeout` via
 * `Promise.race`, on the mistaken assumption that this was merely "cooperative" (would
 * work if the computation happened to yield). Fable review proved that assumption
 * wrong: `Promise.resolve().then(run)` schedules `run` as a microtask, and Node/V8
 * always fully drains the microtask queue before the event loop ever reaches the timer
 * phase — so for a synchronous `run` (which `runSimulation` is), the timer branch of
 * that race could *never* win, regardless of `timeoutMs` or how long `run()` actually
 * took. It wasn't weak protection; it was dead code that could never fire, verified
 * empirically, not just reasoned about.
 *
 * What this function actually does, honestly: lets a pathologically slow (but
 * eventually-finished) computation be reported as `failed` rather than `complete`,
 * rather than silently succeeding no matter how long it took. It cannot stop work
 * already in progress — the only genuine mid-run stop for a truly hung computation is
 * the parent calling `worker.terminate()` (`workerHarness.ts`'s `cancelSimulationRun`),
 * a distinct mechanism this milestone separately proves and the only one that actually
 * halts anything.
 */
function runWithBudgetCheck<T>(run: () => T, timeoutMs: number): T {
  const start = process.hrtime.bigint();
  const result = run();
  const elapsedMs = Number(process.hrtime.bigint() - start) / 1_000_000;
  if (elapsedMs > timeoutMs) {
    throw new WorkerTimeoutError(timeoutMs, elapsedMs);
  }
  return result;
}

async function main(): Promise<void> {
  const {
    simulationRunId,
    scenario,
    iterations,
    seed,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    testOnlyDelayMs,
  } = workerData as SimulationWorkerData;
  const db = getDb();

  // Guards every write this worker makes: if the row has already moved off `running`
  // (a caller cancelled it out from under us), this `UPDATE` matches zero rows instead
  // of overwriting a terminal status — see schema.ts's doc comment on this enum.
  const stillRunning = and(eq(simulationRuns.id, simulationRunId), eq(simulationRuns.status, 'running'));

  // Lets a caller (the termination integration test) know this worker has actually
  // begun executing `main`, not just that the thread was constructed — bundle
  // load/evaluation time is non-trivial (drizzle-orm, pg, the embedded JST dataset),
  // so "call terminate() right after `new Worker(...)`" is not a reliable way to
  // guarantee the worker is genuinely mid-computation rather than still bootstrapping.
  parentPort?.postMessage({ type: 'started', simulationRunId });

  try {
    if (testOnlyDelayMs) {
      await new Promise((resolve) => setTimeout(resolve, testOnlyDelayMs));
    }

    const result = runWithBudgetCheck(
      () => runSimulation(scenario, { iterations, seed }),
      timeoutMs,
    );

    await db
      .update(simulationRuns)
      .set({
        status: 'complete',
        result: serializeSimulationResult(result),
        completedAt: new Date(),
      })
      .where(stillRunning);

    parentPort?.postMessage({ type: 'complete', simulationRunId });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    await db
      .update(simulationRuns)
      .set({ status: 'failed', errorDetail: message, completedAt: new Date() })
      .where(stillRunning);

    parentPort?.postMessage({ type: 'failed', simulationRunId, message });
  } finally {
    // Without this, the worker's own pg Pool keeps an open handle alive (idle clients
    // are kept up to idleTimeoutMillis, per src/lib/db/client.ts) and the worker thread
    // never fires its own 'exit' event — it would just sit there for up to 30s doing
    // nothing. Closing the pool here is what lets the thread's event loop drain and
    // exit promptly once this function returns, on both the success and failure paths.
    await getPool().end();
  }
}

main().catch((error: unknown) => {
  // Only reachable if the DB write inside the catch block above itself throws (e.g. the
  // connection is down) — nothing left to do but report it and exit non-zero.
  console.error('[simulationWorker] unhandled failure:', error);
  process.exitCode = 1;
});
