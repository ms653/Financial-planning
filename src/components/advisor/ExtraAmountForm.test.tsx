import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ExtraAmountForm } from '@/components/advisor/ExtraAmountForm';

describe('ExtraAmountForm', () => {
  it('starts with the submit button enabled when given a valid initial value', () => {
    render(<ExtraAmountForm initialValue="500" />);
    expect(screen.getByRole('button', { name: 'Show recommendations' })).toBeEnabled();
  });

  it('disables submit and shows a message for invalid input', async () => {
    const user = userEvent.setup();
    render(<ExtraAmountForm initialValue="500" />);

    const input = screen.getByLabelText('How much extra do you have to allocate?');
    await user.clear(input);
    await user.type(input, 'not a number');

    expect(screen.getByRole('button', { name: 'Show recommendations' })).toBeDisabled();
    expect(screen.getByText('Enter a plain amount, e.g. 500 or 500.00.')).toBeVisible();
  });

  it('re-enables submit once the input is corrected back to a valid amount', async () => {
    const user = userEvent.setup();
    render(<ExtraAmountForm initialValue="" />);

    const input = screen.getByLabelText('How much extra do you have to allocate?');
    await user.type(input, '1,250.50');

    expect(screen.getByRole('button', { name: 'Show recommendations' })).toBeEnabled();
    expect(input).toHaveValue('1,250.50');
  });

  it('does not show an error message before the household has typed anything', () => {
    render(<ExtraAmountForm initialValue="" />);
    expect(screen.queryByText('Enter a plain amount, e.g. 500 or 500.00.')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Show recommendations' })).toBeDisabled();
  });
});
