/**
 * Fundamentals data provider boundary (Financial Modeling Prep), Phase 4's stock
 * analysis workbench.
 *
 * Mirrors `src/lib/portfolio/quotes.ts`'s conventions exactly, for the same reasons:
 * a typed result union rather than throwing (a fundamentals lookup is a nice-to-have
 * gate before a DCF/checklist can run, never a hard dependency for the page to render —
 * same posture as Phase 2's quote lookups and PROPOSAL.md's Open Banking stance more
 * generally), and an injectable `fetchImpl` on every function that hits the network so
 * unit tests never make a real FMP call (no msw/nock in this codebase, same reasoning
 * `quotes.ts` documents).
 *
 * **Live-verified 2026-08-01** against a real, freshly-issued `FMP_API_KEY` (real curl
 * calls, not docs-reading) — this replaced Milestone 2's original, docs-derived
 * assumptions, and one of them was wrong in a way that would have made every fetch fail
 * silently forever:
 *
 * - **The endpoint family this module originally called (`/api/v3/...`, path-segment
 *   symbol) is FMP's "Legacy" tier and returns a JSON `{"Error Message": "Legacy
 *   Endpoint..."}` for any key issued after 31 Aug 2025** — including this household's.
 *   The **current** endpoints are under `/stable/...`, with the ticker as a `?symbol=`
 *   query parameter, not a path segment. Confirmed working end-to-end for `AAPL` and
 *   `MSFT` with the exact field names this module already expected
 *   (`freeCashFlow`/`totalDebt`/`netDebt`/`cashAndCashEquivalents`/
 *   `weightedAverageShsOutDil`) — the field-name research was right; only the URL shape
 *   was wrong.
 * - **Arrays are confirmed newest-first**: `AAPL`'s first element was FY2025
 *   (`date: "2025-09-27"`), second FY2024 — `[0]` = most recent, as `dcf.ts` assumed.
 * - **A ticker the free tier won't serve fundamentals for returns HTTP 402**, plain
 *   text (not JSON — `response.json()` would throw on it), mentioning a required
 *   subscription upgrade — confirmed with a deliberately-fake symbol. Treated as
 *   `not-found` (see `fetchFmpStatement` below), not `network-error`: it is a permanent
 *   answer for that ticker on this plan, not a transient failure worth retrying every
 *   time the staleness window passes.
 * - **A bad API key returns HTTP 200 with a JSON `{"Error Message": "Invalid API
 *   KEY..."}` body** — confirmed directly, not just documented elsewhere online. Real
 *   rate-limiting almost certainly shares this same object-with-`Error Message` shape
 *   (FMP's own internal convention, now seen twice), so it stays bucketed as
 *   `rate-limited` below — the safer degrade (keep serving cached data, marked stale)
 *   regardless of which specific error this bucket actually meant, same reasoning as
 *   before, now on firmer ground than a documentation guess.
 *
 * **US-listed tickers first, per the household's own decision** (`docs/STATUS.md`):
 * `resolveFmpTicker` below is currently the identity function — bare ticker in, bare
 * ticker out. LSE coverage, and whatever exchange-suffix convention FMP actually wants
 * for it (unconfirmed — may not even be `.LON`, unlike Alpha Vantage's documented
 * convention), is follow-up work for whenever a specific UK stock is actually analyzed.
 */
import { inArray } from 'drizzle-orm';
import { getDb } from '@/lib/db/client';
import { fundamentalsCache } from '@/lib/db/schema';

const FMP_BASE_URL = 'https://financialmodelingprep.com/stable';

/** One period's worth of a financial statement, as FMP returns it — deliberately kept
 * as `unknown` here, not a typed shape. This module's job is fetching and caching the
 * raw response; parsing named fields (revenue, freeCashFlow, totalStockholdersEquity,
 * ...) into a typed shape is Milestone 2+'s job (the DCF calculator, the checklist),
 * once this milestone's foundation is in place and those consumers actually exist. */
export type FmpStatementPeriod = Record<string, unknown>;

export interface FmpStatements {
  incomeStatements: FmpStatementPeriod[];
  balanceSheets: FmpStatementPeriod[];
  cashFlowStatements: FmpStatementPeriod[];
}

export type FundamentalsFetchResult =
  | ({ status: 'ok'; ticker: string } & FmpStatements)
  | { status: 'not-found' }
  | { status: 'rate-limited' }
  | { status: 'network-error'; message: string };

