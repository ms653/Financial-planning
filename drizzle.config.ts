import { defineConfig } from 'drizzle-kit';

/**
 * Drizzle chosen over Prisma per PROPOSAL.md: it emits plain, reviewable SQL migration
 * files, which matters when the target is the household's only copy of irreplaceable
 * financial data. `src/lib/db/schema.ts` is the canonical source of truth; the SQL in
 * drizzle/ is generated from it and committed so it can be eyeballed before it runs.
 *
 * Migrations are forward-only and numbered. The rollback mechanism is the pg_dump that
 * deploy.sh takes immediately before migrating — see docs/DEPLOYMENT.md.
 */
export default defineConfig({
  schema: './src/lib/db/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:5432/financial_planning',
  },
  // Print statements before applying them, so a deploy log records exactly what ran.
  verbose: true,
  // Ask before applying anything destructive rather than silently dropping columns.
  strict: true,
});
