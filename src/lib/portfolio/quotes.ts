/**
 * Market-data provider boundary (Alpha Vantage).
 *
 * PROPOSAL.md names GBX-vs-GBP confusion as the single most likely correctness bug in
 * this phase: LSE prices are quoted in pence (GBX/GBp), not pounds, and providers are
 * inconsistent about labeling this. Alpha Vantage's own docs don't state it either way for
 * `GLOBAL_QUOTE` — settled by a live call against the household's real holdings; see
 * `scripts/verify-quote-provider.ts` and the verified `LSE_QUOTES_ARE_GBX` constant below.
 *
 * This module is also this codebase's first outbound-HTTP boundary — `fetchGlobalQuote`
 * takes an injectable `fetchImpl` specifically so unit tests can stub Alpha Vantage
 * responses without a real network call (there is no existing msw/nock precedent here to
 * follow, and CI has no API key or network access to spend). `ensureFreshQuotes` takes an
 * injectable `QuoteSource` for the same reason, one layer up.
 */
import { inArray } from 'drizzle-orm';
import { getDb } from '@/lib/db/client';
import { quoteCache } from '@/lib/db/schema';
import { numericToPence } from '@/lib/money';
import {
  currentValuePence,
  formatScaledDecimal,
  gainLoss,
  parseScaledDecimal,
  PRICE_SCALE,
  type GainLoss,
} from './valuation';

const ALPHA_VANTAGE_BASE_URL = 'https://www.alphavantage.co/query';

export type QuoteFetchResult =
  | { status: 'ok'; symbol: string; rawPrice: string }
  | { status: 'not-found' }
  | { status: 'rate-limited' }
  | { status: 'network-error'; message: string };

/**
 * Raw Alpha Vantage `GLOBAL_QUOTE` call. Returns a typed result rather than throwing, so
 * every caller is forced to handle "provider unavailable" as a real case — a live quote
 * is a nice-to-have on top of manually-entered holdings, never a hard dependency for the
 * page to render (see docs/PROPOSAL.md's Open Banking posture: the app works with zero
 * provider connected).
 *
 * The returned price is intentionally un-normalized (`rawPrice`, a string straight off
 * the wire) — normalization is `normalizeQuotePrice`'s job, once the GBX/GBP question is
 * actually settled, not this function's.
 */
export async function fetchGlobalQuote(
  symbol: string,
  apiKey: string,
  fetchImpl: typeof fetch = fetch,
): Promise<QuoteFetchResult> {
  const url = new URL(ALPHA_VANTAGE_BASE_URL);
  url.searchParams.set('function', 'GLOBAL_QUOTE');
  url.searchParams.set('symbol', symbol);
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

  if (!body || typeof body !== 'object') {
    return { status: 'network-error', message: 'Unexpected response shape' };
  }

  // Alpha Vantage signals both hard rate limits and soft ones (e.g. "daily limit reached")
  // with a 200 OK and a "Note" or "Information" field instead of "Global Quote" — there is
  // no HTTP status to key off, so this has to be a field-shape check.
  if ('Note' in body || 'Information' in body) {
    return { status: 'rate-limited' };
  }

  const quote = (body as Record<string, unknown>)['Global Quote'];
  if (!quote || typeof quote !== 'object' || Object.keys(quote).length === 0) {
    return { status: 'not-found' };
  }

  const rawPrice = (quote as Record<string, unknown>)['05. price'];
  if (typeof rawPrice !== 'string' || rawPrice.trim() === '') {
    return { status: 'not-found' };
  }

  return { status: 'ok', symbol, rawPrice };
}

/**
 * Map a household-entered ticker (e.g. `VWRL`, stored bare per
 * `src/lib/accounts/validation.ts`'s ticker regex) to the symbol Alpha Vantage expects.
 *
 * GBP-currency accounts query the `.LON` suffix (documented Alpha Vantage format,
 * confirmed via `TSCO.LON` in their own docs); every other currency is sent bare, on the
 * assumption it's US-listed. This also means the quote's currency always equals the
 * holding's account currency by construction — `currentValue = quantity × price` never
 * needs an FX conversion.
 *
 * Documented Phase 2 limitation, not a silent bug: an LSE-listed non-GBP security, or a
 * genuinely non-US/non-UK holding, resolves to a wrong or empty lookup. `fetchGlobalQuote`
 * returns `not-found` for an unrecognised symbol rather than a fabricated price, so this
 * degrades to "Price unavailable," never a wrong number.
 */
export function resolveProviderSymbol(ticker: string, accountCurrency: string): string {
  return accountCurrency === 'GBP' ? `${ticker}.LON` : ticker;
}

/**
 * Whether Alpha Vantage's LSE (`.LON`) quotes are denominated in pence (GBX) rather than
 * pounds (GBP).
 *
 * **Verified 2026-07-27** via `scripts/verify-quote-provider.ts` against the household's
 * real holdings: Alpha Vantage returned `VUAG.LON` at 107.76 and `VHYG.LON` at 79.52,
 * against real-world prices of £107.84 and £79.52 respectively (Yahoo Finance / Hargreaves
 * Lansdown, 24 Jul 2026) — an exact match in pounds, not pence. `false`: no ×0.01
 * normalization is needed. (The `.LON` suffix is also confirmed as the correct GBP line —
 * the bare, non-suffixed tickers came back `not-found`, so there is no USD cross-listing
 * to accidentally pick up here.)
 */
