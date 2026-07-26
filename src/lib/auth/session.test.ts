import { describe, expect, it } from 'vitest';
import {
  SESSION_LIFETIME_SECONDS,
  SESSION_REFRESH_AFTER_SECONDS,
  issueSessionToken,
  shouldRefresh,
  verifySessionToken,
} from './session';

const SECRET = 'a'.repeat(48);
const OTHER_SECRET = 'b'.repeat(48);

/** Fixed clock so expiry assertions don't depend on wall time. */
function clockAt(ms: number) {
  return () => ms;
}

const T0 = Date.UTC(2026, 6, 26, 12, 0, 0);
const DAY_MS = 24 * 60 * 60 * 1000;

describe('issueSessionToken', () => {
  it('mints a v1 three-part token', async () => {
    const { token } = await issueSessionToken(SECRET, { clock: clockAt(T0) });
    const parts = token.split('.');
    expect(parts).toHaveLength(3);
    expect(parts[0]).toBe('v1');
  });

  it('sets a 30-day lifetime', async () => {
    const { payload } = await issueSessionToken(SECRET, { clock: clockAt(T0) });
    expect(payload.exp - payload.iat).toBe(SESSION_LIFETIME_SECONDS);
    expect(SESSION_LIFETIME_SECONDS).toBe(30 * 24 * 60 * 60);
  });

  it('gives each session a distinct random id', async () => {
    const a = await issueSessionToken(SECRET, { clock: clockAt(T0) });
    const b = await issueSessionToken(SECRET, { clock: clockAt(T0) });
    expect(a.payload.sid).not.toBe(b.payload.sid);
    expect(a.payload.sid).toMatch(/^[0-9a-f]{32}$/);
  });

  it('does not put the passphrase or secret in the token', async () => {
    const { token } = await issueSessionToken(SECRET, { clock: clockAt(T0) });
    expect(token).not.toContain(SECRET);
    const decoded = Buffer.from(token.split('.')[1] as string, 'base64url').toString('utf8');
    expect(decoded).not.toContain(SECRET);
    expect(Object.keys(JSON.parse(decoded)).sort()).toEqual(['exp', 'iat', 'sid']);
  });
});

