import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { WatchlistForm } from './WatchlistForm';

afterEach(() => {
  vi.clearAllMocks();
});

describe('WatchlistForm', () => {
  it('clears the field after a successful submit', async () => {
    const user = userEvent.setup();
    const action = vi.fn().mockResolvedValue({ ok: true });
    render(<WatchlistForm action={action} />);

    await user.type(screen.getByLabelText('Add a ticker'), 'AAPL');
    await user.click(screen.getByRole('button', { name: 'Add' }));

    await waitFor(() => expect(screen.getByLabelText('Add a ticker')).toHaveValue(''));
  });

  it('shows a field error and does not clear the field on failure', async () => {
    const user = userEvent.setup();
    const action = vi.fn().mockResolvedValue({ ok: false, errors: { ticker: 'Enter a ticker, like AAPL.' } });
    render(<WatchlistForm action={action} />);

    await user.type(screen.getByLabelText('Add a ticker'), 'AAPL');
    await user.click(screen.getByRole('button', { name: 'Add' }));

    expect(await screen.findByText('Enter a ticker, like AAPL.')).toBeInTheDocument();
    expect(screen.getByLabelText('Add a ticker')).toHaveValue('AAPL');
  });

  // Regression for a real bug found by browser testing: a fast second edit, typed while
  // an earlier (successful) submission was still resolving, was silently wiped the
  // moment that earlier submission's onSuccess fired — because the old code cleared the
  // field unconditionally rather than only when it still held what was actually
  // submitted.
  it('does not clobber a newly-typed value with an earlier submission\'s success callback', async () => {
    const user = userEvent.setup();
    let resolveFirst!: (value: { ok: true }) => void;
    const action = vi.fn().mockImplementationOnce(() => new Promise((resolve) => (resolveFirst = resolve)));
    render(<WatchlistForm action={action} />);

    const input = screen.getByLabelText('Add a ticker');
    await user.type(input, 'AAPL');
    await user.click(screen.getByRole('button', { name: 'Add' })); // first submit, held pending

    // While the first submission is still in flight, the user types the next ticker.
    await user.clear(input);
    await user.type(input, 'MSFT');

    resolveFirst({ ok: true }); // first submission now resolves successfully
    await waitFor(() => expect(action).toHaveBeenCalledTimes(1));

    // The field must still show what the user just typed, not be wiped to empty by the
    // first submission's own onSuccess.
    expect(input).toHaveValue('MSFT');
  });
});
