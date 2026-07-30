/**
 * The "a simulation is running" region — replaces the headline/chart area on Results
 * (`docs/DESIGN_SPEC.md`: "animated... with elapsed-time-aware copy rather than a bare
 * spinner, since compute genuinely takes a few seconds, a spinner with no context reads
 * as broken past ~2 seconds") and is reused unchanged inside the Scenario Editor's
 * results-preview strip while *this tab's* run is in flight — the one Computing pattern
 * both screens share, per the spec's own instruction that Editor/Results/Comparison must
 * agree on what each state looks like.
 *
 * `role="status"` with `aria-live="polite"` on the whole region satisfies the spec's
 * live-region requirement for the Computing → Complete transition — a screen reader
 * hears "Running 2,000 simulations" once, then (once the parent swaps this out for the
 * completed result) hears whatever replaces it, with no separate wiring needed here.
 */

export function ComputingState({
  iterationCount,
  onCancel,
  canceling,
}: {
  iterationCount: number;
  onCancel?: () => void;
  canceling?: boolean;
}) {
  return (
    <div
      role="status"
      aria-live="polite"
      className="flex flex-col items-center gap-3 rounded-card border border-line bg-paper-raised px-6 py-10 text-center"
    >
      <span
        aria-hidden="true"
        className="h-8 w-8 animate-spin rounded-full border-2 border-line-strong border-t-brass"
      />
      <p className="text-sm font-medium text-content">
        Running {iterationCount.toLocaleString('en-GB')} simulations — this usually takes a few seconds
      </p>
      {onCancel ? (
        <button
          type="button"
          onClick={onCancel}
          disabled={canceling}
          className="mt-1 inline-flex min-h-[44px] items-center rounded-lg border border-line-strong px-4 text-sm font-medium text-content-muted transition hover:border-clay/60 hover:text-clay disabled:opacity-50"
        >
          {canceling ? 'Cancelling…' : 'Cancel'}
        </button>
      ) : null}
    </div>
  );
}