type StatementFetchResult =
  | { status: 'ok'; data: FmpStatementPeriod[] }
  | { status: 'not-found' }
  | { status: 'rate-limited' }
  | { status: 'network-error'; message: string };

/** One of `income-statement` / `balance-sheet-statement` / `cash-flow-statement`. */
async function fetchFmpStatement(
  endpoint: string,
  ticker: string,
  apiKey: string,
  fetchImpl: typeof fetch,
): Promise<StatementFetchResult> {
  // `/stable/...`, symbol as a query param — see this file's own doc comment for why,
  // confirmed by a real failed call under the old `/api/v3/{endpoint}/{symbol}` shape
  // before this was fixed.
  const url = new URL(`${FMP_BASE_URL}/${endpoint}`);
  url.searchParams.set('symbol', ticker);
  url.searchParams.set('period', 'annual');
  url.searchParams.set('limit', '5'); // FMP's free tier: up to 5 years of annual statements
  url.searchParams.set('apikey', apiKey);

  let response: Response;
  try {
    response = await fetchImpl(url.toString());
  } catch (error) {
    return { status: 'network-error', message: error instanceof Error ? error.message : String(error) };
  }

  // A ticker this plan won't serve fundamentals for responds HTTP 402 with a plain-text
  // (not JSON) body — confirmed live, see this file's own doc comment. Treated as
  // `not-found`, not folded into the generic `!response.ok` branch below: it's a
  // permanent answer for this ticker on this plan, worth caching as such (so it isn't
  // re-fetched every time the staleness window passes), not a transient error to log
  // and retry.
  if (response.status === 402) {
    return { status: 'not-found' };
  }

  if (!response.ok) {
    return { status: 'network-error', message: `HTTP ${response.status}` };
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return { status: 'network-error', message: 'Response was not valid JSON' };
  }

  // A successful call returns a JSON array (possibly empty); a JSON *object* — carrying
  // an `"Error Message"` field in every case seen so far — is a provider error. See
  // this file's own doc comment: confirmed live for a bad API key, not just documented
  // elsewhere; real rate-limiting is assumed (not yet independently confirmed) to share
  // this same shape.
  if (!Array.isArray(body)) {
    return { status: 'rate-limited' };
  }
  if (body.length === 0) {
    return { status: 'not-found' };
  }

  return { status: 'ok', data: body as FmpStatementPeriod[] };
}

/**
 * Fetch all three statements for one ticker. Sequential, not parallel — matching
 * `quotes.ts`'s own conservative choice for Alpha Vantage; FMP's exact per-minute
 * sub-limit (if any) isn't verified either, so there's no basis yet for being less
 * cautious here than the codebase already is for its other provider.
 *
 * Stops at the first non-`ok` statement rather than fetching all three regardless —
 * if the ticker doesn't exist, the balance sheet and cash flow calls would fail the
 * same way, so there's nothing to gain from spending three API calls to learn that
 * once would already tell you.
 */
export async function fetchFundamentals(
  ticker: string,
  apiKey: string,
  fetchImpl: typeof fetch = fetch,
): Promise<FundamentalsFetchResult> {
  const income = await fetchFmpStatement('income-statement', ticker, apiKey, fetchImpl);
  if (income.status !== 'ok') return income;

  const balance = await fetchFmpStatement('balance-sheet-statement', ticker, apiKey, fetchImpl);
  if (balance.status !== 'ok') return balance;

  const cashFlow = await fetchFmpStatement('cash-flow-statement', ticker, apiKey, fetchImpl);
  if (cashFlow.status !== 'ok') return cashFlow;

  return {
    status: 'ok',
    ticker,
    incomeStatements: income.data,
    balanceSheets: balance.data,
    cashFlowStatements: cashFlow.data,
  };
}

/**
 * Map a household-entered ticker to the symbol FMP expects. Currently the identity
 * function — see this file's own doc comment on why LSE-suffix resolution is deferred.
 */
export function resolveFmpTicker(ticker: string): string {
  return ticker;
}

export interface FundamentalsSource {
  fetchFundamentals(ticker: string): Promise<FundamentalsFetchResult>;
}

/** The real provider, wired up for production use. Tests inject a fake
 * `FundamentalsSource` instead — see `ensureFreshFundamentals` below — so nothing in
 * this codebase's test suite ever makes a real FMP call. */
