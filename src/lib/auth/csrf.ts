/**
 * Explicit same-origin check for plain API route handlers.
 *
 * Next.js 14 Server Actions get an Origin/Host check for free, which covers Phase 0's
 * login and logout forms — see docs/DEPLOYMENT.md. Route handlers get no such
 * default, so any mutating route handler must call this. PROPOSAL.md's Security notes
 * calls this gap out specifically, naming the compute-persist-poll routes (Phase 3)
 * and the Open Banking OAuth callback (Phase 5) as the routes that will need it.
 *
 * Phase 0 ships exactly one route handler — GET /api/health — which is
 * non-mutating and therefore doesn't use this. It is implemented and tested now
 * because the first mutating route handler should not also be the first time this
 * logic is written.
 */

/**
 * Hosts that count as "us". Under `tailscale serve`, the browser's Origin is the
 * tailnet hostname while the app's own Host header is localhost:3000, so comparing
 * Origin against Host alone would reject every request. X-Forwarded-Host is
 * therefore consulted — safe here because the only thing that can set it is our own
 * reverse proxy on the loopback interface; on a directly-exposed app it would be
 * client-controlled and must not be trusted.
 */
function candidateHosts(headers: Headers): string[] {
  const hosts: string[] = [];
  const forwarded = headers.get('x-forwarded-host');
  const host = headers.get('host');
  if (forwarded) hosts.push(...forwarded.split(',').map((h) => h.trim()));
  if (host) hosts.push(host.trim());
  return hosts.filter(Boolean);
}

export type OriginCheck =
  | { ok: true }
  | { ok: false; reason: 'missing-origin' | 'missing-host' | 'origin-mismatch' };

/**
 * Verify that a request's Origin header matches one of this app's own hostnames.
 *
 * A missing Origin is treated as a failure, not a pass: browsers send Origin on all
 * cross-origin requests and on every same-origin POST/PUT/PATCH/DELETE, so an absent
 * Origin on a mutating request is either a non-browser client or an attempt to dodge
 * the check. Failing closed costs nothing here — every legitimate caller is our own
 * front-end.
 */
export function checkSameOrigin(request: {
  headers: Headers;
  method?: string;
}): OriginCheck {
  const origin = request.headers.get('origin');
  if (!origin) return { ok: false, reason: 'missing-origin' };

  const hosts = candidateHosts(request.headers);
  if (hosts.length === 0) return { ok: false, reason: 'missing-host' };

  let originHost: string;
  try {
    originHost = new URL(origin).host;
  } catch {
    return { ok: false, reason: 'origin-mismatch' };
  }

  return hosts.includes(originHost) ? { ok: true } : { ok: false, reason: 'origin-mismatch' };
}

/**
 * Convenience wrapper for route handlers: returns a 403 Response to return directly,
 * or null when the request is same-origin.
 */
export function sameOriginGuard(request: Request): Response | null {
  const result = checkSameOrigin(request);
  if (result.ok) return null;
  return new Response(JSON.stringify({ error: 'Cross-origin request rejected' }), {
    status: 403,
    headers: { 'content-type': 'application/json' },
  });
}
