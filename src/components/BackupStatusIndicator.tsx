import { formatRelativeAge, type BackupStatus } from '@/lib/backup/status';

/**
 * "Last successful backup: <time>" indicator, required by PROPOSAL.md's Phase 0 scope:
 * the app is the monitoring surface the household actually looks at, so a silently
 * failing pg_dump has to be visible here rather than only in a log file.
 *
 * Four states, all distinguishable without relying on colour alone (each carries its
 * own label and glyph) — per DESIGN_SPEC.md's accessibility requirement that
 * financial good/bad framing never be colour-only:
 *  - ok      — a successful backup inside the staleness window.
 *  - stale   — the last success is older than BACKUP_STALE_AFTER_HOURS (default 48h).
 *  - never   — no successful backup has ever been recorded.
 *  - unknown — the status could not be read (e.g. Postgres unreachable). Deliberately
 *              not shown as "ok": a database that is down must not look like a healthy
 *              backup.
 */

const TONE: Record<BackupStatus['severity'], { box: string; glyph: string; label: string }> = {
  ok: {
    box: 'border-sage/40 bg-sage-bg text-sage',
    glyph: '✓',
    label: 'Backup healthy',
  },
  stale: {
    box: 'border-clay/50 bg-clay-bg text-clay',
    glyph: '!',
    label: 'Backup stale',
  },
  never: {
    box: 'border-clay/50 bg-clay-bg text-clay',
    glyph: '!',
    label: 'No backup yet',
  },
  unknown: {
    box: 'border-line-strong bg-paper-sunken text-content-muted',
    glyph: '?',
    label: 'Backup status unknown',
  },
};

function detailLine(status: BackupStatus): string {
  switch (status.severity) {
    case 'ok':
      return `Last successful backup ${formatRelativeAge(status.ageHours ?? 0)}.`;
    case 'stale':
      return `Last successful backup ${formatRelativeAge(
        status.ageHours ?? 0,
      )} — older than the ${status.staleAfterHours}-hour threshold. Check the backup job.`;
    case 'never':
      return 'No successful backup has been recorded. Run scripts/backup.sh and check the cron entry in docs/DEPLOYMENT.md.';
    case 'unknown':
      return "Couldn't read backup history right now, so backup health is unverified.";
  }
}

export function BackupStatusIndicator({ status }: { status: BackupStatus }) {
  const tone = TONE[status.severity];
  const lastFailure =
    status.lastAttempt?.outcome === 'failure' ? status.lastAttempt : null;

  return (
    <section
      aria-labelledby="backup-status-heading"
      className={`rounded-card border px-4 py-3.5 ${tone.box}`}
    >
      <div className="flex items-baseline gap-2">
        <span aria-hidden="true" className="font-semibold">
          {tone.glyph}
        </span>
        <h2 id="backup-status-heading" className="text-sm font-semibold">
          {tone.label}
        </h2>
      </div>

      <p className="mt-1.5 text-sm leading-relaxed">{detailLine(status)}</p>

      {status.lastSuccessAt ? (
        <p className="mt-1 text-xs opacity-80">
          <time dateTime={status.lastSuccessAt.toISOString()} className="tabular">
            {status.lastSuccessAt.toISOString().replace('T', ' ').slice(0, 16)} UTC
          </time>
        </p>
      ) : null}

      {lastFailure ? (
        <p className="mt-2 text-xs opacity-80">
          Most recent attempt failed
          {lastFailure.detail ? `: ${lastFailure.detail}` : '.'}
        </p>
      ) : null}
    </section>
  );
}