export const LSE_QUOTES_ARE_GBX = false;

/**
 * Normalize a raw Alpha Vantage price into the plain decimal string `quote_cache` stores.
 *
 * No pence-to-pounds conversion happens here: verification confirmed Alpha Vantage
 * already returns LSE quotes in pounds, not pence (`LSE_QUOTES_ARE_GBX` above). This
 * function's job is to validate the shape — reject anything that isn't a plain decimal
 * with at most `PRICE_SCALE` fractional digits, the same discipline as `money.ts`'s
 * `parseMoneyInput` — before it reaches the database, not to apply a conversion that
 * verification found isn't needed.
 *
 * Throws on anything that doesn't parse, and on a zero or negative value — a real
 * security's price is never <= 0, so a `05. price` shaped like `"N/A"`, `"-1.0000"`, or a
 * value with more fractional digits than Alpha Vantage has ever been observed to send is a
 * malformed response, not a fabricated price this app should render as if genuine. The
 * caller (`ensureFreshQuotes`) is responsible for catching this and degrading gracefully,
 * the same as any other provider failure mode.
 */
export function normalizeQuotePrice(rawPrice: string): string {
  const scaled = parseScaledDecimal(rawPrice, PRICE_SCALE);
  if (scaled <= 0n) {
    throw new Error(`Price must be positive, got: ${JSON.stringify(rawPrice)}`);
  }
  return formatScaledDecimal(scaled, PRICE_SCALE);
}

export interface QuoteSource {
  fetchQuote(symbol: string): Promise<QuoteFetchResult>;
}

/** The real provider, wired up for production use. Tests inject a fake `QuoteSource`
 * instead — see `ensureFreshQuotes` below — so nothing in this codebase's test suite
 * ever makes a real Alpha Vantage call. */
export function createAlphaVantageQuoteSource(
  apiKey: string,
  fetchImpl: typeof fetch = fetch,
): QuoteSource {
  return { fetchQuote: (symbol) => fetchGlobalQuote(symbol, apiKey, fetchImpl) };
}

export interface QuoteRequest {
  symbol: string;
  /** ISO 4217, from `resolveProviderSymbol`'s caller (the requesting holding's account
   * currency) — recorded on first fetch rather than re-derived from the symbol string on
   * every read. */
  currency: string;
}

export interface QuoteView {
  /** `null` means the provider has confirmed no quote exists for this symbol (e.g. an
   * OEIC/mutual fund with no exchange ticker) — distinct from the symbol being absent
   * from the returned map entirely, which means no cached value exists at all. */
  price: string | null;
  currency: string;
  fetchedAt: Date;
  /** True when this value is older than the staleness threshold — a refetch was
   * attempted and failed (rate limit or network error), so the last known price is being
   * served instead of nothing. */
  stale: boolean;
}

/**
 * Read the quote cache for the requested symbols, refetching whichever are missing or
 * past `staleAfterHours`.
 *
 * Sequential, not parallel — Alpha Vantage's free tier has a per-minute sub-limit as well
 * as the daily one, and a household portfolio is a handful of tickers, not hundreds.
 *
 * A failed refetch (rate-limited or a network error) falls back to whatever is already
 * cached, marked `stale`, rather than surfacing an error to the page — a provider outage
 * must not break the page (the same posture docs/PROPOSAL.md takes for Open Banking). If
 * there is nothing cached yet and the fetch fails, the symbol is simply absent from the
 * returned map; callers render that the same way as a `null` price: "Price unavailable."
 *
 * A confirmed `not-found` (the provider has no quote for this symbol at all) is cached
 * with `price: null` rather than left unrecorded, so a symbol that will never resolve
 * doesn't get re-fetched on every single page load within the staleness window — it still
 * gets rechecked once the window passes, in case the provider adds coverage later.
 */
