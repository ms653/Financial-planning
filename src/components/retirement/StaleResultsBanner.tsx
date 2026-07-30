'use client';

/**
 * The Results screen's stale-after-edit state — a "stronger signal than mere staleness:
 * it means the *inputs* changed, not just time passing" per `docs/DESIGN_SPEC.md`, which
 * is why this is a persistent banner (`role="status"`, tone-keyed like
 * `BackupWarningStrip`) rather than the passive `FreshnessLine` badge used elsewhere for
 * "just old" data. Exact copy from the spec's own copy table.
 *
 * Distinct from the Scenario Editor's own dirty-state message ("Assumptions changed —
 * results below are from your last run") — that one reports *unsaved, in-progress* form
 * edits; this one reports that the scenario's *saved* assumptions have moved on from its
 * last completed run, which can happen from another device/tab too.
 */

export function StaleResultsBanner({ onRerun, rerunning }: { onRerun: () => void; rerunning: boolean }) {
  return (
    <div
      role="status"
      className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-card border border-clay/50 bg-clay-bg px-4 py-3 text-sm text-clay"
    >
      <span>These results are from before your last change</span>
      <button
        type="button"
        onClick={onRerun}
        disabled={rerunning}
        className="inline-flex min-h-[36px] items-center rounded-lg border border-clay/60 px-3 text-sm font-medium transition hover:bg-clay/10 disabled:opacity-60"
      >
        {rerunning ? 'Starting…' : 'Re-run to update'}
      </button>
    </div>
  );
}
