import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { Pool } from 'pg';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import * as schema from '@/lib/db/schema';
import { households, retirementScenarios, simulationRuns } from '@/lib/db/schema';
import { GET } from './route';

const connectionString = process.env.TEST_DATABASE_URL;

function getRequest(): Request {
  return new Request('http://localhost:3000/api/retirement/simulation-runs/1');
}

describe.skipIf(!connectionString)('GET /api/retirement/simulation-runs/[id]', () => {
  let pool: Pool;
  let db: NodePgDatabase<typeof schema>;

  beforeAll(async () => {
    pool = new Pool({ connectionString, max: 4 });
    db = drizzle(pool, { schema });
    await pool.query('DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;');
    await pool.query('DROP SCHEMA IF EXISTS drizzle CASCADE;');
    await migrate(db, { migrationsFolder: './drizzle' });
    process.env.DATABASE_URL = connectionString;
  }, 60_000);

  afterAll(async () => {
    await pool?.end();
  });

  beforeEach(async () => {
    await pool.query(
      'TRUNCATE TABLE simulation_run, retirement_scenario, household RESTART IDENTITY CASCADE;',
    );
  });

  async function seedRun(overrides: Partial<schema.NewSimulationRun> = {}): Promise<number> {
    const [household] = await db.insert(households).values({ name: 'Test household' }).returning();
    const [scenario] = await db
      .insert(retirementScenarios)
      .values({ householdId: household!.id, name: 'Baseline', assumptions: { schemaVersion: 1 } })
      .returning();
    const [run] = await db
      .insert(simulationRuns)
      .values({ retirementScenarioId: scenario!.id, seed: 1, iterationCount: 2000, ...overrides })
      .returning();
    return run!.id;
  }

  it('returns a complete run as-is, result passed through exactly as stored', async () => {
    const runId = await seedRun({
      status: 'complete',
      result: { scenarioId: 1, seed: 1, iterationCount: 2000, successRate: 0.87, percentileBandsPence: {} },
      completedAt: new Date(),
    });

    const response = await GET(getRequest(), { params: { id: String(runId) } });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.status).toBe('complete');
    expect(body.result.successRate).toBe(0.87);
  });

  it('404s for a run id that does not exist', async () => {
    await seedRun();
    const response = await GET(getRequest(), { params: { id: '999999' } });
    expect(response.status).toBe(404);
  });

  it('400s for a malformed id', async () => {
    const response = await GET(getRequest(), { params: { id: 'not-a-number' } });
    expect(response.status).toBe(400);
  });

  it('leaves a recent running row untouched', async () => {
    const runId = await seedRun({ status: 'running' });
    const response = await GET(getRequest(), { params: { id: String(runId) } });
    const body = await response.json();
    expect(body.status).toBe('running');
  });

  it('reconciles a stale running row to failed on poll', async () => {
    const runId = await seedRun({
      status: 'running',
      createdAt: new Date(Date.now() - 120_000), // well past the 60s staleness threshold
    });

    const response = await GET(getRequest(), { params: { id: String(runId) } });
    const body = await response.json();
    expect(body.status).toBe('failed');
    expect(body.errorDetail).toMatch(/Stalled/);
    expect(body.completedAt).not.toBeNull();

    // Confirm it's written to the DB, not just reflected in this one response.
    const [row] = await db.select().from(simulationRuns).where(eq(simulationRuns.id, runId));
    expect(row!.status).toBe('failed');
  });
});
