import { describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BreakdownPanel, type BreakdownSliceView } from '@/components/networth/BreakdownPanel';
import type { BreakdownMode } from '@/lib/networth/breakdown';

/**
 * The breakdown toggle.
 *
 * Two behaviours are being protected here, both stated requirements rather than nice-to-haves:
 *  - DESIGN_SPEC.md: the segmented control "re-renders the chart in place (no navigation, no
 *    reload)". So switching must swap the rendered figures without a request.
 *  - Accessibility requirements: it "must be operable via arrow keys once focused, not
 *    mouse/touch-only".
 */

const SLICES: Record<BreakdownMode, BreakdownSliceView[]> = {
  person: [
    { key: 'person-1', label: 'Alex', amount: '£251,830', share: 0.61, negative: false },
    { key: 'person-2', label: 'Jordan', amount: '£120,800', share: 0.29, negative: false },
    { key: 'joint', label: 'Joint', amount: '£39,680', share: 0.1, negative: false },
  ],
  asset: [
    { key: 'asset-pensions', label: 'Pensions', amount: '£284,280', share: 0.36, negative: false },
    { key: 'asset-investments', label: 'Investments (ISA/GIA)', amount: '£77,050', share: 0.1, negative: false },
    { key: 'asset-property', label: 'Property', amount: '£410,000', share: 0.52, negative: false },
    { key: 'asset-cash', label: 'Cash', amount: '£17,480', share: 0.02, negative: false },
    { key: 'asset-debt', label: 'Debt', amount: '−£376,500', share: 0, negative: true },
  ],
  wrapper: [
    { key: 'wrapper-pension', label: 'Pension', amount: '£284,280', share: 0.76, negative: false },
    { key: 'wrapper-isa', label: 'ISA', amount: '£88,350', share: 0.24, negative: false },
    { key: 'wrapper-none', label: 'No wrapper', amount: '£39,680', share: 0, negative: false },
  ],
};

function panel() {
  return screen.getByRole('tabpanel');
}

