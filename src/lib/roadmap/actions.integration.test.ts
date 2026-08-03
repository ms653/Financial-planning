import { beforeAll, afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

// saveRoadmapOrder calls revalidatePath, which needs a Next request scope that
// doesn't exist in a plain test — same convention as dcfCrud.integration.test.ts.
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

import { Pool } from 'pg';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import * as schema from '@/lib/db/schema';
import { roadmapOrder } from '@/lib/db/schema';
import { saveRoadmapOrder } from '@/lib/roadmap/actions';
import { ROADMAP_ITEMS } from '@/lib/roadmap/data';

/**
 * Exercises the real exported `saveRoadmapOrder` Server Action against a real
 * Postgres, mirroring `dcfCrud.integration.test.ts`'s convention. No household row
 * seeded — `roadmap_order` isn't household-scoped (see its own schema doc comment).
 */

const connectionString = process.env.TEST_DATABASE_URL;

describe.skipIf(!connectionString)('saveRoadmapOrder against a real Postgres', () => {
  let pool: Pool;
  let db: NodePgDatabase<typeof schema>;

  const draggableIds = ROADMAP_ITEMS.filter((item) => item.status !== 'done').map((item) => item.id);
  const doneId = ROADMAP_ITEMS.find((item) => item.status === 'done')!.id;

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
    await pool.query('TRUNCATE TABLE roadmap_order RESTART IDENTITY CASCADE;');
  });

  it('creates the singleton row on first save', async () => {
    const reordered = [...draggableIds].reverse();
    const result = await saveRoadmapOrder(reordered);
    expect(result.ok).toBe(true);

    const rows = await db.select().from(roadmapOrder);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.itemIds).toEqual(reordered);
  });

  it('updates the same row in place on a second save, not a duplicate', async () => {
    await saveRoadmapOrder(draggableIds);
    const secondOrder = [...draggableIds].reverse();
    const result = await saveRoadmapOrder(secondOrder);

    expect(result.ok).toBe(true);
    const rows = await db.select().from(roadmapOrder);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.itemIds).toEqual(secondOrder);
  });

  it('rejects a payload containing a done item id, and writes nothing', async () => {
    const result = await saveRoadmapOrder([doneId, ...draggableIds]);
    expect(result.ok).toBe(false);
    expect(await db.select().from(roadmapOrder)).toHaveLength(0);
  });

  it('rejects a payload missing one of the real draggable ids, and writes nothing', async () => {
    const result = await saveRoadmapOrder(draggableIds.slice(1));
    expect(result.ok).toBe(false);
    expect(await db.select().from(roadmapOrder)).toHaveLength(0);
  });

  it('rejects an unrecognised id, and writes nothing', async () => {
    const result = await saveRoadmapOrder([...draggableIds, 'not-a-real-phase']);
    expect(result.ok).toBe(false);
    expect(await db.select().from(roadmapOrder)).toHaveLength(0);
  });

  it('rejects a duplicated id standing in for a missing one, and writes nothing', async () => {
    const withDuplicate = [draggableIds[0]!, ...draggableIds.slice(0, -1)]; // drops the last id, duplicates the first
    const result = await saveRoadmapOrder(withDuplicate);
    expect(result.ok).toBe(false);
    expect(await db.select().from(roadmapOrder)).toHaveLength(0);
  });
});
