'use client';

import { useRef, useState } from 'react';
import type { ActionResult } from '@/lib/household/actions';
import { formErrorOf, serverErrorsOf, useActionForm } from '@/lib/ui/useActionForm';

/** Add-a-ticker form for the watchlist. Mirrors `HouseholdForm`
 * (`src/components/setup/SetupSteps.tsx`) — single field, `useActionForm`, server
 * errors keyed by field name. No client-side format validation beyond "not blank": the
 * ticker regex lives once, server-side in `src/lib/stocks/actions.ts`'s `parseTicker`,
 * and duplicating it here for a one-field form isn't worth the two-copies-to-drift
 * risk `AccountForm`'s heavier mirroring is worth for its much larger form. */
export function WatchlistForm({ action }: { action: (formData: FormData) => Promise<ActionResult> }) {
  const [ticker, setTicker] = useState('');

  // What was actually submitted, captured at submit time — `onSuccess` clears the field
  // only if the user hasn't since typed something new while that submission was still
  // in flight. Found by real browser testing: unconditionally clearing on success races
  // a second, fast edit — e.g. re-submitting an already-watched ticker (a legitimate
  // no-op success) while the user has already started typing the *next* ticker wipes
  // out what they just typed the moment the first request resolves.
  const submittedTicker = useRef('');
  const { state, pending, onSubmit } = useActionForm(action, {
    onSuccess: () => setTicker((current) => (current === submittedTicker.current ? '' : current)),
  });
  const serverErrors = serverErrorsOf(state);

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    submittedTicker.current = ticker;
    onSubmit(event);
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      {formErrorOf(state) ? (
        <p role="alert" className="text-sm text-clay">
          {formErrorOf(state)}
        </p>
      ) : null}
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label htmlFor="watchlist-ticker" className="block text-sm font-medium text-content">
            Add a ticker
          </label>
          <input
            id="watchlist-ticker"
            name="ticker"
            value={ticker}
            onChange={(event) => setTicker(event.target.value.toUpperCase())}
            placeholder="AAPL"
            className="mt-1.5 min-h-[44px] w-40 rounded-lg border border-line-strong bg-paper px-3 text-sm text-content outline-none transition focus:border-brass"
          />
          {serverErrors.ticker ? (
            <p role="alert" className="mt-1 text-xs text-clay">
              {serverErrors.ticker}
            </p>
          ) : null}
        </div>
        <button
          type="submit"
          disabled={pending}
          className="inline-flex min-h-[44px] items-center rounded-lg bg-ink-950 px-5 text-sm font-medium text-content-ink transition enabled:hover:bg-ink-800 disabled:cursor-not-allowed disabled:opacity-45 dark:bg-brass dark:text-ink-950"
        >
          {pending ? 'Adding…' : 'Add'}
        </button>
      </div>
    </form>
  );
}
