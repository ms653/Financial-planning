import type { SetupState } from '@/lib/household/queries';

/**
 * Which step of Guided Setup a request should render.
 *
 * This is pure and lives outside the page for one reason: the rule is subtler than it looks,
 * and getting it wrong silently broke two of the flow's six steps (see below). As logic inline
 * in an `async` server component it could only be exercised by driving a real browser through
 * setup; here it is a table of cases.
 *
 * DESIGN_SPEC.md's first-time-setup flow:
 *   1. no household → "Let's set up your household"
 *   3. add household *members* — plural, at least one required
 *   4. "Add your first account" → account-type picker
 *   5. account created → "shown in a running list with a '+ Add another' affordance"
 *   6. "adds accounts until done, taps 'Finish setup'" → Net Worth Dashboard
 *
 * **The data caps which step you may be on; it does not decide when you leave one.** Steps 3
 * and 5 are both steps a household lingers on while adding several things, and the *user*
 * leaves them — via "Next: add an account" and "Finish setup" respectively. Every write in
 * setup is followed by `revalidatePath('/setup')`, so a step chosen as "the furthest the data
 * allows" moves out from under the person still typing into it:
 *
 *  - adding the first person made `personCount > 0`, which re-rendered the page onto the
 *    account picker — so a second person could never be added, and the "Next: add an account"
 *    link was unreachable dead code;
 *  - adding the first account made `complete` true, which bounced the page to the dashboard —
 *    so "+ Add another" and "Finish setup" were unreachable too.
 *
 * Hence two separate notions:
 *  - `furthest` — the furthest step the data supports, a *cap* on what `?step=` may ask for, so
 *    going back to a finished step works while skipping ahead to an unearned one does not;
 *  - the default step — the *earliest* step with work left, which keeps `people` selected until
 *    there is at least one account, so an add doesn't advance the flow on the user's behalf.
 *
 * `?step=` is the only forward-progress signal the flow has, so it is honoured even once setup
 * is complete: "I just added my first account and haven't pressed Finish yet" is precisely that
 * state. An unqualified visit to a complete household is the one case that redirects out.
 */
export type SetupStep = 'household' | 'people' | 'accounts';

/** `'done'` means setup needs nothing more and the caller should redirect to the dashboard. */
export type SetupStepResolution = SetupStep | 'done';

export const SETUP_STEP_ORDER: readonly SetupStep[] = ['household', 'people', 'accounts'];

function isSetupStep(value: string | undefined): value is SetupStep {
  return value !== undefined && (SETUP_STEP_ORDER as readonly string[]).includes(value);
}

export function resolveSetupStep(
  setup: Pick<SetupState, 'householdId' | 'personCount' | 'accountCount' | 'complete'>,
  requested: string | undefined,
): SetupStepResolution {
  const requestedStep = isSetupStep(requested) ? requested : null;

  // The spec scopes this screen to a household that still needs building, so someone arriving
  // with no step in mind at a household that has both people and accounts belongs on the
  // dashboard. An explicit request is how the flow itself navigates, so it is not overridden.
  if (setup.complete && requestedStep === null) return 'done';

  const furthest: SetupStep =
    setup.householdId === null ? 'household' : setup.personCount === 0 ? 'people' : 'accounts';

  const defaultStep: SetupStep =
    setup.householdId === null ? 'household' : setup.accountCount === 0 ? 'people' : 'accounts';

  if (
    requestedStep !== null &&
    SETUP_STEP_ORDER.indexOf(requestedStep) <= SETUP_STEP_ORDER.indexOf(furthest)
  ) {
    return requestedStep;
  }

  return defaultStep;
}
