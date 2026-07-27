'use client';

import { useCallback, useState } from 'react';
import { validateBalanceUpdate } from '@/lib/accounts/validation';
import type { AccountTypeValue } from '@/lib/db/schema';
import type { ActionResult } from '@/lib/household/actions';
import { formErrorOf, serverErrorsOf, useActionForm } from '@/lib/ui/useActionForm';

/**
 * Every dated balance entry for an account, editable and removable in place.
 *
 * `UpdateBalanceDrawer` already upserts on `(account_id, snapshot_date)` — resubmitting
 * with the same date silently corrects that day's figure. That's real, but it isn't
 * discoverable (you have to already know the exact date to overwrite), and it can't
 * retarget an entry to a *different* date at all. This panel makes the existing history
 * visible and gives each entry its own Edit/Remove, the same interaction shape as
 * `HoldingsPanel`: one row editable at a time, inline.
 *
 * Deliberately additive, not a replacement for the drawer — that stays the way to record
 * a *new* figure (usually today's); this is for reviewing and correcting what's already
 * there.
 */

export interface BalanceHistoryEntryView {
  id: number;
  /** Pre-formatted for display, e.g. "£12,500.00" (or the debt "amount outstanding"
   * convention — always positive — for a debt account, matching the account header). */
  amount: string;
  /** Plain decimal for prefilling the edit input, in the same sign convention the form
   * expects as input (positive "outstanding" for debt, matching `costBasisRaw`'s role
   * in `HoldingsPanel`). */
  amountRaw: string;
  /** ISO date, e.g. "2026-07-20". */
  snapshotDate: string;
}

export function BalanceHistoryPanel({
  accountId,
  accountType,
  entries,
  editAction,
  deleteAction,
  today,
}: {
  accountId: number;
  accountType: AccountTypeValue;
  entries: BalanceHistoryEntryView[];
  editAction: (formData: FormData) => Promise<ActionResult>;
  /** Bare `<form action>`, so it returns void — a single-button form has nothing to render. */
  deleteAction: (formData: FormData) => Promise<void>;
  today: string;
}) {
  // Only one row editable at a time — same "one thing open" posture as HoldingsPanel.
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editValues, setEditValues] = useState({ amount: '', snapshotDate: today });
  const [editTouched, setEditTouched] = useState<Record<string, boolean>>({});
  const stopEditing = useCallback(() => setEditingId(null), []);
  const startEditing = useCallback((entry: BalanceHistoryEntryView) => {
    setEditingId(entry.id);
    setEditValues({ amount: entry.amountRaw, snapshotDate: entry.snapshotDate });
    setEditTouched({});
  }, []);
  const {
    state: editState,
    pending: editPending,
    onSubmit: onEditSubmit,
  } = useActionForm(editAction, { onSuccess: stopEditing });
  const editValidation = validateBalanceUpdate(editValues, accountType);
  const editServerErrors = serverErrorsOf(editState);
  const editLiveErrors = editValidation.ok ? {} : editValidation.errors;
  const editErrorFor = (field: string) =>
    editServerErrors[field] ?? (editTouched[field] ? editLiveErrors[field] : undefined);

  const isDebt = accountType === 'debt';
  const inputClass =
    'w-full min-h-[44px] rounded-lg border border-line-strong bg-paper px-3 text-sm text-content outline-none transition focus:border-brass';

  return (
    <section className="rounded-card border border-line bg-paper-raised p-5 shadow-card sm:p-6">
      <h2 className="font-serif text-lg text-content">Balance history</h2>
      <p className="mt-0.5 text-xs text-content-faint">
        Every balance recorded for this account. Edit a figure or its date, or remove an
        entry that shouldn’t be here.
      </p>

      {entries.length === 0 ? (
        <p className="mt-5 text-sm text-content-muted">No balance recorded yet.</p>
      ) : (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[420px] text-sm">
            <thead>
              <tr className="border-b border-line text-left text-[11px] uppercase tracking-wider text-content-faint">
                <th scope="col" className="pb-2 font-medium">
                  Date
                </th>
                <th scope="col" className="pb-2 text-right font-medium">
                  {isDebt ? 'Outstanding' : 'Balance'}
                </th>
                <th scope="col" className="pb-2 text-right font-medium">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {entries.map((entry) =>
                editingId === entry.id ? (
                  <tr key={entry.id} className="border-b border-line last:border-b-0">
                    <td colSpan={3} className="py-3">
                      <form onSubmit={onEditSubmit}>
                        <input type="hidden" name="snapshotId" value={entry.id} />
                        <input type="hidden" name="accountId" value={accountId} />

                        {formErrorOf(editState) ? (
                          <div
                            role="alert"
                            className="mb-3 rounded-lg border border-clay/50 bg-clay-bg px-3 py-2 text-xs text-clay"
                          >
                            {formErrorOf(editState)}
                          </div>
                        ) : null}

                        <div className="grid gap-3 sm:grid-cols-2">
                          <div>
                            <label
                              htmlFor={`edit-balance-amount-${entry.id}`}
                              className="block text-xs font-medium text-content"
                            >
                              {isDebt ? 'Amount outstanding' : 'Balance'}
                            </label>
                            <input
                              id={`edit-balance-amount-${entry.id}`}
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

                          <div>
                            <label
                              htmlFor={`edit-balance-date-${entry.id}`}
                              className="block text-xs font-medium text-content"
                            >
                              As of
                            </label>
                            <input
                              id={`edit-balance-date-${entry.id}`}
                              name="snapshotDate"
                              type="date"
                              max={today}
                              value={editValues.snapshotDate}
                              onChange={(event) =>
                                setEditValues((c) => ({ ...c, snapshotDate: event.target.value }))
                              }
                              onBlur={() => setEditTouched((c) => ({ ...c, snapshotDate: true }))}
                              className={`${inputClass} tabular mt-1`}
                            />
                            {editErrorFor('snapshotDate') ? (
                              <p role="alert" className="mt-1 text-xs text-clay">
                                {editErrorFor('snapshotDate')}
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
                    </td>
                  </tr>
                ) : (
                  <tr key={entry.id} className="border-b border-line last:border-b-0">
                    <td className="tabular py-2.5 text-content">{entry.snapshotDate}</td>
                    <td className="tabular py-2.5 text-right text-content-muted">{entry.amount}</td>
                    <td className="py-2.5 text-right">
                      <div className="flex items-center justify-end gap-3">
                        <button
                          type="button"
                          onClick={() => startEditing(entry)}
                          className="text-xs text-content-faint underline underline-offset-2 transition hover:text-content"
                        >
                          Edit
                        </button>
                        <form action={deleteAction}>
                          <input type="hidden" name="snapshotId" value={entry.id} />
                          <input type="hidden" name="accountId" value={accountId} />
                          <button
                            type="submit"
                            className="text-xs text-content-faint underline underline-offset-2 transition hover:text-clay"
                          >
                            Remove
                          </button>
                        </form>
                      </div>
                    </td>
                  </tr>
                ),
              )}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
