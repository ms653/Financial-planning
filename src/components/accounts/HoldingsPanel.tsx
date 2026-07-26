'use client';

import { useCallback, useState } from 'react';
import { validateHolding } from '@/lib/accounts/validation';
import type { ActionResult } from '@/lib/household/actions';
import { formErrorOf, serverErrorsOf, useActionForm } from '@/lib/ui/useActionForm';

/**
 * Holdings for an investment account.
 *
 * DESIGN_SPEC.md: "for investment-type accounts (GIA/ISA/SIPP), a holdings table (ticker,
 * quantity, cost basis, current value, gain/loss) — P1 scope is display-only, editable
 * manually; live pricing is P2 (market data provider)."
 *
 * So current value and gain/loss columns are **absent, not blank**. There is no price in
 * Phase 1 — the provider isn't chosen yet, and choosing it carries a blocking verification
 * task about whether LSE prices come back as pence or pounds (the proposal calls a GBX/GBP
 * mix-up the single most likely correctness bug in Phase 2). Empty columns headed "Current
 * value" would imply the app knows something it doesn't; a line saying valuations arrive with
 * live pricing is honest.
 *
 * Rows are read-only with an explicit remove action rather than inline-editable, per the spec's
 * "Holdings rows are read-only in P1 tap targets (no accidental edit)".
 */

export interface HoldingView {
  id: number;
  ticker: string;
  quantity: string;
  /** Pre-formatted on the server, so no money passes through a float here. */
  costBasis: string;
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

export function HoldingsPanel({
  accountId,
  holdings,
  addAction,
  deleteAction,
}: {
  accountId: number;
  holdings: HoldingView[];
  addAction: (formData: FormData) => Promise<ActionResult>;
  /** Bare `<form action>`, so it returns void — a single-button form has nothing to render. */
  deleteAction: (formData: FormData) => Promise<void>;
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
            Entered manually. Live prices and valuations arrive with market data in a later phase.
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
          <table className="w-full min-w-[380px] text-sm">
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
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {holdings.map((holding) => (
                <tr key={holding.id} className="border-b border-line last:border-b-0">
                  <td className="py-2.5 font-medium text-content">{holding.ticker}</td>
                  <td className="tabular py-2.5 text-right text-content-muted">{holding.quantity}</td>
                  <td className="tabular py-2.5 text-right text-content-muted">{holding.costBasis}</td>
                  <td className="py-2.5 text-right">
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
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
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
