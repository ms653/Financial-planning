import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AccountForm } from '@/components/accounts/AccountForm';
import type { ActionResult } from '@/lib/household/actions';

/**
 * Add/Edit Account form behaviour.
 *
 * These cover the parts of DESIGN_SPEC.md's Add/Edit Account spec that are behavioural rather
 * than visual, and that would be easy to regress silently:
 *  - the type picker is a grid of buttons, and choosing one *reveals* the rest of the form
 *  - fields adapt to the chosen type (debt terms, the LISA note)
 *  - owner starts unselected and more than one selection means joint
 *  - validation is inline and on-blur, and submit is disabled until valid
 *  - a failed save keeps everything entered
 */

const PEOPLE = [
  { id: 1, name: 'Alex' },
  { id: 2, name: 'Jordan' },
];

const TODAY = '2026-07-26';

function renderForm(
  action = vi.fn(async (_formData: FormData): Promise<ActionResult> => ({ ok: true })),
) {
  const utils = render(
    <AccountForm
      people={PEOPLE}
      action={action}
      today={TODAY}
      submitLabel="Add account"
      cancelHref="/accounts"
    />,
  );
  return { ...utils, action };
}

/** Tiles carry an explicit aria-label, so this matches the type exactly. */
const typeTile = (name: string) => screen.getByRole('button', { name });

describe('type picker', () => {
  it('offers all eight account types as a grid of buttons, not a dropdown', () => {
    renderForm();
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();

    for (const label of ['Cash', 'Cash ISA', 'S&S ISA', 'LISA', 'SIPP / Pension', 'GIA', 'Property', 'Debt']) {
      expect(screen.getByRole('button', { name: label })).toBeVisible();
    }
  });

  it('hides the rest of the form until a type is chosen', () => {
    renderForm();
    expect(screen.queryByLabelText('Account name')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add account' })).not.toBeInTheDocument();
  });

  it('reveals the form beneath the picker once a type is chosen, without navigating', async () => {
    const user = userEvent.setup();
    renderForm();

    await user.click(typeTile('Cash ISA'));

    expect(screen.getByLabelText('Account name')).toBeVisible();
    expect(screen.getByLabelText('Current balance')).toBeVisible();
    // The picker is still on screen — the spec wants one step, not two.
    expect(typeTile('Cash ISA')).toHaveAttribute('aria-pressed', 'true');
  });

  it('allows changing the chosen type', async () => {
    const user = userEvent.setup();
    renderForm();

    await user.click(typeTile('Cash ISA'));
    await user.click(typeTile('Debt'));

    expect(typeTile('Debt')).toHaveAttribute('aria-pressed', 'true');
    expect(typeTile('Cash ISA')).toHaveAttribute('aria-pressed', 'false');
  });
});

describe('conditional fields by type', () => {
  it('shows no debt fields for a cash account', async () => {
    const user = userEvent.setup();
    renderForm();

    await user.click(typeTile('Cash'));

    expect(screen.queryByLabelText('Interest rate')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Minimum payment')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Early repayment charge')).not.toBeInTheDocument();
  });

  it('shows debt fields for a debt account, marked optional', async () => {
    const user = userEvent.setup();
    renderForm();

    await user.click(typeTile('Debt'));

    expect(screen.getByLabelText('Interest rate')).toBeVisible();
    expect(screen.getByLabelText('Minimum payment')).toBeVisible();
    expect(screen.getByLabelText('Overpayment allowance')).toBeVisible();
    expect(screen.getByLabelText('Early repayment charge')).toBeVisible();
    expect(screen.getByText(/All optional — you can add these later/i)).toBeVisible();
  });

  it('keeps the overpayment allowance and the ERC rate as two separate inputs', async () => {
    // They were conflated as one field in an earlier draft of the proposal and split after
    // review. This is the UI-level guard against recombining them.
    const user = userEvent.setup();
    renderForm();

    await user.click(typeTile('Debt'));

    const allowance = screen.getByLabelText('Overpayment allowance');
    const erc = screen.getByLabelText('Early repayment charge');
    expect(allowance).not.toBe(erc);
    expect(allowance).toHaveAttribute('name', 'overpaymentAllowancePct');
    expect(erc).toHaveAttribute('name', 'ercRatePct');
  });

  it('asks for the amount outstanding rather than a balance on a debt account', async () => {
    const user = userEvent.setup();
    renderForm();

    await user.click(typeTile('Debt'));

    expect(screen.getByLabelText('Amount outstanding')).toBeVisible();
    expect(screen.getByText(/What you still owe, as a positive number/i)).toBeVisible();
  });

  it('shows the LISA explanatory note only for a LISA', async () => {
    const user = userEvent.setup();
    renderForm();

    await user.click(typeTile('LISA'));
    expect(screen.getByText(/£4,000 yearly limit/i)).toBeVisible();
    expect(screen.getByText(/25% bonus/i)).toBeVisible();

    await user.click(typeTile('Cash ISA'));
    expect(screen.queryByText(/£4,000 yearly limit/i)).not.toBeInTheDocument();
  });

  it('adds no extra fields for cash ISA or S&S ISA beyond the standard set', async () => {
    const user = userEvent.setup();
    renderForm();

    await user.click(typeTile('S&S ISA'));

    expect(screen.getByLabelText('Account name')).toBeVisible();
    expect(screen.getByLabelText('Current balance')).toBeVisible();
    expect(screen.getByLabelText('As of')).toBeVisible();
    expect(screen.queryByLabelText('Interest rate')).not.toBeInTheDocument();
  });
});

