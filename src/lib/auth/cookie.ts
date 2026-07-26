import { cookieSecure } from '@/lib/env';
import { SESSION_LIFETIME_SECONDS } from '@/lib/auth/session';

/**
 * Session cookie name and attributes, in one place so middleware, the login action,
 * and the logout action cannot drift apart.
 *
 * Attributes required by PROPOSAL.md's Security notes:
 *  - httpOnly: JS can't read it, so an injected script can't exfiltrate the session.
 *  - sameSite 'lax': blocks cross-site POSTs while still allowing a normal top-level
 *    link into the app to arrive authenticated (important for a phone-bookmarked PWA).
 *  - secure: set from config, not sniffed from the request — see env.ts cookieSecure().
 *  - path '/': the whole app is behind the gate.
 *
 * Deliberately NOT using the `__Host-` prefix: it mandates Secure, which would make
 * plain-HTTP local development impossible.
 */
export const SESSION_COOKIE_NAME = 'hf_session';

export interface SessionCookieOptions {
  httpOnly: true;
  sameSite: 'lax';
  secure: boolean;
  path: string;
  maxAge: number;
}

export function sessionCookieOptions(): SessionCookieOptions {
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure: cookieSecure(),
    path: '/',
    maxAge: SESSION_LIFETIME_SECONDS,
  };
}

/** Same attributes, zero lifetime — used to clear the cookie on logout. */
export function clearedSessionCookieOptions(): SessionCookieOptions {
  return { ...sessionCookieOptions(), maxAge: 0 };
}
