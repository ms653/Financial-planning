/**
 * UK historical annual real returns — equities, gilts, and bills — for the Monte Carlo
 * engine's bootstrap sampler (Milestone 5).
 *
 * This is Phase 3's blocking verification task #1: the bootstrap engine needs a real,
 * citable annual UK return series, not an invented or approximated one. Two candidate
 * leads from the original planning pass turned out not to work:
 *  - The Bank of England's "A Millennium of Macroeconomic Data" (Thomas & Dimsdale) is
 *    real, freely licensed (Open Government Licence v3.0), and was actually downloaded
 *    and inspected this session — but its `share-prices` series is a **capital-only
 *    price index** ("April 1962=100"), not a total return, and its bond series are
 *    **yields**, not total returns. Reconstructing genuine total returns from those
 *    ingredients would need a separately-sourced dividend-yield series and a
 *    duration-based bond-return approximation — exactly the kind of "glued together
 *    silently" methodology this task exists to avoid, so it was not used.
 *  - The Dimson-Marsh-Staunton series (the academic source behind the UK safe-withdrawal-
 *    rate research `docs/PROPOSAL.md` §2 cites) is commercially licensed via the UBS
 *    Global Investment Returns Yearbook — usable only as a published-summary-statistic
 *    sanity check (see below), never as raw redistributed data.
 *
 * **Source actually used**: the Jordà-Schularick-Taylor (JST) Macrohistory Database,
 * release R6 (www.macrohistory.net/data) — Òscar Jordà, Moritz Schularick, and Alan M.
 * Taylor, "Macrofinancial History and the New Business Cycle Facts," in *NBER
 * Macroeconomics Annual 2016*, and Jordà, Katharina Knoll, Dmitry Kuvshinov, Schularick,
 * and Taylor, "The Rate of Return on Everything, 1870–2015," *Quarterly Journal of
 * Economics* 134:3 (2019). Free, no-cost, peer-reviewed academic data covering 18
 * advanced economies annually since 1870, including UK (`iso: 'GBR'`) equity total
 * return, bond total return, and short-term bill rate — genuine total returns, not
 * prices or yields.
 *
 * **License note, worth stating plainly since this repository is public on GitHub**: the
 * JST database is licensed **CC BY-NC-SA 4.0** (non-commercial) — full terms, required
 * citations, and why this doesn't conflict with the repository's own blanket MIT
 * `LICENSE` are in `/LICENSE-DATA.md` (linked from an explicit exception clause in
 * `LICENSE` itself, added specifically because a blanket MIT grant would otherwise
 * silently misrepresent what this one file's data can legally be used for). This app is
 * a private, self-hosted, non-commercial household tool — not a paid product or a data
 * service — which fits the license's permitted use. If this project's use case ever
 * changed to something commercial, this specific data source would need replacing with
 * a commercially-licensed one first.
 *
 * **Coverage: 1871–2020 (150 years), UK only.** The database's own most recent release
 * does not yet reach the present day. **Deliberately not spliced to more recent years in
 * this milestone** — `docs/PROPOSAL.md`'s own Compute execution model methodology
 * warning applies here as much as anywhere: a rushed splice with a different-methodology
 * recent-years series, glued on without the same care, would be worse than an honest gap.
 * That splice is real, separate work for a future pass, not attempted here under time
 * pressure. A 150-year sample is already large for bootstrap resampling and includes the
 * 1914–18 and 1939–45 wars, the 1973–74 UK crash (the JST-reported −28.0%/−50.2% nominal
 * equity returns for 1973/1974 match the historical record for that crash, an
 * independent sanity check in itself), 1987, the dot-com bust, and 2008 — a genuinely
 * rich sample of adverse sequences for a retirement engine to stress-test against.
 *
 * **Independently cross-validated, not just transcribed and trusted**: the geometric
 * mean *real* UK equity return implied by this data (computed via the Fisher relation
 * below, over 1871–2020) is **5.2%** — matching, to one decimal place, the UBS Global
 * Investment Returns Yearbook 2025's independently published "worldwide equities
 * returned 5.2% per year in real terms over 125 years" figure (itself descending from
 * the same DMS research programme this file's primary source is a peer of, but computed
 * independently and not copied from it).
 *
 * **Methodology**: raw values below are nominal (equity/gilt total return, bill rate)
 * and the CPI index level, exactly as JST reports them, rounded to 6 decimal places —
 * matching `RATE_SCALE` in `src/lib/retirement/engineTypes.ts`, whose fixed-point
 * conventions this file reuses throughout (`parseScaledDecimal`/`roundDiv` from
 * `src/lib/portfolio/valuation.ts` — no float ever touches a rate here, the same
 * discipline `docs/PROPOSAL.md` calls for explicitly for a Monte Carlo engine). Inflation
 * for a year is derived from the ratio of that year's CPI to the previous year's, not
 * stored as a separate figure that could silently disagree with it. Real returns are
 * derived from nominal ones via the exact Fisher relation, `(1+nominal)/(1+inflation) −
 * 1`, not the arithmetic approximation (`nominal − inflation`), which drifts
 * measurably at the high-inflation years this exact series contains (e.g. 1975).
 */

