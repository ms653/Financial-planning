'use server';

import { revalidatePath } from 'next/cache';
import { getDb } from '@/lib/db/client';
import { roadmapOrder } from '@/lib/db/schema';
import { ROADMAP_ITEMS } from '@/lib/roadmap/data';
import type { ActionResult } from '@/lib/household/actions';

/**
 * `roadmap_order` write path. Takes a plain array, not `FormData` — a drag-and-drop
 * reorder has no form fields to serialize, so `RoadmapBoard.tsx` calls this directly
 * (wrapped in `useTransition`, the same pattern `PassphraseForm.tsx` already uses for
 * a non-`<form>`-submit action call), rather than forcing this through
 * `useActionForm`, which is built around form field state this doesn't have.
 *
 * No household/auth check here (unlike every other Server Action in this codebase) —
 * `roadmap_order` isn't household data (see its own schema doc comment), and every
 * route including this one already sits behind `middleware.ts`'s session-cookie gate.
 */
export async function saveRoadmapOrder(itemIds: string[]): Promise<ActionResult> {
  // A `done` item can't be dragged (see `RoadmapBoard.tsx`), and an id that isn't a
  // real `ROADMAP_ITEMS` id at all shouldn't be possible from the real UI — both
  // rejected here too, since this is a Server Action a modified client could call
  // directly with an arbitrary payload.
  const draggableIds = new Set(ROADMAP_ITEMS.filter((item) => item.status !== 'done').map((item) => item.id));
  const submittedIds = new Set(itemIds);
  const allValid = itemIds.every((id) => draggableIds.has(id));
  // `submittedIds.size` (not `itemIds.length`) catches a duplicate silently
  // compensating for a missing id — e.g. `[a, a, c]` for a real set of `{a, b, c}`
  // would otherwise pass a naive length check.
  if (!allValid || submittedIds.size !== draggableIds.size) {
    return { ok: false, errors: {}, formError: 'That reorder didn’t look right — nothing was saved.' };
  }

  try {
    const db = getDb();
    const existing = await db.select({ id: roadmapOrder.id }).from(roadmapOrder);
    if (existing.length > 0) {
      await db.update(roadmapOrder).set({ itemIds, updatedAt: new Date() });
    } else {
      await db.insert(roadmapOrder).values({ itemIds });
    }
  } catch (error) {
    console.error('[roadmap] saveRoadmapOrder failed:', error);
    return { ok: false, errors: {}, formError: 'Couldn’t save this right now' };
  }

  revalidatePath('/roadmap');
  return { ok: true };
}
