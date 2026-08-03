'use client';

import { useCallback, useState } from 'react';
import { validateRegularContribution } from '@/lib/accounts/validation';
import type { ActionResult } from '@/lib/household/actions';
import { formErrorOf, serverErrorsOf, useActionForm } from '@/lib/ui/useActionForm';

/**
 * Regular (annual) contributions into a non-pension account — the follow-up to Phase
 * 4.4's pension accumulation phase, covering everywhere else money regularly goes:
 * a Cash ISA standing order, a GIA/S&S ISA/LISA regular purchase. Mirrors
 * `HoldingsPanel`'s list + inline add/edit form exactly, just with fewer fields.
 *
 * One component for both account shapes rather than two: `allowTicker` hides the
 * ticker field (and shows every row as "Cash") for `cash`/`cash_isa` accounts, which
 * never hold a `holding` row to attach a ticker to.
 */

export interface RegularContributionView {
  id: number;
  /** null = a plain cash contribution to the account's balance, shown as "Cash". */
  ticker: string | null;
  /** Pre-formatted, e.g. "£2,400/year". */
  amount: string;
  /** Plain decimal (e.g. "2400.00"), for prefilling the edit form. */
  amountRaw: string;
}

function AddButton({ disabled, pending }: { disabled: boolean; pending: boolean }) {
  return (
    <button
      type="submit"
      disabled={disabled || pending}
      className="inline-flex min-h-[44px] items-center rounded-lg border border-line-strong px-4 text-sm font-medium text-content-muted transition enabled:hover:border-brass enabled:hover:text-content disabled:cursor-not-allowed disabled:opacity-45"
    >
      {pending ? 'Adding…' : 'Add regular contribution'}
    </button>
  );
}