describe('owner chips', () => {
  it('starts with nobody selected, forcing an explicit choice', async () => {
    const user = userEvent.setup();
    renderForm();

    await user.click(typeTile('Cash'));

    for (const person of PEOPLE) {
      expect(screen.getByRole('checkbox', { name: person.name })).not.toBeChecked();
    }
  });

  it('uses checkboxes, not radio buttons, so joint ownership is expressible', async () => {
    const user = userEvent.setup();
    renderForm();

    await user.click(typeTile('Cash'));

    expect(screen.queryByRole('radio')).not.toBeInTheDocument();
    expect(screen.getAllByRole('checkbox')).toHaveLength(2);
  });

  it('says the account will be joint once more than one owner is selected', async () => {
    const user = userEvent.setup();
    renderForm();

    await user.click(typeTile('Cash'));
    await user.click(screen.getByRole('checkbox', { name: 'Alex' }));
    expect(screen.queryByText(/recorded as a joint account/i)).not.toBeInTheDocument();

    await user.click(screen.getByRole('checkbox', { name: 'Jordan' }));
    expect(screen.getByText(/recorded as a joint account/i)).toBeVisible();
  });

  it('can deselect an owner again', async () => {
    const user = userEvent.setup();
    renderForm();

    await user.click(typeTile('Cash'));
    const alex = screen.getByRole('checkbox', { name: 'Alex' });
    await user.click(alex);
    await user.click(alex);

    expect(alex).not.toBeChecked();
  });
});

