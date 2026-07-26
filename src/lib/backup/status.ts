import { and, desc, eq } from 'drizzle-orm';
import { getDb } from '@/lib/db/client';
import { backupRuns, type BackupRun } from '@/lib/db/schema';
import { backupStaleAfterHours } from '@/lib/env';

/**
 * Backup staleness, for the in-app indicator PROPOSAL.md requires:
 * "a visible 'last successful backup: <time>' indicator in the app itself (red if
 * stale — the app is the monitoring surface its users actually look at, not a log
 * file nobody checks)".
 *
 * The severity logic is a pure function so it can be tested without a database, which
 * matters because the failure mode being defended against is exactly the one where
 * nobody notices the indicator is wrong.
 */

export type BackupSeverity = 'ok' | 'stale' | 'never' | 'unknown';

export interface BackupStatus {
  severity: BackupSeverity;
  /** Most recent successful run, if any. */
  lastSuccessAt: Date | null;
  /** Most recent run of any outcome — a fresh failure is worth surfacing separately. */
  lastAttempt: Pick<BackupRun, 'outcome' | 'finishedAt' | 'detail'> | null;
  ageHours: number | null;
  staleAfterHours: number;
  /** Set when the status itself couldn't be determined (e.g. database unreachable). */
  error?: string;
}

/** Hours between `at` and `now`, rounded down. */
export function hoursSince(at: Date, now: Date): number {
  return Math.floor((now.getTime() - at.getTime()) / 3_600_000);
}

/**
 * Classify a last-success timestamp.
 *
 * `null` maps to 'never' rather than 'stale': a system that has never backed up is a
 * different (and more urgent) problem than one whose backup has drifted, and the copy
 * shown should differ. A future timestamp is treated as fresh rather than as an error
 * — clock skew on a laptop that has been asleep is common and not worth alarming over.
 */
export function classifyBackupAge(
  lastSuccessAt: Date | null,
  now: Date,
  staleAfterHours: number,
): { severity: BackupSeverity; ageHours: number | null } {
  if (!lastSuccessAt) return { severity: 'never', ageHours: null };
  const ageHours = hoursSince(lastSuccessAt, now);
  if (ageHours < 0) return { severity: 'ok', ageHours: 0 };
  return { severity: ageHours >= staleAfterHours ? 'stale' : 'ok', ageHours };
}

/**
 * Read backup status from the database.
 *
 * Never throws. A database that is down would otherwise take out the whole
 * authenticated page over a status widget, and "can't tell you" is a legitimate,
 * displayable answer — rendered as 'unknown' rather than silently as 'ok', so an
 * unreachable database can't masquerade as a healthy backup.
 */
export async function getBackupStatus(now: Date = new Date()): Promise<BackupStatus> {
  const staleAfterHours = backupStaleAfterHours();
  try {
    const db = getDb();

    const [lastSuccess] = await db
      .select({ finishedAt: backupRuns.finishedAt })
      .from(backupRuns)
      .where(and(eq(backupRuns.outcome, 'success')))
      .orderBy(desc(backupRuns.finishedAt))
      .limit(1);

    const [lastAttempt] = await db
      .select({
        outcome: backupRuns.outcome,
        finishedAt: backupRuns.finishedAt,
        detail: backupRuns.detail,
      })
      .from(backupRuns)
      .orderBy(desc(backupRuns.finishedAt))
      .limit(1);

    const lastSuccessAt = lastSuccess?.finishedAt ?? null;
    const { severity, ageHours } = classifyBackupAge(lastSuccessAt, now, staleAfterHours);

    return {
      severity,
      lastSuccessAt,
      lastAttempt: lastAttempt ?? null,
      ageHours,
      staleAfterHours,
    };
  } catch (error) {
    return {
      severity: 'unknown',
      lastSuccessAt: null,
      lastAttempt: null,
      ageHours: null,
      staleAfterHours,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/** "3 hours ago" / "just now" — relative time for the indicator. */
export function formatRelativeAge(ageHours: number): string {
  if (ageHours < 1) return 'less than an hour ago';
  if (ageHours === 1) return '1 hour ago';
  if (ageHours < 48) return `${ageHours} hours ago`;
  const days = Math.floor(ageHours / 24);
  return days === 1 ? '1 day ago' : `${days} days ago`;
}
