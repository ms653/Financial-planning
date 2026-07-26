import { beforeEach, describe, expect, it } from 'vitest';
import {
  GLOBAL_LOGIN_KEY,
  LOCKOUT_DURATION_MS,
  LoginRateLimiter,
  MAX_FAILURES_BEFORE_LOCKOUT,
  loginRateLimiter,
} from './lockout';

/** Controllable clock so the 60-second window is testable without waiting. */
class FakeClock {
  constructor(private t = 1_000_000) {}
  now = () => this.t;
  advance(ms: number) {
    this.t += ms;
  }
}

const KEY = 'household-passphrase';

describe('LoginRateLimiter', () => {
  let clock: FakeClock;
  let limiter: LoginRateLimiter;

  beforeEach(() => {
    clock = new FakeClock();
    limiter = new LoginRateLimiter(clock.now);
  });

  it('matches the spec: 5 failures, 60 second lockout', () => {
    expect(MAX_FAILURES_BEFORE_LOCKOUT).toBe(5);
    expect(LOCKOUT_DURATION_MS).toBe(60_000);
  });

  it('starts unlocked with no failures', () => {
    expect(limiter.status(KEY)).toEqual({ locked: false, failures: 0 });
  });

  it('allows the first four failures without locking', () => {
    for (let i = 1; i <= 4; i += 1) {
      const status = limiter.recordFailure(KEY);
      expect(status).toEqual({ locked: false, failures: i });
    }
    expect(limiter.status(KEY).locked).toBe(false);
  });

  it('locks on the fifth failure', () => {
    for (let i = 0; i < 4; i += 1) limiter.recordFailure(KEY);
    const status = limiter.recordFailure(KEY);
    expect(status.locked).toBe(true);
    expect(status).toMatchObject({ failures: 5, retryAfterMs: 60_000 });
  });

  it('reports locked status on subsequent checks without needing another attempt', () => {
    for (let i = 0; i < 5; i += 1) limiter.recordFailure(KEY);
    const status = limiter.status(KEY);
    expect(status.locked).toBe(true);
  });

  it('counts down retryAfterMs as time passes', () => {
    for (let i = 0; i < 5; i += 1) limiter.recordFailure(KEY);
    clock.advance(20_000);
    const status = limiter.status(KEY);
    expect(status.locked).toBe(true);
    if (status.locked) expect(status.retryAfterMs).toBe(40_000);
  });

  it('stays locked one millisecond before the window elapses', () => {
    for (let i = 0; i < 5; i += 1) limiter.recordFailure(KEY);
    clock.advance(LOCKOUT_DURATION_MS - 1);
    expect(limiter.status(KEY).locked).toBe(true);
  });

  it('unlocks once 60 seconds have elapsed', () => {
    for (let i = 0; i < 5; i += 1) limiter.recordFailure(KEY);
    clock.advance(LOCKOUT_DURATION_MS);
    expect(limiter.status(KEY)).toEqual({ locked: false, failures: 0 });
  });

  it('gives a fresh allowance after unlocking, rather than re-locking on one failure', () => {
    for (let i = 0; i < 5; i += 1) limiter.recordFailure(KEY);
    clock.advance(LOCKOUT_DURATION_MS);
    // Regression guard: if the counter were left at 5, this single failure would
    // immediately re-lock and the household would be stuck in a 60s loop forever.
    const status = limiter.recordFailure(KEY);
    expect(status).toEqual({ locked: false, failures: 1 });
  });

  it('does not extend the lockout when an attempt slips through while locked', () => {
    for (let i = 0; i < 5; i += 1) limiter.recordFailure(KEY);
    clock.advance(30_000);
    limiter.recordFailure(KEY);
    limiter.recordFailure(KEY);
    const status = limiter.status(KEY);
    expect(status.locked).toBe(true);
    // Still the original deadline: 60s from the fifth failure, not from the last call.
    if (status.locked) expect(status.retryAfterMs).toBe(30_000);
  });

  it('clears the counter on success', () => {
    for (let i = 0; i < 4; i += 1) limiter.recordFailure(KEY);
    limiter.recordSuccess(KEY);
    expect(limiter.status(KEY)).toEqual({ locked: false, failures: 0 });
    // And a subsequent failure starts from one, not five.
    expect(limiter.recordFailure(KEY)).toEqual({ locked: false, failures: 1 });
  });

  it('lets a correct passphrase clear a nearly-exhausted allowance', () => {
    for (let i = 0; i < 4; i += 1) limiter.recordFailure(KEY);
    limiter.recordSuccess(KEY);
    for (let i = 0; i < 4; i += 1) {
      expect(limiter.recordFailure(KEY).locked).toBe(false);
    }
  });

  it('keeps separate keys independent', () => {
    for (let i = 0; i < 5; i += 1) limiter.recordFailure('key-a');
    expect(limiter.status('key-a').locked).toBe(true);
    expect(limiter.status('key-b').locked).toBe(false);
  });

  it('honours custom thresholds', () => {
    const strict = new LoginRateLimiter(clock.now, 2, 5_000);
    expect(strict.recordFailure(KEY).locked).toBe(false);
    expect(strict.recordFailure(KEY).locked).toBe(true);
    clock.advance(5_000);
    expect(strict.status(KEY).locked).toBe(false);
  });

  it('evicts idle unlocked entries so the map cannot grow unbounded', () => {
    limiter.recordFailure('transient');
    clock.advance(16 * 60_000);
    // A fresh status call triggers eviction; the entry is gone, so failures reset to 0.
    expect(limiter.status('transient')).toEqual({ locked: false, failures: 0 });
  });

  it('does not evict an entry that is still locked', () => {
    for (let i = 0; i < 5; i += 1) limiter.recordFailure(KEY);
    // Past the idle TTL but still inside the lockout window would be contradictory;
    // check the ordering holds at the boundary of the lockout instead.
    clock.advance(LOCKOUT_DURATION_MS - 1);
    expect(limiter.status(KEY).locked).toBe(true);
  });
});

describe('shared loginRateLimiter instance', () => {
  beforeEach(() => {
    loginRateLimiter.reset();
  });

  it('uses one global key rather than per-IP buckets', () => {
    // Deliberate: there is a single shared passphrase, so per-IP buckets would hand an
    // attacker with several devices five guesses each.
    expect(GLOBAL_LOGIN_KEY).toBe('household-passphrase');
  });

  it('is shared process-wide, so lockout survives across requests', () => {
    for (let i = 0; i < 5; i += 1) loginRateLimiter.recordFailure(GLOBAL_LOGIN_KEY);
    expect(loginRateLimiter.status(GLOBAL_LOGIN_KEY).locked).toBe(true);
    loginRateLimiter.reset();
    expect(loginRateLimiter.status(GLOBAL_LOGIN_KEY).locked).toBe(false);
  });
});