describe('verifySessionToken', () => {
  it('accepts a freshly issued token', async () => {
    const { token, payload } = await issueSessionToken(SECRET, { clock: clockAt(T0) });
    const result = await verifySessionToken(token, SECRET, { clock: clockAt(T0) });
    expect(result).toEqual({ valid: true, payload });
  });

  it('rejects a token signed with a different secret', async () => {
    // This is the "rotate SESSION_SECRET to log everyone out" behaviour.
    const { token } = await issueSessionToken(OTHER_SECRET, { clock: clockAt(T0) });
    await expect(verifySessionToken(token, SECRET, { clock: clockAt(T0) })).resolves.toEqual({
      valid: false,
      reason: 'bad-signature',
    });
  });

  it('rejects a tampered payload — the forged-expiry attack', async () => {
    const { token } = await issueSessionToken(SECRET, { clock: clockAt(T0) });
    const [version, encodedPayload, signature] = token.split('.') as [string, string, string];
    const payload = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf8'));
    // Extend expiry by ten years and re-encode, keeping the original signature.
    payload.exp += 10 * 365 * 24 * 60 * 60;
    const forged = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
    await expect(
      verifySessionToken(`${version}.${forged}.${signature}`, SECRET, { clock: clockAt(T0) }),
    ).resolves.toEqual({ valid: false, reason: 'bad-signature' });
  });

  it('rejects a tampered signature', async () => {
    const { token } = await issueSessionToken(SECRET, { clock: clockAt(T0) });
    const [version, payload, signature] = token.split('.') as [string, string, string];
    // Tamper with the FIRST character, not the last. A 32-byte HMAC base64url-encodes to
    // 43 characters, of which the last carries only 4 significant bits — so flipping 'A'
    // to 'B' there changes two padding bits, decodes to byte-identical output, and the
    // signature still verifies. That made this test fail roughly one run in sixteen
    // (whenever the signature happened to end in 'A') while looking like it tested
    // tampering. Every bit of the first character is significant.
    const flipped = `${signature.startsWith('A') ? 'B' : 'A'}${signature.slice(1)}`;
    await expect(
      verifySessionToken(`${version}.${payload}.${flipped}`, SECRET, { clock: clockAt(T0) }),
    ).resolves.toEqual({ valid: false, reason: 'bad-signature' });
  });

  it('rejects an empty signature — the "alg=none" shape of this bug', async () => {
    const { token } = await issueSessionToken(SECRET, { clock: clockAt(T0) });
    const [version, payload] = token.split('.') as [string, string];
    await expect(
      verifySessionToken(`${version}.${payload}.`, SECRET, { clock: clockAt(T0) }),
    ).resolves.toEqual({ valid: false, reason: 'malformed' });
  });

  it('rejects a token whose version has been swapped', async () => {
    const { token } = await issueSessionToken(SECRET, { clock: clockAt(T0) });
    const [, payload, signature] = token.split('.') as [string, string, string];
    await expect(
      verifySessionToken(`v2.${payload}.${signature}`, SECRET, { clock: clockAt(T0) }),
    ).resolves.toEqual({ valid: false, reason: 'bad-version' });
  });

  it.each([
    ['empty string', ''],
    ['no separators', 'notatoken'],
    ['too few parts', 'v1.abc'],
    ['too many parts', 'v1.abc.def.ghi'],
    ['non-base64url payload', 'v1.!!!.###'],
  ])('rejects a malformed token: %s', async (_label, token) => {
    const result = await verifySessionToken(token, SECRET, { clock: clockAt(T0) });
    expect(result.valid).toBe(false);
  });

  it('rejects a validly-signed token carrying a non-session payload', async () => {
    // Signature valid, shape wrong — must not be treated as a session.
    const body = `v1.${Buffer.from(JSON.stringify({ hello: 'world' }), 'utf8').toString('base64url')}`;
    const key = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(SECRET),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign'],
    );
    const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body));
    const token = `${body}.${Buffer.from(signature).toString('base64url')}`;
    await expect(verifySessionToken(token, SECRET, { clock: clockAt(T0) })).resolves.toEqual({
      valid: false,
      reason: 'malformed',
    });
  });

  it('accepts a token one second before expiry', async () => {
    const { token } = await issueSessionToken(SECRET, { clock: clockAt(T0) });
    const justBefore = T0 + SESSION_LIFETIME_SECONDS * 1000 - 1000;
    const result = await verifySessionToken(token, SECRET, { clock: clockAt(justBefore) });
    expect(result.valid).toBe(true);
  });

  it('rejects a token at its expiry instant', async () => {
    const { token } = await issueSessionToken(SECRET, { clock: clockAt(T0) });
    const atExpiry = T0 + SESSION_LIFETIME_SECONDS * 1000;
    await expect(verifySessionToken(token, SECRET, { clock: clockAt(atExpiry) })).resolves.toEqual({
      valid: false,
      reason: 'expired',
    });
  });

  it('rejects a token 31 days later', async () => {
    const { token } = await issueSessionToken(SECRET, { clock: clockAt(T0) });
    await expect(
      verifySessionToken(token, SECRET, { clock: clockAt(T0 + 31 * DAY_MS) }),
    ).resolves.toEqual({ valid: false, reason: 'expired' });
  });

  it('checks the signature before trusting expiry', async () => {
    // A token that is both expired AND badly signed should report the signature
    // failure, proving the payload is never parsed before the signature is verified.
    const { token } = await issueSessionToken(OTHER_SECRET, {
      clock: clockAt(T0),
      lifetimeSeconds: 1,
    });
    await expect(
      verifySessionToken(token, SECRET, { clock: clockAt(T0 + 10_000) }),
    ).resolves.toEqual({ valid: false, reason: 'bad-signature' });
  });
});

describe('shouldRefresh (rolling lifetime)', () => {
  it('does not refresh a token issued moments ago', async () => {
    const { payload } = await issueSessionToken(SECRET, { clock: clockAt(T0) });
    expect(shouldRefresh(payload, { clock: clockAt(T0 + 60_000) })).toBe(false);
  });

  it('refreshes once the token is a day old', async () => {
    const { payload } = await issueSessionToken(SECRET, { clock: clockAt(T0) });
    expect(shouldRefresh(payload, { clock: clockAt(T0 + DAY_MS) })).toBe(true);
    expect(SESSION_REFRESH_AFTER_SECONDS).toBe(24 * 60 * 60);
  });

  it('extends the window to a full 30 days from the moment of refresh', async () => {
    const { payload: original } = await issueSessionToken(SECRET, { clock: clockAt(T0) });
    const refreshAt = T0 + 20 * DAY_MS;
    expect(shouldRefresh(original, { clock: clockAt(refreshAt) })).toBe(true);

    const { payload: refreshed } = await issueSessionToken(SECRET, { clock: clockAt(refreshAt) });
    // Rolling means "30 days from last activity", not "30 days from first login".
    expect(refreshed.exp).toBeGreaterThan(original.exp);
    expect(refreshed.exp - Math.floor(refreshAt / 1000)).toBe(SESSION_LIFETIME_SECONDS);
  });

  it('lets an unused session lapse: no refresh happens after expiry', async () => {
    const { token } = await issueSessionToken(SECRET, { clock: clockAt(T0) });
    // 40 days of no visits — verification fails, so middleware never reaches refresh.
    const result = await verifySessionToken(token, SECRET, { clock: clockAt(T0 + 40 * DAY_MS) });
    expect(result.valid).toBe(false);
  });
});
