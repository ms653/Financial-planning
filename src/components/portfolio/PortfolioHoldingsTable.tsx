'use client';

import { Fragment, useState } from 'react';

/**
 * Household-wide holdings, aggregated across accounts by ticker — DESIGN_SPEC.md's
 * Portfolio View: "a holdings table aggregated across all investment accounts (ticker,
 * total quantity across accounts, total value, % of portfolio …). Each row expandable to
 * show which account(s) it's held in." "Tap a holding row → expand in place (accordion),
 * not navigate away."
 *
 * A client component for exactly that expand-in-place interaction — the data itself is
 * computed server-side and handed over whole, the same reasoning as `BreakdownPanel`.
 */

export interface PortfolioHoldingAccountView {
  accountId: number;
  accountName: string;
  /** null = jointly owned by the household. */
  ownerName: string | null;
  quantity: string;
  currency: string;
}

export interface PortfolioHoldingGainLoss {
  amount: string;
  percent: string | null;
  direction: 'up' | 'down' | 'flat';
}

export interface PortfolioHoldingRowView {
  ticker: string;
  /** Unique per row — `ticker` alone isn't, once a bare ticker can appear under more than
   * one account currency (unreachable today; see `aggregateByTicker`'s doc comment in
   * src/lib/portfolio/valuation.ts). Used for the React key and the expand/collapse state
   * instead of `ticker`. */
  rowKey: string;
  totalQuantity: string;
  /** Pre-formatted GBP, or null when unpriced or priced in a non-GBP currency (see
   * `nonGbpCurrency`). */
  totalValue: string | null;
  /** Pre-formatted, e.g. "23.4%" — share of the GBP-priced portfolio total. Null when
   * `totalValue` is null. */
  sharePercent: string | null;
  gainLoss: PortfolioHoldingGainLoss | null;
  accounts: PortfolioHoldingAccountView[];
  /**
   * Set when this ticker's live price came back in a currency other than GBP.
   * DESIGN_SPEC.md's multi-currency edge case asks for "value shown in GBP with the
   * original currency/price visible on expand" — Phase 2 deliberately has no FX
   * conversion (see src/lib/portfolio/quotes.ts's `resolveProviderSymbol`), so rather
   * than silently mixing currencies into one GBP-labelled total, a non-GBP-priced ticker
   * is excluded from the GBP total/allocation and flagged here instead. None of the
   * household's actual holdings hit this today; it exists so a future US-listed holding
   * doesn't silently misreport a dollar value as pounds.
   */
  nonGbpCurrency: string | null;
}

export function PortfolioHoldingsTable({ rows }: { rows: PortfolioHoldingRowView[] }) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  function toggle(rowKey: string) {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(rowKey)) next.delete(rowKey);
      else next.add(rowKey);
      return next;
    });
  }

  return (
    <div className="overflow-x-auto">
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
              Value
            </th>
            <th scope="col" className="pb-2 text-right font-medium">
              % of portfolio
            </th>
            <th scope="col" className="pb-2 text-right font-medium">
              Gain/loss
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const isOpen = expanded.has(row.rowKey);
            return (
              <Fragment key={row.rowKey}>
                <tr
                  className="cursor-pointer border-b border-line last:border-b-0 hover:bg-paper-sunken/50"
                  onClick={() => toggle(row.rowKey)}
                >
                  <td className="py-2.5">
                    <button
                      type="button"
                      className="flex items-center gap-1.5 font-medium text-content"
                      aria-expanded={isOpen}
                      aria-controls={`portfolio-row-${row.rowKey}`}
                    >
                      <span
                        aria-hidden="true"
                        className={`text-content-faint transition-transform ${isOpen ? 'rotate-90' : ''}`}
                      >
                        ▸
                      </span>
                      {row.ticker}
                    </button>
                  </td>
                  <td className="tabular py-2.5 text-right text-content-muted">
                    {row.totalQuantity}
                  </td>
                  <td className="tabular py-2.5 text-right text-content-muted">
                    {row.totalValue ?? <span className="text-content-faint">Price unavailable</span>}
                  </td>
                  <td className="tabular py-2.5 text-right text-content-muted">
                    {row.sharePercent ?? '—'}
                  </td>
                  <td
                    className={`tabular py-2.5 text-right ${
                      row.gainLoss?.direction === 'up'
                        ? 'text-sage'
                        : row.gainLoss?.direction === 'down'
                          ? 'text-clay'
                          : 'text-content-muted'
                    }`}
                  >
                    {row.gainLoss ? (
                      <>
                        {row.gainLoss.amount}
                        {row.gainLoss.percent ? (
                          <span className="ml-1 text-content-faint">({row.gainLoss.percent}%)</span>
                        ) : null}
                      </>
                    ) : (
                      <span className="text-content-faint">—</span>
                    )}
                  </td>
                </tr>
                {isOpen ? (
                  <tr id={`portfolio-row-${row.rowKey}`}>
                    <td colSpan={5} className="border-b border-line bg-paper-sunken/40 px-3 py-3">
                      {row.nonGbpCurrency ? (
                        <p className="mb-2 text-xs text-content-muted">
                          Priced in {row.nonGbpCurrency}, not GBP — excluded from the total and
                          allocation above until currency conversion is supported.
                        </p>
                      ) : null}
                      <ul className="space-y-1.5">
                        {row.accounts.map((account) => (
                          <li
                            key={account.accountId}
                            className="flex items-center justify-between gap-3 text-xs"
                          >
                            <span className="text-content-muted">
                              {account.accountName}
                              {account.ownerName ? ` — ${account.ownerName}` : ' — Joint'}
                            </span>
                            <span className="tabular text-content-faint">
                              {account.quantity} {row.ticker}
                              {account.currency !== 'GBP' ? ` (${account.currency})` : ''}
                            </span>
                          </li>
                        ))}
                      </ul>
                    </td>
                  </tr>
                ) : null}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