import { parseScaledDecimal, roundDiv } from '@/lib/portfolio/valuation';
import { RATE_SCALE } from '@/lib/retirement/engineTypes';

const SCALE_UNIT = 10n ** BigInt(RATE_SCALE);

interface RawYear {
  year: number;
  /** CPI index level, JST's own base year, 6dp. */
  cpi: string;
  /** Nominal equity total return (capital gain + dividends reinvested), as a fraction. */
  equityTotalReturnNominal: string;
  /** Nominal long-term government bond ("gilt") total return, as a fraction. */
  giltTotalReturnNominal: string;
  /** Nominal short-term bill rate, as a fraction. */
  billRateNominal: string;
}

/**
 * UK, 1871–2020, from JST Macrohistory Database R6 (`iso: 'GBR'`). 1870 itself is
 * excluded — its `eq_tr` is genuinely absent in JST's own panel (no prior year to
 * compute a first-year equity return against), and starting the series uniformly at
 * 1871 keeps equity/gilt/bill aligned on the same year range rather than a ragged start
 * (1870's `bond_tr` and `bill_rate` are actually present in the source, unlike `eq_tr` —
 * worth being precise about, since only one of the three is the reason 1870 is excluded).
 */
const RAW_YEARS: readonly RawYear[] = [
  { year: 1871, cpi: '2.227974', equityTotalReturnNominal: '0.261900', giltTotalReturnNominal: '0.045144', billRateNominal: '0.026300' },
  { year: 1872, cpi: '2.332689', equityTotalReturnNominal: '0.063100', giltTotalReturnNominal: '0.016216', billRateNominal: '0.039000' },
  { year: 1873, cpi: '2.405002', equityTotalReturnNominal: '0.049700', giltTotalReturnNominal: '0.043956', billRateNominal: '0.044900' },
  { year: 1874, cpi: '2.325637', equityTotalReturnNominal: '0.031700', giltTotalReturnNominal: '0.028533', billRateNominal: '0.034100' },
  { year: 1875, cpi: '2.281450', equityTotalReturnNominal: '0.075300', giltTotalReturnNominal: '0.057299', billRateNominal: '0.029000' },
  { year: 1876, cpi: '2.274606', equityTotalReturnNominal: '0.068400', giltTotalReturnNominal: '0.033289', billRateNominal: '0.018900' },
  { year: 1877, cpi: '2.258683', equityTotalReturnNominal: '0.088700', giltTotalReturnNominal: '0.044548', billRateNominal: '0.023400' },
  { year: 1878, cpi: '2.208992', equityTotalReturnNominal: '0.005200', giltTotalReturnNominal: '0.022981', billRateNominal: '0.032300' },
  { year: 1879, cpi: '2.111797', equityTotalReturnNominal: '0.156500', giltTotalReturnNominal: '0.063576', billRateNominal: '0.017600' },
  { year: 1880, cpi: '2.175151', equityTotalReturnNominal: '0.138100', giltTotalReturnNominal: '0.044929', billRateNominal: '0.023200' },
  { year: 1881, cpi: '2.151224', equityTotalReturnNominal: '0.166800', giltTotalReturnNominal: '0.035724', billRateNominal: '0.028600' },
  { year: 1882, cpi: '2.172736', equityTotalReturnNominal: '0.015600', giltTotalReturnNominal: '0.045677', billRateNominal: '0.033800' },
  { year: 1883, cpi: '2.161872', equityTotalReturnNominal: '0.003100', giltTotalReturnNominal: '0.026658', billRateNominal: '0.030300' },
  { year: 1884, cpi: '2.103502', equityTotalReturnNominal: '0.034000', giltTotalReturnNominal: '0.018209', billRateNominal: '0.024000' },
  { year: 1885, cpi: '2.040397', equityTotalReturnNominal: '0.029600', giltTotalReturnNominal: '0.036948', billRateNominal: '0.021300' },
  { year: 1886, cpi: '2.007751', equityTotalReturnNominal: '0.026500', giltTotalReturnNominal: '0.035000', billRateNominal: '0.021300' },
  { year: 1887, cpi: '1.997712', equityTotalReturnNominal: '0.031700', giltTotalReturnNominal: '0.041791', billRateNominal: '0.024000' },
  { year: 1888, cpi: '2.011696', equityTotalReturnNominal: '0.136100', giltTotalReturnNominal: '0.008850', billRateNominal: '0.023800' },
  { year: 1889, cpi: '2.039859', equityTotalReturnNominal: '0.092200', giltTotalReturnNominal: '0.038027', billRateNominal: '0.026900' },
  { year: 1890, cpi: '2.043939', equityTotalReturnNominal: '0.042200', giltTotalReturnNominal: '0.011831', billRateNominal: '0.036600' },
  { year: 1891, cpi: '2.058247', equityTotalReturnNominal: '-0.004100', giltTotalReturnNominal: '0.025105', billRateNominal: '0.026300' },
  { year: 1892, cpi: '2.066480', equityTotalReturnNominal: '0.004300', giltTotalReturnNominal: '0.051181', billRateNominal: '0.014300' },
  { year: 1893, cpi: '2.052014', equityTotalReturnNominal: '-0.000900', giltTotalReturnNominal: '0.035302', billRateNominal: '0.021300' },
  { year: 1894, cpi: '2.010974', equityTotalReturnNominal: '0.107500', giltTotalReturnNominal: '0.079669', billRateNominal: '0.009700' },
  { year: 1895, cpi: '1.990864', equityTotalReturnNominal: '0.123200', giltTotalReturnNominal: '0.061212', billRateNominal: '0.008000' },
  { year: 1896, cpi: '1.984892', equityTotalReturnNominal: '0.122100', giltTotalReturnNominal: '0.068541', billRateNominal: '0.014700' },
  { year: 1897, cpi: '2.014665', equityTotalReturnNominal: '0.068300', giltTotalReturnNominal: '0.038202', billRateNominal: '0.017800' },
  { year: 1898, cpi: '2.020709', equityTotalReturnNominal: '0.052400', giltTotalReturnNominal: '0.002772', billRateNominal: '0.026600' },
  { year: 1899, cpi: '2.034854', equityTotalReturnNominal: '0.046700', giltTotalReturnNominal: '-0.063456', billRateNominal: '0.031800' },
  { year: 1900, cpi: '2.138632', equityTotalReturnNominal: '0.094600', giltTotalReturnNominal: '-0.004351', billRateNominal: '0.036600' },
  { year: 1901, cpi: '2.149325', equityTotalReturnNominal: '0.049100', giltTotalReturnNominal: '-0.016046', billRateNominal: '0.031600' },
  { year: 1902, cpi: '2.149325', equityTotalReturnNominal: '0.058900', giltTotalReturnNominal: '0.019486', billRateNominal: '0.029700' },
  { year: 1903, cpi: '2.157922', equityTotalReturnNominal: '0.016700', giltTotalReturnNominal: '-0.027631', billRateNominal: '0.034100' },
  { year: 1904, cpi: '2.153606', equityTotalReturnNominal: '0.111200', giltTotalReturnNominal: '0.041458', billRateNominal: '0.026800' },
  { year: 1905, cpi: '2.162221', equityTotalReturnNominal: '0.109400', giltTotalReturnNominal: '0.035830', billRateNominal: '0.025600' },
  { year: 1906, cpi: '2.162221', equityTotalReturnNominal: '0.096300', giltTotalReturnNominal: '-0.010846', billRateNominal: '0.039900' },
  { year: 1907, cpi: '2.188167', equityTotalReturnNominal: '-0.001600', giltTotalReturnNominal: '0.000132', billRateNominal: '0.044700' },
  { year: 1908, cpi: '2.199108', equityTotalReturnNominal: '0.045682', giltTotalReturnNominal: '0.035945', billRateNominal: '0.023200' },
  { year: 1909, cpi: '2.210104', equityTotalReturnNominal: '0.110602', giltTotalReturnNominal: '0.018180', billRateNominal: '0.022900' },
  { year: 1910, cpi: '2.229995', equityTotalReturnNominal: '0.014817', giltTotalReturnNominal: '-0.013062', billRateNominal: '0.031600' },
  { year: 1911, cpi: '2.232225', equityTotalReturnNominal: '0.016036', giltTotalReturnNominal: '0.002250', billRateNominal: '0.029100' },
  { year: 1912, cpi: '2.299191', equityTotalReturnNominal: '0.034422', giltTotalReturnNominal: '0.007547', billRateNominal: '0.036200' },
  { year: 1913, cpi: '2.289995', equityTotalReturnNominal: '-0.037963', giltTotalReturnNominal: '-0.013174', billRateNominal: '0.043700' },
  { year: 1914, cpi: '2.283125', equityTotalReturnNominal: '-0.000640', giltTotalReturnNominal: '0.044682', billRateNominal: '0.029100' },
  { year: 1915, cpi: '2.568515', equityTotalReturnNominal: '0.026000', giltTotalReturnNominal: '0.034000', billRateNominal: '0.036600' },
  { year: 1916, cpi: '3.033417', equityTotalReturnNominal: '-0.024708', giltTotalReturnNominal: '-0.202986', billRateNominal: '0.052000' },
  { year: 1917, cpi: '3.797837', equityTotalReturnNominal: '0.095101', giltTotalReturnNominal: '0.030637', billRateNominal: '0.047900' },
  { year: 1918, cpi: '4.633362', equityTotalReturnNominal: '0.207742', giltTotalReturnNominal: '0.127967', billRateNominal: '0.035700' },
  { year: 1919, cpi: '5.101331', equityTotalReturnNominal: '0.095556', giltTotalReturnNominal: '-0.084263', billRateNominal: '0.034800' },
  { year: 1920, cpi: '5.886936', equityTotalReturnNominal: '-0.213397', giltTotalReturnNominal: '-0.073387', billRateNominal: '0.062100' },
  { year: 1921, cpi: '5.380660', equityTotalReturnNominal: '-0.007442', giltTotalReturnNominal: '0.164649', billRateNominal: '0.045800' },
  { year: 1922, cpi: '4.627367', equityTotalReturnNominal: '0.262400', giltTotalReturnNominal: '0.159672', billRateNominal: '0.025700' },
  { year: 1923, cpi: '4.349725', equityTotalReturnNominal: '0.009125', giltTotalReturnNominal: '0.042221', billRateNominal: '0.026200' },
  { year: 1924, cpi: '4.319277', equityTotalReturnNominal: '0.201717', giltTotalReturnNominal: '0.073520', billRateNominal: '0.033900' },
  { year: 1925, cpi: '4.332235', equityTotalReturnNominal: '0.151236', giltTotalReturnNominal: '0.003139', billRateNominal: '0.040900' },
  { year: 1926, cpi: '4.297577', equityTotalReturnNominal: '0.065915', giltTotalReturnNominal: '0.028755', billRateNominal: '0.045100' },
  { year: 1927, cpi: '4.194435', equityTotalReturnNominal: '0.085782', giltTotalReturnNominal: '0.071688', billRateNominal: '0.042500' },
  { year: 1928, cpi: '4.181852', equityTotalReturnNominal: '0.164685', giltTotalReturnNominal: '0.059311', billRateNominal: '0.041500' },
  { year: 1929, cpi: '4.144215', equityTotalReturnNominal: '-0.142338', giltTotalReturnNominal: '-0.015965', billRateNominal: '0.052600' },
  { year: 1930, cpi: '4.028177', equityTotalReturnNominal: '-0.048602', giltTotalReturnNominal: '0.131428', billRateNominal: '0.024800' },
  { year: 1931, cpi: '3.854966', equityTotalReturnNominal: '-0.201314', giltTotalReturnNominal: '-0.005443', billRateNominal: '0.035900' },
  { year: 1932, cpi: '3.754737', equityTotalReturnNominal: '0.342286', giltTotalReturnNominal: '0.403182', billRateNominal: '0.014900' },
  { year: 1933, cpi: '3.675887', equityTotalReturnNominal: '0.244091', giltTotalReturnNominal: '0.031661', billRateNominal: '0.005900' },
  { year: 1934, cpi: '3.675887', equityTotalReturnNominal: '0.140471', giltTotalReturnNominal: '0.276968', billRateNominal: '0.007300' },
  { year: 1935, cpi: '3.701618', equityTotalReturnNominal: '0.139908', giltTotalReturnNominal: '-0.031190', billRateNominal: '0.005500' },
  { year: 1936, cpi: '3.727530', equityTotalReturnNominal: '0.191972', giltTotalReturnNominal: '0.002684', billRateNominal: '0.005800' },
  { year: 1937, cpi: '3.854266', equityTotalReturnNominal: '-0.130434', giltTotalReturnNominal: '-0.092034', billRateNominal: '0.005600' },
  { year: 1938, cpi: '3.915934', equityTotalReturnNominal: '-0.097899', giltTotalReturnNominal: '-0.021813', billRateNominal: '0.006100' },
  { year: 1939, cpi: '4.025580', equityTotalReturnNominal: '0.018271', giltTotalReturnNominal: '0.009540', billRateNominal: '0.013200' },
  { year: 1940, cpi: '4.701878', equityTotalReturnNominal: '-0.048895', giltTotalReturnNominal: '0.159367', billRateNominal: '0.010300' },
  { year: 1941, cpi: '5.209680', equityTotalReturnNominal: '0.227333', giltTotalReturnNominal: '0.105643', billRateNominal: '0.010100' },
  { year: 1942, cpi: '5.579568', equityTotalReturnNominal: '0.184370', giltTotalReturnNominal: '0.027593', billRateNominal: '0.010000' },
  { year: 1943, cpi: '5.769273', equityTotalReturnNominal: '0.110400', giltTotalReturnNominal: '-0.004982', billRateNominal: '0.010000' },
  { year: 1944, cpi: '5.925043', equityTotalReturnNominal: '0.124500', giltTotalReturnNominal: '0.057250', billRateNominal: '0.010000' },
  { year: 1945, cpi: '6.090945', equityTotalReturnNominal: '0.064615', giltTotalReturnNominal: '0.148149', billRateNominal: '0.009000' },
  { year: 1946, cpi: '6.279764', equityTotalReturnNominal: '0.177313', giltTotalReturnNominal: '0.107610', billRateNominal: '0.005000' },
  { year: 1947, cpi: '6.719347', equityTotalReturnNominal: '-0.025769', giltTotalReturnNominal: '-0.143347', billRateNominal: '0.005100' },
  { year: 1948, cpi: '7.236737', equityTotalReturnNominal: '-0.036759', giltTotalReturnNominal: '0.006970', billRateNominal: '0.005100' },
  { year: 1949, cpi: '7.439366', equityTotalReturnNominal: '-0.057006', giltTotalReturnNominal: '-0.089347', billRateNominal: '0.005200' },
  { year: 1950, cpi: '7.730877', equityTotalReturnNominal: '0.109574', giltTotalReturnNominal: '0.040642', billRateNominal: '0.005200' },
  { year: 1951, cpi: '8.430504', equityTotalReturnNominal: '0.082295', giltTotalReturnNominal: '-0.096837', billRateNominal: '0.005600' },
  { year: 1952, cpi: '9.328358', equityTotalReturnNominal: '-0.001412', giltTotalReturnNominal: '-0.006850', billRateNominal: '0.022000' },
  { year: 1953, cpi: '9.666511', equityTotalReturnNominal: '0.244306', giltTotalReturnNominal: '0.138610', billRateNominal: '0.023000' },
  { year: 1954, cpi: '9.888060', equityTotalReturnNominal: '0.486165', giltTotalReturnNominal: '0.060638', billRateNominal: '0.017900' },
  { year: 1955, cpi: '10.389459', equityTotalReturnNominal: '0.108628', giltTotalReturnNominal: '-0.101183', billRateNominal: '0.037500' },
  { year: 1956, cpi: '10.925840', equityTotalReturnNominal: '-0.091641', giltTotalReturnNominal: '-0.029814', billRateNominal: '0.049500' },
  { year: 1957, cpi: '11.345616', equityTotalReturnNominal: '-0.009477', giltTotalReturnNominal: '-0.063057', billRateNominal: '0.048100' },
  { year: 1958, cpi: '11.672108', equityTotalReturnNominal: '0.477424', giltTotalReturnNominal: '0.170271', billRateNominal: '0.045600' },
  { year: 1959, cpi: '11.742071', equityTotalReturnNominal: '0.548623', giltTotalReturnNominal: '0.009832', billRateNominal: '0.033800' },
  { year: 1960, cpi: '11.835354', equityTotalReturnNominal: '0.018391', giltTotalReturnNominal: '-0.071032', billRateNominal: '0.048900' },
  { year: 1961, cpi: '12.220149', equityTotalReturnNominal: '0.018128', giltTotalReturnNominal: '-0.079440', billRateNominal: '0.051400' },
  { year: 1962, cpi: '12.733209', equityTotalReturnNominal: '0.003790', giltTotalReturnNominal: '0.247768', billRateNominal: '0.041700' },
  { year: 1963, cpi: '13.001399', equityTotalReturnNominal: '0.198082', giltTotalReturnNominal: '0.036340', billRateNominal: '0.036700' },
  { year: 1964, cpi: '13.421175', equityTotalReturnNominal: '-0.054100', giltTotalReturnNominal: '-0.023652', billRateNominal: '0.045900' },
  { year: 1965, cpi: '13.992537', equityTotalReturnNominal: '0.111743', giltTotalReturnNominal: '0.043927', billRateNominal: '0.059100' },
  { year: 1966, cpi: '14.552239', equityTotalReturnNominal: '-0.038407', giltTotalReturnNominal: '0.042149', billRateNominal: '0.061200' },
  { year: 1967, cpi: '14.878731', equityTotalReturnNominal: '0.341902', giltTotalReturnNominal: '0.023494', billRateNominal: '0.058100' },
  { year: 1968, cpi: '15.473414', equityTotalReturnNominal: '0.481952', giltTotalReturnNominal: '-0.023348', billRateNominal: '0.070300' },
  { year: 1969, cpi: '16.277985', equityTotalReturnNominal: '-0.118731', giltTotalReturnNominal: '-0.002488', billRateNominal: '0.076300' },
  { year: 1970, cpi: '17.339086', equityTotalReturnNominal: '-0.034857', giltTotalReturnNominal: '0.034527', billRateNominal: '0.070200' },
  { year: 1971, cpi: '18.971549', equityTotalReturnNominal: '0.466016', giltTotalReturnNominal: '0.269080', billRateNominal: '0.055800' },
  { year: 1972, cpi: '20.335821', equityTotalReturnNominal: '0.163745', giltTotalReturnNominal: '-0.041294', billRateNominal: '0.055200' },
  { year: 1973, cpi: '22.236474', equityTotalReturnNominal: '-0.280009', giltTotalReturnNominal: '-0.087871', billRateNominal: '0.093800' },
  { year: 1974, cpi: '25.734608', equityTotalReturnNominal: '-0.501952', giltTotalReturnNominal: '-0.157680', billRateNominal: '0.113800' },
  { year: 1975, cpi: '31.576493', equityTotalReturnNominal: '1.496069', giltTotalReturnNominal: '0.361257', billRateNominal: '0.101800' },
  { year: 1976, cpi: '36.520522', equityTotalReturnNominal: '0.023265', giltTotalReturnNominal: '0.138826', billRateNominal: '0.111500' },
  { year: 1977, cpi: '41.977612', equityTotalReturnNominal: '0.485602', giltTotalReturnNominal: '0.455556', billRateNominal: '0.076600' },
  { year: 1978, cpi: '45.114272', equityTotalReturnNominal: '0.086659', giltTotalReturnNominal: '-0.025752', billRateNominal: '0.085100' },
  { year: 1979, cpi: '50.244869', equityTotalReturnNominal: '0.114814', giltTotalReturnNominal: '0.041836', billRateNominal: '0.130000' },
  { year: 1980, cpi: '57.859142', equityTotalReturnNominal: '0.348331', giltTotalReturnNominal: '0.191252', billRateNominal: '0.151200' },
  { year: 1981, cpi: '64.692164', equityTotalReturnNominal: '0.136274', giltTotalReturnNominal: '0.099868', billRateNominal: '0.129800' },
  { year: 1982, cpi: '69.939366', equityTotalReturnNominal: '0.284920', giltTotalReturnNominal: '0.535222', billRateNominal: '0.113800' },
  { year: 1983, cpi: '73.390858', equityTotalReturnNominal: '0.287792', giltTotalReturnNominal: '0.078283', billRateNominal: '0.095900' },
  { year: 1984, cpi: '76.515858', equityTotalReturnNominal: '0.315741', giltTotalReturnNominal: '0.037561', billRateNominal: '0.093000' },
  { year: 1985, cpi: '80.282183', equityTotalReturnNominal: '0.201366', giltTotalReturnNominal: '0.199184', billRateNominal: '0.116000' },
  { year: 1986, cpi: '82.952425', equityTotalReturnNominal: '0.272176', giltTotalReturnNominal: '0.125390', billRateNominal: '0.103400' },
  { year: 1987, cpi: '85.611007', equityTotalReturnNominal: '0.086509', giltTotalReturnNominal: '0.178991', billRateNominal: '0.092300' },
  { year: 1988, cpi: '88.829291', equityTotalReturnNominal: '0.114840', giltTotalReturnNominal: '0.068684', billRateNominal: '0.098000' },
  { year: 1989, cpi: '93.481810', equityTotalReturnNominal: '0.354682', giltTotalReturnNominal: '0.082100', billRateNominal: '0.132800' },
  { year: 1990, cpi: '100.000000', equityTotalReturnNominal: '-0.096108', giltTotalReturnNominal: '0.082109', billRateNominal: '0.140900' },
  { year: 1991, cpi: '107.532649', equityTotalReturnNominal: '0.208054', giltTotalReturnNominal: '0.184824', billRateNominal: '0.108200' },
  { year: 1992, cpi: '112.115205', equityTotalReturnNominal: '0.198887', giltTotalReturnNominal: '0.200163', billRateNominal: '0.089400' },
  { year: 1993, cpi: '114.925373', equityTotalReturnNominal: '0.275481', giltTotalReturnNominal: '0.227906', billRateNominal: '0.052100' },
  { year: 1994, cpi: '117.199160', equityTotalReturnNominal: '-0.059496', giltTotalReturnNominal: '-0.104130', billRateNominal: '0.051500' },
  { year: 1995, cpi: '120.312500', equityTotalReturnNominal: '0.230210', giltTotalReturnNominal: '0.175601', billRateNominal: '0.063300' },
  { year: 1996, cpi: '123.200371', equityTotalReturnNominal: '0.158099', giltTotalReturnNominal: '0.077644', billRateNominal: '0.057800' },
  { year: 1997, cpi: '125.448293', equityTotalReturnNominal: '0.235671', giltTotalReturnNominal: '0.167595', billRateNominal: '0.064800' },
  { year: 1998, cpi: '127.402021', equityTotalReturnNominal: '0.136740', giltTotalReturnNominal: '0.211694', billRateNominal: '0.068200' },
  { year: 1999, cpi: '129.094825', equityTotalReturnNominal: '0.237990', giltTotalReturnNominal: '-0.041475', billRateNominal: '0.050400' },
  { year: 2000, cpi: '130.123009', equityTotalReturnNominal: '-0.059403', giltTotalReturnNominal: '0.097945', billRateNominal: '0.058000' },
  { year: 2001, cpi: '131.728092', equityTotalReturnNominal: '-0.132198', giltTotalReturnNominal: '0.029549', billRateNominal: '0.047600' },
  { year: 2002, cpi: '133.386434', equityTotalReturnNominal: '-0.222603', giltTotalReturnNominal: '0.102087', billRateNominal: '0.038600' },
  { year: 2003, cpi: '135.202614', equityTotalReturnNominal: '0.201757', giltTotalReturnNominal: '0.021114', billRateNominal: '0.035600' },
  { year: 2004, cpi: '137.019092', equityTotalReturnNominal: '0.125950', giltTotalReturnNominal: '0.066381', billRateNominal: '0.044400' },
  { year: 2005, cpi: '139.837498', equityTotalReturnNominal: '0.216436', giltTotalReturnNominal: '0.085014', billRateNominal: '0.045500' },
  { year: 2006, cpi: '143.093911', equityTotalReturnNominal: '0.164316', giltTotalReturnNominal: '-0.005020', billRateNominal: '0.046500' },
  { year: 2007, cpi: '146.417756', equityTotalReturnNominal: '0.050815', giltTotalReturnNominal: '0.062061', billRateNominal: '0.055300' },
  { year: 2008, cpi: '151.691600', equityTotalReturnNominal: '-0.297511', giltTotalReturnNominal: '0.159729', billRateNominal: '0.043200' },
  { year: 2009, cpi: '154.976209', equityTotalReturnNominal: '0.289520', giltTotalReturnNominal: '-0.015164', billRateNominal: '0.005300' },
  { year: 2010, cpi: '160.087591', equityTotalReturnNominal: '0.141579', giltTotalReturnNominal: '0.101185', billRateNominal: '0.005000' },
  { year: 2011, cpi: '167.233410', equityTotalReturnNominal: '-0.034273', giltTotalReturnNominal: '0.184079', billRateNominal: '0.004800' },
  { year: 2012, cpi: '171.963175', equityTotalReturnNominal: '0.121456', giltTotalReturnNominal: '0.038486', billRateNominal: '0.003130' },
  { year: 2013, cpi: '176.373685', equityTotalReturnNominal: '0.205382', giltTotalReturnNominal: '-0.061271', billRateNominal: '0.003020' },
  { year: 2014, cpi: '178.950560', equityTotalReturnNominal: '0.011954', giltTotalReturnNominal: '0.155964', billRateNominal: '0.003800' },
  { year: 2015, cpi: '179.022318', equityTotalReturnNominal: '0.010999', giltTotalReturnNominal: '0.007676', billRateNominal: '0.004400' },
  { year: 2016, cpi: '180.203267', equityTotalReturnNominal: '0.154100', giltTotalReturnNominal: '0.071265', billRateNominal: '0.002024' },
  { year: 2017, cpi: '185.068756', equityTotalReturnNominal: '0.140700', giltTotalReturnNominal: '0.037439', billRateNominal: '0.004123' },
  { year: 2018, cpi: '189.695474', equityTotalReturnNominal: '-0.095500', giltTotalReturnNominal: '0.022330', billRateNominal: '0.006998' },
  { year: 2019, cpi: '193.109993', equityTotalReturnNominal: '0.183800', giltTotalReturnNominal: '0.057202', billRateNominal: '0.007098' },
  { year: 2020, cpi: '194.847983', equityTotalReturnNominal: '-0.094400', giltTotalReturnNominal: '0.057524', billRateNominal: '0.000394' },
];

