import { describe, expect, it } from 'vitest';
import { createRng, randomIndex } from './rng';

describe('createRng', () => {
  it('matches a hardcoded reference vector, not just self-consistency', () => {
    // The two tests below only check that same-seed generators agree with *each
    // other* — a self-consistent but subtly wrong transcription (a swapped constant,
    // a wrong shift amount) would still pass both. This pins the actual output against
    // known-correct mulberry32 values, independently verified against a canonical
    // reference implementation, so a future edit that quietly breaks the algorithm has
    // something concrete to fail against.
    const rng = createRng(42);
    const values = Array.from({ length: 5 }, () => rng());
    expect(values).toEqual([
      0.6011037519201636,
      0.44829055899754167,
      0.8524657934904099,
      0.6697340414393693,
      0.17481389874592423,
    ]);
  });

  it('produces a bit-identical sequence for the same seed, across separate generators', () => {
    const a = createRng(42);
    const b = createRng(42);
    const sequenceA = Array.from({ length: 50 }, () => a());
    const sequenceB = Array.from({ length: 50 }, () => b());
    expect(sequenceA).toEqual(sequenceB);
  });

  it('produces a different sequence for a different seed', () => {
    const a = createRng(1);
    const b = createRng(2);
    const sequenceA = Array.from({ length: 20 }, () => a());
    const sequenceB = Array.from({ length: 20 }, () => b());
    expect(sequenceA).not.toEqual(sequenceB);
  });

  it('stays within [0, 1) over a large sample', () => {
    const rng = createRng(12345);
    for (let i = 0; i < 10_000; i++) {
      const value = rng();
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });

  it('advances state on each call rather than repeating the first value', () => {
    const rng = createRng(7);
    const first = rng();
    const second = rng();
    expect(first).not.toBe(second);
  });

  it('handles a zero seed and negative seeds without throwing', () => {
    expect(() => createRng(0)()).not.toThrow();
    expect(() => createRng(-1)()).not.toThrow();
  });
});

describe('randomIndex', () => {
  it('stays within [0, length) over a large sample', () => {
    const rng = createRng(99);
    for (let i = 0; i < 5_000; i++) {
      const index = randomIndex(rng, 37);
      expect(index).toBeGreaterThanOrEqual(0);
      expect(index).toBeLessThan(37);
      expect(Number.isInteger(index)).toBe(true);
    }
  });

  it('is deterministic for a fixed seed', () => {
    const a = randomIndex(createRng(5), 100);
    const b = randomIndex(createRng(5), 100);
    expect(a).toBe(b);
  });
});
