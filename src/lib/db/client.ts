import { Pool } from 'pg';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import * as schema from '@/lib/db/schema';
import { databaseUrl } from '@/lib/env';

/**
 * Postgres connection pool, created lazily and cached across hot reloads.
 *
 * Lazy because module-level connection setup would make importing anything in this
 * directory fail hard when DATABASE_URL is absent — including in unit tests that only
 * want the schema types. Cached on globalThis because `next dev` re-evaluates modules
 * on every change, and a fresh 10-connection pool per edit exhausts Postgres'
 * max_connections within a few minutes of editing.
 */

const globalForDb = globalThis as unknown as {
  __hfPool?: Pool;
  __hfDb?: NodePgDatabase<typeof schema>;
};

export function getPool(): Pool {
  if (!globalForDb.__hfPool) {
    globalForDb.__hfPool = new Pool({
      connectionString: databaseUrl(),
      // One household, one app container. A small pool is plenty and keeps Postgres'
      // default max_connections comfortable.
      max: 10,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 5_000,
    });
    // Without this, a Postgres restart makes an idle client emit an unhandled 'error'
    // event, which crashes the Node process.
    globalForDb.__hfPool.on('error', (error) => {
      console.error('[db] idle client error', error.message);
    });
  }
  return globalForDb.__hfPool;
}

export function getDb(): NodePgDatabase<typeof schema> {
  if (!globalForDb.__hfDb) {
    globalForDb.__hfDb = drizzle(getPool(), { schema });
  }
  return globalForDb.__hfDb;
}
