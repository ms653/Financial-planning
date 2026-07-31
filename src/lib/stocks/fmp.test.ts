import { describe, expect, it, vi } from 'vitest';
import { fetchFundamentals } from './fmp';

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return { ok, status, json: async () => body } as Response;
}

const INCOME = [{ date: '2025-12-31', revenue: 1000 }];
const BALANCE = [{ date: '2025-12-31', totalStockholdersEquity: 500 }];
const CASH_FLOW = [{ date: '2025-12-31', freeCashFlow: 200 }];

describe('fetchFundamentals', () => {
  it('returns ok with all three statements on a successful lookup', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(INCOME))
      .mockResolvedValueOnce(jsonResponse(BALANCE))
      .mockResolvedValueOnce(jsonResponse(CASH_FLOW));

    const result = await fetchFundamentals('AAPL', 'key', fetchImpl);

    expect(result).toEqual({
      status: 'ok',
      ticker: 'AAPL',
      incomeStatements: INCOME,
      balanceSheets: BALANCE,
      cashFlowStatements: CASH_FLOW,
    });
  });

  it('calls the three endpoints in order with period=annual, limit=5, and the api key', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(INCOME))
      .mockResolvedValueOnce(jsonResponse(BALANCE))
      .mockResolvedValueOnce(jsonResponse(CASH_FLOW));

    await fetchFundamentals('AAPL', 'my-key', fetchImpl);

    expect(fetchImpl).toHaveBeenCalledTimes(3);
    const urls = fetchImpl.mock.calls.map((call) => new URL(call[0] as string));
    expect(urls[0]!.pathname).toBe('/api/v3/income-statement/AAPL');
    expect(urls[1]!.pathname).toBe('/api/v3/balance-sheet-statement/AAPL');
    expect(urls[2]!.pathname).toBe('/api/v3/cash-flow-statement/AAPL');
    for (const url of urls) {
      expect(url.searchParams.get('period')).toBe('annual');
      expect(url.searchParams.get('limit')).toBe('5');
      expect(url.searchParams.get('apikey')).toBe('my-key');
    }
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
