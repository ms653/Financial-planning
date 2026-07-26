import { BackupStatusIndicator } from '@/components/BackupStatusIndicator';
import { getBackupStatus } from '@/lib/backup/status';
import { logout } from '@/app/login/actions';

/**
 * Phase 0's placeholder authenticated page.
 *
 * Its only jobs are to prove the auth flow works end to end and to host the backup
 * staleness indicator that Phase 0 requires. The real Net Worth Dashboard
 * (DESIGN_SPEC.md, route `/`) is Phase 1 and replaces this file.
 */

// Backup status must reflect reality on every load, so this page is never cached.
export const dynamic = 'force-dynamic';

export default async function HomePage() {
  const backupStatus = await getBackupStatus();

  return (
    <main className="mx-auto min-h-screen w-full max-w-2xl px-5 py-14">
      <div className="mb-9 flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <span
            aria-hidden="true"
            className="grid h-9 w-9 place-items-center rounded-lg bg-gradient-to-br from-brass to-brass-strong font-serif text-base font-bold text-ink-950"
          >
            £
          </span>
          <span className="text-sm font-medium uppercase tracking-[0.14em] text-content-muted">
            Household Finance
          </span>
        </div>

        {/* Server Action, so it carries Next's built-in same-origin POST check. */}
        <form action={logout}>
          <button
            type="submit"
            className="rounded-lg border border-line-strong px-3 py-1.5 text-xs font-medium text-content-muted transition hover:border-brass hover:text-content"
          >
            Lock
          </button>
        </form>
      </div>

      <h1 className="font-serif text-4xl leading-tight text-content">
        You&rsquo;re in. Phase 1 starts here.
      </h1>
      <p className="mt-3 max-w-prose text-sm leading-relaxed text-content-muted">
        Phase 0 is scaffold only: repo, Postgres and Drizzle migrations, Docker Compose,
        CI, the passphrase gate you just came through, Tailscale Serve HTTPS, and backup
        tooling. The household, accounts, and net worth dashboard arrive in Phase 1 —
        see <span className="font-medium text-content">docs/PROPOSAL.md</span> Section 5.
      </p>

      <div className="mt-10">
        <BackupStatusIndicator status={backupStatus} />
      </div>

      <dl className="mt-10 grid grid-cols-2 gap-3 text-sm">
        <div className="rounded-card border border-line bg-paper-raised p-4">
          <dt className="text-xs uppercase tracking-wider text-content-faint">
            Session
          </dt>
          <dd className="mt-1 text-content">Signed cookie, 30-day rolling</dd>
        </div>
        <div className="rounded-card border border-line bg-paper-raised p-4">
          <dt className="text-xs uppercase tracking-wider text-content-faint">
            Network boundary
          </dt>
          <dd className="mt-1 text-content">Tailscale only</dd>
        </div>
      </dl>
    </main>
  );
}
