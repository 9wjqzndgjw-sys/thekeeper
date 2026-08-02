import { describe, expect, it } from 'vitest';
import { createPickValueCurveFromRankedValues } from './pick-value-curve.js';

describe('createPickValueCurveFromRankedValues', () => {
  const curve = createPickValueCurveFromRankedValues([50, 40, 30, 20]);

  it('returns the ranked value at the given overall pick', () => {
    expect(curve.getValueForPick(1)).toBe(50);
    expect(curve.getValueForPick(4)).toBe(20);
  });

  it('falls back to zero past the end of the ranked pool', () => {
    expect(curve.getValueForPick(5)).toBe(0);
  });

  it('rejects non-positive-integer picks', () => {
    expect(() => curve.getValueForPick(0)).toThrow(/overallPick/);
    expect(() => curve.getValueForPick(1.5)).toThrow(/overallPick/);
  });
});

describe('keeper-consumed picks', () => {
  // A keeper occupies a draft slot but takes nobody off the board. Without accounting for
  // that, pick N reads N-1 deep into a pool that only N-1-keepersBefore(N) players have
  // left, understating what the pick would have bought and inflating every surplus measured
  // against it.
  const ranked = Array.from({ length: 20 }, (_, index) => 100 - index * 5);

  it('does not shift picks that come before every keeper slot', () => {
    const curve = createPickValueCurveFromRankedValues(ranked, 'v', [10, 11]);

    expect(curve.getValueForPick(1)).toBe(100);
    expect(curve.getValueForPick(9)).toBe(60);
  });

  it('skips a keeper slot rather than consuming a player for it', () => {
    const plain = createPickValueCurveFromRankedValues(ranked, 'v');
    const withKeeper = createPickValueCurveFromRankedValues(ranked, 'v', [3]);

    // Pick 5 is the fifth slot, but one of the first four was a keeper, so only three
    // players have left: it buys the fourth best, not the fifth.
    expect(plain.getValueForPick(5)).toBe(80);
    expect(withKeeper.getValueForPick(5)).toBe(85);
  });

  it('accumulates across many keeper slots', () => {
    const curve = createPickValueCurveFromRankedValues(ranked, 'v', [1, 2, 3, 4]);

    expect(curve.getValueForPick(5)).toBe(100);
    expect(curve.getValueForPick(6)).toBe(95);
  });

  it('never reports a keeper slot as costing more than the pick before it', () => {
    const curve = createPickValueCurveFromRankedValues(ranked, 'v', [4, 9, 14]);

    for (let pick = 1; pick < 20; pick += 1) {
      expect(curve.getValueForPick(pick + 1)).toBeLessThanOrEqual(curve.getValueForPick(pick));
    }
  });

  it('is unchanged when no keeper consumes a pick', () => {
    const plain = createPickValueCurveFromRankedValues(ranked, 'v');
    const empty = createPickValueCurveFromRankedValues(ranked, 'v', []);

    for (const pick of [1, 5, 10, 20]) {
      expect(empty.getValueForPick(pick)).toBe(plain.getValueForPick(pick));
    }
  });
});
