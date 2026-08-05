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
 *
 * **`/stable/profile` (company profile, fetched for its `beta` field only) — live
 * verified 2026-08-01**, same pass that added the DCF discount-rate suggestion
 * feature: same array-of-objects / empty-array-for-unknown-ticker / bad-key
 * `{"Error Message": ...}` shapes as the statement endpoints above, so it reuses
 * `fetchFmpStatement`'s parsing rather than duplicating it. Confirmed non-null `beta`
 * for AAPL (1.097), MSFT (1.13), and — notably — **COF** (1.022), whose financial
 * *statements* 402 on the free tier; profile coverage is evidently broader than
 * statement coverage, consistent with the earlier per-ticker coverage investigation
 * (`docs/STATUS.md`'s "how do I know what tickers will work?" note).
 *
 * **`/stable/ratios`, `/stable/key-metrics`, `/stable/stock-peers` (Milestone 3's
 * relative-valuation and quality/balance-sheet screens) — live verified 2026-08-03**:
 * `ratios`/`key-metrics` take the identical `?symbol=&period=annual&limit=N` shape and
 * response parsing as the statements (`fetchFmpStatement` reused directly); `peers`
 * takes no `period`/`limit` (a flat list, not a time series) but shares the same
 * array/empty-array/402/bad-key response shapes. Confirmed against `AAPL`, `MSFT`, and
 * `COF`: **`ratios` and `key-metrics` 402 for COF exactly like its statements do**
 * (same free-tier gating), but **`stock-peers` works for COF regardless** (7 peers
 * returned) — peer discovery is independent of whether a ticker's own multiples are
 * available on this plan. Most large-cap peers have working `ratios`/`key-metrics`
 * (`BAC`, `MSFT`, `GOOGL`, `TSM` all confirmed); a real negative P/E was seen for
 * `SONY` (negative trailing EPS) — a genuine result to display as-is, not filter out.
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
  /** `null` when the profile call failed or had no usable beta — see
   * `fetchFundamentals`'s own doc comment on why that doesn't fail the whole fetch.
   * Cached rows written before this field existed simply lack the key; read as
   * `undefined` there, which callers treat the same as `null` (no suggestion). */
  beta: number | null;
  /** Same optional-call posture as `beta`: `[]` when the ratios call failed, never
   * failing the whole fetch. Feeds `relativeValuation.ts`'s quality-metrics and
   * peer-comparison P/E, never the DCF calculation. */
  ratios: FmpStatementPeriod[];
  /** Same posture as `ratios` — feeds EV/EBITDA and ROE/ROIC in
   * `relativeValuation.ts`. */
  keyMetrics: FmpStatementPeriod[];
  /** `[]` when the peers call failed or the provider has none for this ticker — same
   * optional posture. FMP's own peer determination, not hand-picked; a peer here may
   * itself have no usable `ratios`/`keyMetrics` (`relativeValuation.ts` shows it with a
   * `null` multiple rather than omitting it, so the household can see which peers had
   * no data). */
  peers: Array<{ ticker: string; companyName: string }>;
}

/** Which optional fields genuinely failed this fetch (rate-limited/network-error) as
 * opposed to confirmed-empty (a real `not-found`/empty-array response) — the two look
 * identical once collapsed to `null`/`[]` on `FmpStatements` itself, so this is tracked
 * separately. `ensureFreshFundamentals` uses it to fall back to the previous cached
 * value for exactly the fields that failed, never for a field that's legitimately
 * empty, and to mark the returned view `stale` when anything failed. */
export interface OptionalFieldFailures {
  beta: boolean;
  ratios: boolean;
  keyMetrics: boolean;
  peers: boolean;
}

export type FundamentalsFetchResult =
  | ({ status: 'ok'; ticker: string; failed: OptionalFieldFailures } & FmpStatements)
  | { status: 'not-found' }
  | { status: 'rate-limited' }
  | { status: 'network-error'; message: string };

type StatementFetchResult =
  | { status: 'ok'; data: FmpStatementPeriod[] }
  | { status: 'not-found' }
  | { status: 'rate-limited' }
  | { status: 'network-error'; message: string };

/**
 * Shared response handling for every `/stable/...` endpoint this module calls
 * (statements and profile alike) — same 402/error-object/empty-array shapes across
 * all of them, confirmed live for both categories (see this file's own doc comment).
 */
async function fetchFmpArray(url: URL, fetchImpl: typeof fetch): Promise<StatementFetchResult> {
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
  return fetchFmpArray(url, fetchImpl);
}

/**
 * Company profile — fetched for its `beta` field only (the CAPM-based discount-rate
 * suggestion's input). See this file's own doc comment: live-verified 2026-08-01,
 * same response shapes as the statement endpoints, and notably *broader* free-tier
 * coverage (works for COF, whose statements don't).
 */
