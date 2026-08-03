import { redirect } from 'next/navigation';
import { AppShell } from '@/components/AppShell';
import { RoadmapBoard } from '@/components/roadmap/RoadmapBoard';
import { RoadmapCard } from '@/components/roadmap/RoadmapCard';
import { getSetupState } from '@/lib/household/queries';
import { ROADMAP_ITEMS } from '@/lib/roadmap/data';
import { getRoadmapOrder, resolveRoadmapOrder } from '@/lib/roadmap/queries';
import { saveRoadmapOrder } from '@/lib/roadmap/actions';

/**
 * What's built, and what's next — a plain-language view of `docs/PROPOSAL.md`'s
 * Phased Delivery table (both come from the same `ROADMAP_ITEMS`, so they can't
 * silently drift apart — see `src/lib/roadmap/data.ts`'s own doc comment).
 *
 * "Done" items are listed but not draggable — reordering something already shipped
 * doesn't mean anything, so they're kept out of `RoadmapBoard` entirely rather than
 * rendered there disabled.
 */

export const dynamic = 'force-dynamic';

export default async function RoadmapPage() {
  const setup = await getSetupState();
  if (setup.householdId === null || setup.personCount === 0) redirect('/setup');

  const stored = await getRoadmapOrder();
  const ordered = resolveRoadmapOrder(stored, ROADMAP_ITEMS);
  const done = ordered.filter((item) => item.status === 'done');
  const upNext = ordered.filter((item) => item.status !== 'done');

  return (
    <AppShell pathname="/roadmap">
      <h1 className="font-serif text-3xl leading-tight text-content">Roadmap</h1>
      <p className="mt-2 max-w-2xl text-sm text-content-muted">
        What’s built, and what’s next. Drag “Up next” to reorder it by what matters
        most to you — a future session will check your reorder against what each item
        actually depends on before building, and say so if a reorder skips ahead of
        something it needs first.
      </p>

      <section className="mt-7 rounded-card border border-line bg-paper-raised p-5 shadow-card sm:p-6">
        <h2 className="font-serif text-lg text-content">Up next</h2>
        <p className="mt-0.5 text-xs text-content-faint">Drag a card to change its priority.</p>
        <RoadmapBoard items={upNext} action={saveRoadmapOrder} />
      </section>

      <section className="mt-6 rounded-card border border-line bg-paper-raised p-5 shadow-card sm:p-6">
        <h2 className="font-serif text-lg text-content">Done</h2>
        <ul className="mt-4 space-y-3">
          {done.map((item) => (
            <li key={item.id}>
              <RoadmapCard item={item} />
            </li>
          ))}
        </ul>
      </section>
    </AppShell>
  );
}
