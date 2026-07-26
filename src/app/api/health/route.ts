import { getPool } from '@/lib/db/client';

/**
 * Liveness/readiness probe for docker-compose and deploy.sh.
 *
 * Deliberately unauthenticated (allow-listed in src/middleware.ts) so a container
 * healthcheck doesn't need credentials, and deliberately mute: it reports whether the
 * app is up and whether Postgres answers, and nothing about the household's data.
 *
 * GET only. It performs no mutation, so it does not need the Origin check in
 * src/lib/auth/csrf.ts — the first mutating route handler (Phase 3's simulation-run
 * endpoints) must call `sameOriginGuard`, since Next's Server Action CSRF protection
 * does not extend to route handlers.
 */

export const dynamic = 'force-dynamic';

export async function GET() {
  let database: 'up' | 'down' = 'down';
  try {
    await getPool().query('select 1');
    database = 'up';
  } catch {
    database = 'down';
  }

  return Response.json(
    { status: database === 'up' ? 'ok' : 'degraded', database },
    { status: database === 'up' ? 200 : 503 },
  );
}
