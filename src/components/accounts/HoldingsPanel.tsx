'use client';

import { useCallback, useState } from 'react';
import { validateHolding } from '@/lib/accounts/validation';
import type { ActionResult } from '@/lib/household/actions';
import { formErrorOf, serverErrorsOf, useActionForm } from '@/lib/ui/useActionForm';

/**
 * Holdings for an investment account.
 *
 * DESIGN_SPEC.md: "for investment-type accounts (GIA/ISA/SIPP), a holdings table (ticker,
 * quantity, cost basis, current value, gain/loss)."
 *
 * Phase 2 adds live current value and gain/loss, via `src/lib/portfolio/quotes.ts`'s
 * `valueHoldings` — but a price still isn't guaranteed for every row: a holding with no
 * `ALPHA_VANTAGE_API_KEY` configured, a provider outage, or a symbol the provider
 * genuinely has no quote for (the household's own OEIC holding, priced by NAV with no
 * exchange ticker, is exactly this case) all resolve to `currentValue: null`. That
 * renders as "Price unavailable," never a blank cell or a fabricated value — the same
 * honesty-over-guessing rule Phase 1 applied when this data didn't exist at all yet.
 *
 * DESIGN_SPEC.md's P1 spec kept rows read-only ("no accidental edit") since there was no
 * price data yet to make a typo costly to leave wrong. Phase 2 adds live valuation derived
 * from quantity and cost basis, so a wrong entry now visibly corrupts gain/loss too —
 * households asked for a way to fix one without deleting and re-adding it, which also loses
 * the original entry order. Edit opens the same fields as "Add holding", inline on the row,
 * behind an explicit tap rather than a click-to-edit cell, so it stays intentional.
 */

export interface HoldingGainLoss {
  /** Pre-formatted, e.g. "+£240.12" or "−£18.40". */
  amount: string;
  /** Pre-formatted percent vs. cost basis, e.g. "12.4%" — null when cost basis is zero. */
  percent: string | null;
  direction: 'up' | 'down' | 'flat';
}

export interface HoldingView {
  id: number;
  ticker: string;
  quantity: string;
  /** Pre-formatted on the server, so no money passes through a float here. */
  costBasis: string;
  /** Plain decimal (e.g. "6080.00"), for prefilling the edit form's input — the same shape
   * the add form's own input accepts, unlike `costBasis` which carries a currency symbol. */
  costBasisRaw: string;
  /** Pre-formatted, or null when no live price is available. */
  currentValue: string | null;
  gainLoss: HoldingGainLoss | null;
}

function AddButton({ disabled, pending }: { disabled: boolean; pending: boolean }) {
  return (
    <button
      type="submit"
      disabled={disabled || pending}
      className="inline-flex min-h-[44px] items-center rounded-lg border border-line-strong px-4 text-sm font-medium text-content-muted transition enabled:hover:border-brass enabled:hover:text-content disabled:cursor-not-allowed disabled:opacity-45"
    >
      {pending ? 'Adding…' : 'Add holding'}
    </button>
  );
}

export interface HoldingsTotalsView {
  /** Pre-formatted, sums every holding — cost basis is always known, never blocked on a price. */
  costBasis: string;
  /** Pre-formatted, or null when nothing priced at all (no provider, or every holding
   * unpriceable). Sums only the holdings that actually priced — see `unpricedCount`. */
  currentValue: string | null;
  gainLoss: HoldingGainLoss | null;
  /** Count of holdings excluded from `currentValue`/`gainLoss` because no price was
   * available. When > 0 and > 0 holdings did price, the totals are a partial sum, not the
   * whole account — flagged rather than silently understated. */
  unpricedCount: number;
}

