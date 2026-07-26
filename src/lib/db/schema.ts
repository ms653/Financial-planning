import { sql } from 'drizzle-orm';
import {
  bigint,
  index,
  pgEnum,
  pgTable,
  serial,
  text,
  timestamp,
} from 'drizzle-orm/pg-core';

/**
 * Phase 0 schema — deliberately one table.
 *
 * Why there is no `user`, `person`, `household`, or `session` table yet:
 *  - Auth is a single shared household passphrase (PROPOSAL.md Security notes), whose
 *    argon2id hash lives in the APP_PASSPHRASE_HASH environment variable. There are no
 *    per-user accounts and no signup flow, so there is nothing to store.
 *  - Sessions are stateless signed cookies (src/lib/auth/session.ts), so there is no
 *    server-side session record to persist.
 *  - Brute-force counters are in-memory by explicit design (src/lib/auth/lockout.ts).
 *  - The household/person/account model is Phase 1 and is specified in detail in
 *    PROPOSAL.md's data model section. Modelling it now would mean guessing at
 *    NUMERIC precision, joint-ownership nullability, and tax-wrapper sub-types ahead
 *    of the phase that actually has requirements for them.
 *
 * What does need a table in Phase 0 is backup observability: the app is the monitoring
 * surface for `pg_dump`, so it has to be able to read backup history.
 */

export const backupOutcome = pgEnum('backup_outcome', ['success', 'failure']);

export const backupRuns = pgTable(
  'backup_run',
  {
    id: serial('id').primaryKey(),

    /** When the backup script started. Set by scripts/backup.sh. */
    startedAt: timestamp('started_at', { withTimezone: true }).notNull(),

    /** When it finished, successfully or not. */
    finishedAt: timestamp('finished_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),

    outcome: backupOutcome('outcome').notNull(),

    /**
     * Path of the encrypted dump on the backup host. Nullable because a failed run
     * often has no artefact to point at.
     */
    artefactPath: text('artefact_path'),

    /**
     * Size of the encrypted dump. bigint because a household's dump will outgrow
     * int4 bytes eventually, and this column is trivially cheap to get right now.
     * Nullable for the same reason as artefactPath.
     */
    artefactBytes: bigint('artefact_bytes', { mode: 'number' }),

    /** SHA-256 of the encrypted dump, so a restore test can prove integrity. */
    artefactSha256: text('artefact_sha256'),

    /**
     * Whether the artefact was encrypted before leaving the machine. Recorded rather
     * than assumed: an unencrypted dump copied off-machine is a reportable problem,
     * and the app should be able to show it.
     */
    encryptionMethod: text('encryption_method'),

    /** Failure detail, or any note the script wants to surface in the UI. */
    detail: text('detail'),
  },
  (table) => ({
    /**
     * The app's only read pattern is "most recent successful run", which this index
     * serves directly: filter on outcome, take the newest finished_at.
     */
    outcomeFinishedAtIdx: index('backup_run_outcome_finished_at_idx').on(
      table.outcome,
      table.finishedAt.desc(),
    ),
  }),
);

export type BackupRun = typeof backupRuns.$inferSelect;
export type NewBackupRun = typeof backupRuns.$inferInsert;
