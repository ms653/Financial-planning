import Link from 'next/link';
import { formatMoney, numericToPence } from '@/lib/money';
import { accountTypeMeta } from '@/lib/accounts/types';
import { AccountTypeIcon, ArchivedBadge, TaxWrapperBadge } from '@/components/ui/Badges';
import type { OwnerGroup } from '@/lib/networth/breakdown';
import type { AccountWithBalance } from '@/lib/household/queries';

/**
 * The account list, grouped by owner — shared by the Net Worth Dashboard and the Accounts
 * List, since DESIGN_SPEC.md specifies the same grouped-by-owner structure for both and two
 * implementations would drift.
 *
 * Groups include a "Joint" group for accounts with no single owner (null `person_id`), and a
 * joint account appears once there rather than under both people — the grouping function
 * enforces that and its tests assert it.
 */

function relativeUpdated(date: string | null, now: Date): string {
  if (!date) return 'No balance yet';
  const then = new Date(`${date}T00:00:00Z`);
  const days = Math.floor((now.getTime() - then.getTime()) / 86_400_000);
  if (days <= 0) return 'Updated today';
  if (days === 1) return 'Updated yesterday';
  if (days < 7) return `Updated ${days} days ago`;
  if (days < 14) return 'Updated 1 week ago';
  if (days < 60) return `Updated ${Math.floor(days / 7)} weeks ago`;
  return `Updated ${Math.floor(days / 30)} months ago`;
}

function AccountRow({ account, now }: { account: AccountWithBalance; now: Date }) {
  const meta = accountTypeMeta(account.type);
  const pence = account.latestAmount === null ? null : numericToPence(account.latestAmount);

  return (
    <li>
      <Link
        href={`/accounts/${account.id}`}
        // 44px minimum touch target, per the accessibility requirements.
        className="flex min-h-[56px] items-center gap-3 border-b border-line px-1 py-3 transition last:border-b-0 hover:bg-paper-sunken/60"
      >
        <AccountTypeIcon type={account.type} />

        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium text-content">{account.name}</span>
          <span className="block text-[11.5px] text-content-faint">
            {meta.label} · {relativeUpdated(account.latestSnapshotDate, now)}
          </span>
        </span>

        <span className="hidden sm:block">
          <TaxWrapperBadge wrapper={account.taxWrapper} />
        </span>

        {account.archived ? <ArchivedBadge /> : null}

        <span
          className={`tabular w-24 shrink-0 text-right text-sm font-medium sm:w-28 ${
            pence !== null && pence < 0n ? 'text-clay' : 'text-content'
          }`}
        >
          {pence === null ? <span className="text-content-faint">—</span> : formatMoney(pence)}
        </span>
      </Link>
    </li>
  );
}

export function AccountLedger({
  groups,
  now,
  showGroupTotals = true,
}: {
  groups: OwnerGroup[];
  now: Date;
  showGroupTotals?: boolean;
}) {
  return (
    <div className="space-y-6">
      {groups.map((group) => (
        <div key={group.key}>
          <div className="flex items-baseline justify-between gap-3 border-b border-line-strong pb-1.5">
            <h3 className="text-[11px] font-semibold uppercase tracking-[0.12em] text-content-muted">
              {group.label}
            </h3>
            {showGroupTotals ? (
              <span
                className={`tabular text-xs font-medium ${
                  group.pence < 0n ? 'text-clay' : 'text-content-muted'
                }`}
              >
                {formatMoney(group.pence)}
              </span>
            ) : null}
          </div>
          <ul>
            {group.accounts.map((account) => (
              <AccountRow
                key={account.id}
                account={account as AccountWithBalance}
                now={now}
              />
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}
