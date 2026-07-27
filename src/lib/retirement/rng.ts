/**
 * A seeded, deterministic pseudo-random number generator for the Monte Carlo engine.
 *
 * `docs/PROPOSAL.md`'s Compute execution model calls for this by name: "a seeded,
 * deterministic RNG... makes bit-identical results possible for a fixed seed (needed
 * for the property-based tests in Testing strategy) and makes 'why did this number
 * changed' debuggable, rather than every run being silently different." `Math.random()`
 * cannot be seeded at all, so it was never an option here.
 *
 * mulberry32 (public-domain, Tommy Ettinger) — chosen over pulling in a dependency for
 * something this small: ~10 lines, passes standard PRNG statistical test suites well
 * enough for Monte Carlo sampling (not cryptographic use), and every operation is
 * 32-bit integer arithmetic with well-defined overflow behaviour, which is exactly what
 * makes the sequence reproducible bit-for-bit across machines and Node versions.
 *
 * **Not cryptographically secure — never use this for anything security-adjacent**
 * (session tokens, password reset codes, etc.). `src/lib/auth/session.ts`'s HMAC-based
 * approach is the pattern for that; this module exists solely to drive simulated market
 * returns.
 */

/** Returns a generator function producing floats in `[0, 1)`, deterministic for a given
 * `seed`. Calling the returned function advances the generator's internal state — the
 * same generator instance must be threaded through a whole simulation run for its
 * output to be reproducible; two separately-created generators from the same seed
 * produce the same sequence, but a fresh `createRng(seed)` call restarts it. */
export function createRng(seed: number): () => number {
  let state = seed | 0;
  return function next(): number {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), state | 1);
    t = (t + Math.imul(t ^ (t >>> 7), t | 61)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A uniformly-distributed integer index in `[0, length)`, drawn from `rng`. The
 * companion operation every consumer of this module actually wants (bootstrap
 * resampling picks a random historical year by index) — kept here rather than
 * duplicated at each call site. Simple `floor(rng() * length)`, not rejection-sampled:
 * for the dataset sizes this engine samples from (on the order of 100 historical
 * years), the resulting bias is negligible, and rejection sampling would cost
 * determinism-sensitive complexity this doesn't need. */
export function randomIndex(rng: () => number, length: number): number {
  return Math.floor(rng() * length);
}
