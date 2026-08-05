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
  // This is a Server Action a modified client could call directly with an arbitrary
  // payload, not necessarily even an array — the type annotation above is a compile-time
  // hint, not a runtime guarantee. Checked *before* anything below touches `itemIds` as
  // an array (`.every`/`new Set` would otherwise throw on a non-array, and a thrown
  // error here has no `try` around it to catch it — the caller, `RoadmapBoard.tsx`'s
  // `startTransition`, has no `.catch` either, so an uncaught throw would leave the UI
  // silently showing the locally-reordered list as if it had saved, with nothing
  // actually written).
  if (!Array.isArray(itemIds) || !itemIds.every((id) => typeof id === 'string')) {
    return { ok: false, errors: {}, formError: 'That reorder didn’t look right — nothing was saved.' };
  }

  // A `done` item can't be dragged (see `RoadmapBoard.tsx`), and an id that isn't a
  // real `ROADMAP_ITEMS` id at all shouldn't be possible from the real UI — both
  // rejected here too. This specific mismatch (a well-formed payload that doesn't
  // match the *current* draggable set) has one extra likely cause worth naming: a
  // browser tab left open across a deploy that changed `ROADMAP_ITEMS` (a phase marked
  // done, a new one added) will always fail this check until reloaded, so the message
  // says so rather than the generic "didn't look right."
  const draggableIds = new Set(ROADMAP_ITEMS.filter((item) => item.status !== 'done').map((item) => item.id));
  const submittedIds = new Set(itemIds);
  const allValid = itemIds.every((id) => draggableIds.has(id));
  // `submittedIds.size` (not `itemIds.length`) catches a duplicate silently
  // compensating for a missing id — e.g. `[a, a, c]` for a real set of `{a, b, c}`
  // would otherwise pass a naive length check.
  if (!allValid || submittedIds.size !== draggableIds.size) {
    return {
      ok: false,
      errors: {},
      formError: 'This roadmap has changed since you loaded it — reload the page and try again.',
    };
  }

  const db = getDb();

  try {
    // Insert directly rather than a SELECT-then-branch: the previous check-then-act
    // shape let two concurrent first-ever saves both observe zero rows and both
    // attempt INSERT, so the second failed outright on the unique index with a
    // generic error instead of landing. `roadmap_order`'s singleton constraint
    // (`roadmap_order_singleton`, a `uniqueIndex` on `sql\`(true)\``) is the same
    // shape `household_singleton` already uses, and `createHousehold`
    // (`household/actions.ts`) already has this codebase's proven fix for exactly
    // this race: attempt the write, catch the resulting SQLSTATE 23505. Unlike
    // household creation, though, a conflict here means a row already exists that
    // this reorder genuinely needs to update — not "already done, discard."
    await db.insert(roadmapOrder).values({ itemIds });
  } catch (error) {
    const pgError = error as { code?: string; constraint?: string };
    if (pgError.code === '23505' && pgError.constraint === 'roadmap_order_singleton') {
      try {
        await db.update(roadmapOrder).set({ itemIds, updatedAt: new Date() });
      } catch (updateError) {
        console.error('[roadmap] saveRoadmapOrder update-after-conflict failed:', updateError);
        return { ok: false, errors: {}, formError: 'Couldn’t save this right now' };
      }
    } else {
      console.error('[roadmap] saveRoadmapOrder failed:', error);
      return { ok: false, errors: {}, formError: 'Couldn’t save this right now' };
    }
  }

  revalidatePath('/roadmap');
  return { ok: true };
}
