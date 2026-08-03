import Link from 'next/link';
import { logout } from '@/app/login/actions';
import { getBackupStatus } from '@/lib/backup/status';
import { BackupWarningStrip } from '@/components/BackupWarningStrip';

/**
 * The app chrome: persistent sidebar on laptop, bottom tab bar on mobile.
 *
 * DESIGN_SPEC.md, Foundational decisions: "persistent left sidebar on laptop
 * (collapsible), bottom tab bar on mobile. Five primary sections for P1: Net Worth (home),
 * Accounts, Portfolio, Retirement Planner, Settings. P2 sections (Stocks, Advisor, Reports)
 * get sidebar slots reserved but greyed out/hidden until built, so P1's nav doesn't need
 * restructuring later."
 *
 * Retirement Planner is unreserved as of Milestone 9 — the Monte Carlo engine (M1–M8)
 * plus its UI (Scenario Editor, Results, Comparison) are both built now. Portfolio was
 * unreserved as of Phase 2, the same way. Stocks is unreserved as of Phase 4 Milestone
 * 1 — unlike Portfolio/Retirement before it, this is the *first* commit for its slot
 * (confirmed via git history: no `comingIn: 'Phase 4'` placeholder ever existed here to
 * delete), since M1 ships a working watchlist page rather than reserving the slot
 * across several UI-less milestones the way Retirement's engine milestones did.
 * Roadmap is new, unreserved from the start — not a phase from `docs/PROPOSAL.md`'s
 * own Phased Delivery table, but a household-facing view of that same table (see
 * `src/lib/roadmap/data.ts`).
 *
 * What is deliberately *not* here is the connectivity badge. The design spec puts one in the
 * top chrome of every screen, but its three states (Connected / Offline / Syncing) only mean
 * anything once there is a service worker and a write queue behind them — Phase 6. A badge
 * that reported "Connected" unconditionally would be worse than none: it would look like a
 * working indicator while telling the user nothing. The dashboard instead carries a real
 * freshness line derived from the newest balance snapshot.
 */

interface NavItem {
  href: string;
  label: string;
  /** Set for reserved P2/P3 slots — rendered, not linked. */
  comingIn?: string;
}

const NAV_ITEMS: readonly NavItem[] = [
  { href: '/', label: 'Net Worth' },
  { href: '/accounts', label: 'Accounts' },
  { href: '/portfolio', label: 'Portfolio' },
  { href: '/retirement', label: 'Retirement' },
  { href: '/stocks', label: 'Stocks' },
  { href: '/roadmap', label: 'Roadmap' },
  { href: '/settings', label: 'Settings' },
];

function isActive(pathname: string, href: string): boolean {
  if (href === '/') return pathname === '/';
  return pathname === href || pathname.startsWith(`${href}/`);
}

export async function AppShell({
  children,
  pathname,
}: {
  children: React.ReactNode;
  pathname: string;
}) {
  // Read on every render so the indicator can't go stale. PROPOSAL.md is emphatic that the
  // app is the monitoring surface for backups, not a log file nobody checks.
  const backupStatus = await getBackupStatus();

  return (
    <div className="min-h-screen bg-paper lg:flex">
      <aside
        aria-label="Primary"
        className="hidden border-r border-line bg-paper-sunken lg:flex lg:w-60 lg:shrink-0 lg:flex-col lg:justify-between"
      >
        <div>
          <div className="flex items-center gap-3 px-5 py-6">
            <span
              aria-hidden="true"
              className="grid h-9 w-9 place-items-center rounded-lg bg-gradient-to-br from-brass to-brass-strong font-serif text-base font-bold text-ink-950"
            >
              £
            </span>
            <div className="leading-tight">
              <div className="text-[11px] uppercase tracking-[0.14em] text-content-faint">
                Household
              </div>
              <div className="font-serif text-base text-content">Finance</div>
            </div>
          </div>

          <nav aria-label="Sections" className="px-2">
            <ul className="space-y-0.5">
              {NAV_ITEMS.map((item) => (
                <li key={item.href}>
                  {item.comingIn ? (
                    <span
                      aria-disabled="true"
                      className="flex items-center justify-between rounded-lg px-3 py-2 text-sm text-content-faint"
                    >
                      {item.label}
                      <span className="text-[10px] uppercase tracking-wider">{item.comingIn}</span>
                    </span>
                  ) : (
                    <Link
                      href={item.href}
                      aria-current={isActive(pathname, item.href) ? 'page' : undefined}
                      className={`flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition ${
                        isActive(pathname, item.href)
                          ? 'bg-paper-raised font-medium text-content shadow-card'
                          : 'text-content-muted hover:bg-paper-raised hover:text-content'
                      }`}
                    >
                      <span
                        aria-hidden="true"
                        className={`h-1.5 w-1.5 rounded-full ${
                          isActive(pathname, item.href) ? 'bg-brass' : 'bg-line-strong'
                        }`}
                      />
                      {item.label}
                    </Link>
                  )}
                </li>
              ))}
            </ul>
          </nav>
        </div>

        <form action={logout} className="p-4">
          <button
            type="submit"
            className="w-full rounded-lg border border-line-strong px-3 py-2 text-xs font-medium text-content-muted transition hover:border-brass hover:text-content"
          >
            Lock
          </button>
        </form>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Mobile header: the sidebar's brand and lock action, which the tab bar has no room for. */}
        <header className="flex items-center justify-between border-b border-line px-4 py-3 lg:hidden">
          <div className="flex items-center gap-2">
            <span
              aria-hidden="true"
              className="grid h-7 w-7 place-items-center rounded-md bg-gradient-to-br from-brass to-brass-strong font-serif text-sm font-bold text-ink-950"
            >
              £
            </span>
            <span className="font-serif text-sm text-content">Household Finance</span>
          </div>
          <form action={logout}>
            <button
              type="submit"
              className="rounded-lg border border-line-strong px-2.5 py-1.5 text-xs text-content-muted"
            >
              Lock
            </button>
          </form>
        </header>

        <main className="mx-auto w-full max-w-4xl flex-1 px-4 pb-24 pt-6 lg:px-8 lg:pb-14 lg:pt-10">
          <BackupWarningStrip status={backupStatus} />
          {children}
        </main>

        {/* Bottom tab bar. Touch targets are 44px+ per the accessibility requirements. */}
        <nav
          aria-label="Sections"
          className="fixed inset-x-0 bottom-0 z-10 flex border-t border-line bg-paper-raised lg:hidden"
        >
          {NAV_ITEMS.filter((item) => !item.comingIn).map((item) => (
            <Link
              key={item.href}
              href={item.href}
              aria-current={isActive(pathname, item.href) ? 'page' : undefined}
              className={`flex min-h-[52px] flex-1 flex-col items-center justify-center gap-1 py-2 text-[11px] ${
                isActive(pathname, item.href) ? 'font-medium text-content' : 'text-content-muted'
              }`}
            >
              <span
                aria-hidden="true"
                className={`h-1.5 w-1.5 rounded-full ${
                  isActive(pathname, item.href) ? 'bg-brass' : 'bg-transparent'
                }`}
              />
              {item.label}
            </Link>
          ))}
        </nav>
      </div>
    </div>
  );
}
