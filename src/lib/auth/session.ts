/**
 * Session token: a signed (not encrypted) bearer token carried in an HTTP-only,
 * SameSite=Lax cookie with a 30-day rolling lifetime.
 *
 * Why hand-rolled rather than iron-session (both are sanctioned by PROPOSAL.md's
 * Security notes):
 *  - The token payload holds nothing secret — an issue time, an expiry, and a random
 *    session id. Signing is sufficient; encryption would only obscure values the
 *    client already knows.
 *  - It must be verifiable inside Next.js middleware, which runs in the edge runtime
 *    where `node:crypto` is unavailable. This module uses Web Crypto (`crypto.subtle`)
 *    only, so the exact same code path verifies in middleware and in Server Actions.
 *  - Rolling refresh needs an explicit "should I re-issue?" decision that is worth
 *    unit-testing directly. `shouldRefresh()` below is a pure function with tests.
 *
 * Token format: `v1.<base64url(json payload)>.<base64url(hmac-sha256)>`
 * The signature covers the literal `v1.<payload>` prefix, so the version cannot be
 * swapped without invalidating the signature.
 */

export const SESSION_TOKEN_VERSION = 'v1';

/** 30-day rolling lifetime, per the Security notes ("aggressive expiry just trains
 * passphrase-typing on a phone for a household tool"). */
export const SESSION_LIFETIME_SECONDS = 30 * 24 * 60 * 60;

/**
 * Re-issue a token once it is older than this. Rolling means "30 days from last
 * activity", but re-signing and re-setting the cookie on literally every request is
 * wasteful and makes every response uncacheable, so refresh is coarse-grained.
 */
export const SESSION_REFRESH_AFTER_SECONDS = 24 * 60 * 60;

export interface SessionPayload {
  /** Issued-at, seconds since epoch. */
  iat: number;
  /** Expiry, seconds since epoch. */
  exp: number;
  /** Random per-login id. Unused in Phase 0; present so sessions are distinguishable
   * in logs and so a future revocation list has something to key on. */
  sid: string;
}

export type SessionVerification =
  | { valid: true; payload: SessionPayload }
  | {
      valid: false;
      reason: 'malformed' | 'bad-version' | 'bad-signature' | 'expired';
    };

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// Return type is pinned to Uint8Array<ArrayBuffer> (not the default ArrayBufferLike)
// because crypto.subtle only accepts a non-shared BufferSource.
function base64UrlDecode(value: string): Uint8Array<ArrayBuffer> | null {
  if (!/^[A-Za-z0-9_-]*$/.test(value)) return null;
  const padded = value.replace(/-/g, '+').replace(/_/g, '/');
  try {
    const binary = atob(padded);
    const bytes = new Uint8Array(new ArrayBuffer(binary.length));
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return bytes;
  } catch {
    return null;
  }
}

async function importKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  );
}

function nowSeconds(clock: () => number): number {
  return Math.floor(clock() / 1000);
}

/** Cryptographically random session id. */
function randomSessionId(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Mint a signed session token.
 *
 * `clock` is injectable purely so the tests can assert expiry behaviour without
 * sleeping for 30 days.
 */
export async function issueSessionToken(
  secret: string,
  options: { clock?: () => number; lifetimeSeconds?: number } = {},
): Promise<{ token: string; payload: SessionPayload }> {
  const clock = options.clock ?? Date.now;
  const lifetime = options.lifetimeSeconds ?? SESSION_LIFETIME_SECONDS;
  const iat = nowSeconds(clock);
  const payload: SessionPayload = {
    iat,
    exp: iat + lifetime,
    sid: randomSessionId(),
  };

  const body = `${SESSION_TOKEN_VERSION}.${base64UrlEncode(encoder.encode(JSON.stringify(payload)))}`;
  const key = await importKey(secret);
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(body));
  return { token: `${body}.${base64UrlEncode(new Uint8Array(signature))}`, payload };
}

/**
 * Verify a session token's version, signature, and expiry — in that order, and with
 * the signature checked *before* the payload is parsed or trusted for anything.
 *
 * Signature comparison uses `crypto.subtle.verify`, which is constant-time; this
 * avoids the classic hand-rolled mistake of comparing hex strings with `===`.
 */
export async function verifySessionToken(
  token: string,
  secret: string,
  options: { clock?: () => number } = {},
): Promise<SessionVerification> {
  const clock = options.clock ?? Date.now;
  const parts = token.split('.');
  if (parts.length !== 3) return { valid: false, reason: 'malformed' };

  const [version, encodedPayload, encodedSignature] = parts as [string, string, string];
  if (version !== SESSION_TOKEN_VERSION) return { valid: false, reason: 'bad-version' };

  const signature = base64UrlDecode(encodedSignature);
  if (!signature || signature.length === 0) return { valid: false, reason: 'malformed' };

  const key = await importKey(secret);
  const signatureValid = await crypto.subtle.verify(
    'HMAC',
    key,
    signature,
    encoder.encode(`${version}.${encodedPayload}`),
  );
  if (!signatureValid) return { valid: false, reason: 'bad-signature' };

  const payloadBytes = base64UrlDecode(encodedPayload);
  if (!payloadBytes) return { valid: false, reason: 'malformed' };

  let parsed: unknown;
  try {
    parsed = JSON.parse(decoder.decode(payloadBytes));
  } catch {
    return { valid: false, reason: 'malformed' };
  }

  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    typeof (parsed as SessionPayload).iat !== 'number' ||
    typeof (parsed as SessionPayload).exp !== 'number' ||
    typeof (parsed as SessionPayload).sid !== 'string'
  ) {
    return { valid: false, reason: 'malformed' };
  }

  const payload = parsed as SessionPayload;
  if (payload.exp <= nowSeconds(clock)) return { valid: false, reason: 'expired' };

  return { valid: true, payload };
}

/**
 * Whether a still-valid session should be re-issued to extend the rolling window.
 * Pure so the rolling-lifetime rule can be tested without cookies or a request.
 */
export function shouldRefresh(
  payload: SessionPayload,
  options: { clock?: () => number } = {},
): boolean {
  const clock = options.clock ?? Date.now;
  return nowSeconds(clock) - payload.iat >= SESSION_REFRESH_AFTER_SECONDS;
}
