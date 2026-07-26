'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { validateBalanceUpdate } from '@/lib/accounts/validation';
import type { AccountTypeValue } from '@/lib/db/schema';
import type { ActionResult } from '@/lib/household/actions';
import { formErrorOf, serverErrorsOf, useActionForm } from '@/lib/ui/useActionForm';

/**
 * "Update balance", as an in-page drawer.
 *
 * DESIGN_SPEC.md: "'Update balance' opens the Manual balance update flow as an in-page drawer
 * (not full navigation) — the user shouldn't lose their place on the detail screen for such a
 * lightweight action." And from the accessibility requirements: "Modals/drawers (Manual balance
 * update) trap focus and return it to the triggering element on close."
 *
 * Both are implemented here: focus moves to the amount field on open, Escape and the backdrop
 * close it, Tab cycles within the panel, and focus returns to the button that opened it.
 *
 * What this deliberately is *not*: optimistic. The spec's flow describes the write appearing
 * immediately with a "syncing" indicator, and the proposal describes a queue behind it — but
 * both belong to the offline layer, which is **Phase 6**. Phase 1 does a plain server round
 * trip, which is honest: with no write queue there is nothing to be optimistic on behalf of,
 * and a "pending sync" indicator that never had a queue would be theatre.
 */

function SubmitButton({ disabled, pending }: { disabled: boolean; pending: boolean }) {
  return (
    <button
      type="submit"
      disabled={disabled || pending}
      className="inline-flex min-h-[44px] items-center rounded-lg bg-ink-950 px-5 text-sm font-medium text-content-ink transition enabled:hover:bg-ink-800 disabled:cursor-not-allowed disabled:opacity-45 dark:bg-brass dark:text-ink-950"
    >
      {pending ? 'Saving…' : 'Save balance'}
    </button>
  );
}

export function UpdateBalanceDrawer({
  accountId,
  accountName,
  accountType,
  action,
  today,
}: {
  accountId: number;
  accountName: string;
  accountType: AccountTypeValue;
  action: (formData: FormData) => Promise<ActionResult>;
  today: string;
}) {
  const [open, setOpen] = useState(false);
  const [values, setValues] = useState({ amount: '', snapshotDate: today });
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const onSuccess = useCallback(() => {
    setOpen(false);
    setValues({ amount: '', snapshotDate: today });
    setTouched({});
  }, [today]);
  const { state, pending, onSubmit } = useActionForm(action, { onSuccess });

  const panelRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const amountRef = useRef<HTMLInputElement>(null);

  const isDebt = accountType === 'debt';
  const validation = validateBalanceUpdate(values, accountType);
  const serverErrors = serverErrorsOf(state);
  const liveErrors = validation.ok ? {} : validation.errors;
  const errorFor = (field: string) =>
    serverErrors[field] ?? (touched[field] ? liveErrors[field] : undefined);

  useEffect(() => {
    if (open) {
      amountRef.current?.focus();
      return;
    }
    // Return focus to the trigger on close, as the accessibility requirements ask.
    triggerRef.current?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return;

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setOpen(false);
        return;
      }
      if (event.key !== 'Tab') return;

      // Focus trap: cycle within the panel rather than escaping to the page behind it.
      const focusable = panelRef.current?.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), select, a[href]',
      );
      if (!focusable || focusable.length === 0) return;
      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open]);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex min-h-[44px] items-center rounded-lg bg-ink-950 px-4 text-sm font-medium text-content-ink transition hover:bg-ink-800 dark:bg-brass dark:text-ink-950"
      >
        Update balance
      </button>

      {open ? (
        <div className="fixed inset-0 z-30 flex items-end justify-center sm:items-center">
          <div
            aria-hidden="true"
            onClick={() => setOpen(false)}
            className="absolute inset-0 bg-ink-950/40"
          />

          <div
            ref={panelRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="update-balance-title"
            className="relative w-full max-w-md rounded-t-card border border-line bg-paper-raised p-5 shadow-card sm:rounded-card"
          >
            <h2 id="update-balance-title" className="font-serif text-lg text-content">
              Update balance
            </h2>
            <p className="mt-1 text-xs text-content-faint">{accountName}</p>

            <form onSubmit={onSubmit} className="mt-5 space-y-4">
              <input type="hidden" name="accountId" value={accountId} />

              {formErrorOf(state) ? (
                <div role="alert" className="rounded-lg border border-clay/50 bg-clay-bg px-3 py-2 text-sm text-clay">
                  {formErrorOf(state)}
                </div>
              ) : null}

              <div>
                <label htmlFor="balance-amount" className="block text-sm font-medium text-content">
                  {isDebt ? 'Amount outstanding' : 'New balance'}
                </label>
                {isDebt ? (
                  <p className="mt-0.5 text-xs text-content-faint">
                    What you still owe, as a positive number.
                  </p>
                ) : null}
                <input
                  ref={amountRef}
                  id="balance-amount"
                  name="amount"
                  inputMode="decimal"
                  value={values.amount}
                  onChange={(event) => setValues((c) => ({ ...c, amount: event.target.value }))}
                  onBlur={() => setTouched((c) => ({ ...c, amount: true }))}
                  aria-invalid={errorFor('amount') ? true : undefined}
                  placeholder="12500"
                  className="tabular mt-1.5 w-full min-h-[44px] rounded-lg border border-line-strong bg-paper px-3 text-sm text-content outline-none transition focus:border-brass"
                />
                {errorFor('amount') ? (
                  <p role="alert" className="mt-1 text-xs text-clay">
                    {errorFor('amount')}
                  </p>
                ) : null}
              </div>

              <div>
                <label htmlFor="balance-date" className="block text-sm font-medium text-content">
                  As of
                </label>
                <p className="mt-0.5 text-xs text-content-faint">
                  Defaults to today. Entering the same date twice replaces that day’s figure.
                </p>
                <input
                  id="balance-date"
                  name="snapshotDate"
                  type="date"
                  max={today}
                  value={values.snapshotDate}
                  onChange={(event) => setValues((c) => ({ ...c, snapshotDate: event.target.value }))}
                  onBlur={() => setTouched((c) => ({ ...c, snapshotDate: true }))}
                  aria-invalid={errorFor('snapshotDate') ? true : undefined}
                  className="tabular mt-1.5 w-full min-h-[44px] rounded-lg border border-line-strong bg-paper px-3 text-sm text-content outline-none transition focus:border-brass"
                />
                {errorFor('snapshotDate') ? (
                  <p role="alert" className="mt-1 text-xs text-clay">
                    {errorFor('snapshotDate')}
                  </p>
                ) : null}
              </div>

              <div className="flex items-center gap-3 pt-1">
                <SubmitButton disabled={!validation.ok} pending={pending} />
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="min-h-[44px] px-2 text-sm text-content-muted transition hover:text-content"
                >
                  Cancel
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </>
  );
}