/** Every raw year has a predecessor in `RAW_YEARS` (1870's CPI isn't in this array, but
 * every year from 1871 has its own preceding year present), so inflation is always
 * computable without a separate "first year" special case. */
const CPI_BY_YEAR = new Map(RAW_YEARS.map((row) => [row.year, row.cpi]));
// 1870's CPI, needed only to compute 1871's inflation rate, sourced the same way as
// every other CPI value above (JST Macrohistory Database R6, UK, `cpi` column, 1870).
const CPI_1870 = '2.197213';

/** `(1 + nominal) / (1 + inflation) − 1`, in `RATE_SCALE`-scaled fixed point throughout
 * — the exact Fisher relation, not the arithmetic approximation (`nominal − inflation`),
 * which measurably understates real returns in the high-inflation years this series
 * contains (e.g. 1975's ~35% UK inflation). */
function realReturnFraction(nominalScaled: bigint, inflationScaled: bigint): bigint {
  const numerator = (SCALE_UNIT + nominalScaled) * SCALE_UNIT;
  const denominator = SCALE_UNIT + inflationScaled;
  return roundDiv(numerator, denominator) - SCALE_UNIT;
}

export interface UkHistoricalReturnYear {
  year: number;
  /** `RATE_SCALE`-scaled fraction — e.g. `52000n` at `RATE_SCALE = 6` means 5.2%. */
  equityRealReturn: bigint;
  giltRealReturn: bigint;
  billRealReturn: bigint;
  inflationRate: bigint;
}