describe('BreakdownPanel', () => {
  it('renders the requested mode on first paint', () => {
    render(<BreakdownPanel slices={SLICES} initialMode="person" />);

    expect(screen.getByRole('tab', { name: 'By person' })).toHaveAttribute('aria-selected', 'true');
    expect(within(panel()).getByText('Alex')).toBeVisible();
    expect(within(panel()).getByText('£251,830')).toBeVisible();
  });

  it('honours a non-default initial mode, so the URL parameter survives a refresh', () => {
    render(<BreakdownPanel slices={SLICES} initialMode="wrapper" />);

    expect(screen.getByRole('tab', { name: 'By tax wrapper' })).toHaveAttribute('aria-selected', 'true');
    expect(within(panel()).getByText('No wrapper')).toBeVisible();
  });

  it('swaps to asset class in place when clicked', async () => {
    const user = userEvent.setup();
    render(<BreakdownPanel slices={SLICES} initialMode="person" />);

    await user.click(screen.getByRole('tab', { name: 'By asset class' }));

    expect(within(panel()).getByText('Pensions')).toBeVisible();
    expect(within(panel()).getByText('Investments (ISA/GIA)')).toBeVisible();
    // The previous grouping's rows are gone, not merely hidden behind them.
    expect(within(panel()).queryByText('Alex')).not.toBeInTheDocument();
  });

  it('swaps to tax wrapper when clicked', async () => {
    const user = userEvent.setup();
    render(<BreakdownPanel slices={SLICES} initialMode="person" />);

    await user.click(screen.getByRole('tab', { name: 'By tax wrapper' }));

    expect(within(panel()).getByText('Pension')).toBeVisible();
    expect(within(panel()).getByText('ISA')).toBeVisible();
    expect(within(panel()).queryByText('Jordan')).not.toBeInTheDocument();
  });

  it('can switch back, so the toggle is not one-way', async () => {
    const user = userEvent.setup();
    render(<BreakdownPanel slices={SLICES} initialMode="person" />);

    await user.click(screen.getByRole('tab', { name: 'By asset class' }));
    await user.click(screen.getByRole('tab', { name: 'By person' }));

    expect(within(panel()).getByText('Alex')).toBeVisible();
  });

  it('keeps exactly one tab selected at a time', async () => {
    const user = userEvent.setup();
    render(<BreakdownPanel slices={SLICES} initialMode="person" />);

    await user.click(screen.getByRole('tab', { name: 'By asset class' }));

    const selected = screen
      .getAllByRole('tab')
      .filter((tab) => tab.getAttribute('aria-selected') === 'true');
    expect(selected).toHaveLength(1);
    expect(selected[0]).toHaveAccessibleName('By asset class');
  });

  describe('keyboard operation', () => {
    it('moves to the next mode with ArrowRight', async () => {
      const user = userEvent.setup();
      render(<BreakdownPanel slices={SLICES} initialMode="person" />);

      await user.tab();
      expect(screen.getByRole('tab', { name: 'By person' })).toHaveFocus();

      await user.keyboard('{ArrowRight}');

      expect(screen.getByRole('tab', { name: 'By asset class' })).toHaveAttribute('aria-selected', 'true');
      // Focus follows selection, so the ring and the visible state stay together.
      expect(screen.getByRole('tab', { name: 'By asset class' })).toHaveFocus();
      expect(within(panel()).getByText('Pensions')).toBeVisible();
    });

    it('moves backwards with ArrowLeft', async () => {
      const user = userEvent.setup();
      render(<BreakdownPanel slices={SLICES} initialMode="asset" />);

      await user.tab();
      await user.keyboard('{ArrowLeft}');

      expect(screen.getByRole('tab', { name: 'By person' })).toHaveAttribute('aria-selected', 'true');
    });

    it('wraps around at both ends', async () => {
      const user = userEvent.setup();
      render(<BreakdownPanel slices={SLICES} initialMode="person" />);

      await user.tab();
      await user.keyboard('{ArrowLeft}');
      expect(screen.getByRole('tab', { name: 'By tax wrapper' })).toHaveAttribute('aria-selected', 'true');

      await user.keyboard('{ArrowRight}');
      expect(screen.getByRole('tab', { name: 'By person' })).toHaveAttribute('aria-selected', 'true');
    });

    it('supports Home and End', async () => {
      const user = userEvent.setup();
      render(<BreakdownPanel slices={SLICES} initialMode="asset" />);

      await user.tab();
      await user.keyboard('{End}');
      expect(screen.getByRole('tab', { name: 'By tax wrapper' })).toHaveAttribute('aria-selected', 'true');

      await user.keyboard('{Home}');
      expect(screen.getByRole('tab', { name: 'By person' })).toHaveAttribute('aria-selected', 'true');
    });

    it('is a single tab stop, so Tab leaves the group rather than walking it', async () => {
      const user = userEvent.setup();
      render(<BreakdownPanel slices={SLICES} initialMode="person" />);

      await user.tab();
      expect(screen.getByRole('tab', { name: 'By person' })).toHaveFocus();

      await user.tab();
      expect(screen.getByRole('tab', { name: 'By asset class' })).not.toHaveFocus();
      expect(screen.getByRole('tab', { name: 'By tax wrapper' })).not.toHaveFocus();
    });
  });

  describe('negative slices', () => {
    it('shows a debt figure in the legend with its sign', async () => {
      const user = userEvent.setup();
      render(<BreakdownPanel slices={SLICES} initialMode="person" />);

      await user.click(screen.getByRole('tab', { name: 'By asset class' }));

      expect(within(panel()).getByText('Debt')).toBeVisible();
      expect(within(panel()).getByText('−£376,500')).toBeVisible();
    });
  });

  it('handles an empty breakdown without rendering an empty bar', () => {
    render(
      <BreakdownPanel
        slices={{ person: [], asset: [], wrapper: [] }}
        initialMode="person"
      />,
    );
    expect(screen.getByText('Nothing to break down yet.')).toBeVisible();
  });

  it('links the panel to its selected tab for assistive tech', async () => {
    const user = userEvent.setup();
    render(<BreakdownPanel slices={SLICES} initialMode="person" />);

    expect(panel()).toHaveAttribute('aria-labelledby', 'breakdown-tab-person');

    await user.click(screen.getByRole('tab', { name: 'By asset class' }));
    expect(panel()).toHaveAttribute('aria-labelledby', 'breakdown-tab-asset');
  });
});
