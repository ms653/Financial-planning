import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ScenarioEditorForm } from './ScenarioEditorForm';
import type { ScenarioAssumptionsV1 } from '@/lib/retirement/scenarioAssumptions';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));

const createScenarioReturningId = vi.fn();
const updateScenario = vi.fn();
vi.mock('@/lib/retirement/actions', () => ({
  createScenarioReturningId: (formData: FormData) => createScenarioReturningId(formData),
  updateScenario: (formData: FormData) => updateScenario(formData),
}));

const startSimulationRun = vi.fn();
const fetchSimulationRun = vi.fn();
vi.mock('@/lib/retirement/simulationRunClient', () => ({
  startSimulationRun: (scenarioId: number) => startSimulationRun(scenarioId),
  fetchSimulationRun: (runId: number) => fetchSimulationRun(runId),
  cancelSimulationRun: vi.fn(),
}));

afterEach(() => {
  vi.clearAllMocks();
});

const PEOPLE = [{ personId: 1, name: 'Alex', currentAge: 41 }];

function baseAssumptions(): ScenarioAssumptionsV1 {
  return {
    schemaVersion: 1,
    annualSpending: '30000.00',
    inflationPct: '2.500',
    equityAllocationPct: '60.000',
    targetSuccessRatePct: '90.000',
    flatEffectiveTaxRatePct: '20.000',
    wrapperWithdrawalOrder: ['cash', 'gia'],
    people: [{ personId: 1, retirementAge: 65, planEndAge: 95 }],
  };
}

