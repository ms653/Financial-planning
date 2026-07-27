import { describe, expect, it, vi } from 'vitest';
import { fetchGlobalQuote, normalizeQuotePrice, resolveProviderSymbol } from './quotes';

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    json: async () => body,
  } as Response;
}

describe('fetchGlobalQuote', () => {
  it('returns ok with the raw, un-normalized price on a successful lookup', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse({
        'Global Quote': { '01. symbol': 'VWRL.LON', '05. price': '135.7400' },
      }),
    );
    const result = await fetchGlobalQuote('VWRL.LON', 'key', fetchImpl);
    expect(result).toEqual({ status: 'ok', symbol: 'VWRL.LON', rawPrice: '135.7400' });
  });

  it('passes the function, symbol, and api key as query params', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse({ 'Global Quote': { '05. price': '1.00' } }),
    );
    await fetchGlobalQuote('VWRL.LON', 'my-key', fetchImpl);
    const calledUrl = new URL(fetchImpl.mock.calls[0]?.[0] as string);
    expect(calledUrl.searchParams.get('function')).toBe('GLOBAL_QUOTE');
    expect(calledUrl.searchParams.get('symbol')).toBe('VWRL.LON');
    expect(calledUrl.searchParams.get('apikey')).toBe('my-key');
  });

  it('treats an empty Global Quote object as not-found (unknown symbol)', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ 'Global Quote': {} }));
    const result = await fetchGlobalQuote('NOTATICKER', 'key', fetchImpl);
    expect(result).toEqual({ status: 'not-found' });
  });

  it('treats a missing Global Quote field as not-found', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ something: 'else' }));
    const result = await fetchGlobalQuote('VWRL.LON', 'key', fetchImpl);
    expect(result).toEqual({ status: 'not-found' });
  });

  it('treats a "Note" field as rate-limited', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse({ Note: 'Thank you for using Alpha Vantage! Our standard API rate limit is...' }),
    );
    const result = await fetchGlobalQuote('VWRL.LON', 'key', fetchImpl);
    expect(result).toEqual({ status: 'rate-limited' });
  });

  it('treats an "Information" field as rate-limited', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse({ Information: 'Thank you for using Alpha Vantage! ...25 requests per day...' }),
    );
    const result = await fetchGlobalQuote('VWRL.LON', 'key', fetchImpl);
    expect(result).toEqual({ status: 'rate-limited' });
  });

  it('treats a non-OK HTTP status as a network error', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({}, false, 503));
    const result = await fetchGlobalQuote('VWRL.LON', 'key', fetchImpl);
    expect(result).toEqual({ status: 'network-error', message: 'HTTP 503' });
  });

  it('treats a thrown fetch error as a network error', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error('getaddrinfo ENOTFOUND'));
    const result = await fetchGlobalQuote('VWRL.LON', 'key', fetchImpl);
    expect(result).toEqual({ status: 'network-error', message: 'getaddrinfo ENOTFOUND' });
  });

  it('treats invalid JSON as a network error rather than throwing', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => {
        throw new SyntaxError('Unexpected token');
      },
    } as unknown as Response);
    const result = await fetchGlobalQuote('VWRL.LON', 'key', fetchImpl);
    expect(result).toEqual({ status: 'network-error', message: 'Response was not valid JSON' });
  });

  it('treats a missing "05. price" field as not-found', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse({ 'Global Quote': { '01. symbol': 'VWRL.LON' } }),
    );
    const result = await fetchGlobalQuote('VWRL.LON', 'key', fetchImpl);
    expect(result).toEqual({ status: 'not-found' });
  });
});

describe('resolveProviderSymbol', () => {
  it('appends .LON for GBP-currency accounts', () => {
    expect(resolveProviderSymbol('VWRL', 'GBP')).toBe('VWRL.LON');
  });

  it('sends the bare ticker for non-GBP accounts, assumed US-listed', () => {
    expect(resolveProviderSymbol('VOO', 'USD')).toBe('VOO');
  });
});

describe('normalizeQuotePrice', () => {
  it('passes through a well-formed positive price', () => {
    expect(normalizeQuotePrice('107.7600')).toBe('107.7600');
  });

  it('zero-pads a price with fewer than 4 decimal places', () => {
    expect(normalizeQuotePrice('107.76')).toBe('107.7600');
  });

  // Found by independent code review: a malformed "05. price" value (a real possibility
  // from a third-party API — "N/A", a thousands separator, more decimals than expected)
  // must be rejected here, not reach the database or a page render, since the caller
  // (`ensureFreshQuotes`) is only correct if this function either returns a valid price or
  // throws — never returns something that renders as a real, if wrong, number.
  it('rejects a non-numeric price', () => {
    expect(() => normalizeQuotePrice('N/A')).toThrow();
  });

  it('rejects a zero price — no real security is ever worth exactly nothing', () => {
    expect(() => normalizeQuotePrice('0.0000')).toThrow(/must be positive/);
  });

  it('rejects a negative price', () => {
    expect(() => normalizeQuotePrice('-107.7600')).toThrow(/must be positive/);
  });

  it('rejects more decimal places than the schema allows', () => {
    expect(() => normalizeQuotePrice('107.760000')).toThrow(/too many decimal places/i);
  });

  it('rejects a thousands separator', () => {
    expect(() => normalizeQuotePrice('1,234.56')).toThrow();
  });
});