export function RegularContributionsPanel({
  accountId,
  contributions,
  addAction,
  editAction,
  deleteAction,
  allowTicker,
}: {
  accountId: number;
  contributions: RegularContributionView[];
  addAction: (formData: FormData) => Promise<ActionResult>;
  editAction: (formData: FormData) => Promise<ActionResult>;
  /** Bare `<form action>`, so it returns void — a single-button form has nothing to render. */
  deleteAction: (formData: FormData) => Promise<void>;
  allowTicker: boolean;
}) {
  const [adding, setAdding] = useState(false);
  const [values, setValues] = useState({ ticker: '', amount: '' });
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const onSuccess = useCallback(() => {
    setValues({ ticker: '', amount: '' });
    setTouched({});
    setAdding(false);
  }, []);
  const { state, pending, onSubmit } = useActionForm(addAction, { onSuccess });

  const [editingId, setEditingId] = useState<number | null>(null);
  const [editValues, setEditValues] = useState({ ticker: '', amount: '' });
  const [editTouched, setEditTouched] = useState<Record<string, boolean>>({});
  const stopEditing = useCallback(() => setEditingId(null), []);
  const startEditing = useCallback((contribution: RegularContributionView) => {
    setEditingId(contribution.id);
    setEditValues({ ticker: contribution.ticker ?? '', amount: contribution.amountRaw });
    setEditTouched({});
  }, []);
  const {
    state: editState,
    pending: editPending,
    onSubmit: onEditSubmit,
  } = useActionForm(editAction, { onSuccess: stopEditing });
  const editValidation = validateRegularContribution(editValues);
  const editServerErrors = serverErrorsOf(editState);
  const editLiveErrors = editValidation.ok ? {} : editValidation.errors;
  const editErrorFor = (field: string) =>
    editServerErrors[field] ?? (editTouched[field] ? editLiveErrors[field] : undefined);

  const validation = validateRegularContribution(values);
  const serverErrors = serverErrorsOf(state);
  const liveErrors = validation.ok ? {} : validation.errors;
  const errorFor = (field: string) => serverErrors[field] ?? (touched[field] ? liveErrors[field] : undefined);

  const inputClass =
    'w-full min-h-[44px] rounded-lg border border-line-strong bg-paper px-3 text-sm text-content outline-none transition focus:border-brass';

  return (
    <section className="rounded-card border border-line bg-paper-raised p-5 shadow-card sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-serif text-lg text-content">Regular contributions</h2>
          <p className="mt-0.5 text-xs text-content-faint">
            {allowTicker
              ? 'What you regularly pay into this account — a specific holding, or cash sitting uninvested. Feeds the retirement planner’s projections.'
              : 'What you regularly pay into this account. Feeds the retirement planner’s projections.'}
          </p>
        </div>
        {!adding ? (
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="inline-flex min-h-[36px] items-center gap-1.5 rounded-lg border border-line-strong px-3 text-xs font-medium text-content-muted transition hover:border-brass hover:text-content"
          >
            <span aria-hidden="true">+</span> Add
          </button>
        ) : null}
      </div>

      {contributions.length === 0 && !adding ? (
        <p className="mt-5 text-sm text-content-muted">No regular contributions recorded yet.</p>
      ) : null}

      {contributions.length > 0 ? (
        <ul className="mt-4 space-y-1.5">
          {contributions.map((contribution) =>
            editingId === contribution.id ? (
              <li key={contribution.id} className="rounded-lg border border-line bg-paper px-4 py-3">
                <form onSubmit={onEditSubmit}>
                  <input type="hidden" name="contributionId" value={contribution.id} />
                  <input type="hidden" name="accountId" value={accountId} />

                  {formErrorOf(editState) ? (
                    <div role="alert" className="mb-3 rounded-lg border border-clay/50 bg-clay-bg px-3 py-2 text-xs text-clay">
                      {formErrorOf(editState)}
                    </div>
                  ) : null}

                  <div className={`grid gap-3 ${allowTicker ? 'sm:grid-cols-2' : ''}`}>
                    {allowTicker ? (
                      <div>
                        <label htmlFor={`edit-rc-ticker-${contribution.id}`} className="block text-xs font-medium text-content">
                          Ticker (blank for cash)
                        </label>
                        <input
                          id={`edit-rc-ticker-${contribution.id}`}
                          name="ticker"
                          value={editValues.ticker}
                          onChange={(event) => setEditValues((c) => ({ ...c, ticker: event.target.value }))}
                          onBlur={() => setEditTouched((c) => ({ ...c, ticker: true }))}
                          className={`${inputClass} mt-1`}
                        />
                        {editErrorFor('ticker') ? (
                          <p role="alert" className="mt-1 text-xs text-clay">
                            {editErrorFor('ticker')}
                          </p>
                        ) : null}
                      </div>
                    ) : null}

                    <div>
                      <label htmlFor={`edit-rc-amount-${contribution.id}`} className="block text-xs font-medium text-content">
                        Amount per year
                      </label>
                      <input
                        id={`edit-rc-amount-${contribution.id}`}
                        name="amount"
                        inputMode="decimal"
                        value={editValues.amount}
                        onChange={(event) => setEditValues((c) => ({ ...c, amount: event.target.value }))}
                        onBlur={() => setEditTouched((c) => ({ ...c, amount: true }))}
                        className={`${inputClass} tabular mt-1`}
                      />
                      {editErrorFor('amount') ? (
                        <p role="alert" className="mt-1 text-xs text-clay">
                          {editErrorFor('amount')}
                        </p>
                      ) : null}
                    </div>
                  </div>

                  <div className="mt-3 flex items-center gap-3">
                    <button
                      type="submit"
                      disabled={!editValidation.ok || editPending}
                      className="inline-flex min-h-[36px] items-center rounded-lg border border-line-strong px-3 text-xs font-medium text-content-muted transition enabled:hover:border-brass enabled:hover:text-content disabled:cursor-not-allowed disabled:opacity-45"
                    >
                      {editPending ? 'Saving…' : 'Save'}
                    </button>
                    <button
                      type="button"
                      onClick={stopEditing}
                      className="min-h-[36px] px-2 text-xs text-content-muted transition hover:text-content"
                    >
                      Cancel
                    </button>
                  </div>
                </form>
              </li>
            ) : (
              <li
                key={contribution.id}
                className="flex items-center justify-between gap-3 rounded-lg border border-line bg-paper px-4 py-3"
              >
                <div className="text-sm">
                  <span className="font-medium text-content">{contribution.ticker ?? 'Cash'}</span>
                  <span className="ml-2 tabular text-content-muted">{contribution.amount}</span>
                </div>
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={() => startEditing(contribution)}
                    className="text-xs text-content-faint underline underline-offset-2 transition hover:text-content"
                  >
                    Edit
                  </button>
                  <form action={deleteAction}>
                    <input type="hidden" name="contributionId" value={contribution.id} />
                    <input type="hidden" name="accountId" value={accountId} />
                    <button
                      type="submit"
                      className="text-xs text-content-faint underline underline-offset-2 transition hover:text-clay"
                    >
                      Remove
                    </button>
                  </form>
                </div>
              </li>
            ),
          )}
        </ul>
      ) : null}

      {adding ? (
        <form onSubmit={onSubmit} className="mt-5 border-t border-line pt-5">
          <input type="hidden" name="accountId" value={accountId} />

          {formErrorOf(state) ? (
            <div role="alert" className="mb-4 rounded-lg border border-clay/50 bg-clay-bg px-3 py-2 text-sm text-clay">
              {formErrorOf(state)}
            </div>
          ) : null}

          <div className={`grid gap-4 ${allowTicker ? 'sm:grid-cols-2' : ''}`}>
            {allowTicker ? (
              <div>
                <label htmlFor="rc-ticker" className="block text-sm font-medium text-content">
                  Ticker (blank for cash)
                </label>
                <input
                  id="rc-ticker"
                  name="ticker"
                  value={values.ticker}
                  onChange={(event) => setValues((c) => ({ ...c, ticker: event.target.value }))}
                  onBlur={() => setTouched((c) => ({ ...c, ticker: true }))}
                  placeholder="VWRL"
                  className={`${inputClass} mt-1.5`}
                />
                {errorFor('ticker') ? (
                  <p role="alert" className="mt-1 text-xs text-clay">
                    {errorFor('ticker')}
                  </p>
                ) : null}
              </div>
            ) : null}

            <div>
              <label htmlFor="rc-amount" className="block text-sm font-medium text-content">
                Amount per year
              </label>
              <input
                id="rc-amount"
                name="amount"
                inputMode="decimal"
                value={values.amount}
                onChange={(event) => setValues((c) => ({ ...c, amount: event.target.value }))}
                onBlur={() => setTouched((c) => ({ ...c, amount: true }))}
                placeholder="2400"
                className={`${inputClass} tabular mt-1.5`}
              />
              {errorFor('amount') ? (
                <p role="alert" className="mt-1 text-xs text-clay">
                  {errorFor('amount')}
                </p>
              ) : null}
            </div>
          </div>

          <div className="mt-4 flex items-center gap-3">
            <AddButton disabled={!validation.ok} pending={pending} />
            <button
              type="button"
              onClick={() => setAdding(false)}
              className="min-h-[44px] px-2 text-sm text-content-muted transition hover:text-content"
            >
              Cancel
            </button>
          </div>
        </form>
      ) : null}
    </section>
  );
}
