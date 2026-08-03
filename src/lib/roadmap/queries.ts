/**
 * Reads for `roadmap_order` — the household's saved reprioritization of
 * `src/lib/roadmap/data.ts`'s `ROADMAP_ITEMS`. Not household-scoped (see that table's
 * own schema doc comment); a plain singleton read, same shape as `getStockAnalysis`'s
 * "table exists, might have nothing in it yet" posture.
 */
import { getDb } from '@/lib/db/client';
import { roadmapOrder } from '@/lib/db/schema';
import { ROADMAP_ITEMS, type RoadmapItem } from '@/lib/roadmap/data';

/** `null` when the household has never reordered anything yet. */
export async function getRoadmapOrder(): Promise<string[] | null> {
  const db = getDb();
  const [row] = await db.select({ itemIds: roadmapOrder.itemIds }).from(roadmapOrder);
  return (row?.itemIds as string[] | undefined) ?? null;
}

/**
 * Merges a saved order (a plain array of ids, possibly stale or absent) with the
 * current `ROADMAP_ITEMS`. An id in `stored` that no longer exists in `items` (a
 * phase renamed or removed — shouldn't happen given the "never reuse/renumber an id"
 * rule in `data.ts`, but not trusted blindly since this round-trips through a DB
 * column, not just in-memory state) is silently dropped rather than crashing the
 * page. An item in `items` missing from `stored` (added since the household last
 * reordered) is appended at the end, in `items`'s own default order — so a brand new
 * phase shows up where I actually sequenced it, not at a random position.
 *
 * Pure, and the one real piece of logic here worth unit-testing directly rather than
 * only through an integration test.
 */
export function resolveRoadmapOrder(stored: string[] | null, items: readonly RoadmapItem[] = ROADMAP_ITEMS): RoadmapItem[] {
  if (stored === null || stored.length === 0) return [...items];

  const byId = new Map(items.map((item) => [item.id, item]));
  const ordered: RoadmapItem[] = [];
  const seen = new Set<string>();

  for (const id of stored) {
    const item = byId.get(id);
    if (item && !seen.has(id)) {
      ordered.push(item);
      seen.add(id);
    }
  }
  for (const item of items) {
    if (!seen.has(item.id)) ordered.push(item);
  }
  return ordered;
}