async function fetchFmpProfile(
  ticker: string,
  apiKey: string,
  fetchImpl: typeof fetch,
): Promise<StatementFetchResult> {
  const url = new URL(`${FMP_BASE_URL}/profile`);
  url.searchParams.set('symbol', ticker);
  url.searchParams.set('apikey', apiKey);
  return fetchFmpArray(url, fetchImpl);
}

/** Peer tickers — no `period`/`limit` (a flat list, not a time series), otherwise the
 * same shared response handling. See this file's own doc comment: live-verified
 * 2026-08-03, works independently of whether the ticker's own `ratios`/`key-metrics`
 * are available on this plan. */
async function fetchFmpPeers(
  ticker: string,
  apiKey: string,
  fetchImpl: typeof fetch,
): Promise<StatementFetchResult> {
  const url = new URL(`${FMP_BASE_URL}/stock-peers`);
  url.searchParams.set('symbol', ticker);
  url.searchParams.set('apikey', apiKey);
  return fetchFmpArray(url, fetchImpl);
}

/**
 * Fetch all three statements plus the profile's `beta`, for one ticker. Sequential,
 * not parallel — matching `quotes.ts`'s own conservative choice for Alpha Vantage;
 * FMP's exact per-minute sub-limit (if any) isn't verified either, so there's no
 * basis yet for being less cautious here than the codebase already is for its other
 * provider.
 *
 * Stops at the first non-`ok` *statement* rather than fetching the rest regardless —
 * if the ticker doesn't exist, the balance sheet and cash flow calls would fail the
 * same way, so there's nothing to gain from spending API calls to learn that once
 * would already tell you.
 *
 * The profile/ratios/key-metrics/peers calls are different: each is fetched *after*
 * the three statements succeed, but none of their failures fail the whole result.
 * `beta` only feeds an optional discount-rate suggestion (`dcf.ts`'s
 * `suggestDiscountRatePct`); `ratios`/`keyMetrics`/`peers` only feed Milestone 3's
 * optional relative-valuation and quality screens (`relativeValuation.ts`) — none of
 * them touch the DCF calculation, so any one missing just means that one optional
 * section has nothing to show, not "no fundamentals for this ticker." This is a
 * deliberate asymmetry from the statement-to-statement behaviour above, and each of
 * the four degrades independently of the other three.
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

  const profile = await fetchFmpProfile(ticker, apiKey, fetchImpl);
  const beta =
    profile.status === 'ok' && typeof profile.data[0]?.beta === 'number' && Number.isFinite(profile.data[0].beta)
      ? (profile.data[0].beta as number)
      : null;

  const ratios = await fetchFmpStatement('ratios', ticker, apiKey, fetchImpl);
  const keyMetrics = await fetchFmpStatement('key-metrics', ticker, apiKey, fetchImpl);

  const peersResult = await fetchFmpPeers(ticker, apiKey, fetchImpl);
  const peers =
    peersResult.status === 'ok'
      ? peersResult.data
          .filter(
            (p): p is FmpStatementPeriod & { symbol: string; companyName: string } =>
              typeof p.symbol === 'string' && typeof p.companyName === 'string',
          )
          .map((p) => ({ ticker: p.symbol, companyName: p.companyName }))
      : [];

  // A genuine failure (rate-limited/network-error) is different from a confirmed-empty
  // `not-found` — the latter is a real, cacheable answer ("this ticker has no ratios"),
  // the former is "we don't actually know," and treating it the same as an empty
  // result would fabricate an authoritative-looking gap. `ensureFreshFundamentals`
  // uses this to fall back to whatever was cached before, field by field, rather than
  // overwrite it — never for a field that's legitimately empty.
  const didOptionalCallFail = (result: StatementFetchResult) =>
    result.status === 'rate-limited' || result.status === 'network-error';

  return {
    status: 'ok',
    ticker,
    failed: {
      beta: didOptionalCallFail(profile),
      ratios: didOptionalCallFail(ratios),
      keyMetrics: didOptionalCallFail(keyMetrics),
      peers: didOptionalCallFail(peersResult),
    },
    incomeStatements: income.data,
    balanceSheets: balance.data,
    cashFlowStatements: cashFlow.data,
    beta,
    ratios: ratios.status === 'ok' ? ratios.data : [],
    keyMetrics: keyMetrics.status === 'ok' ? keyMetrics.data : [],
    peers,
  };
}

export interface RatiosAndKeyMetrics {
  ratios: FmpStatementPeriod[];
  keyMetrics: FmpStatementPeriod[];
}

/**
 * Just a ticker's `ratios` and `keyMetrics` — 2 calls, not the full 7-call
 * `fetchFundamentals` set. For peer-comparison rows on the ticker page, which only
 * ever read these two fields (`relativeValuation.ts`'s `derivePeerComparison`) — a
 * cold render with `MAX_PEERS` peers previously cost 5 × 7 = 35 calls just for peers,
 * on top of the primary ticker's own 7, found disproportionate to what the feature
 * actually uses by independent review.
 *
 * Deliberately **not** cached through `fundamentals_cache`/`ensureFreshFundamentals`:
 * that cache's freshness check has no concept of "this row only has ratios/keyMetrics,
 * not the full statement set" — writing a partial row under a peer's ticker would risk
 * a later visit to that same ticker *as a primary ticker* seeing it as "fresh, no DCF
 * data available" for up to the staleness window, when the real data was simply never
 * fetched. Refetching a handful of peers' 2 calls each on every page view is a real,
 * accepted cost, not a caching gap — for a household-scale tool viewing a handful of
 * pages a day, this is far cheaper than the 35-call worst case it replaces, and safer
 * than a cache shape this table doesn't actually support.
 */
