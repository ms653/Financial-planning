import { NextResponse, type NextRequest } from 'next/server';
import { SESSION_COOKIE_NAME, sessionCookieOptions } from '@/lib/auth/cookie';
import {
  issueSessionToken,
  shouldRefresh,
  verifySessionToken,
} from '@/lib/auth/session';
import { sessionSecret } from '@/lib/env';

/**
 * The passphrase gate. Everything except the login page and the health endpoint
 * requires a valid session.
 *
 * This runs in Next's edge runtime, which is why src/lib/auth/session.ts is built on
 * Web Crypto rather than node:crypto — see the note at the top of that file.
 */

const PUBLIC_PATHS = new Set<string>(['/login']);

function isPublic(pathname: string): boolean {
  if (PUBLIC_PATHS.has(pathname)) return true;
  // Health check must answer without a session so Docker/uptime checks don't need
  // credentials. It exposes no household data — see src/app/api/health/route.ts.
  if (pathname === '/api/health') return true;
  return false;
}

export async function middleware(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const token = request.cookies.get(SESSION_COOKIE_NAME)?.value;

  let secret: string;
  try {
    secret = sessionSecret();
  } catch {
    // Misconfigured deployment. Treat everyone as unauthenticated rather than
    // throwing on every route; /login will surface the real error on submit.
    secret = '';
  }

  const verification =
    token && secret ? await verifySessionToken(token, secret) : ({ valid: false } as const);

  if (isPublic(pathname)) {
    // Already signed in and heading for the login page: send them home instead of
    // showing a gate they've already passed.
    if (pathname === '/login' && verification.valid) {
      return NextResponse.redirect(new URL('/', request.url));
    }
    return NextResponse.next();
  }

  if (!verification.valid) {
    const loginUrl = new URL('/login', request.url);
    // Preserve where they were headed. Only relative paths, so this can't be turned
    // into an open redirect (see src/app/login/actions.ts safeRedirectTarget).
    if (pathname !== '/') loginUrl.searchParams.set('next', `${pathname}${search}`);
    const response = NextResponse.redirect(loginUrl);
    // Clear an expired/tampered cookie so the browser stops sending it.
    if (token) response.cookies.set(SESSION_COOKIE_NAME, '', { ...sessionCookieOptions(), maxAge: 0 });
    return response;
  }

  const response = NextResponse.next();

  // Rolling 30-day lifetime: re-issue once the current token is a day old, so an
  // actively-used session never expires while an abandoned one does.
  if (shouldRefresh(verification.payload)) {
    const { token: refreshed } = await issueSessionToken(secret);
    response.cookies.set(SESSION_COOKIE_NAME, refreshed, sessionCookieOptions());
  }

  return response;
}

export const config = {
  /**
   * Skip Next's internals and static files. `_next/static` and `_next/image` carry no
   * household data; page and route-handler requests all pass through the gate above.
   */
  matcher: ['/((?!_next/static|_next/image|favicon.ico|manifest.webmanifest).*)'],
};
