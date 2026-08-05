'use client';

import { useRef, useState } from 'react';
import type { DebtOrderingMode } from '@/lib/advisor/debtOrdering';

/**
 * Avalanche/snowball toggle over every household debt — structurally a near-copy of
 * `BreakdownPanel.tsx`'s segmented control: both orderings are computed once,
 * server-side, and handed over together, so switching is instant and needs no round
 * trip (a household's debt list is a few dozen bytes either way). Same WAI-ARIA tab
 * pattern, same arrow-key navigation. Amounts arrive pre-formatted as strings — money
 * arithmetic lives server-side in `src/lib/money.ts`, and `bigint` isn't serialisable
 * across the server/client boundary anyway.
 */

const MODES: readonly { value: DebtOrderingMode; label: string }[] = [
  { value: 'avalanche', label: 'Avalanche' },
  { value: 'snowball', label: 'Snowball' },
];

export interface DebtOrderRowView {
  accountId: number;
  name: string;
  balance: string;
  minimumPayment: string | null;
  interestRate: string | null;
}

export function DebtOrderToggle({
  orderings,
  initialMode = 'avalanche',
}: {
  orderings: Record<DebtOrderingMode, DebtOrderRowView[]>;
  initialMode?: DebtOrderingMode;
}) {
  const [mode, setMode] = useState<DebtOrderingMode>(initialMode);
  const buttonRefs = useRef<Array<HTMLButtonElement | null>>([]);

  const rows = orderings[mode];

  function onKeyDown(event: React.KeyboardEvent<HTMLButtonElement>, index: number) {
    const lastIndex = MODES.length - 1;
    let nextIndex: number | null = null;

    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') nextIndex = index === lastIndex ? 0 : index + 1;
    if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') nextIndex = index === 0 ? lastIndex : index - 1;
    if (event.key === 'Home') nextIndex = 0;
    if (event.key === 'End') nextIndex = lastIndex;
    if (nextIndex === null) return;

    event.preventDefault();
    const nextMode = MODES[nextIndex]!.value;
    setMode(nextMode);
    buttonRefs.current[nextIndex]?.focus();
  }

  return (
    <section
      aria-labelledby="debt-order-heading"
      className="rounded-card border border-line bg-paper-raised p-5 shadow-card sm:p-6"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 id="debt-order-heading" className="font-serif text-lg text-content">
            Debt payoff order
          </h2>
          <p className="mt-0.5 text-xs text-content-faint">
            {mode === 'avalanche'
              ? 'Highest interest rate first — mathematically optimal.'
              : 'Smallest balance first — for the psychological win of clearing one sooner.'}
          </p>
        </div>

        <div role="tablist" aria-label="Payoff order" className="flex gap-0.5 rounded-full bg-paper-sunken p-0.5">
          {MODES.map((option, index) => (
            <button
              key={option.value}
              ref={(element) => {
                buttonRefs.current[index] = element;
              }}
              type="button"
              role="tab"
              id={`debt-order-tab-${option.value}`}
              aria-selected={option.value === mode}
              aria-controls="debt-order-panel"
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

      <div id="debt-order-panel" role="tabpanel" aria-labelledby={`debt-order-tab-${mode}`}>
        {rows.length === 0 ? (
          <p className="mt-4 text-sm text-content-muted">No outstanding debt to order.</p>
        ) : (
          <ol className="mt-4 space-y-0.5">
            {rows.map((row, index) => (
              <li
                key={row.accountId}
                className="flex items-center gap-2.5 border-b border-line py-2 text-sm last:border-b-0"
              >
                <span className="w-5 shrink-0 text-content-faint">{index + 1}.</span>
                <span className="min-w-0 flex-1 truncate text-content">{row.name}</span>
                <span className="tabular text-xs text-content-faint">
                  {row.interestRate ? `${row.interestRate}%` : 'no rate'}
                </span>
                <span className="tabular font-medium text-content">{row.balance}</span>
              </li>
            ))}
          </ol>
        )}
      </div>
    </section>
  );
}
