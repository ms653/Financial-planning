'use client';

import { useState, useTransition } from 'react';
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { ActionResult } from '@/lib/household/actions';
import type { RoadmapItem } from '@/lib/roadmap/data';
import { RoadmapCard } from './RoadmapCard';

/**
 * Drag-and-drop reordering for the "Up next" roadmap items — `done` items never reach
 * this component at all (the page keeps them in a separate, static list), since
 * reordering something already shipped doesn't mean anything.
 *
 * Built on `@dnd-kit/core` + `@dnd-kit/sortable` rather than hand-rolled: unlike the
 * net worth chart's hover tooltip (genuinely simple — two SVG paths and a pointer
 * listener), accessible drag reordering — keyboard operation, screen-reader
 * announcements — is a different, harder problem, and this is exactly what a mature,
 * focused library exists for.
 *
 * `saveRoadmapOrder` takes a plain array (no form fields to serialize), so this calls
 * it directly inside `useTransition` rather than through `useActionForm` — the same
 * "form or plain action, whichever the shape of the data actually calls for" judgment
 * `PassphraseForm.tsx` already made for the same reason.
 */

function SortableRoadmapCard({ item, index, total }: { item: RoadmapItem; index: number; total: number }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: item.id });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <li
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      tabIndex={0}
      aria-roledescription="Draggable roadmap item"
      aria-label={`${item.title}, phase ${item.phaseLabel}. Position ${index + 1} of ${total}. Press space to pick up, arrow keys to move, space again to drop.`}
      className="cursor-grab touch-none rounded-card outline-none focus-visible:ring-2 focus-visible:ring-brass active:cursor-grabbing"
    >
      <RoadmapCard item={item} />
    </li>
  );
}

export function RoadmapBoard({
  items,
  action,
}: {
  items: RoadmapItem[];
  action: (itemIds: string[]) => Promise<ActionResult>;
}) {
  const initialOrder = items.map((item) => item.id);
  const [order, setOrder] = useState<string[]>(initialOrder);
  const [lastSavedOrder, setLastSavedOrder] = useState<string[]>(initialOrder);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const byId = new Map(items.map((item) => [item.id, item]));
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const oldIndex = order.indexOf(String(active.id));
    const newIndex = order.indexOf(String(over.id));
    const next = arrayMove(order, oldIndex, newIndex);
    setOrder(next);
    setError(null);

    startTransition(async () => {
      const result = await action(next);
      if (result.ok) {
        setLastSavedOrder(next);
      } else {
        // Revert to the last order that actually saved, not the page's original
        // props — those could be several successful reorders stale by now.
        setError(result.formError ?? 'Couldn’t save this right now');
        setOrder(lastSavedOrder);
      }
    });
  }

  return (
    <div>
      {error ? (
        <p role="alert" className="mt-2 text-sm text-clay">
          {error}
        </p>
      ) : null}
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={order} strategy={verticalListSortingStrategy}>
          <ul className="mt-4 space-y-3">
            {order.map((id, index) => {
              const item = byId.get(id);
              return item ? (
                <SortableRoadmapCard key={id} item={item} index={index} total={order.length} />
              ) : null;
            })}
          </ul>
        </SortableContext>
      </DndContext>
      {isPending ? <p className="mt-2 text-xs text-content-faint">Saving order…</p> : null}
    </div>
  );
}
