'use client';

import { useMemo, useState } from 'react';
import { parseMoneyInput } from '@/lib/money';

const inputClass =
  'w-full min-h-[44px] rounded-lg border border-line-strong bg-paper px-3 text-sm text-content outline-none transition focus:border-brass tabular';

/**
 * "How much extra do I have this month" — a single-field GET form, not a Server
 * Action. Unlike `DcfForm.tsx` (which persists assumptions worth remembering per
 * ticker on revisit), this number is a one-off that goes stale immediately and has
 * nowhere to live — a plain `<form method="GET">` to `/advisor` is `retirement/
 * compare/page.tsx`'s own established pattern for a read-only view parameterized by
 * query string, and needs no JS at all for the navigation itself (only for the live
 * validation UX below). Live-validates via the real `parseMoneyInput` — the same "one
 * set of rules, not two" discipline every form in this codebase already follows —
 * rather than duplicating its checks.
 */
export function ExtraAmountForm({ initialValue }: { initialValue: string }) {
  const [value, setValue] = useState(initialValue);

  const validation = useMemo(() => parseMoneyInput(value), [value]);

  return (
    <form method="GET" action="/advisor" className="rounded-card border border-line bg-paper-raised p-5 shadow-card sm:p-6">
      <label htmlFor="advisor-extra" className="block text-sm font-medium text-content">
        How much extra do you have to allocate?
      </label>
      <p className="mt-0.5 text-xs text-content-faint">
        A one-off or monthly amount — whatever you’re deciding where to put right now.
      </p>
      <div className="mt-3 flex flex-wrap items-end gap-3">
        <input
          id="advisor-extra"
          name="extra"
          inputMode="decimal"
          value={value}
          onChange={(event) => setValue(event.target.value)}
          className={`max-w-[12rem] ${inputClass}`}
          aria-invalid={!validation.ok && value.trim() !== ''}
        />
        <button
          type="submit"
          disabled={!validation.ok}
          className="inline-flex min-h-[44px] items-center rounded-lg bg-ink-950 px-5 text-sm font-medium text-content-ink transition enabled:hover:bg-ink-800 disabled:cursor-not-allowed disabled:opacity-45 dark:bg-brass dark:text-ink-950"
        >
          Show recommendations
        </button>
      </div>
      {!validation.ok && value.trim() !== '' ? (
        <p className="mt-2 text-xs text-clay">Enter a plain amount, e.g. 500 or 500.00.</p>
      ) : null}
    </form>
  );
}
