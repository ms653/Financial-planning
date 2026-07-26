'use client';

import { useRef, useState } from 'react';
import { BREAKDOWN_MODES, type BreakdownMode } from '@/lib/networth/breakdown';

/**
 * The breakdown panel: a segmented control over By person / By asset class / By tax wrapper,
 * plus a stacked bar and a legend.
 *
 * A client component for one specific reason from DESIGN_SPEC.md: "Tapping the breakdown
 * segmented control re-renders the chart in place (no navigation, no reload)." All three
 * groupings are computed on the server and handed over together, so switching is instant and
 * needs no request — the data for a household's accounts is a few dozen bytes either way, and
 * fetching per toggle would make an interaction the spec wants to feel immediate depend on a
 * round trip to a laptop that might be on the other end of a Tailscale link.
 *
 * Amounts arrive pre-formatted as strings. Deliberate: money arithmetic and formatting live
 * in src/lib/money.ts on the server, `bigint` isn't serialisable across the server/client
 * boundary anyway, and converting pence to a `number` just to render it is how float bugs get
 * into a financial UI.
 *
 * Keyboard support is a stated accessibility requirement: "the segmented breakdown control on
 * the Dashboard must be operable via arrow keys once focused, not mouse/touch-only". This is
 * the WAI-ARIA tab pattern — one tab stop for the group, arrows to move between options.
 */

export interface BreakdownSliceView {
  key: string;
  label: string;
  /** Pre-formatted, e.g. "£186,420" or "−£376,500". */
  amount: string;
  /** 0–1 share of the positive total, for the bar. Negative slices are 0. */
  share: number;
  negative: boolean;
}

/**
 * Segment colours. Cycled positionally rather than mapped per category, since the categories
 * differ between the three modes; negative slices always take the clay tone so a liability
 * reads consistently wherever it appears.
 */
const SWATCHES = ['var(--brass)', 'var(--sage)', '#8b9c8e', '#c9a876', 'var(--brass-strong)'];

function swatchFor(index: number, negative: boolean): string {
  return negative ? 'var(--clay)' : (SWATCHES[index % SWATCHES.length] as string);
}

export function BreakdownPanel({
  slices,
  initialMode,
}: {
  slices: Record<BreakdownMode, BreakdownSliceView[]>;
  initialMode: BreakdownMode;
}) {
  const [mode, setMode] = useState<BreakdownMode>(initialMode);
  const buttonRefs = useRef<Array<HTMLButtonElement | null>>([]);

  const current = slices[mode];
  const positives = current.filter((slice) => slice.share > 0);

  function onKeyDown(event: React.KeyboardEvent<HTMLButtonElement>, index: number) {
    const lastIndex = BREAKDOWN_MODES.length - 1;
    let nextIndex: number | null = null;

    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') nextIndex = index === lastIndex ? 0 : index + 1;
    if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') nextIndex = index === 0 ? lastIndex : index - 1;
    if (event.key === 'Home') nextIndex = 0;
    if (event.key === 'End') nextIndex = lastIndex;
    if (nextIndex === null) return;

    event.preventDefault();
    const nextMode = BREAKDOWN_MODES[nextIndex]!.value;
    setMode(nextMode);
    // Follow focus, so the arrow keys move the visible selection and the focus ring together.
    buttonRefs.current[nextIndex]?.focus();
  }

  return (
    <section
      aria-labelledby="breakdown-heading"
      className="rounded-card border border-line bg-paper-raised p-5 shadow-card sm:p-6"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="breakdown-heading" className="font-serif text-lg text-content">
          Breakdown
        </h2>

        <div role="tablist" aria-label="Breakdown by" className="flex gap-0.5 rounded-full bg-paper-sunken p-0.5">
          {BREAKDOWN_MODES.map((option, index) => (
            <button
              key={option.value}
              ref={(element) => {
                buttonRefs.current[index] = element;
              }}
              type="button"
              role="tab"
              id={`breakdown-tab-${option.value}`}
              aria-selected={option.value === mode}
              aria-controls="breakdown-panel"
              // Only the selected tab is in the tab order; arrows move within the group.
              tabIndex={option.value === mode ? 0 : -1}
              onClick={() => setMode(option.value)}
              onKeyDown={(event) => onKeyDown(event, index)}
              className={`min-h-[44px] rounded-full px-3.5 text-xs font-medium transition ${
                option.value === mode
                  ? 'bg-paper-raised text-content shadow-card'
                  : 'text-content-muted hover:text-content'
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      <div id="breakdown-panel" role="tabpanel" aria-labelledby={`breakdown-tab-${mode}`}>
        {current.length === 0 ? (
          <p className="mt-4 text-sm text-content-muted">Nothing to break down yet.</p>
        ) : (
          <>
            {/* The bar stacks positives only — a liability can't occupy width in a bar of what
                you own. It still appears in the legend below with its real figure, which is
                the pattern the mockup uses. Hidden from assistive tech because the legend
                immediately below carries the same information as text. */}
            <div
              aria-hidden="true"
              className="mt-5 flex h-7 gap-0.5 overflow-hidden rounded-full bg-paper-sunken"
            >
              {positives.map((slice) => (
                <div
                  key={slice.key}
                  style={{
                    width: `${(slice.share * 100).toFixed(2)}%`,
                    background: swatchFor(current.indexOf(slice), false),
                  }}
                />
              ))}
            </div>

            <ul className="mt-4 space-y-0.5">
              {current.map((slice, index) => (
                <li
                  key={slice.key}
                  className="flex items-center gap-2.5 border-b border-line py-2 text-sm last:border-b-0"
                >
                  <span
                    aria-hidden="true"
                    className="h-2.5 w-2.5 shrink-0 rounded-sm"
                    style={{ background: swatchFor(index, slice.negative) }}
                  />
                  <span className="min-w-0 flex-1 truncate text-content-muted">{slice.label}</span>
                  <span className={`tabular font-medium ${slice.negative ? 'text-clay' : 'text-content'}`}>
                    {slice.amount}
                  </span>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </section>
  );
}