describe('ScenarioEditorForm', () => {
  it('shows the exact spec copy inline when retirement age is out of range, on blur', async () => {
    const user = userEvent.setup();
    render(
      <ScenarioEditorForm
        people={PEOPLE}
        scenarioId={null}
        initialName=""
        initialIsBaseline={false}
        initialAssumptions={baseAssumptions()}
      />,
    );

    const retirementAgeInput = screen.getByLabelText(/Alex's retirement age/i);
    await user.clear(retirementAgeInput);
    await user.type(retirementAgeInput, '10');
    await user.tab();

    expect(await screen.findByText('Retirement age must be between your current age and 100')).toBeInTheDocument();
  });

  it('does not save or start a run when the run button is clicked while invalid', async () => {
    const user = userEvent.setup();
    render(
      <ScenarioEditorForm
        people={PEOPLE}
        scenarioId={null}
        initialName="Baseline"
        initialIsBaseline={false}
        initialAssumptions={baseAssumptions()}
      />,
    );

    const retirementAgeInput = screen.getByLabelText(/Alex's retirement age/i);
    await user.clear(retirementAgeInput);
    await user.type(retirementAgeInput, '10');

    await user.click(screen.getByRole('button', { name: 'Run simulation' }));

    expect(createScenarioReturningId).not.toHaveBeenCalled();
    expect(startSimulationRun).not.toHaveBeenCalled();
  });

  it('saves then starts a run when valid, and shows the Computing state while this tab\'s run is in flight', async () => {
    const user = userEvent.setup();
    const runningRow = {
      id: 7,
      scenarioId: 42,
      status: 'running' as const,
      seed: 1,
      iterationCount: 2000,
      result: null,
      errorDetail: null,
      createdAt: new Date().toISOString(),
      completedAt: null,
    };
    createScenarioReturningId.mockResolvedValue({ ok: true, scenarioId: 42 });
    startSimulationRun.mockResolvedValue(runningRow);
    // The polling hook's own effect fetches the run right after startSimulationRun sets
    // activeRunId — without this, useSimulationPolling never learns the run is running.
    fetchSimulationRun.mockResolvedValue(runningRow);

    render(
      <ScenarioEditorForm
        people={PEOPLE}
        scenarioId={null}
        initialName="Baseline"
        initialIsBaseline={false}
        initialAssumptions={baseAssumptions()}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Run simulation' }));

    await waitFor(() => expect(createScenarioReturningId).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(startSimulationRun).toHaveBeenCalledWith(42));

    expect(await screen.findByText(/Running 2,000 simulations/i)).toBeInTheDocument();

    // The whole form is disabled while this tab's own run is in flight.
    const retirementAgeInput = screen.getByLabelText(/Alex's retirement age/i);
    expect(retirementAgeInput).toBeDisabled();
  });

  it('shows "Simulation complete" once a just-started run finishes, not "Assumptions changed" — regression for a real bug found via E2E, where the dirty check compared against the fixed initial props instead of what was actually last run', async () => {
    const user = userEvent.setup();
    const completeRow = {
      id: 7,
      scenarioId: 42,
      status: 'complete' as const,
      seed: 1,
      iterationCount: 2000,
      result: { scenarioId: 42, seed: 1, iterationCount: 2000, successRate: 0.9, percentileBandsPence: {} },
      errorDetail: null,
      createdAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
    };
    createScenarioReturningId.mockResolvedValue({ ok: true, scenarioId: 42 });
    startSimulationRun.mockResolvedValue(completeRow);
    fetchSimulationRun.mockResolvedValue(completeRow);

    render(
      <ScenarioEditorForm
        people={PEOPLE}
        scenarioId={null}
        // A brand-new scenario's initialName is always "" — the case that triggered the
        // bug, since a typed-in name never again equals "".
        initialName=""
        initialIsBaseline={false}
        initialAssumptions={baseAssumptions()}
      />,
    );

    await user.type(screen.getByLabelText('Scenario name'), 'Baseline');
    await user.click(screen.getByRole('button', { name: 'Run simulation' }));

    await waitFor(() => expect(startSimulationRun).toHaveBeenCalledWith(42));
    expect(await screen.findByText(/Simulation complete/i)).toBeInTheDocument();
    expect(screen.queryByText(/Assumptions changed/i)).not.toBeInTheDocument();
  });

  it('updates the same scenario on a second run from /retirement/new, rather than creating a duplicate — regression for a real bug found by Fable review, where the create-vs-update branch used the fixed scenarioId prop (always null on this page) instead of the id the first save actually returned', async () => {
    const user = userEvent.setup();
    const firstRun = {
      id: 7,
      scenarioId: 42,
      status: 'complete' as const,
      seed: 1,
      iterationCount: 2000,
      result: { scenarioId: 42, seed: 1, iterationCount: 2000, successRate: 0.9, percentileBandsPence: {} },
      errorDetail: null,
      createdAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
    };
    const secondRun = { ...firstRun, id: 8 };
    createScenarioReturningId.mockResolvedValue({ ok: true, scenarioId: 42 });
    startSimulationRun.mockResolvedValueOnce(firstRun).mockResolvedValueOnce(secondRun);
    fetchSimulationRun.mockResolvedValue(firstRun);
    updateScenario.mockResolvedValue({ ok: true });

    render(
      <ScenarioEditorForm
        people={PEOPLE}
        scenarioId={null}
        initialName=""
        initialIsBaseline={false}
        initialAssumptions={baseAssumptions()}
      />,
    );

    await user.type(screen.getByLabelText('Scenario name'), 'Baseline');
    await user.click(screen.getByRole('button', { name: 'Run simulation' }));
    await waitFor(() => expect(startSimulationRun).toHaveBeenNthCalledWith(1, 42));

    // Edit an assumption and run again, without navigating away — exactly the ordinary
    // workflow that duplicated a scenario before this fix.
    const spendingInput = screen.getByLabelText('Annual spending');
    await user.clear(spendingInput);
    await user.type(spendingInput, '35000');
    await user.click(screen.getByRole('button', { name: 'Run simulation' }));

    await waitFor(() => expect(startSimulationRun).toHaveBeenNthCalledWith(2, 42));
    expect(createScenarioReturningId).toHaveBeenCalledTimes(1);
    expect(updateScenario).toHaveBeenCalledTimes(1);
  });

  it('shows a visible error when an unblurred field (e.g. PCLS age) is invalid at submit time — regression for a real bug found by Fable review, where the forced-touch list on an invalid submit omitted statePensionClaimAge and pclsAge, so their field-keyed errors never rendered', async () => {
    const user = userEvent.setup();
    render(
      <ScenarioEditorForm
        people={PEOPLE}
        scenarioId={null}
        initialName="Baseline"
        initialIsBaseline={false}
        initialAssumptions={baseAssumptions()}
      />,
    );

    await user.click(screen.getByRole('button', { name: /Strategy/ }));
    await user.type(screen.getByLabelText(/Alex's PCLS age/i), 'abc');
    // Deliberately no blur — clicking straight to "Run simulation" is the failure mode.
    await user.click(screen.getByRole('button', { name: 'Run simulation' }));

    expect(await screen.findByText('Enter a whole number of years.')).toBeInTheDocument();
    expect(createScenarioReturningId).not.toHaveBeenCalled();
  });

  it('surfaces a save failure as a banner without starting a run', async () => {
    const user = userEvent.setup();
    createScenarioReturningId.mockResolvedValue({ ok: false, errors: {}, formError: 'Enter a name for this scenario.' });

    render(
      <ScenarioEditorForm
        people={PEOPLE}
        scenarioId={null}
        initialName="Baseline"
        initialIsBaseline={false}
        initialAssumptions={baseAssumptions()}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Run simulation' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Enter a name for this scenario.');
    expect(startSimulationRun).not.toHaveBeenCalled();
  });
});
