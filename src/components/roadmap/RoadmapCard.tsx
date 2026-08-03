import type { RoadmapItem } from '@/lib/roadmap/data';

/** Server-safe, pure presentational — shared between the static "Done" list
 * (`/roadmap` page) and the draggable "Up next" list (`RoadmapBoard.tsx`), so the two
 * can never visually drift apart. */

const STATUS_STYLES: Record<RoadmapItem['status'], string> = {
  done: 'bg-sage-bg text-sage',
  'in-progress': 'bg-brass/15 text-brass-strong dark:text-brass',
  queued: 'bg-paper-sunken text-content-muted',
};

const STATUS_LABELS: Record<RoadmapItem['status'], string> = {
  done: 'Done',
  'in-progress': 'In progress',
  queued: 'Queued',
};

export function RoadmapCard({ item }: { item: RoadmapItem }) {
  return (
    <div className="rounded-card border border-line bg-paper p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-wider text-content-faint">Phase {item.phaseLabel}</p>
          <p className="mt-0.5 font-medium text-content">{item.title}</p>
        </div>
        <span
          className={`inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-[11px] font-medium ${STATUS_STYLES[item.status]}`}
        >
          {STATUS_LABELS[item.status]}
        </span>
      </div>
      <p className="mt-2 text-sm text-content-muted">{item.summary}</p>
    </div>
  );
}
