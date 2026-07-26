/**
 * Post-login redirect target sanitisation.
 *
 * Lives in its own module rather than alongside the login action because a
 * `'use server'` file may only export async functions, and this needs to be a plain
 * synchronous function so it can be unit-tested directly.
 */

/**
 * True if the string contains a C0 control character, DEL, or any whitespace.
 * Written as an explicit scan rather than a regex so no control characters appear
 * literally in this source file.
 */
function hasUnsafeCharacters(value: string): boolean {
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if (code <= 31 || code === 127) return true;
    if (/\s/.test(value[i] as string)) return true;
  }
  return false;
}

/**
 * Reduce an untrusted `next` parameter to a safe relative path.
 *
 * Rejected, with reasons:
 *  - anything not starting with `/` — an absolute URL or a scheme-relative reference.
 *  - `//host` — a protocol-relative URL, which browsers resolve to a *different origin*
 *    despite looking like a path. This is the classic open-redirect bypass.
 *  - a backslash anywhere — some browsers normalise `\` to `/`, so `/\evil.example`
 *    can be read as `//evil.example`.
 *  - control characters or whitespace — used to smuggle past naive prefix checks and to
 *    inject into headers.
 */
export function safeRedirectTarget(candidate: string | undefined | null): string {
  if (!candidate) return '/';
  if (!candidate.startsWith('/')) return '/';
  if (candidate.startsWith('//')) return '/';
  if (candidate.includes('\\')) return '/';
  if (hasUnsafeCharacters(candidate)) return '/';
  return candidate;
}
