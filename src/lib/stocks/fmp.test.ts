import { describe, expect, it, vi } from 'vitest';
import { fetchFundamentals } from './fmp';

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return { ok, status, json: async () => body } as Response;
}

const INCOME = [{ date: '2025-12-31', revenue: 1000 }];
const BALANCE = [{ date: '2025-12-31', totalStockholdersEquity: 500 }];
const CASH_FLOW = [{ date: '2025-12-31', freeCashFlow: 200 }];
const PROFILE = [{ symbol: 'AAPL', beta: 1.097 }];

/** Matches the four calls a fully-successful `fetchFundamentals` makes: three
 * statements, then the profile. */
function fourCallFetch(...responses: [unknown, unknown, unknown, unknown]) {
  return vi
    .fn()
    .mockResolvedValueOnce(jsonResponse(responses[0]))
    .mockResolvedValueOnce(jsonResponse(responses[1]))
    .mockResolvedValueOnce(jsonResponse(responses[2]))
    .mockResolvedValueOnce(jsonResponse(responses[3]));
}

describe('fetchFundamentals', () => {
  it('returns ok with all three statements and beta on a successful lookup', async () => {
    const fetchImpl = fourCallFetch(INCOME, BALANCE, CASH_FLOW, PROFILE);

    const result = await fetchFundamentals('AAPL', 'key', fetchImpl);

    expect(result).toEqual({
      status: 'ok',
      ticker: 'AAPL',
      incomeStatements: INCOME,
      balanceSheets: BALANCE,
      cashFlowStatements: CASH_FLOW,
      beta: 1.097,
    });
  });

  it('calls the four endpoints in order with period=annual, limit=5, and the api key', async () => {
    const fetchImpl = fourCallFetch(INCOME, BALANCE, CASH_FLOW, PROFILE);

    await fetchFundamentals('AAPL', 'my-key', fetchImpl);

    expect(fetchImpl).toHaveBeenCalledTimes(4);
    const urls = fetchImpl.mock.calls.map((call) => new URL(call[0] as string));
    expect(urls[0]!.pathname).toBe('/stable/income-statement');
    expect(urls[1]!.pathname).toBe('/stable/balance-sheet-statement');
    expect(urls[2]!.pathname).toBe('/stable/cash-flow-statement');
    expect(urls[3]!.pathname).toBe('/stable/profile');
    for (const url of [urls[0]!, urls[1]!, urls[2]!]) {
      expect(url.searchParams.get('symbol')).toBe('AAPL');
      expect(url.searchParams.get('period')).toBe('annual');
      expect(url.searchParams.get('limit')).toBe('5');
      expect(url.searchParams.get('apikey')).toBe('my-key');
    }
    // Profile has no period/limit — it's not a time-series statement.
    expect(urls[3]!.searchParams.get('symbol')).toBe('AAPL');
    expect(urls[3]!.searchParams.get('apikey')).toBe('my-key');
    expect(urls[3]!.searchParams.get('period')).toBeNull();
  });

  it('degrades to beta: null (not a failed fetch) when the profile call fails', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(INCOME))
      .mockResolvedValueOnce(jsonResponse(BALANCE))
      .mockResolvedValueOnce(jsonResponse(CASH_FLOW))
      .mockResolvedValueOnce(jsonResponse({}, false, 503));

    const result = await fetchFundamentals('AAPL', 'key', fetchImpl);

    expect(result).toEqual({
      status: 'ok',
      ticker: 'AAPL',
      incomeStatements: INCOME,
      balanceSheets: BALANCE,
      cashFlowStatements: CASH_FLOW,
      beta: null,
    });
  });

  it('degrades to beta: null when the profile has no numeric beta field', async () => {
    const fetchImpl = fourCallFetch(INCOME, BALANCE, CASH_FLOW, [{ symbol: 'AAPL' }]);
    const result = await fetchFundamentals('AAPL', 'key', fetchImpl);
    expect(result).toMatchObject({ status: 'ok', beta: null });
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