describe('validation', () => {
  it('keeps submit disabled until the required fields are valid', async () => {
    const user = userEvent.setup();
    renderForm();

    await user.click(typeTile('Cash'));
    const submit = screen.getByRole('button', { name: 'Add account' });
    expect(submit).toBeDisabled();

    await user.type(screen.getByLabelText('Account name'), 'Joint current account');
    expect(submit).toBeDisabled(); // no owner, no balance yet

    await user.click(screen.getByRole('checkbox', { name: 'Alex' }));
    expect(submit).toBeDisabled(); // still no balance

    await user.type(screen.getByLabelText('Current balance'), '6180');
    expect(submit).toBeEnabled();
  });

  it('shows a message on blur, not only on submit', async () => {
    const user = userEvent.setup();
    renderForm();

    await user.click(typeTile('Cash'));

    const name = screen.getByLabelText('Account name');
    await user.click(name);
    await user.tab();

    expect(await screen.findByText('Give this account a name.')).toBeVisible();
  });

  it('does not shout at a field before it has been touched', async () => {
    const user = userEvent.setup();
    renderForm();

    await user.click(typeTile('Cash'));

    expect(screen.queryByText('Give this account a name.')).not.toBeInTheDocument();
    expect(screen.queryByText('Choose who owns this account.')).not.toBeInTheDocument();
  });

  it('rejects a negative balance on a non-debt account with the spec’s exact copy', async () => {
    const user = userEvent.setup();
    renderForm();

    await user.click(typeTile('Cash'));
    await user.type(screen.getByLabelText('Current balance'), '-100');
    await user.tab();

    expect(
      await screen.findByText('Balance can’t be negative for this account type'),
    ).toBeVisible();
  });

  it('asks for a positive figure when a negative is entered on a debt account', async () => {
    const user = userEvent.setup();
    renderForm();

    await user.click(typeTile('Debt'));
    await user.type(screen.getByLabelText('Amount outstanding'), '-376500');
    await user.tab();

    expect(
      await screen.findByText('Enter the amount outstanding as a positive number.'),
    ).toBeVisible();
  });

  it('requires an allowance basis once an overpayment percentage is entered', async () => {
    const user = userEvent.setup();
    renderForm();

    await user.click(typeTile('Debt'));
    await user.type(screen.getByLabelText('Overpayment allowance'), '10');
    await user.tab();

    // Submit stays disabled because a percentage with no basis can't be interpreted.
    await user.type(screen.getByLabelText('Account name'), 'Mortgage');
    await user.click(screen.getByRole('checkbox', { name: 'Alex' }));
    await user.type(screen.getByLabelText('Amount outstanding'), '376500');

    expect(screen.getByRole('button', { name: 'Add account' })).toBeDisabled();
  });

  it('defaults the as-of date to today and does not allow the future', async () => {
    const user = userEvent.setup();
    renderForm();

    await user.click(typeTile('Cash'));

    const asOf = screen.getByLabelText('As of');
    expect(asOf).toHaveValue(TODAY);
    expect(asOf).toHaveAttribute('max', TODAY);
  });
});

