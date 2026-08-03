/**
 * Phase 4's fundamentals-provider verification task: settle FMP's real endpoint shape,
 * error responses, and array ordering against a real key — the same role
 * `verify-quote-provider.ts` played for Alpha Vantage's GBX/GBP question in Phase 2.
 *
 * This already ran once, for real, on 2026-08-01, and found a genuine bug: the
 * `/api/v3/...` endpoints this module originally called are FMP's retired "Legacy"
 * tier and fail for any key issued after 31 Aug 2025 — fixed to use `/stable/...` with
 * `?symbol=` as a query param. See `src/lib/stocks/fmp.ts`'s own doc comment for the
 * full write-up of what else that pass confirmed (newest-first arrays, HTTP 402 for a
 * tier-restricted ticker, the `Error Message` JSON shape for a bad key).
 *
 *   FMP_API_KEY=your-key npm run stocks:verify-fmp
 *
 * Sign up for a free key (no card) at https://site.financialmodelingprep.com.
 *
 * This script is permanent, not throwaway — worth re-running if FMP changes its API
 * again (as the Legacy-tier retirement already shows they will), or periodically as a
 * sanity check that field names/shapes haven't silently drifted.
 */
import { deriveDcfBaseInputs, suggestDiscountRatePct, suggestGrowthRatePct } from '../src/lib/stocks/dcf';
import { fetchFundamentals } from '../src/lib/stocks/fmp';

// AAPL/MSFT: real, large-cap tickers expected to work on the free tier. NOTATICKERXYZ:
// deliberately fake, expected to come back not-found (HTTP 402 on FMP's current free
// tier — see the module doc comment above) — confirms that failure mode still degrades
// gracefully rather than silently breaking.
const TICKERS_TO_CHECK = ['AAPL', 'MSFT', 'NOTATICKERXYZ'];

async function main(): Promise<void> {
  const apiKey = process.env.FMP_API_KEY;
  if (!apiKey) {
    process.stderr.write(
      'FMP_API_KEY is not set. Get a free key at https://site.financialmodelingprep.com ' +
        'and run:\n\n  FMP_API_KEY=your-key npm run stocks:verify-fmp\n',
    );
    process.exit(1);
  }

  for (const ticker of TICKERS_TO_CHECK) {
    const result = await fetchFundamentals(ticker, apiKey);

    if (result.status !== 'ok') {
      process.stdout.write(`${ticker}: ${result.status}\n`);
      continue;
    }

    const latestIncome = result.incomeStatements[0];
    const latestCashFlow = result.cashFlowStatements[0];
    process.stdout.write(
      `${ticker}: most recent period ${String(latestIncome?.date)} ` +
        `(cash flow statement's own most-recent date: ${String(latestCashFlow?.date)} — ` +
        `should match, confirming both statements are ordered the same way)\n`,
    );

    const baseInputs = deriveDcfBaseInputs({
      incomeStatements: result.incomeStatements,
      balanceSheets: result.balanceSheets,
      cashFlowStatements: result.cashFlowStatements,
      beta: result.beta,
    });
    if (baseInputs) {
      process.stdout.write(
        `  base FCF: ${baseInputs.baseFcfPence} pence, ` +
          `net debt: ${baseInputs.netDebtPence} pence, ` +
          `diluted shares: ${baseInputs.dilutedShares}\n`,
      );
    } else {
      process.stdout.write('  deriveDcfBaseInputs returned null — a required field is missing\n');
    }

    process.stdout.write(
      `  beta: ${result.beta ?? '(none)'}, ` +
        `suggested growth rate: ${suggestGrowthRatePct(result.cashFlowStatements) ?? '(none)'}%, ` +
        `suggested discount rate: ${suggestDiscountRatePct(result.beta) ?? '(none)'}%\n`,
    );
  }
}

main().catch((error: unknown) => {
  process.stderr.write(`Failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