export async function ensureFreshQuotes(
  requests: readonly QuoteRequest[],
  options: { source: QuoteSource; staleAfterHours: number; now?: Date },
): Promise<Map<string, QuoteView>> {
  const symbols = Array.from(new Set(requests.map((request) => request.symbol)));
  if (symbols.length === 0) return new Map();

  const db = getDb();
  const now = options.now ?? new Date();
  const staleAfterMs = options.staleAfterHours * 60 * 60 * 1000;

  const existingRows = await db.select().from(quoteCache).where(inArray(quoteCache.symbol, symbols));
  const existingBySymbol = new Map(existingRows.map((row) => [row.symbol, row]));

  const result = new Map<string, QuoteView>();

  for (const request of requests) {
    if (result.has(request.symbol)) continue; // multiple holdings can share one ticker

    const existing = existingBySymbol.get(request.symbol);
    const isFresh =
      existing !== undefined && now.getTime() - existing.fetchedAt.getTime() < staleAfterMs;

    if (isFresh) {
      result.set(request.symbol, {
        price: existing.price,
        currency: existing.currency,
        fetchedAt: existing.fetchedAt,
        stale: false,
      });
      continue;
    }

    // Everything from here down — the fetch itself, price normalization, and the cache
    // write — is wrapped in one try/catch. `normalizeQuotePrice` throws on a malformed or
    // non-positive price (see its doc comment), and a DB write can fail transiently; either
    // must degrade the same way a rate-limited/network-error response does — serve the
    // last known price if one exists, otherwise omit the symbol — never let an exception
    // propagate out of this function and crash the page it's rendering into. This is the
    // one property this module promises everywhere else in its doc comments, so it applies
    // here without exception, not just to the failure modes `fetchQuote` itself catches.
    try {
      const fetchResult = await options.source.fetchQuote(request.symbol);

      if (fetchResult.status === 'ok') {
        const price = normalizeQuotePrice(fetchResult.rawPrice);
        await db
          .insert(quoteCache)
          .values({ symbol: request.symbol, currency: request.currency, price, fetchedAt: now })
          .onConflictDoUpdate({
            target: quoteCache.symbol,
            set: { currency: request.currency, price, fetchedAt: now },
          });
        result.set(request.symbol, { price, currency: request.currency, fetchedAt: now, stale: false });
        continue;
      }

      if (fetchResult.status === 'not-found') {
        await db
          .insert(quoteCache)
          .values({ symbol: request.symbol, currency: request.currency, price: null, fetchedAt: now })
          .onConflictDoUpdate({
            target: quoteCache.symbol,
            set: { currency: request.currency, price: null, fetchedAt: now },
          });
        result.set(request.symbol, {
          price: null,
          currency: request.currency,
          fetchedAt: now,
          stale: false,
        });
        continue;
      }

      // rate-limited / network-error: keep serving the last known price, however old,
      // rather than losing it over a transient provider problem.
      console.error(`[quotes] ${request.symbol}: ${fetchResult.status}, serving cached value`);
      if (existing) {
        result.set(request.symbol, {
          price: existing.price,
          currency: existing.currency,
          fetchedAt: existing.fetchedAt,
          stale: true,
        });
      }
    } catch (error) {
      console.error(`[quotes] ${request.symbol}: failed to refresh`, error);
      if (existing) {
        result.set(request.symbol, {
          price: existing.price,
          currency: existing.currency,
          fetchedAt: existing.fetchedAt,
          stale: true,
        });
      }
    }
  }

  return result;
}

export interface HoldingWithContext {
  id: number;
  ticker: string;
  /** NUMERIC(18,6) string. */
  quantity: string;
  /** NUMERIC(14,2) string. */
  costBasis: string;
  /** The owning account's currency — determines the provider symbol (`resolveProviderSymbol`)
   * and is therefore also the currency the valuation comes back in. */
  accountCurrency: string;
}

export interface HoldingValuation {
  /** `null` when no price is available (provider unreachable, or a confirmed no-quote
   * symbol like an OEIC) — never a fabricated value. */
  currentValuePence: bigint | null;
  gainLoss: GainLoss | null;
  quoteCurrency: string | null;
  quoteFetchedAt: Date | null;
  quoteStale: boolean;
}

/**
 * Value a set of holdings against live (or cached) quotes in one batch, keyed by
 * holding id.
 *
 * Bridges the provider/cache layer above with `valuation.ts`'s pure math: resolves each
 * holding's provider symbol, fetches/refreshes the whole batch through `ensureFreshQuotes`
 * (so holdings sharing a ticker across accounts still cost one API call), then computes
 * current value and gain/loss per holding from the result.
 */
export async function valueHoldings(
  holdingsList: readonly HoldingWithContext[],
  options: { source: QuoteSource; staleAfterHours: number },
): Promise<Map<number, HoldingValuation>> {
  const symbolByHoldingId = new Map(
    holdingsList.map((holding) => [
      holding.id,
      resolveProviderSymbol(holding.ticker, holding.accountCurrency),
    ]),
  );
  const requests: QuoteRequest[] = holdingsList.map((holding) => ({
    symbol: symbolByHoldingId.get(holding.id)!,
    currency: holding.accountCurrency,
  }));
  const quotes = await ensureFreshQuotes(requests, options);

  const result = new Map<number, HoldingValuation>();
  for (const holding of holdingsList) {
    const symbol = symbolByHoldingId.get(holding.id)!;
    const quote = quotes.get(symbol);

    if (!quote || quote.price === null) {
      result.set(holding.id, {
        currentValuePence: null,
        gainLoss: null,
        quoteCurrency: quote?.currency ?? null,
        quoteFetchedAt: quote?.fetchedAt ?? null,
        quoteStale: quote?.stale ?? false,
      });
      continue;
    }

    const valuePence = currentValuePence(holding.quantity, quote.price);
    result.set(holding.id, {
      currentValuePence: valuePence,
      gainLoss: gainLoss(numericToPence(holding.costBasis), valuePence),
      quoteCurrency: quote.currency,
      quoteFetchedAt: quote.fetchedAt,
      quoteStale: quote.stale,
    });
  }

  return result;
}
