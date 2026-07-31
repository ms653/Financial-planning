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
 * **A real, disclosed gap**: FMP's exact error-response shape (invalid ticker vs. rate
 * limit vs. bad key) is not yet live-verified against a real API key — the household
 * hasn't obtained one yet as of Milestone 1 (see `docs/STATUS.md`). This module's error
 * handling is built from FMP's public documentation and community-reported behavior
 * (an empty JSON array for an unknown ticker; a JSON object carrying an `"Error
 * Message"` field, at HTTP 200, for other failures — no distinct HTTP status to key
 * off, the same "field-shape check, not a status code" situation `quotes.ts` documents
 * for Alpha Vantage's `Note`/`Information` fields), **not** a live-verified fact the
 * way `LSE_QUOTES_ARE_GBX` below it in `quotes.ts` is. Every non-array object response
 * is bucketed as `rate-limited` rather than guessing which specific error FMP meant —
 * the safer degrade (keep serving cached data, marked stale) regardless of the true
 * cause. Revisit once a real key exists and a live call can settle this the way
 * `scripts/verify-quote-provider.ts` settled the GBX/GBP question for Alpha Vantage.
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

const FMP_BASE_URL = 'https://financialmodelingprep.com/api/v3';

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
  const url = new URL(`${FMP_BASE_URL}/${endpoint}/${ticker}`);
  url.searchParams.set('period', 'annual');
  url.searchParams.set('limit', '5'); // FMP's free tier: up to 5 years of annual statements
  url.searchParams.set('apikey', apiKey);

  let response: Response;
  try {
    response = await fetchImpl(url.toString());
  } catch (error) {
    return { status: 'network-error', message: error instanceof Error ? error.message : String(error) };
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

  // See this file's own doc comment: this bucketing is provisional, not yet
  // live-verified. A successful call returns a JSON array (possibly empty, for an
  // unknown ticker); anything else is treated as a provider error.
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