export function createFmpFundamentalsSource(
  apiKey: string,
  fetchImpl: typeof fetch = fetch,
): FundamentalsSource {
  return {
    fetchFundamentals: (ticker) => fetchFundamentals(resolveFmpTicker(ticker), apiKey, fetchImpl),
  };
}

export interface FundamentalsView {
  /** `null` means the provider confirmed no statements exist for this ticker —
   * distinct from the ticker being absent from the returned map entirely, which means
   * no cached value exists at all (mirrors `QuoteView.price`'s convention exactly). */
  statements: FmpStatements | null;
  fetchedAt: Date;
  /** True when this value is older than the staleness threshold and a refetch was
   * attempted and failed (provider error or network error) — the last cached value is
   * being served instead of nothing. */
  stale: boolean;
}

/**
 * Read the fundamentals cache for the requested tickers, refetching whichever are
 * missing or past `staleAfterHours`. Mirrors `ensureFreshQuotes` structurally — see
 * that function's own doc comment for the reasoning behind every decision repeated
 * here (fallback-to-cached-on-failure, caching a confirmed not-found rather than
 * leaving it unrecorded, catching everything so a provider problem can never crash the
 * page it's rendering into).
 *
 * Unlike `ensureFreshQuotes`, this cache is keyed by bare `ticker`, not a
 * currency-resolved provider symbol — `fundamentals_cache` has no `household_id`
 * either (see that table's own schema doc comment for why: fundamentals are the same
 * fact for every household).
 */
export async function ensureFreshFundamentals(
  tickers: readonly string[],
  options: { source: FundamentalsSource; staleAfterHours: number; now?: Date },
): Promise<Map<string, FundamentalsView>> {
  const uniqueTickers = Array.from(new Set(tickers));
  if (uniqueTickers.length === 0) return new Map();

  const db = getDb();
  const now = options.now ?? new Date();
  const staleAfterMs = options.staleAfterHours * 60 * 60 * 1000;

  const existingRows = await db
    .select()
    .from(fundamentalsCache)
    .where(inArray(fundamentalsCache.ticker, uniqueTickers));
  const existingByTicker = new Map(existingRows.map((row) => [row.ticker, row]));

  const result = new Map<string, FundamentalsView>();

  for (const ticker of uniqueTickers) {
    const existing = existingByTicker.get(ticker);
    const isFresh =
      existing !== undefined && now.getTime() - existing.fetchedAt.getTime() < staleAfterMs;

    if (isFresh) {
      result.set(ticker, {
        statements: existing.statements as FmpStatements | null,
        fetchedAt: existing.fetchedAt,
        stale: false,
      });
      continue;
    }

    try {
      const fetchResult = await options.source.fetchFundamentals(ticker);

      if (fetchResult.status === 'ok') {
        const statements: FmpStatements = {
          incomeStatements: fetchResult.incomeStatements,
          balanceSheets: fetchResult.balanceSheets,
          cashFlowStatements: fetchResult.cashFlowStatements,
        };
        await db
          .insert(fundamentalsCache)
          .values({ ticker, statements, fetchedAt: now })
          .onConflictDoUpdate({ target: fundamentalsCache.ticker, set: { statements, fetchedAt: now } });
        result.set(ticker, { statements, fetchedAt: now, stale: false });
        continue;
      }

      if (fetchResult.status === 'not-found') {
        await db
          .insert(fundamentalsCache)
          .values({ ticker, statements: null, fetchedAt: now })
          .onConflictDoUpdate({ target: fundamentalsCache.ticker, set: { statements: null, fetchedAt: now } });
        result.set(ticker, { statements: null, fetchedAt: now, stale: false });
        continue;
      }

      console.error(`[stocks/fmp] ${ticker}: ${fetchResult.status}, serving cached value`);
      if (existing) {
        result.set(ticker, {
          statements: existing.statements as FmpStatements | null,
          fetchedAt: existing.fetchedAt,
          stale: true,
        });
      }
    } catch (error) {
      console.error(`[stocks/fmp] ${ticker}: failed to refresh`, error);
      if (existing) {
        result.set(ticker, {
          statements: existing.statements as FmpStatements | null,
          fetchedAt: existing.fetchedAt,
          stale: true,
        });
      }
    }
  }

  return result;
}