export async function fetchRatiosAndKeyMetrics(
  ticker: string,
  apiKey: string,
  fetchImpl: typeof fetch = fetch,
): Promise<RatiosAndKeyMetrics> {
  const [ratios, keyMetrics] = await Promise.all([
    fetchFmpStatement('ratios', ticker, apiKey, fetchImpl),
    fetchFmpStatement('key-metrics', ticker, apiKey, fetchImpl),
  ]);
  return {
    ratios: ratios.status === 'ok' ? ratios.data : [],
    keyMetrics: keyMetrics.status === 'ok' ? keyMetrics.data : [],
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
  /** True whenever this value isn't fully current: either the whole refetch failed
   * (provider error or network error) and a cached value is being served instead of
   * nothing, or the required statements refreshed fine but at least one optional field
   * (beta/ratios/keyMetrics/peers) didn't and is falling back to its own last
   * successfully-fetched value — see `ensureFreshFundamentals`'s own doc comment. */
  stale: boolean;
}

/** Cached rows written before `ratios`/`keyMetrics`/`peers` existed (Milestone 2, before
 * Milestone 3 added them) simply lack those keys — `undefined`, not `[]` — which none of
 * this module's consumers guard against at their own call sites (they assume the array
 * is always at least present and empty, matching every other field's own convention).
 * Normalized here, the one place a cached row is read back, so nothing downstream has
 * to know this history exists. */
function normalizeStatements(raw: FmpStatements | null): FmpStatements | null {
  if (raw === null) return null;
  return {
    ...raw,
    ratios: raw.ratios ?? [],
    keyMetrics: raw.keyMetrics ?? [],
    peers: raw.peers ?? [],
  };
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
        statements: normalizeStatements(existing.statements as FmpStatements | null),
        fetchedAt: existing.fetchedAt,
        stale: false,
      });
      continue;
    }

    const existingStatements = existing ? normalizeStatements(existing.statements as FmpStatements | null) : null;

    try {
      const fetchResult = await options.source.fetchFundamentals(ticker);

      if (fetchResult.status === 'ok') {
        // Fields that genuinely failed this round (`fetchResult.failed.*`, not a
        // legitimately-empty confirmed result) fall back to whatever was cached for
        // that specific field, instead of overwriting known-good data with a
        // fabricated empty array; the view is marked `stale` whenever anything failed,
        // even though the required statements themselves are fresh (intentionally
        // distinct from the whole-fetch-failed case below, which keeps the entire
        // previous value including its old `fetchedAt`).
        const partial = Object.values(fetchResult.failed).some(Boolean);
        const statements: FmpStatements = {
          incomeStatements: fetchResult.incomeStatements,
          balanceSheets: fetchResult.balanceSheets,
          cashFlowStatements: fetchResult.cashFlowStatements,
          beta: fetchResult.failed.beta ? (existingStatements?.beta ?? null) : fetchResult.beta,
          ratios: fetchResult.failed.ratios ? (existingStatements?.ratios ?? []) : fetchResult.ratios,
          keyMetrics: fetchResult.failed.keyMetrics
            ? (existingStatements?.keyMetrics ?? [])
            : fetchResult.keyMetrics,
          peers: fetchResult.failed.peers ? (existingStatements?.peers ?? []) : fetchResult.peers,
        };
        await db
          .insert(fundamentalsCache)
          .values({ ticker, statements, fetchedAt: now })
          .onConflictDoUpdate({ target: fundamentalsCache.ticker, set: { statements, fetchedAt: now } });
        result.set(ticker, { statements, fetchedAt: now, stale: partial });
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
        result.set(ticker, { statements: existingStatements, fetchedAt: existing.fetchedAt, stale: true });
      }
    } catch (error) {
      console.error(`[stocks/fmp] ${ticker}: failed to refresh`, error);
      if (existing) {
        result.set(ticker, { statements: existingStatements, fetchedAt: existing.fetchedAt, stale: true });
      }
    }
  }

  return result;
}
