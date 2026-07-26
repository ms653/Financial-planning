/**
 * Brute-force protection: an in-memory failure counter, 5 failures => 60s lockout.
 *
 * Deliberately in-memory, exactly as PROPOSAL.md specifies ("a trivial in-memory
 * counter"). The tradeoffs, stated rather than discovered later:
 *  - State is lost on app restart, so restarting clears a lockout. Acceptable: the
 *    network boundary is Tailscale, so only enrolled devices can reach the port at
 *    all, and an attacker who can restart the container has already won.
 *  - It does not survive across multiple app instances. There is exactly one app
 *    container in this deployment (docker-compose.yml), so there is nothing to share.
 *
 * Implemented as a class with an injectable clock so the 60-second window is
 * unit-testable without real waiting, plus a module-level default instance for the
 * app to use.
 */

export const MAX_FAILURES_BEFORE_LOCKOUT = 5;
export const LOCKOUT_DURATION_MS = 60_000;

/** Discard idle entries after this long so the map can't grow without bound. */
const ENTRY_TTL_MS = 15 * 60_000;

interface Entry {
  failures: number;
  lockedUntil: number | null;
  lastSeen: number;
}

export type LockoutStatus =
  | { locked: false; failures: number }
  | { locked: true; failures: number; retryAfterMs: number };

export class LoginRateLimiter {
  private readonly entries = new Map<string, Entry>();

  constructor(
    private readonly clock: () => number = Date.now,
    private readonly maxFailures: number = MAX_FAILURES_BEFORE_LOCKOUT,
    private readonly lockoutMs: number = LOCKOUT_DURATION_MS,
  ) {}

  /**
   * Current status for a key, without recording anything.
   *
   * Call this *before* verifying a passphrase — otherwise a locked-out client still
   * gets its guess checked, which defeats the point of the lockout.
   */
  status(key: string): LockoutStatus {
    const now = this.clock();
    this.evictStale(now);
    const entry = this.entries.get(key);
    if (!entry) return { locked: false, failures: 0 };

    if (entry.lockedUntil !== null) {
      if (entry.lockedUntil > now) {
        return {
          locked: true,
          failures: entry.failures,
          retryAfterMs: entry.lockedUntil - now,
        };
      }
      // Lockout has elapsed: clear it and give a fresh allowance of attempts rather
      // than leaving the counter at the threshold, where a single further failure
      // would re-lock immediately.
      entry.lockedUntil = null;
      entry.failures = 0;
    }
    return { locked: false, failures: entry.failures };
  }

  /** Record a failed attempt and return the resulting status (locked if at threshold). */
  recordFailure(key: string): LockoutStatus {
    const now = this.clock();
    this.evictStale(now);
    // Normalise any elapsed lockout first.
    const current = this.status(key);
    // Already locked: don't count the attempt. Callers check status() before verifying,
    // so reaching here means something bypassed that — extending the lockout on each
    // such call would turn a fixed 60s penalty into an indefinite one.
    if (current.locked) return current;

    const entry = this.entries.get(key) ?? { failures: 0, lockedUntil: null, lastSeen: now };
    entry.failures += 1;
    entry.lastSeen = now;

    if (entry.failures >= this.maxFailures) {
      entry.lockedUntil = now + this.lockoutMs;
      this.entries.set(key, entry);
      return { locked: true, failures: entry.failures, retryAfterMs: this.lockoutMs };
    }

    this.entries.set(key, entry);
    return { locked: false, failures: entry.failures };
  }

  /** Clear a key's history. Called on successful login. */
  recordSuccess(key: string): void {
    this.entries.delete(key);
  }

  /** Test helper — resets all state. */
  reset(): void {
    this.entries.clear();
  }

  private evictStale(now: number): void {
    for (const [key, entry] of this.entries) {
      const idle = now - entry.lastSeen > ENTRY_TTL_MS;
      const unlocked = entry.lockedUntil === null || entry.lockedUntil <= now;
      if (idle && unlocked) this.entries.delete(key);
    }
  }
}

/**
 * Process-wide limiter used by the login action.
 *
 * Keyed on a single constant rather than on client IP: there is one shared household
 * passphrase, so per-IP buckets would let an attacker with several Tailscale devices
 * (or a spoofable proxy header) get 5 guesses each. A global bucket means a locked-out
 * attacker also locks out the household for 60 seconds, which is an acceptable price
 * for a single-passphrase app on a private tailnet.
 */
export const loginRateLimiter = new LoginRateLimiter();

export const GLOBAL_LOGIN_KEY = 'household-passphrase';
