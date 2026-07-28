# Third-party data license

This file covers exactly one thing: the historical UK returns data embedded in
[`src/lib/retirement/returns/ukHistoricalReturns.ts`](src/lib/retirement/returns/ukHistoricalReturns.ts)
(the `RAW_YEARS` constant, and every value derived from it). Nothing else in this
repository is covered by this file — see [`LICENSE`](LICENSE) (MIT) for everything else.

## Source

Jordà-Schularick-Taylor (JST) Macrohistory Database, release R6.
<https://www.macrohistory.net/data/>

Required citations, per the database's own terms of use:

- Òscar Jordà, Moritz Schularick, and Alan M. Taylor. "Macrofinancial History and the
  New Business Cycle Facts." In *NBER Macroeconomics Annual 2016*, volume 31, edited by
  Martin Eichenbaum and Jonathan A. Parker. Chicago: University of Chicago Press.
- Òscar Jordà, Katharina Knoll, Dmitry Kuvshinov, Moritz Schularick, and Alan M. Taylor.
  "The Rate of Return on Everything, 1870–2015." *Quarterly Journal of Economics* 134,
  no. 3 (2019): 1225–1298.

## License

**CC BY-NC-SA 4.0** (Creative Commons Attribution-NonCommercial-ShareAlike 4.0
International) — <https://creativecommons.org/licenses/by-nc-sa/4.0/>.

Quoting the database's own terms of use directly:

> We grant every user at no cost a license... provided that it is for non-commercial
> (e.g., academic) purposes... and provided that it may only be shared under identical
> license terms. Commercial data providers are thus strictly forbidden to integrate all
> or parts of the dataset into their services and/or resell the data.

## Why this is here

This project is a private, self-hosted, non-commercial household financial-planning
tool — not sold, not a data service, not integrated into any commercial product. That
use fits the license's non-commercial terms. This file exists because the repository
itself is public on GitHub and is MIT-licensed overall, and the JST data specifically
needs its own, different, non-commercial terms stated explicitly — see the exception
clause in `LICENSE`.

**If this project's purpose ever changes to something commercial**, the specific data
in `ukHistoricalReturns.ts` would need replacing with a commercially-licensed source
first — this license does not travel with any commercial use of the surrounding
(MIT-licensed) codebase.

Any further redistribution of the data itself (not the code that reads it) must carry
this same CC BY-NC-SA 4.0 license and the citations above.
