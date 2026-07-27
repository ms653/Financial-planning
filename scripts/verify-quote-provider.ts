/**
 * Phase 2's blocking verification task: settle whether Alpha Vantage's LSE quotes are
 * pence (GBX) or pounds (GBP), and confirm `.LON` returns the GBP line rather than a USD
 * cross-listing, for the household's actual holdings — Vanguard VUAG and VHYG (both
 * LSE-listed accumulating ETFs). The household's third holding, the Vanguard FTSE Global
 * All Cap Index Fund, is an OEIC/unit trust with no exchange ticker (priced once daily by
 * NAV, bought direct through Vanguard Investor) — it is checked here too, but is expected
 * to come back not-found against a stock-quote endpoint like GLOBAL_QUOTE; that's a real
 * Phase 2 limitation to confirm, not a bug to chase.
 *
 *   ALPHA_VANTAGE_API_KEY=your-key npm run portfolio:verify-quotes
 *
 * Sign up for a free key (no card) at https://www.alphavantage.co/support/#api-key.
 *
 * This prints the raw response for each symbol. A human has to read the price and
 * compare it against the real-world price (check a source like the LSE's own site or a
 * finance site) — that comparison can't be automated, since "is this number plausible as
 * pounds or as pence" is exactly the ambiguity being resolved. Once you know the answer:
 *
 *   1. Update `LSE_QUOTES_ARE_GBX` in src/lib/portfolio/quotes.ts to `true` or `false`,
 *      with a comment recording the date and the evidence (the actual price returned).
 *   2. Note the result in docs/STATUS.md's Phase 2 section.
 *
 * This script is permanent, not throwaway — worth re-running if the provider is ever
 * changed, or periodically as a sanity check that the provider hasn't silently changed
 * its labeling (which is exactly the failure mode PROPOSAL.md warns is common).
 */
import { fetchGlobalQuote } from '../src/lib/portfolio/quotes';

// Bare tickers are included alongside the .LON-suffixed ones specifically to check for a
// USD-denominated cross-listing under the same symbol — Vanguard ETFs sometimes have
// both a GBP line and a USD line, and PROPOSAL.md flags picking the wrong one as a real
// risk, not a hypothetical one. VANGFTSEGACC is a guess at a possible OEIC symbol and is
// expected to fail — see the module comment above.
const SYMBOLS_TO_CHECK = ['VUAG.LON', 'VHYG.LON', 'VUAG', 'VHYG', 'VANGFTSEGACC'];

async function main(): Promise<void> {
  const apiKey = process.env.ALPHA_VANTAGE_API_KEY;
  if (!apiKey) {
    process.stderr.write(
      'ALPHA_VANTAGE_API_KEY is not set. Get a free key at ' +
        'https://www.alphavantage.co/support/#api-key and run:\n\n' +
        '  ALPHA_VANTAGE_API_KEY=your-key npm run portfolio:verify-quotes\n',
    );
    process.exit(1);
  }

  process.stdout.write(
    'Fetching live quotes. Compare each price against the real-world price and judge ' +
      'whether the number reads as pounds or as pence.\n\n',
  );

  for (const symbol of SYMBOLS_TO_CHECK) {
    const result = await fetchGlobalQuote(symbol, apiKey);

    if (result.status === 'ok') {
      process.stdout.write(`${symbol}: ${result.rawPrice}\n`);
    } else if (result.status === 'not-found') {
      process.stdout.write(`${symbol}: not found (no Global Quote data)\n`);
    } else if (result.status === 'rate-limited') {
      process.stdout.write(
        `${symbol}: rate-limited — wait and re-run, or check your daily quota.\n`,
      );
    } else {
      process.stdout.write(`${symbol}: network error — ${result.message}\n`);
    }

    // Alpha Vantage's free tier has a per-minute sub-limit as well as the daily one;
    // a short pause between the four calls this script makes avoids tripping it.
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }

  process.stdout.write(
    '\nCheck the real current price of VUAG and VHYG (e.g. on the LSE\'s own site or ' +
      'Vanguard\'s UK site) and compare magnitude: if the returned number is roughly the ' +
      'same order of magnitude as the real price in pounds, it\'s GBP; if it\'s about 100x ' +
      'larger, it\'s pence (GBX). If the bare (non-.LON) symbols also returned real prices, ' +
      'check whether that\'s a USD cross-listing rather than the LSE GBP line before ' +
      'deciding which one to use. VANGFTSEGACC is a guess at the OEIC\'s symbol and is ' +
      'expected to come back not-found — that confirms the fund has no exchange quote via ' +
      'this endpoint, which is fine: it will show "price unavailable" in the app.\n',
  );
}

main().catch((error: unknown) => {
  process.stderr.write(`Failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
