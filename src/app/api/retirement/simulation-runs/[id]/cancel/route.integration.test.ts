import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { Pool } from 'pg';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import * as schema from '@/lib/db/schema';
import { households, retirementScenarios, simulationRuns } from '@/lib/db/schema';
import { buildSimulationWorkerBundle } from '@/workers/build';
import { spawnSimulationWorker } from '@/lib/retirement/workerHarness';
import { percentStringToScaledFraction, type ResolvedScenario } from '@/lib/retirement/engineTypes';
import { statePensionAnnualPence } from '@/lib/retirement/taxYearConfig';
import { POST } from './route';

const connectionString = process.env.TEST_DATABASE_URL;

function cancelRequest(headers: Record<string, string> = {}): Request {
  return new Request('http://localhost:3000/api/retirement/simulation-runs/1/cancel', {
    method: 'POST',
    headers: { origin: 'http://localhost:3000', host: 'localhost:3000', ...headers },
  });
}

function fixtureScenario(scenarioId: number): ResolvedScenario {
  return {
    scenarioId,
    annualSpendingPence: 2_000_000n,
    survivorAnnualSpendingPence: null,
    inflationRate: percentStringToScaledFraction('2.500'),
    equityAllocationRate: percentStringToScaledFraction('60.000'),
    targetSuccessRate: percentStringToScaledFraction('90.000'),
    flatEffectiveTaxRate: percentStringToScaledFraction('20.000'),
    wrapperWithdrawalOrder: ['gia'],
    people: [
      {
        personId: 1,
        currentAge: 65,
        retirementAge: 65,
        statePensionClaimAge: 67,
        statePensionAnnualPence: statePensionAnnualPence(),
        pclsAge: null,
        planEndAge: 90,
        annualContributionPence: 0n,
      },
    ],
    startingBalancesPence: { gia: 50_000_000n },
  };
}

describe.skipIf(!connectionString)('POST /api/retirement/simulation-runs/[id]/cancel', () => {
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
    process.env.DATABASE_URL = connectionString;

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

  async function seedRun(overrides: Partial<schema.NewSimulationRun> = {}): Promise<{
    scenarioId: number;
    runId: number;
  }> {
    const [household] = await db.insert(households).values({ name: 'Test household' }).returning();
    const [scenario] = await db
      .insert(retirementScenarios)
      .values({ householdId: household!.id, name: 'Baseline', assumptions: { schemaVersion: 1 } })
      .returning();
    const [run] = await db
      .insert(simulationRuns)
      .values({ retirementScenarioId: scenario!.id, seed: 1, iterationCount: 200, ...overrides })
      .returning();
    return { scenarioId: scenario!.id, runId: run!.id };
  }

  it('rejects a cross-origin request', async () => {
    const { runId } = await seedRun({ status: 'running' });
    const response = await POST(cancelRequest({ origin: 'https://evil.example' }), {
      params: { id: String(runId) },
    });
    expect(response.status).toBe(403);
  });

  it('404s for a run id that does not exist', async () => {
    await seedRun();
    const response = await POST(cancelRequest(), { params: { id: '999999' } });
    expect(response.status).toBe(404);
  });

  it('is idempotent: cancelling an already-complete run just returns its current state', async () => {
    const { runId } = await seedRun({ status: 'complete', completedAt: new Date() });
    const response = await POST(cancelRequest(), { params: { id: String(runId) } });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.status).toBe('complete');
  });

  it('cancels via the guarded DB write when no live worker is registered for the run', async () => {
    // A run left `running` with nothing in workerHarness.ts's in-memory registry — the
    // "app restarted since this run started" case. No worker was ever spawned by this
    // process for this run id.
    const { runId } = await seedRun({ status: 'running' });
    const response = await POST(cancelRequest(), { params: { id: String(runId) } });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.status).toBe('cancelled');

    const [row] = await db.select().from(simulationRuns).where(eq(simulationRuns.id, runId));
    expect(row!.status).toBe('cancelled');
  });

  it('terminates a real live worker and marks the run cancelled', async () => {
    const { scenarioId, runId } = await seedRun({ status: 'running' });

    const worker = spawnSimulationWorker(runId, {
      workerPath: bundlePath,
      scenario: fixtureScenario(scenarioId),
      iterations: 200,
      seed: 1,
      testOnlyDelayMs: 2000, // deterministic window, same reasoning as the M6/M7 worker tests
    });
    const exited = new Promise<void>((resolve) => worker.once('exit', () => resolve()));
    await new Promise<void>((resolve) => {
      worker.once('message', (message: { type: string }) => {
        if (message.type === 'started') resolve();
      });
    });

    const response = await POST(cancelRequest(), { params: { id: String(runId) } });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.status).toBe('cancelled');

    await exited; // proves the real worker was actually terminated, not just the row flipped
  });
});
