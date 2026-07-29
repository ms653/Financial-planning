import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { Pool } from 'pg';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import * as schema from '@/lib/db/schema';
import {
  accounts,
  balanceSnapshots,
  households,
  people,
  retirementScenarios,
  simulationRuns,
} from '@/lib/db/schema';
import { taxWrapperForType } from '@/lib/accounts/types';
import { todayIso } from '@/lib/accounts/validation';
import { penceToNumeric } from '@/lib/money';
import { buildSimulationWorkerBundle } from '@/workers/build';
import { POST } from './route';

/**
 * Exercises the real exported `POST` handler directly, against a real Postgres and a
 * real spawned worker — not a mock. `sameOriginGuard`/household-scoping/validation are
 * this milestone's own required test list; the completion case additionally proves the
 * whole compute→persist→poll pipeline (resolveScenario → spawnSimulationWorker → the
 * worker actually running and writing back) end to end through the real route.
 */

const connectionString = process.env.TEST_DATABASE_URL;

function jsonRequest(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request('http://localhost:3000/api/retirement/simulation-runs', {
    method: 'POST',
    headers: {
      origin: 'http://localhost:3000',
      host: 'localhost:3000',
      'content-type': 'application/json',
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

describe.skipIf(!connectionString)('POST /api/retirement/simulation-runs', () => {
  let pool: Pool;
  let db: NodePgDatabase<typeof schema>;
  let bundleDir: string;

  beforeAll(async () => {
    pool = new Pool({ connectionString, max: 4 });
    db = drizzle(pool, { schema });

    await pool.query('DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;');
    await pool.query('DROP SCHEMA IF EXISTS drizzle CASCADE;');
    await migrate(db, { migrationsFolder: './drizzle' });

    process.env.DATABASE_URL = connectionString;

    await mkdir(path.join(process.cwd(), '.next'), { recursive: true });
    bundleDir = await mkdtemp(path.join(process.cwd(), '.next', 'test-workers-'));
    const bundlePath = path.join(bundleDir, 'simulationWorker.js');
    await buildSimulationWorkerBundle(bundlePath);
    // Lets spawnSimulationWorker (called inside the route handler itself, with no
    // workerPath override — see workerHarness.ts's own doc comment) find this test's
    // bundle instead of the production .next/standalone one, which doesn't exist here.
    process.env.SIMULATION_WORKER_BUNDLE_PATH = bundlePath;
  }, 60_000);

  afterAll(async () => {
    delete process.env.SIMULATION_WORKER_BUNDLE_PATH;
    await pool?.end();
    if (bundleDir) await rm(bundleDir, { recursive: true, force: true });
  });

  beforeEach(async () => {
    await pool.query(
      'TRUNCATE TABLE simulation_run, retirement_scenario, balance_snapshot, account, person, household RESTART IDENTITY CASCADE;',
    );
  });

  async function seedScenario(): Promise<number> {
    const [household] = await db.insert(households).values({ name: 'Test household' }).returning();
    const [person] = await db
      .insert(people)
      .values({ householdId: household!.id, name: 'Alex', dateOfBirth: '1985-06-15' })
      .returning();
    const [account] = await db
      .insert(accounts)
      .values({
        householdId: household!.id,
        personId: person!.id,
        name: 'GIA',
        type: 'gia',
        taxWrapper: taxWrapperForType('gia'),
      })
      .returning();
    await db
      .insert(balanceSnapshots)
      .values({ accountId: account!.id, amount: penceToNumeric(50_000_00n), snapshotDate: todayIso() });
    const [scenario] = await db
      .insert(retirementScenarios)
      .values({
        householdId: household!.id,
        name: 'Baseline',
        assumptions: {
          schemaVersion: 1,
          annualSpending: '20000.00',
          inflationPct: '2.500',
          equityAllocationPct: '60.000',
          targetSuccessRatePct: '90.000',
          flatEffectiveTaxRatePct: '20.000',
          wrapperWithdrawalOrder: ['gia'],
          people: [{ personId: person!.id, retirementAge: 65, planEndAge: 90 }],
        },
      })
      .returning();
    return scenario!.id;
  }

  it('creates a running row, spawns a real worker, and it reaches complete', async () => {
    const scenarioId = await seedScenario();

    const response = await POST(jsonRequest({ scenarioId, iterations: 50 }));
    expect(response.status).toBe(202);
    const body = await response.json();
    expect(body.status).toBe('running');
    expect(body.scenarioId).toBe(scenarioId);
    expect(body.iterationCount).toBe(50);

    let final: schema.SimulationRun | undefined;
    for (let i = 0; i < 50; i++) {
      [final] = await db.select().from(simulationRuns).where(eq(simulationRuns.id, body.id));
      if (final!.status !== 'running') break;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    expect(final!.status).toBe('complete');
    expect(final!.result).not.toBeNull();
  });

  it('rejects a cross-origin request before touching the database', async () => {
    const response = await POST(jsonRequest({ scenarioId: 1 }, { origin: 'https://evil.example' }));
    expect(response.status).toBe(403);

    const { rows } = await pool.query('select count(*)::int as count from simulation_run');
    expect(rows[0].count).toBe(0);
  });

  it('404s for a scenarioId that does not exist', async () => {
    await seedScenario(); // ensures a household exists
    const response = await POST(jsonRequest({ scenarioId: 999_999 }));
    expect(response.status).toBe(404);
  });

  it('rejects an out-of-range iterations value without creating a run', async () => {
    const scenarioId = await seedScenario();
    const response = await POST(jsonRequest({ scenarioId, iterations: -5 }));
    expect(response.status).toBe(400);

    const { rows } = await pool.query('select count(*)::int as count from simulation_run');
    expect(rows[0].count).toBe(0);
  });

  it('400s when no household exists yet', async () => {
    const response = await POST(jsonRequest({ scenarioId: 1 }));
    expect(response.status).toBe(400);
  });
});
