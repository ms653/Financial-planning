import Link from 'next/link';

/**
 * The loading, empty and error states every list screen needs.
 *
 * DESIGN_SPEC.md specifies these per screen rather than leaving them to chance, and is
 * particular about two things this file exists to enforce:
 *  - **Skeletons, not spinners.** "skeleton for the total figure, chart, and account rows —
 *    not a full-page spinner, since this is the landing screen and should feel instant even
 *    on first paint."
 *  - **Error is distinct from empty.** "backend reachable but query failed — 'Couldn't load
 *    your net worth right now' with a retry button; distinct from the offline state." An
 *    empty state shown for a failed query would tell a household its accounts are gone.
 *
 * Copy is taken verbatim from the spec's Copy Decisions table where it specifies it.
 */

export function Skeleton({ className = '' }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={`block animate-pulse rounded bg-paper-sunken ${className}`}
    />
  );
}

/**
 * A block of skeleton rows.
 *
 * `aria-busy` with a polite live label, so a screen reader user is told the region is
 * loading instead of being read a set of meaningless empty boxes.
 */
export function SkeletonRows({ rows = 4, label }: { rows?: number; label: string }) {
  return (
    <div aria-busy="true" aria-label={label} className="space-y-2">
      {Array.from({ length: rows }, (_, index) => (
        <div key={index} className="flex items-center gap-3 rounded-card border border-line bg-paper-raised px-4 py-3.5">
          <Skeleton className="h-8 w-8 shrink-0 rounded-lg" />
          <div className="min-w-0 flex-1 space-y-1.5">
            <Skeleton className="h-3.5 w-1/3" />
            <Skeleton className="h-2.5 w-1/5" />
          </div>
          <Skeleton className="h-3.5 w-20" />
        </div>
      ))}
    </div>
  );
}

export function DashboardSkeleton() {
  return (
    <div className="space-y-5">
      <div className="rounded-card border border-line bg-paper-raised p-7 shadow-card" aria-busy="true" aria-label="Loading your net worth">
        <Skeleton className="h-3 w-28" />
        <Skeleton className="mt-3 h-11 w-64" />
        <Skeleton className="mt-3 h-3 w-40" />
        <Skeleton className="mt-6 h-[132px] w-full rounded-lg" />
      </div>
      <div className="rounded-card border border-line bg-paper-raised p-6 shadow-card">
        <Skeleton className="h-3 w-24" />
        <Skeleton className="mt-4 h-7 w-full rounded-full" />
      </div>
      <SkeletonRows rows={4} label="Loading your accounts" />
    </div>
  );
}

/**
 * Error state with a retry.
 *
 * The retry is a plain link to the same route rather than a client-side refetch: these are
 * server components, so re-requesting the page *is* the retry, and it needs no JavaScript to
 * work. Sub-copy stays non-technical per the spec ("avoid technical error text"), while the
 * real error goes to the server log where it's diagnosable.
 */
export function ErrorState({
  title = 'Couldn’t load this right now',
  detail,
  retryHref,
}: {
  title?: string;
  detail?: string;
  retryHref: string;
}) {
  return (
    <section
      role="alert"
      className="rounded-card border border-clay/50 bg-clay-bg px-5 py-6 text-clay"
    >
      <h2 className="font-serif text-lg">{title}</h2>
      {detail ? <p className="mt-1.5 text-sm opacity-90">{detail}</p> : null}
      <Link
        href={retryHref}
        className="mt-4 inline-flex min-h-[44px] items-center rounded-lg border border-clay/60 px-4 text-sm font-medium transition hover:bg-clay/10"
      >
        Try again
      </Link>
    </section>
  );
}

/**
 * Empty state with a single primary call to action.
 *
 * Used for the genuinely-zero-accounts case. Guided Setup should mean a household never sees
 * this, but "shouldn't normally happen" is not the same as "can't", and the spec asks for it
 * explicitly rather than leaving a blank screen.
 */
export function EmptyState({
  title,
  body,
  ctaLabel,
  ctaHref,
}: {
  title: string;
  body?: string;
  ctaLabel: string;
  ctaHref: string;
}) {
  return (
    <section className="rounded-card border border-line bg-paper-raised px-6 py-10 text-center shadow-card">
      <h2 className="font-serif text-xl text-content">{title}</h2>
      {body ? <p className="mx-auto mt-2 max-w-sm text-sm text-content-muted">{body}</p> : null}
      <Link
        href={ctaHref}
        className="mt-6 inline-flex min-h-[44px] items-center rounded-lg bg-ink-950 px-5 text-sm font-medium text-content-ink transition hover:bg-ink-800 dark:bg-brass dark:text-ink-950"
      >
        {ctaLabel}
      </Link>
    </section>
  );
}

/**
 * Freshness line: "Balances updated 2 hours ago".
 *
 * This is Phase 1's honest version of the design spec's Stale/Last-Synced Indicator. The
 * spec's component reports when the *device* last synced with the backend, which only means
 * something once Phase 6's offline cache exists. What Phase 1 can say truthfully is when the
 * household last updated a balance — which is the number that actually decides whether the
 * figure above it can be trusted, and it escalates in visual weight the older it gets, as
 * the spec asks ("a week-old net worth figure shown with the same subtlety as a
 * 5-minute-old one would be misleading").
 */
export function FreshnessLine({ capturedAt, now }: { capturedAt: Date | null; now: Date }) {
  if (!capturedAt) return null;

  const hours = Math.floor((now.getTime() - capturedAt.getTime()) / 3_600_000);
  const relative =
    hours < 1
      ? 'less than an hour ago'
      : hours === 1
        ? '1 hour ago'
        : hours < 48
          ? `${hours} hours ago`
          : `${Math.floor(hours / 24)} days ago`;

  // Quiet under a day, more visible past a day, clearly flagged past a week.
  const tone =
    hours >= 168 ? 'text-clay' : hours >= 24 ? 'text-content-muted' : 'text-content-faint';

  return (
    <p className={`mt-2 text-xs ${tone}`}>
      Balances last updated{' '}
      <time dateTime={capturedAt.toISOString()}>{relative}</time>
      {hours >= 168 ? ' — worth a refresh' : ''}
    </p>
  );
}