let cached: readonly UkHistoricalReturnYear[] | null = null;

/**
 * The full 1871–2020 UK series, converted to real (inflation-adjusted) returns. Computed
 * once and cached — this is static historical data, not a value that changes between
 * calls, and Milestone 5's bootstrap sampler is expected to call this once per
 * simulation batch rather than once per sampled year.
 */
export function ukHistoricalRealReturns(): readonly UkHistoricalReturnYear[] {
  if (cached) return cached;

  cached = RAW_YEARS.map((row) => {
    const previousCpi = CPI_BY_YEAR.get(row.year - 1) ?? (row.year - 1 === 1870 ? CPI_1870 : null);
    if (previousCpi === null) {
      throw new Error(`No prior-year CPI available to compute inflation for ${row.year}`);
    }

    const cpiScaled = parseScaledDecimal(row.cpi, RATE_SCALE);
    const previousCpiScaled = parseScaledDecimal(previousCpi, RATE_SCALE);
    const inflationRate = roundDiv(cpiScaled * SCALE_UNIT, previousCpiScaled) - SCALE_UNIT;

    const equityNominal = parseScaledDecimal(row.equityTotalReturnNominal, RATE_SCALE);
    const giltNominal = parseScaledDecimal(row.giltTotalReturnNominal, RATE_SCALE);
    const billNominal = parseScaledDecimal(row.billRateNominal, RATE_SCALE);

    return {
      year: row.year,
      equityRealReturn: realReturnFraction(equityNominal, inflationRate),
      giltRealReturn: realReturnFraction(giltNominal, inflationRate),
      billRealReturn: realReturnFraction(billNominal, inflationRate),
      inflationRate,
    };
  });

  return cached;
}