export function HoldingsPanel({
  accountId,
  holdings,
  addAction,
  editAction,
  deleteAction,
  pricesAsOf,
  pricesStale,
  totals,
}: {
  accountId: number;
  holdings: HoldingView[];
  addAction: (formData: FormData) => Promise<ActionResult>;
  editAction: (formData: FormData) => Promise<ActionResult>;
  /** Bare `<form action>`, so it returns void — a single-button form has nothing to render. */
  deleteAction: (formData: FormData) => Promise<void>;
  /** Pre-formatted relative time, e.g. "2 hours ago" — null when no holding has a live
   * price at all (no provider configured, or nothing priceable yet). */
  pricesAsOf?: string | null;
  /** True when the freshest attempt to refresh a price failed and a cached value (or
   * none) is being shown instead — same "provider outage must not break the page"
   * posture as everywhere else this data is read. */
  pricesStale?: boolean;
  totals?: HoldingsTotalsView;
}) {
  const [adding, setAdding] = useState(false);
  const [values, setValues] = useState({ ticker: '', quantity: '', costBasis: '' });
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const onSuccess = useCallback(() => {
    setValues({ ticker: '', quantity: '', costBasis: '' });
    setTouched({});
    setAdding(false);
  }, []);
  const { state, pending, onSubmit } = useActionForm(addAction, { onSuccess });

  // Only one row editable at a time — same "one thing open" posture as the add form below
  // the table, so there's never more than one in-flight edit to reconcile.
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editValues, setEditValues] = useState({ ticker: '', quantity: '', costBasis: '' });
  const [editTouched, setEditTouched] = useState<Record<string, boolean>>({});
  const stopEditing = useCallback(() => setEditingId(null), []);
  const startEditing = useCallback((holding: HoldingView) => {
    setEditingId(holding.id);
    setEditValues({ ticker: holding.ticker, quantity: holding.quantity, costBasis: holding.costBasisRaw });
    setEditTouched({});
  }, []);
  const {
    state: editState,
    pending: editPending,
    onSubmit: onEditSubmit,
  } = useActionForm(editAction, { onSuccess: stopEditing });
  const editValidation = validateHolding(editValues);
  const editServerErrors = serverErrorsOf(editState);
  const editLiveErrors = editValidation.ok ? {} : editValidation.errors;
  const editErrorFor = (field: string) =>
    editServerErrors[field] ?? (editTouched[field] ? editLiveErrors[field] : undefined);

  const validation = validateHolding(values);
  const serverErrors = serverErrorsOf(state);
  const liveErrors = validation.ok ? {} : validation.errors;
  const errorFor = (field: string) =>
    serverErrors[field] ?? (touched[field] ? liveErrors[field] : undefined);

  const inputClass =
    'w-full min-h-[44px] rounded-lg border border-line-strong bg-paper px-3 text-sm text-content outline-none transition focus:border-brass';

  return (
    <section className="rounded-card border border-line bg-paper-raised p-5 shadow-card sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-serif text-lg text-content">Holdings</h2>
          <p className="mt-0.5 text-xs text-content-faint">
            {pricesAsOf
              ? `Quantity and cost basis entered manually. Prices as of ${pricesAsOf}${
                  pricesStale ? ' — couldn’t refresh just now' : ''
                }.`
              : 'Entered manually. Live prices arrive once a market-data provider is configured.'}
          </p>
        </div>
        {!adding ? (
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="inline-flex min-h-[36px] items-center gap-1.5 rounded-lg border border-line-strong px-3 text-xs font-medium text-content-muted transition hover:border-brass hover:text-content"
          >
            <span aria-hidden="true">+</span> Add holding
          </button>
        ) : null}
      </div>

      {holdings.length === 0 && !adding ? (
        <p className="mt-5 text-sm text-content-muted">No holdings added yet.</p>
      ) : null}

      {holdings.length > 0 ? (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[560px] text-sm">
            <thead>
              <tr className="border-b border-line text-left text-[11px] uppercase tracking-wider text-content-faint">
                <th scope="col" className="pb-2 font-medium">
                  Ticker
                </th>
                <th scope="col" className="pb-2 text-right font-medium">
                  Quantity
                </th>
                <th scope="col" className="pb-2 text-right font-medium">
                  Cost basis
                </th>
                <th scope="col" className="pb-2 text-right font-medium">
                  Current value
                </th>
                <th scope="col" className="pb-2 text-right font-medium">
                  Gain/loss
                </th>
                <th scope="col" className="pb-2 text-right font-medium">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {holdings.map((holding) =>
                editingId === holding.id ? (
                  <tr key={holding.id} className="border-b border-line last:border-b-0">
                    <td colSpan={6} className="py-3">
                      <form onSubmit={onEditSubmit}>
                        <input type="hidden" name="holdingId" value={holding.id} />
                        <input type="hidden" name="accountId" value={accountId} />

                        {formErrorOf(editState) ? (
                          <div
                            role="alert"
                            className="mb-3 rounded-lg border border-clay/50 bg-clay-bg px-3 py-2 text-xs text-clay"
                          >
                            {formErrorOf(editState)}
                          </div>
                        ) : null}

                        <div className="grid gap-3 sm:grid-cols-3">
                          <div>
                            <label htmlFor={`edit-ticker-${holding.id}`} className="block text-xs font-medium text-content">
                              Ticker
                            </label>
                            <input
                              id={`edit-ticker-${holding.id}`}
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

                          <div>
                            <label htmlFor={`edit-quantity-${holding.id}`} className="block text-xs font-medium text-content">
                              Quantity
                            </label>
                            <input
                              id={`edit-quantity-${holding.id}`}
                              name="quantity"
                              inputMode="decimal"
                              value={editValues.quantity}
                              onChange={(event) => setEditValues((c) => ({ ...c, quantity: event.target.value }))}
                              onBlur={() => setEditTouched((c) => ({ ...c, quantity: true }))}
                              className={`${inputClass} tabular mt-1`}
                            />
                            {editErrorFor('quantity') ? (
                              <p role="alert" className="mt-1 text-xs text-clay">
                                {editErrorFor('quantity')}
                              </p>
                            ) : null}
                          </div>

                          <div>
                            <label htmlFor={`edit-cost-${holding.id}`} className="block text-xs font-medium text-content">
                              Cost basis
                            </label>
                            <input
                              id={`edit-cost-${holding.id}`}
                              name="costBasis"
                              inputMode="decimal"
                              value={editValues.costBasis}
                              onChange={(event) => setEditValues((c) => ({ ...c, costBasis: event.target.value }))}
                              onBlur={() => setEditTouched((c) => ({ ...c, costBasis: true }))}
                              className={`${inputClass} tabular mt-1`}
                            />
                            {editErrorFor('costBasis') ? (
                              <p role="alert" className="mt-1 text-xs text-clay">
                                {editErrorFor('costBasis')}
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
                  <tr key={holding.id} className="border-b border-line last:border-b-0">
                    <td className="py-2.5 font-medium text-content">{holding.ticker}</td>
                    <td className="tabular py-2.5 text-right text-content-muted">{holding.quantity}</td>
                    <td className="tabular py-2.5 text-right text-content-muted">{holding.costBasis}</td>
                    <td className="tabular py-2.5 text-right text-content-muted">
                      {holding.currentValue ?? (
                        <span className="text-content-faint">Price unavailable</span>
                      )}
                    </td>
                    <td
                      className={`tabular py-2.5 text-right ${
                        holding.gainLoss?.direction === 'up'
                          ? 'text-sage'
                          : holding.gainLoss?.direction === 'down'
                            ? 'text-clay'
                            : 'text-content-muted'
                      }`}
                    >
                      {holding.gainLoss ? (
                        <>
                          {holding.gainLoss.amount}
                          {holding.gainLoss.percent ? (
                            <span className="ml-1 text-content-faint">
                              ({holding.gainLoss.percent}%)
                            </span>
                          ) : null}
                        </>
                      ) : (
                        <span className="text-content-faint">—</span>
                      )}
                    </td>
                    <td className="py-2.5 text-right">
                      <div className="flex items-center justify-end gap-3">
                        <button
                          type="button"
                          onClick={() => startEditing(holding)}
                          className="text-xs text-content-faint underline underline-offset-2 transition hover:text-content"
                        >
                          Edit
                        </button>
                        <form action={deleteAction}>
                          <input type="hidden" name="holdingId" value={holding.id} />
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
            {totals ? (
              <tfoot>
                <tr className="border-t border-line-strong font-medium">
                  <td className="py-2.5 text-content">Total</td>
                  <td />
                  <td className="tabular py-2.5 text-right text-content">{totals.costBasis}</td>
                  <td className="tabular py-2.5 text-right text-content">
                    {totals.currentValue ?? (
                      <span className="font-normal text-content-faint">Price unavailable</span>
                    )}
                  </td>
                  <td
                    className={`tabular py-2.5 text-right ${
                      totals.gainLoss?.direction === 'up'
                        ? 'text-sage'
                        : totals.gainLoss?.direction === 'down'
                          ? 'text-clay'
                          : 'text-content'
                    }`}
                  >
                    {totals.gainLoss ? (
                      <>
                        {totals.gainLoss.amount}
                        {totals.gainLoss.percent ? (
                          <span className="ml-1 font-normal text-content-faint">
                            ({totals.gainLoss.percent}%)
                          </span>
                        ) : null}
                      </>
                    ) : (
                      <span className="font-normal text-content-faint">—</span>
                    )}
                  </td>
                  <td />
                </tr>
              </tfoot>
            ) : null}
          </table>
        </div>
      ) : null}
      {totals && totals.unpricedCount > 0 && holdings.length > totals.unpricedCount ? (
        <p className="mt-2 text-xs text-content-faint">
          Total value and gain/loss exclude {totals.unpricedCount} holding
          {totals.unpricedCount === 1 ? '' : 's'} with no current price.
        </p>
      ) : null}

      {adding ? (
        <form onSubmit={onSubmit} className="mt-5 border-t border-line pt-5">
          <input type="hidden" name="accountId" value={accountId} />

          {formErrorOf(state) ? (
            <div role="alert" className="mb-4 rounded-lg border border-clay/50 bg-clay-bg px-3 py-2 text-sm text-clay">
              {formErrorOf(state)}
            </div>
          ) : null}

          <div className="grid gap-4 sm:grid-cols-3">
            <div>
              <label htmlFor="holding-ticker" className="block text-sm font-medium text-content">
                Ticker
              </label>
              <input
                id="holding-ticker"
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

            <div>
              <label htmlFor="holding-quantity" className="block text-sm font-medium text-content">
                Quantity
              </label>
              <input
                id="holding-quantity"
                name="quantity"
                inputMode="decimal"
                value={values.quantity}
                onChange={(event) => setValues((c) => ({ ...c, quantity: event.target.value }))}
                onBlur={() => setTouched((c) => ({ ...c, quantity: true }))}
                placeholder="120"
                className={`${inputClass} tabular mt-1.5`}
              />
              {errorFor('quantity') ? (
                <p role="alert" className="mt-1 text-xs text-clay">
                  {errorFor('quantity')}
                </p>
              ) : null}
            </div>

            <div>
              <label htmlFor="holding-cost" className="block text-sm font-medium text-content">
                Cost basis
              </label>
              <input
                id="holding-cost"
                name="costBasis"
                inputMode="decimal"
                value={values.costBasis}
                onChange={(event) => setValues((c) => ({ ...c, costBasis: event.target.value }))}
                onBlur={() => setTouched((c) => ({ ...c, costBasis: true }))}
                placeholder="9400"
                className={`${inputClass} tabular mt-1.5`}
              />
              {errorFor('costBasis') ? (
                <p role="alert" className="mt-1 text-xs text-clay">
                  {errorFor('costBasis')}
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
