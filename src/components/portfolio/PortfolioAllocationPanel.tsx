/**
 * Portfolio allocation — a stacked bar plus a legend, one ticker per slice.
 *
 * DESIGN_SPEC.md's Portfolio View asks for "allocation breakdown (by asset class, e.g.
 * equities/bonds/cash)". That specific breakdown isn't buildable from what Phase 2 stores:
 * `holding` carries a ticker and a quantity, not an asset-class tag, and deriving one from
 * fundamentals data is Phase 4's stock-workbench remit, not this phase's. By-ticker is what
 * the schema can honestly support today, and it's what the same screen's holdings table
 * already needs ("% of portfolio") — so this reuses that instead of inventing a second,
 * unsupported grouping. A future manual per-holding classification field could add a real
 * asset-class view later without displacing this one.
 *
 * Visually the same idiom as the Net Worth dashboard's `BreakdownPanel` (stacked bar +
 * legend, cycling the same swatches) — no mode switcher here, since there is only one
 * grouping, so this is a plain server component rather than a client one.
 */

export interface PortfolioSliceView {
  key: string;
  /** The ticker. */
  label: string;
  /** Pre-formatted GBP value, e.g. "£12,985.08". */
  amount: string;
  /** 0–1 share of the total *GBP-priced* portfolio value. */
  share: number;
}

/** Same palette as `BreakdownPanel`, kept separate rather than imported — a shared
 * five-colour constant isn't worth a cross-domain import between net-worth and portfolio
 * components, but the values are intentionally identical so slices read consistently
 * wherever they appear in the app. */
const SWATCHES = ['var(--brass)', 'var(--sage)', '#8b9c8e', '#c9a876', 'var(--brass-strong)'];

export function PortfolioAllocationPanel({ slices }: { slices: PortfolioSliceView[] }) {
  return (
    <section
      aria-labelledby="portfolio-allocation-heading"
      className="rounded-card border border-line bg-paper-raised p-5 shadow-card sm:p-6"
    >
      <h2 id="portfolio-allocation-heading" className="font-serif text-lg text-content">
        Allocation
      </h2>

      {slices.length === 0 ? (
        <p className="mt-4 text-sm text-content-muted">Nothing to break down yet.</p>
      ) : (
        <>
          <div
            aria-hidden="true"
            className="mt-5 flex h-7 gap-0.5 overflow-hidden rounded-full bg-paper-sunken"
          >
            {slices.map((slice, index) => (
              <div
                key={slice.key}
                style={{
                  width: `${(slice.share * 100).toFixed(2)}%`,
                  background: SWATCHES[index % SWATCHES.length],
                }}
              />
            ))}
          </div>

          <ul className="mt-4 space-y-0.5">
            {slices.map((slice, index) => (
              <li
                key={slice.key}
                className="flex items-center gap-2.5 border-b border-line py-2 text-sm last:border-b-0"
              >
                <span
                  aria-hidden="true"
                  className="h-2.5 w-2.5 shrink-0 rounded-sm"
                  style={{ background: SWATCHES[index % SWATCHES.length] }}
                />
                <span className="min-w-0 flex-1 truncate text-content-muted">{slice.label}</span>
                <span className="tabular font-medium text-content">{slice.amount}</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
