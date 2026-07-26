import { DashboardSkeleton } from '@/components/ui/States';

/**
 * The dashboard's loading state.
 *
 * DESIGN_SPEC.md: "skeleton for the total figure, chart, and account rows — not a full-page
 * spinner, since this is the landing screen and should feel instant even on first paint."
 *
 * Next renders this while the page's server component awaits its queries. The app chrome is
 * deliberately not repeated here: the shell is rendered by the layout above, so the sidebar
 * stays put and only the content region swaps, which is what makes navigation feel immediate
 * rather than like a page load.
 */
export default function DashboardLoading() {
  return (
    <div className="mx-auto w-full max-w-4xl px-4 pb-24 pt-6 lg:px-8 lg:pb-14 lg:pt-10">
      <div className="mb-6">
        <span className="text-[11px] font-medium uppercase tracking-[0.14em] text-content-faint">
          Overview
        </span>
        <h1 className="font-serif text-3xl leading-tight text-content">Net worth</h1>
      </div>
      <DashboardSkeleton />
    </div>
  );
}
