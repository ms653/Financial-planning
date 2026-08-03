import { describe, expect, it, vi } from 'vitest';
import { fetchFundamentals } from './fmp';

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return { ok, status, json: async () => body } as Response;
}

const INCOME = [{ date: '2025-12-31', revenue: 1000 }];
const BALANCE = [{ date: '2025-12-31', totalStockholdersEquity: 500 }];
const CASH_FLOW = [{ date: '2025-12-31', freeCashFlow: 200 }];
const PROFILE = [{ symbol: 'AAPL', beta: 1.097 }];
const RATIOS = [{ date: '2025-12-31', priceToEarningsRatio: 34.1 }];
const KEY_METRICS = [{ date: '2025-12-31', evToEBITDA: 27.0 }];
const PEERS = [{ symbol: 'MSFT', companyName: 'Microsoft Corporation' }];

/** Matches the seven calls a fully-successful `fetchFundamentals` makes: three
 * statements, then profile, ratios, key-metrics, peers — in that order. */
function sevenCallFetch(...responses: [unknown, unknown, unknown, unknown, unknown, unknown, unknown]) {
  const mock = vi.fn();
  for (const response of responses) {
    mock.mockResolvedValueOnce(jsonResponse(response));
  }
  return mock;
}

describe('fetchFundamentals', () => {
  it('returns ok with all three statements, beta, ratios, key metrics, and peers on a successful lookup', async () => {
    const fetchImpl = sevenCallFetch(INCOME, BALANCE, CASH_FLOW, PROFILE, RATIOS, KEY_METRICS, PEERS);

    const result = await fetchFundamentals('AAPL', 'key', fetchImpl);

    expect(result).toEqual({
      status: 'ok',
      ticker: 'AAPL',
      incomeStatements: INCOME,
      balanceSheets: BALANCE,
      cashFlowStatements: CASH_FLOW,
      beta: 1.097,
      ratios: RATIOS,
      keyMetrics: KEY_METRICS,
      peers: [{ ticker: 'MSFT', companyName: 'Microsoft Corporation' }],
    });
  });

  it('calls the seven endpoints in order with period=annual, limit=5, and the api key (except peers/profile)', async () => {
    const fetchImpl = sevenCallFetch(INCOME, BALANCE, CASH_FLOW, PROFILE, RATIOS, KEY_METRICS, PEERS);

    await fetchFundamentals('AAPL', 'my-key', fetchImpl);

    expect(fetchImpl).toHaveBeenCalledTimes(7);
    const urls = fetchImpl.mock.calls.map((call) => new URL(call[0] as string));
    expect(urls[0]!.pathname).toBe('/stable/income-statement');
    expect(urls[1]!.pathname).toBe('/stable/balance-sheet-statement');
    expect(urls[2]!.pathname).toBe('/stable/cash-flow-statement');
    expect(urls[3]!.pathname).toBe('/stable/profile');
    expect(urls[4]!.pathname).toBe('/stable/ratios');
    expect(urls[5]!.pathname).toBe('/stable/key-metrics');
    expect(urls[6]!.pathname).toBe('/stable/stock-peers');
    for (const url of [urls[0]!, urls[1]!, urls[2]!, urls[4]!, urls[5]!]) {
      expect(url.searchParams.get('symbol')).toBe('AAPL');
      expect(url.searchParams.get('period')).toBe('annual');
      expect(url.searchParams.get('limit')).toBe('5');
      expect(url.searchParams.get('apikey')).toBe('my-key');
    }
    // Profile and peers have no period/limit — neither is a time-series statement.
    for (const url of [urls[3]!, urls[6]!]) {
      expect(url.searchParams.get('symbol')).toBe('AAPL');
      expect(url.searchParams.get('apikey')).toBe('my-key');
      expect(url.searchParams.get('period')).toBeNull();
    }
  });

  it('degrades to beta: null (not a failed fetch) when the profile call fails', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(INCOME))
      .mockResolvedValueOnce(jsonResponse(BALANCE))
      .mockResolvedValueOnce(jsonResponse(CASH_FLOW))
      .mockResolvedValueOnce(jsonResponse({}, false, 503))
      .mockResolvedValue(jsonResponse([]));

    const result = await fetchFundamentals('AAPL', 'key', fetchImpl);

    expect(result).toEqual({
      status: 'ok',
      ticker: 'AAPL',
      incomeStatements: INCOME,
      balanceSheets: BALANCE,
      cashFlowStatements: CASH_FLOW,
      beta: null,
      ratios: [],
      keyMetrics: [],
      peers: [],
    });
  });

  it('degrades to beta: null when the profile has no numeric beta field', async () => {
    const fetchImpl = sevenCallFetch(INCOME, BALANCE, CASH_FLOW, [{ symbol: 'AAPL' }], RATIOS, KEY_METRICS, PEERS);
    const result = await fetchFundamentals('AAPL', 'key', fetchImpl);
    expect(result).toMatchObject({ status: 'ok', beta: null });
  });

  it('degrades ratios/keyMetrics/peers to [] independently when each fails, without affecting the others', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(INCOME))
      .mockResolvedValueOnce(jsonResponse(BALANCE))
      .mockResolvedValueOnce(jsonResponse(CASH_FLOW))
      .mockResolvedValueOnce(jsonResponse(PROFILE))
      .mockResolvedValueOnce(jsonResponse({}, false, 503)) // ratios fails
      .mockResolvedValueOnce(jsonResponse(KEY_METRICS)) // key-metrics still succeeds
      .mockResolvedValueOnce(jsonResponse({ 'Error Message': 'nope' })); // peers fails differently

    const result = await fetchFundamentals('AAPL', 'key', fetchImpl);

    expect(result).toMatchObject({
      status: 'ok',
      beta: 1.097,
      ratios: [],
      keyMetrics: KEY_METRICS,
      peers: [],
    });
  });

  it('filters out a peer entry missing symbol or companyName rather than including a malformed one', async () => {
    const fetchImpl = sevenCallFetch(INCOME, BALANCE, CASH_FLOW, PROFILE, RATIOS, KEY_METRICS, [
      { symbol: 'MSFT', companyName: 'Microsoft Corporation' },
      { symbol: 'NOCOMPANYNAME' },
      { companyName: 'No Symbol Inc' },
    ]);
    const result = await fetchFundamentals('AAPL', 'key', fetchImpl);
    expect(result).toMatchObject({ peers: [{ ticker: 'MSFT', companyName: 'Microsoft Corporation' }] });
  });

  it('treats an empty array response as not-found (unknown ticker)', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse([]));
    const result = await fetchFundamentals('NOTATICKER', 'key', fetchImpl);
    expect(result).toEqual({ status: 'not-found' });
  });

  it('stops after the first not-found statement rather than fetching all three', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse([]));
    await fetchFundamentals('NOTATICKER', 'key', fetchImpl);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  // Regression for a real, live-verified finding: a ticker this plan won't serve
  // fundamentals for responds HTTP 402 with a plain-text (non-JSON) body — confirmed
  // 2026-08-01 with a real API key against a deliberately-fake symbol. Treated as
  // not-found (a permanent, cacheable answer for this ticker on this plan), not
  // network-error — and specifically never reaches `response.json()`, which would
  // throw on the real plain-text body.
  it('treats HTTP 402 as not-found, without attempting to parse the body as JSON', async () => {
    const jsonSpy = vi.fn(() => {
      throw new Error('should never be called for a 402');
    });
    const fetchImpl = vi.fn().mockResolvedValue({ ok: false, status: 402, json: jsonSpy } as unknown as Response);

    const result = await fetchFundamentals('NOTATICKERXYZ', 'key', fetchImpl);

    expect(result).toEqual({ status: 'not-found' });
    expect(jsonSpy).not.toHaveBeenCalled();
  });

  it('treats a non-array object response (an "Error Message" shape) as rate-limited', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse({ 'Error Message': 'Invalid API KEY.' }),
    );
    const result = await fetchFundamentals('AAPL', 'bad-key', fetchImpl);
    expect(result).toEqual({ status: 'rate-limited' });
  });

  it('treats a non-OK HTTP status as a network error', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({}, false, 503));
    const result = await fetchFundamentals('AAPL', 'key', fetchImpl);
    expect(result).toEqual({ status: 'network-error', message: 'HTTP 503' });
  });

  it('treats a thrown fetch error as a network error', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error('getaddrinfo ENOTFOUND'));
    const result = await fetchFundamentals('AAPL', 'key', fetchImpl);
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
    const result = await fetchFundamentals('AAPL', 'key', fetchImpl);
    expect(result).toEqual({ status: 'network-error', message: 'Response was not valid JSON' });
  });

  it('short-circuits on the second call if the balance sheet fails, without calling cash flow', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(INCOME))
      .mockResolvedValueOnce(jsonResponse({}, false, 503));

    const result = await fetchFundamentals('AAPL', 'key', fetchImpl);

    expect(result).toEqual({ status: 'network-error', message: 'HTTP 503' });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
});
