import { describe, expect, it } from 'vitest';
import { resolveSetupStep } from '@/lib/household/setupStep';

/**
 * The step rule for Guided Setup.
 *
 * These cases exist because an earlier version of this logic — inline in the page, where
 * nothing could reach it — chose "the furthest step the data allows" and so skipped the user
 * past two of the flow's own steps: adding one person jumped to the account picker, and adding
 * one account redirected to the dashboard. Both were only observable by driving a browser
 * through setup, and both are one assertion each here.
 */

function state(
  householdId: number | null,
  personCount: number,
  accountCount: number,
): { householdId: number | null; personCount: number; accountCount: number; complete: boolean } {
  return {
    householdId,
    personCount,
    accountCount,
    complete: householdId !== null && personCount > 0 && accountCount > 0,
  };
}

describe('resolveSetupStep', () => {
  describe('with no step requested', () => {
    it('starts at the household step when there is no household', () => {
      expect(resolveSetupStep(state(null, 0, 0), undefined)).toBe('household');
    });

    it('moves to people once the household exists', () => {
      expect(resolveSetupStep(state(1, 0, 0), undefined)).toBe('people');
    });

    it('stays on people after the first person is added', () => {
      // The regression: this used to return 'accounts', which re-rendered the page onto the
      // type picker the moment someone added their first person — so a second person could
      // not be added and the step's own "Next: add an account" link was unreachable.
      expect(resolveSetupStep(state(1, 1, 0), undefined)).toBe('people');
      expect(resolveSetupStep(state(1, 2, 0), undefined)).toBe('people');
    });

    it('sends a complete household to the dashboard', () => {
      expect(resolveSetupStep(state(1, 2, 3), undefined)).toBe('done');
    });
  });

  describe('with a step requested', () => {
    it('honours accounts once there is someone to own an account', () => {
      expect(resolveSetupStep(state(1, 1, 0), 'accounts')).toBe('accounts');
    });

    it('keeps rendering accounts after the first account, so "Finish setup" is reachable', () => {
      // The second regression: `complete` alone used to redirect to the dashboard, so the
      // running list, "+ Add another" and "Finish setup" — steps 5 and 6 of the spec's flow —
      // could never be seen. An explicit `?step=` is the flow saying "not finished yet".
      expect(resolveSetupStep(state(1, 2, 1), 'accounts')).toBe('accounts');
      expect(resolveSetupStep(state(1, 2, 5), 'accounts')).toBe('accounts');
    });

    it('allows going back to an earlier step that is already satisfied', () => {
      expect(resolveSetupStep(state(1, 2, 1), 'people')).toBe('people');
      expect(resolveSetupStep(state(1, 2, 1), 'household')).toBe('household');
    });

    it('refuses to skip ahead to accounts before anyone is in the household', () => {
      expect(resolveSetupStep(state(1, 0, 0), 'accounts')).toBe('people');
    });

    it('refuses to skip ahead past the household step', () => {
      expect(resolveSetupStep(state(null, 0, 0), 'people')).toBe('household');
      expect(resolveSetupStep(state(null, 0, 0), 'accounts')).toBe('household');
    });

    it('ignores a step that is not a step', () => {
      expect(resolveSetupStep(state(1, 1, 0), 'nonsense')).toBe('people');
      // Unparseable and complete still means done — an unknown value is not a request.
      expect(resolveSetupStep(state(1, 2, 3), 'nonsense')).toBe('done');
    });
  });
});
