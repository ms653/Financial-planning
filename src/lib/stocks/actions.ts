'use server';

import { revalidatePath } from 'next/cache';
import { and, eq } from 'drizzle-orm';
import { getDb } from '@/lib/db/client';
import { stockAnalyses, watchlistItems } from '@/lib/db/schema';
import { getSetupState } from '@/lib/household/queries';
import type { ActionResult } from '@/lib/household/actions';
import { DcfInputsParseError, parseDcfInputs } from '@/lib/stocks/dcf';

/**
 * Stocks CRUD — watchlist (Phase 4 Milestone 1) and DCF assumptions (Milestone 2).
 * Mirrors `src/lib/retirement/actions.ts`'s exact shape — `ActionResult` reused
 * directly from `household/actions.ts` (not redefined, same reason: so
 * `useActionForm` works with these unmodified), a locally-redefined
 * `requireHouseholdId` (that helper isn't exported from `household/actions.ts`; every
 * domain module that needs it defines its own copy — the existing, established
 * convention, not a new one invented here).
 */

const GENERIC_SAVE_ERROR = 'Couldn’t save this right now';

async function requireHouseholdId(): Promise<number> {
  const state = await getSetupState();
  if (state.householdId === null) {
    throw new Error('No household exists yet. Complete guided setup first.');
  }
  return state.householdId;
}

function logAndWrap(scope: string, error: unknown): ActionResult {
  console.error(`[stocks] ${scope} failed:`, error);
  return { ok: false, errors: {}, formError: GENERIC_SAVE_ERROR };
}

/** Same shape as `holding.ticker`'s own validation in
 * `src/lib/accounts/validation.ts` — letters, digits, dots, dashes, up to 20 chars —
 * reimplemented here rather than imported, so the stocks module doesn't reach into
 * accounts' validation module for an unrelated concept that only happens to look
 * similar today. */
function parseTicker(raw: FormDataEntryValue | null): { ok: true; value: string } | { ok: false; error: string } {
  const ticker = String(raw ?? '').trim().toUpperCase();
  if (ticker === '') return { ok: false, error: 'Enter a ticker, like AAPL.' };
  if (!/^[A-Z0-9.\-:]{1,20}$/.test(ticker)) {
    return { ok: false, error: 'Tickers are letters, digits, dots and dashes.' };
  }
  return { ok: true, value: ticker };
}

export async function addToWatchlist(formData: FormData): Promise<ActionResult> {
  const parsed = parseTicker(formData.get('ticker'));
  if (!parsed.ok) return { ok: false, errors: { ticker: parsed.error } };

  try {
    const householdId = await requireHouseholdId();
    // Adding an already-watched ticker is a no-op, not an error — the unique index on
    // (householdId, ticker) is the backstop; onConflictDoNothing is what makes hitting
    // it a quiet success instead of a thrown 23505 the caller would have to catch.
    await getDb()
      .insert(watchlistItems)
      .values({ householdId, ticker: parsed.value })
      .onConflictDoNothing({ target: [watchlistItems.householdId, watchlistItems.ticker] });
  } catch (error) {
    return logAndWrap('addToWatchlist', error);
  }

  revalidatePath('/stocks');
  return { ok: true };
}

export async function removeFromWatchlist(formData: FormData): Promise<ActionResult> {
  const id = Number.parseInt(String(formData.get('id') ?? ''), 10);
  if (!Number.isInteger(id)) {
    return { ok: false, errors: {}, formError: GENERIC_SAVE_ERROR };
  }

  try {
    const householdId = await requireHouseholdId();
    await getDb()
      .delete(watchlistItems)
      .where(and(eq(watchlistItems.id, id), eq(watchlistItems.householdId, householdId)));
  } catch (error) {
    return logAndWrap('removeFromWatchlist', error);
  }

  revalidatePath('/stocks');
  return { ok: true };
}

/**
 * DCF assumptions, Phase 4 Milestone 2. Takes `ticker` plus one JSON-encoded `inputs`
 * field — mirroring `retirement/actions.ts`'s `createScenario`/`updateScenario`
 * (a whole-blob field validated through the same typed parser the engine itself uses,
 * `parseDcfInputs`, rather than four separate scalar FormData fields) — appropriate
 * here for the same reason it was there: the parser is the single source of truth for
 * the shape, and duplicating its rules as per-field FormData parsing would be a second
 * copy to drift out of sync.
 *
 * Upserts on `(householdId, ticker)` — a stock analysis has no append-only run history
 * to preserve the way `simulation_run` does (see `stock_analysis`'s own schema doc
 * comment); editing DCF assumptions replaces the previous ones outright.
 */
export async function saveDcfInputs(formData: FormData): Promise<ActionResult> {
  const parsedTicker = parseTicker(formData.get('ticker'));
  if (!parsedTicker.ok) return { ok: false, errors: { ticker: parsedTicker.error } };

  const raw = formData.get('inputs');
  if (typeof raw !== 'string' || raw === '') {
    return { ok: false, errors: {}, formError: 'Missing DCF inputs.' };
  }

  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return { ok: false, errors: {}, formError: 'DCF inputs must be valid JSON.' };
  }

  let inputs;
  try {
    inputs = parseDcfInputs(json);
  } catch (error) {
    const message = error instanceof DcfInputsParseError ? error.message : GENERIC_SAVE_ERROR;
    return { ok: false, errors: {}, formError: message };
  }

  try {
    const householdId = await requireHouseholdId();
    await getDb()
      .insert(stockAnalyses)
      .values({ householdId, ticker: parsedTicker.value, inputs })
      .onConflictDoUpdate({
        target: [stockAnalyses.householdId, stockAnalyses.ticker],
        set: { inputs, updatedAt: new Date() },
      });
  } catch (error) {
    return logAndWrap('saveDcfInputs', error);
  }

  revalidatePath(`/stocks/${parsedTicker.value}`);
  return { ok: true };
}
