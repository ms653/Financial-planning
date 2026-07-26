'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import {
  SESSION_COOKIE_NAME,
  clearedSessionCookieOptions,
  sessionCookieOptions,
} from '@/lib/auth/cookie';
import { GLOBAL_LOGIN_KEY, loginRateLimiter } from '@/lib/auth/lockout';
import { verifyPassphrase } from '@/lib/auth/passphrase';
import { safeRedirectTarget } from '@/lib/auth/redirect';
import { issueSessionToken } from '@/lib/auth/session';
import { passphraseHash, sessionSecret } from '@/lib/env';

/**
 * Login and logout.
 *
 * CSRF: these are Server Actions, which Next.js 14 restricts to POST and guards with
 * an Origin/Host check — that is the app's CSRF defence for form submissions, as
 * stated in PROPOSAL.md's Security notes. Note that this check is also what
 * `experimental.serverActions.allowedOrigins` in next.config.mjs exists to keep working
 * under `tailscale serve`; without it the reverse proxy's host rewrite reads as a
 * cross-origin attempt and every login is rejected.
 */

export type LoginResult =
  | { ok: false; kind: 'invalid'; message: string }
  | { ok: false; kind: 'locked'; message: string; retryAfterSeconds: number }
  | { ok: false; kind: 'misconfigured'; message: string };
// Success returns nothing: the action redirects, which throws NEXT_REDIRECT.

function lockoutMessage(retryAfterMs: number): string {
  const seconds = Math.max(1, Math.ceil(retryAfterMs / 1000));
  return `Too many incorrect attempts. Try again in ${seconds} second${seconds === 1 ? '' : 's'}.`;
}

export async function login(formData: FormData): Promise<LoginResult> {
  const passphrase = String(formData.get('passphrase') ?? '');
  const target = safeRedirectTarget(String(formData.get('next') ?? '') || null);

  // Check the lockout BEFORE verifying. Verifying first would burn a full argon2id
  // hash on every request from a locked-out client, which is both pointless and a
  // cheap way to load the CPU.
  const existing = loginRateLimiter.status(GLOBAL_LOGIN_KEY);
  if (existing.locked) {
    return {
      ok: false,
      kind: 'locked',
      message: lockoutMessage(existing.retryAfterMs),
      retryAfterSeconds: Math.ceil(existing.retryAfterMs / 1000),
    };
  }

  let storedHash: string;
  let secret: string;
  try {
    storedHash = passphraseHash();
    secret = sessionSecret();
  } catch (error) {
    console.error('[auth] login blocked by configuration error:', error);
    return {
      ok: false,
      kind: 'misconfigured',
      // Surfaced rather than hidden behind the generic message: only someone who can
      // reach this app over the tailnet sees it, and a silent generic failure for a
      // missing environment variable is genuinely hard to diagnose at 11pm.
      message:
        'This app is not configured correctly — APP_PASSPHRASE_HASH or SESSION_SECRET is missing or invalid. See docs/DEPLOYMENT.md.',
    };
  }

  const verification = await verifyPassphrase(passphrase, storedHash);

  if (!verification.ok) {
    if (verification.reason === 'misconfigured-hash') {
      console.error(
        '[auth] APP_PASSPHRASE_HASH is not a valid argon2id hash. Generate one with `npm run passphrase:hash`.',
      );
      return {
        ok: false,
        kind: 'misconfigured',
        message:
          'This app is not configured correctly — APP_PASSPHRASE_HASH is not a valid argon2id hash. See docs/DEPLOYMENT.md.',
      };
    }

    // An empty submission is not counted as a failed attempt: it carries no guess, and
    // counting it would let a stray Enter keypress consume the household's allowance.
    if (verification.reason === 'empty-input') {
      return { ok: false, kind: 'invalid', message: 'Enter your passphrase.' };
    }

    const status = loginRateLimiter.recordFailure(GLOBAL_LOGIN_KEY);
    if (status.locked) {
      return {
        ok: false,
        kind: 'locked',
        message: lockoutMessage(status.retryAfterMs),
        retryAfterSeconds: Math.ceil(status.retryAfterMs / 1000),
      };
    }
    return { ok: false, kind: 'invalid', message: 'That passphrase is not right.' };
  }

  loginRateLimiter.recordSuccess(GLOBAL_LOGIN_KEY);

  const { token } = await issueSessionToken(secret);
  cookies().set(SESSION_COOKIE_NAME, token, sessionCookieOptions());

  redirect(target);
}

export async function logout(): Promise<void> {
  cookies().set(SESSION_COOKIE_NAME, '', clearedSessionCookieOptions());
  redirect('/login');
}
