import { describe, expect, it } from 'vitest';
import { checkSameOrigin, sameOriginGuard } from './csrf';

function req(headers: Record<string, string>): { headers: Headers } {
  return { headers: new Headers(headers) };
}

describe('checkSameOrigin', () => {
  it('accepts a same-origin request', () => {
    expect(
      checkSameOrigin(req({ origin: 'http://localhost:3000', host: 'localhost:3000' })),
    ).toEqual({ ok: true });
  });

  it('rejects a cross-origin request', () => {
    expect(
      checkSameOrigin(req({ origin: 'https://evil.example', host: 'localhost:3000' })),
    ).toEqual({ ok: false, reason: 'origin-mismatch' });
  });

  it('rejects a missing Origin header, rather than failing open', () => {
    expect(checkSameOrigin(req({ host: 'localhost:3000' }))).toEqual({
      ok: false,
      reason: 'missing-origin',
    });
  });

  it('rejects when no host header is present at all', () => {
    expect(checkSameOrigin(req({ origin: 'http://localhost:3000' }))).toEqual({
      ok: false,
      reason: 'missing-host',
    });
  });

  it('accepts the tailnet hostname via x-forwarded-host under tailscale serve', () => {
    // The realistic deployment shape: browser is on the tailnet name over HTTPS, the
    // app sees localhost. Comparing Origin to Host alone would reject every request.
    expect(
      checkSameOrigin(
        req({
          origin: 'https://laptop.tailnet-name.ts.net',
          host: 'localhost:3000',
          'x-forwarded-host': 'laptop.tailnet-name.ts.net',
        }),
      ),
    ).toEqual({ ok: true });
  });

  it('still accepts a direct localhost request when x-forwarded-host is also present', () => {
    expect(
      checkSameOrigin(
        req({
          origin: 'http://localhost:3000',
          host: 'localhost:3000',
          'x-forwarded-host': 'laptop.tailnet-name.ts.net',
        }),
      ),
    ).toEqual({ ok: true });
  });

  it('handles a comma-separated x-forwarded-host chain', () => {
    expect(
      checkSameOrigin(
        req({
          origin: 'https://laptop.tailnet-name.ts.net',
          host: 'localhost:3000',
          'x-forwarded-host': 'laptop.tailnet-name.ts.net, inner-proxy:8080',
        }),
      ),
    ).toEqual({ ok: true });
  });

  it('treats a port mismatch as cross-origin', () => {
    expect(
      checkSameOrigin(req({ origin: 'http://localhost:3001', host: 'localhost:3000' })),
    ).toEqual({ ok: false, reason: 'origin-mismatch' });
  });

  it('is not fooled by a hostname that merely contains ours', () => {
    expect(
      checkSameOrigin(req({ origin: 'https://localhost:3000.evil.example', host: 'localhost:3000' })),
    ).toEqual({ ok: false, reason: 'origin-mismatch' });
  });

  it('rejects the literal string "null" origin (sandboxed iframe / opaque origin)', () => {
    expect(checkSameOrigin(req({ origin: 'null', host: 'localhost:3000' }))).toEqual({
      ok: false,
      reason: 'origin-mismatch',
    });
  });

  it('rejects an unparseable Origin', () => {
    expect(checkSameOrigin(req({ origin: 'not a url', host: 'localhost:3000' }))).toEqual({
      ok: false,
      reason: 'origin-mismatch',
    });
  });

  it('ignores scheme when comparing — TLS termination happens upstream', () => {
    // Under tailscale serve the app is reached over http internally while the browser
    // used https, so requiring a scheme match would break every request.
    expect(
      checkSameOrigin(req({ origin: 'https://localhost:3000', host: 'localhost:3000' })),
    ).toEqual({ ok: true });
  });
});

describe('sameOriginGuard', () => {
  it('returns null for a same-origin request', () => {
    const request = new Request('http://localhost:3000/api/thing', {
      method: 'POST',
      headers: { origin: 'http://localhost:3000', host: 'localhost:3000' },
    });
    expect(sameOriginGuard(request)).toBeNull();
  });

  it('returns a 403 Response for a cross-origin request', () => {
    const request = new Request('http://localhost:3000/api/thing', {
      method: 'POST',
      headers: { origin: 'https://evil.example', host: 'localhost:3000' },
    });
    const response = sameOriginGuard(request);
    expect(response).not.toBeNull();
    expect(response?.status).toBe(403);
  });
});
