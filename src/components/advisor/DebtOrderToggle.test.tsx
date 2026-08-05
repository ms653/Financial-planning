import { describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DebtOrderToggle, type DebtOrderRowView } from '@/components/advisor/DebtOrderToggle';
import type { DebtOrderingMode } from '@/lib/advisor/debtOrdering';

const ORDERINGS: Record<DebtOrderingMode, DebtOrderRowView[]> = {
  avalanche: [
    { accountId: 2, name: 'Credit card', balance: '£2,000', minimumPayment: '£50', interestRate: '24.900' },
    { accountId: 1, name: 'Mortgage', balance: '£300,000', minimumPayment: '£1,200', interestRate: '4.250' },
  ],
  snowball: [
    { accountId: 2, name: 'Credit card', balance: '£2,000', minimumPayment: '£50', interestRate: '24.900' },
    { accountId: 1, name: 'Mortgage', balance: '£300,000', minimumPayment: '£1,200', interestRate: '4.250' },
  ],
};

function panel() {
  return screen.getByRole('tabpanel');
}

describe('DebtOrderToggle', () => {
  it('renders the requested mode on first paint', () => {
    render(<DebtOrderToggle orderings={ORDERINGS} initialMode="avalanche" />);

    expect(screen.getByRole('tab', { name: 'Avalanche' })).toHaveAttribute('aria-selected', 'true');
    expect(within(panel()).getByText('Credit card')).toBeVisible();
  });

  it('swaps in place when the other tab is clicked, with no navigation', async () => {
    const user = userEvent.setup();
    render(<DebtOrderToggle orderings={ORDERINGS} initialMode="avalanche" />);

    await user.click(screen.getByRole('tab', { name: 'Snowball' }));

    expect(screen.getByRole('tab', { name: 'Snowball' })).toHaveAttribute('aria-selected', 'true');
    expect(within(panel()).getByText('Credit card')).toBeVisible();
  });

  it('moves selection and focus together with ArrowRight', async () => {
    const user = userEvent.setup();
    render(<DebtOrderToggle orderings={ORDERINGS} initialMode="avalanche" />);

    await user.tab();
    expect(screen.getByRole('tab', { name: 'Avalanche' })).toHaveFocus();

    await user.keyboard('{ArrowRight}');

    expect(screen.getByRole('tab', { name: 'Snowball' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: 'Snowball' })).toHaveFocus();
  });

  it('wraps around at both ends', async () => {
    const user = userEvent.setup();
    render(<DebtOrderToggle orderings={ORDERINGS} initialMode="avalanche" />);

    await user.tab();
    await user.keyboard('{ArrowLeft}');
    expect(screen.getByRole('tab', { name: 'Snowball' })).toHaveAttribute('aria-selected', 'true');

    await user.keyboard('{ArrowRight}');
    expect(screen.getByRole('tab', { name: 'Avalanche' })).toHaveAttribute('aria-selected', 'true');
  });

  it('handles no outstanding debt without rendering an empty list', () => {
    render(<DebtOrderToggle orderings={{ avalanche: [], snowball: [] }} />);
    expect(screen.getByText('No outstanding debt to order.')).toBeVisible();
  });
});
