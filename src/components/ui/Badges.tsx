import type { AccountTypeValue, TaxWrapperValue } from '@/lib/db/schema';
import { TAX_WRAPPER_LABELS, accountTypeMeta } from '@/lib/accounts/types';

/**
 * Account Type Badge and wrapper badge, per DESIGN_SPEC.md's Component Decisions:
 * "consistent small label/icon per type (Cash/GIA/Cash ISA/S&S ISA/LISA/SIPP/Property/Debt)
 * — same visual vocabulary everywhere the type appears, so users build pattern recognition
 * once." Variants: icon-only for dense lists, icon+label for detail views.
 *
 * Both take their label from `accounts/types.ts` rather than a local map, so a type can't
 * end up labelled one way here and another way in the breakdown legend.
 */

/** Per-type tint. Debt is the clay tone, pensions sage, investments brass — as in the mockup. */
const TYPE_TINT: Record<AccountTypeValue, string> = {
  cash: 'bg-paper-sunken text-content-muted',
  cash_isa: 'bg-paper-sunken text-content-muted',
  ss_isa: 'bg-brass/15 text-brass-strong dark:text-brass',
  lisa: 'bg-brass/15 text-brass-strong dark:text-brass',
  gia: 'bg-brass/15 text-brass-strong dark:text-brass',
  sipp_pension: 'bg-sage-bg text-sage',
  property: 'bg-brass/10 text-brass-strong dark:text-brass',
  debt: 'bg-clay-bg text-clay',
};

export function AccountTypeIcon({ type }: { type: AccountTypeValue }) {
  const meta = accountTypeMeta(type);
  return (
    <span
      // The label is carried by the adjacent badge or the row's accessible name, so the
      // decorative letter is hidden rather than read out as a stray character.
      aria-hidden="true"
      className={`grid h-8 w-8 shrink-0 place-items-center rounded-lg text-xs font-semibold ${TYPE_TINT[type]}`}
    >
      {meta.initial}
    </span>
  );
}

export function AccountTypeBadge({
  type,
  showLabel = true,
}: {
  type: AccountTypeValue;
  showLabel?: boolean;
}) {
  const meta = accountTypeMeta(type);
  if (!showLabel) return <AccountTypeIcon type={type} />;
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ${TYPE_TINT[type]}`}
    >
      {meta.label}
    </span>
  );
}

/**
 * Wrapper badge. `none` renders as an em dash in dense lists (as the mockup does) but the
 * accessible name says "No tax wrapper", since an em dash read aloud is meaningless.
 */
export function TaxWrapperBadge({ wrapper }: { wrapper: TaxWrapperValue }) {
  const label = TAX_WRAPPER_LABELS[wrapper];
  const tint =
    wrapper === 'pension'
      ? 'bg-sage-bg text-sage'
      : wrapper === 'isa'
        ? 'bg-brass/15 text-brass-strong dark:text-brass'
        : 'bg-paper-sunken text-content-muted';

  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ${tint}`}
      aria-label={wrapper === 'none' ? 'No tax wrapper' : `${label} wrapper`}
    >
      {label}
    </span>
  );
}

export function ArchivedBadge() {
  return (
    <span className="inline-flex items-center rounded-full bg-paper-sunken px-2 py-0.5 text-[11px] font-medium text-content-faint">
      Archived
    </span>
  );
}
