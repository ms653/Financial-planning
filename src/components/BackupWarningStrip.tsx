import Link from 'next/link';
import type { BackupStatus } from '@/lib/backup/status';

/**
 * A compact backup warning, shown in the app chrome on every screen — but only when there
 * is something wrong.
 *
 * Phase 0 put the full `BackupStatusIndicator` on the placeholder home page. Phase 1 turns
 * that page into the Net Worth Dashboard and moves the full indicator to /settings, which is
 * where DESIGN_SPEC.md's screen inventory puts backup status. That move alone would quietly
 * reduce the visibility of the thing PROPOSAL.md calls "the single most likely catastrophic
 * failure mode for this system" — a `pg_dump` silently failing for six months.
 *
 * So the two are split by urgency: the full panel lives on Settings for when someone goes
 * looking, and this strip appears above every screen whenever the state is stale, never or
 * unknown. A healthy backup renders nothing at all, because a permanent green banner is
 * exactly the kind of chrome people learn to stop seeing.
 */

const TONE: Record<'stale' | 'never' | 'unknown', { box: string; glyph: string; text: string }> = {
  stale: {
    box: 'border-clay/50 bg-clay-bg text-clay',
    glyph: '!',
    text: 'Your last backup is out of date.',
  },
  never: {
    box: 'border-clay/50 bg-clay-bg text-clay',
    glyph: '!',
    text: 'No backup has ever completed.',
  },
  unknown: {
    box: 'border-line-strong bg-paper-sunken text-content-muted',
    glyph: '?',
    text: 'Backup health can’t be checked right now.',
  },
};

export function BackupWarningStrip({ status }: { status: BackupStatus }) {
  if (status.severity === 'ok') return null;
  const tone = TONE[status.severity];

  return (
    <div
      role="status"
      className={`mb-5 flex flex-wrap items-center gap-x-2 gap-y-1 rounded-card border px-3.5 py-2.5 text-sm ${tone.box}`}
    >
      <span aria-hidden="true" className="font-semibold">
        {tone.glyph}
      </span>
      <span>{tone.text}</span>
      <Link href="/settings" className="font-medium underline underline-offset-2">
        Check backup status
      </Link>
    </div>
  );
}
