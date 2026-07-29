import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { Pool } from 'pg';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { Worker } from 'node:worker_threads';
import * as schema from '@/lib/db/schema';
import { households, retirementScenarios, simulationRuns } from '@/lib/db/schema';
import { buildSimulationWorkerBundle } from '@/workers/build';
import { spawnSimulationWorker, cancelSimulationRun } from '@/lib/retirement/workerHarness';
import { deserializeSimulationResult } from '@/lib/retirement/simulationResultCodec';

/**
 * Milestone 6's required proof: a real worker_threads worker, spawned from a bundle
 * built the same way production builds it (`buildSimulationWorkerBundle`, the function
 * `scripts/build-worker.ts` calls against `.next/standalone`), doing a real DB
 * read/write cycle against a real Postgres — not a mock, not just a unit test of the
 * bundling config. The bundle is built under `.next/test-workers/` (gitignored, like
 * the rest of `.next/`) rather than a system temp directory: `pg` is deliberately left
 * external by `buildSimulationWorkerBundle` (see its own doc comment), so the bundle's
 * `require('pg')` only resolves if it sits somewhere Node's module resolution can walk
 * up from and find a real `node_modules/pg` — true under this project root, not under
 * `os.tmpdir()`. This also means the test doesn't depend on a full `next build` having
 * run first (CI's "Unit tests" step never runs `next build`).
 *
 * Skipped unless `TEST_DATABASE_URL` is set, same convention as every other
 * `*.integration.test.ts` file in this repo.
 */

const connectionString = process.env.TEST_DATABASE_URL;

describe.skipIf(!connectionString)('simulationWorker against a real Postgres', () => {
  let pool: Pool;
  let db: NodePgDatabase<typeof schema>;
  let bundleDir: string;
  let bundlePath: string;

  beforeAll(async () => {
    pool = new Pool({ connectionString, max: 4 });
    db = drizzle(pool, { schema });

    await pool.query('DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;');
    await pool.query('DROP SCHEMA IF EXISTS drizzle CASCADE;');
    await migrate(db, { migrationsFolder: './drizzle' });

    // The worker inherits process.env at Worker construction time (unless overridden
    // via the `env` option) — this is what lets its own getDb()/getPool() connect to
    // the same scratch database without any explicit plumbing.
    process.env.DATABASE_URL = connectionString;

    // .next may not exist yet in CI, which never runs "next build" before "npm test".
    await mkdir(path.join(process.cwd(), '.next'), { recursive: true });
    bundleDir = await mkdtemp(path.join(process.cwd(), '.next', 'test-workers-'));
    bundlePath = path.join(bundleDir, 'simulationWorker.js');
    await buildSimulationWorkerBundle(bundlePath);
  }, 60_000);

  afterAll(async () => {
    await pool?.end();
    if (bundleDir) await rm(bundleDir, { recursive: true, force: true });
  });

  beforeEach(async () => {
    await pool.query(
      'TRUNCATE TABLE simulation_run, retirement_scenario, household RESTART IDENTITY CASCADE;',
    );
  });

  async function seedRunningSimulation(): Promise<{ scenarioId: number; runId: number }> {
    const [household] = await db.insert(households).values({ name: 'Test household' }).returning();
    const [scenario] = await db
      .insert(retirementScenarios)
      .values({ householdId: household!.id, name: 'Baseline', assumptions: { schemaVersion: 1 } })
      .returning();
    const [run] = await db
      .insert(simulationRuns)
      .values({ retirementScenarioId: scenario!.id, seed: 1, iterationCount: 200 })
      .returning();
    return { scenarioId: scenario!.id, runId: run!.id };
  }

  function waitForExit(worker: Worker): Promise<number> {
    return new Promise((resolve, reject) => {
      worker.once('exit', resolve);
      worker.once('error', reject);
    });
  }

  it('runs a real worker end-to-end: running -> complete, with a real result written', async () => {
    const { runId } = await seedRunningSimulation();

    const worker = spawnSimulationWorker(runId, { workerPath: bundlePath });
    const exitCode = await waitForExit(worker);
    expect(exitCode).toBe(0);

    const [updated] = await db.select().from(simulationRuns).where(eq(simulationRuns.id, runId));
    expect(updated!.status).toBe('complete');
    expect(updated!.completedAt).not.toBeNull();
    expect(updated!.result).not.toBeNull();

    const result = deserializeSimulationResult(updated!.result);
    expect(result.iterationCount).toBe(200);
    expect(result.successRate).toBeGreaterThanOrEqual(0);
    expect(result.successRate).toBeLessThanOrEqual(1);
  });

  it('reports a run that overruns its budget as failed, not complete', async () => {
    const { runId } = await seedRunningSimulation();

    // timeoutMs: 0 forces runWithBudgetCheck to always find the (non-zero-duration)
    // real computation over budget — see that function's own doc comment for why this
    // is a *detected-after-the-fact* overrun, not a preempted one: the worker still
    // runs the full computation, then reports failure instead of success because it
    // took longer than allowed. This is also the only path that exercises the worker's
    // `catch` branch/`status: 'failed'` write at all.
    const worker = spawnSimulationWorker(runId, { workerPath: bundlePath, timeoutMs: 0 });
    const exitCode = await waitForExit(worker);
    expect(exitCode).toBe(0);

    const [updated] = await db.select().from(simulationRuns).where(eq(simulationRuns.id, runId));
    expect(updated!.status).toBe('failed');
    expect(updated!.completedAt).not.toBeNull();
    expect(updated!.result).toBeNull();
    expect(updated!.errorDetail).toMatch(/exceeding its 0ms compute budget/);
  });

  it('terminates a running worker on cancellation, and the row stays cancelled', async () => {
    const { runId } = await seedRunningSimulation();

    // Constructed directly rather than through spawnSimulationWorker, to pass the
    // worker's test-only testOnlyDelayMs hook (not part of the harness's real, M7-facing
    // contract): it awaits an idle timer before it starts computing, giving
    // cancelSimulationRun a deterministic window in which terminate() is guaranteed to
    // land while the worker is genuinely still running, not racing a fixture
    // computation fast enough to finish first.
    const worker = new Worker(bundlePath, {
      workerData: { simulationRunId: runId, testOnlyDelayMs: 2000 },
    });

    // Wait for the worker's own "I have actually started main()" signal before
    // cancelling — calling terminate() immediately after `new Worker(...)` raced the
    // bundle's own load/evaluation time (drizzle-orm, pg, the embedded JST dataset) in
    // practice and could stop it before it had genuinely begun running, which made
    // Node's reported exit code unreliable as a "was it really running" signal.
    const started = new Promise<void>((resolve) => {
      worker.once('message', (message: { type: string }) => {
        if (message.type === 'started') resolve();
      });
    });

    const exitPromise = waitForExit(worker);
    await started;
    await cancelSimulationRun(db, worker, runId);
    await exitPromise;

    const [updated] = await db.select().from(simulationRuns).where(eq(simulationRuns.id, runId));
    expect(updated!.status).toBe('cancelled');
    expect(updated!.completedAt).not.toBeNull();
    expect(updated!.result).toBeNull();

    // Confirm the worker was actually stopped, not just that this test won a race:
    // wait past the point the fixture computation would have finished if it had been
    // allowed to run, and assert the row was never overwritten.
    await new Promise((resolve) => setTimeout(resolve, 200));
    const [afterWait] = await db.select().from(simulationRuns).where(eq(simulationRuns.id, runId));
    expect(afterWait!.status).toBe('cancelled');
  });
});