describe('submission', () => {
  it('submits the entered values, with the type carried in a hidden field', async () => {
    const user = userEvent.setup();
    const action = vi.fn(async (_formData: FormData): Promise<ActionResult> => ({ ok: true }));
    renderForm(action);

    await user.click(typeTile('S&S ISA'));
    await user.type(screen.getByLabelText('Account name'), 'Vanguard S&S ISA');
    await user.click(screen.getByRole('checkbox', { name: 'Alex' }));
    await user.type(screen.getByLabelText('Current balance'), '54110');
    await user.click(screen.getByRole('button', { name: 'Add account' }));

    await waitFor(() => expect(action).toHaveBeenCalledTimes(1));

    const submitted = action.mock.calls[0]![0];
    expect(submitted.get('type')).toBe('ss_isa');
    expect(submitted.get('name')).toBe('Vanguard S&S ISA');
    expect(submitted.get('openingBalance')).toBe('54110');
    expect(submitted.getAll('ownerIds')).toEqual(['1']);
  });

  it('submits both owners for a joint account', async () => {
    const user = userEvent.setup();
    const action = vi.fn(async (_formData: FormData): Promise<ActionResult> => ({ ok: true }));
    renderForm(action);

    await user.click(typeTile('Cash'));
    await user.type(screen.getByLabelText('Account name'), 'Joint current account');
    await user.click(screen.getByRole('checkbox', { name: 'Alex' }));
    await user.click(screen.getByRole('checkbox', { name: 'Jordan' }));
    await user.type(screen.getByLabelText('Current balance'), '6180');
    await user.click(screen.getByRole('button', { name: 'Add account' }));

    await waitFor(() => expect(action).toHaveBeenCalledTimes(1));
    const submitted = action.mock.calls[0]![0];
    expect(submitted.getAll('ownerIds')).toEqual(['1', '2']);
  });

  it('keeps every entered value and shows a banner when the save fails', async () => {
    // DESIGN_SPEC.md: "form retains all entered values, error banner at the top, does not clear
    // the form — never lose entered data on a failed save."
    const user = userEvent.setup();
    const action = vi.fn(
      async (_formData: FormData): Promise<ActionResult> => ({
        ok: false,
        errors: {},
        formError: 'Couldn’t save this right now',
      }),
    );
    renderForm(action);

    await user.click(typeTile('Cash'));
    await user.type(screen.getByLabelText('Account name'), 'Joint current account');
    await user.click(screen.getByRole('checkbox', { name: 'Alex' }));
    await user.type(screen.getByLabelText('Current balance'), '6180');
    await user.click(screen.getByRole('button', { name: 'Add account' }));

    expect(await screen.findByText('Couldn’t save this right now')).toBeVisible();
    expect(screen.getByLabelText('Account name')).toHaveValue('Joint current account');
    expect(screen.getByLabelText('Current balance')).toHaveValue('6180');
    expect(screen.getByRole('checkbox', { name: 'Alex' })).toBeChecked();
  });

  it('surfaces a server field error against the right field', async () => {
    const user = userEvent.setup();
    const action = vi.fn(
      async (_formData: FormData): Promise<ActionResult> => ({
        ok: false,
        errors: { name: 'That name is too long.' },
      }),
    );
    renderForm(action);

    await user.click(typeTile('Cash'));
    await user.type(screen.getByLabelText('Account name'), 'A name');
    await user.click(screen.getByRole('checkbox', { name: 'Alex' }));
    await user.type(screen.getByLabelText('Current balance'), '10');
    await user.click(screen.getByRole('button', { name: 'Add account' }));

    expect(await screen.findByText('That name is too long.')).toBeVisible();
  });
});

describe('edit mode', () => {
  const INITIAL = {
    accountId: 7,
    name: 'Mortgage — 14 Elm Grove',
    type: 'debt' as const,
    ownerIds: [1, 2],
    debtTerms: {
      interestRate: '4.250',
      minimumPayment: '1450.00',
      overpaymentAllowancePct: '10.000',
      overpaymentAllowanceBalanceBasis: 'annual_opening_balance',
      ercRatePct: '3.000',
      ercPeriodEnd: '2028-06-30',
    },
  };

  function renderEdit() {
    const action = vi.fn(async (_formData: FormData): Promise<ActionResult> => ({ ok: true }));
    render(
      <AccountForm
        people={PEOPLE}
        action={action}
        today={TODAY}
        initial={INITIAL}
        submitLabel="Save changes"
        cancelHref="/accounts/7"
      />,
    );
    return action;
  }

  it('pre-fills the form and pre-selects the type and owners', () => {
    renderEdit();

    expect(screen.getByLabelText('Account name')).toHaveValue('Mortgage — 14 Elm Grove');
    expect(typeTile('Debt')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('checkbox', { name: 'Alex' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Jordan' })).toBeChecked();
    expect(screen.getByLabelText('Interest rate')).toHaveValue('4.250');
    expect(screen.getByLabelText('Early repayment charge')).toHaveValue('3.000');
  });

  it('offers no balance fields — those belong to the Update balance flow', () => {
    renderEdit();

    expect(screen.queryByLabelText('Amount outstanding')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Current balance')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('As of')).not.toBeInTheDocument();
  });

  it('carries the account id so the server knows what it is updating', async () => {
    const user = userEvent.setup();
    const action = renderEdit();

    await user.click(screen.getByRole('button', { name: 'Save changes' }));

    await waitFor(() => expect(action).toHaveBeenCalledTimes(1));
    const submitted = action.mock.calls[0]![0];
    expect(submitted.get('accountId')).toBe('7');
  });

  it('starts with submit enabled, since a pre-filled account is already valid', () => {
    renderEdit();
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeEnabled();
  });
});