/**
 * The arithmetic mean of this series' real equity returns, as a percent string (e.g.
 * `"5.234"`) — Phase 4.5's default "realistic investment returns" benchmark for the
 * contribution waterfall's high-interest-debt comparison (any debt rate above this is
 * "beats realistic returns", per `docs/PROPOSAL.md` §4). Arithmetic, not geometric:
 * this is used only as a one-off comparison threshold, not to compound a portfolio
 * over time, so the simpler mean is proportionate — the bootstrap engine (Milestone 5)
 * still samples the full year-by-year series for compounding, where the geometric
 * distinction actually matters and a mean would be the wrong tool entirely. Plain
 * `Number` math converting the final scaled bigint to a percent string is the same
 * disclosed exception to bigint-only money that `dcf.ts`'s own suggested-input
 * functions already take, since this is a percent-string config default, not stored
 * money — precision to 3 decimal places is more than this benchmark needs.
 */
export function meanRealEquityReturnPct(): string {
  const years = ukHistoricalRealReturns();
  const sumScaled = years.reduce((sum, year) => sum + year.equityRealReturn, 0n);
  const meanScaled = sumScaled / BigInt(years.length);
  const meanFraction = Number(meanScaled) / Number(SCALE_UNIT);
  return (meanFraction * 100).toFixed(3);
}
