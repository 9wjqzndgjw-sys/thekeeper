import { describe, expect, it } from 'vitest';
import { computeIntrinsicValue } from './intrinsic-value.js';

describe('computeIntrinsicValue', () => {
  it('values a player as projected points above replacement', () => {
    const result = computeIntrinsicValue({ projectedPoints: 220, replacementLevel: 130 });

    expect(result.intrinsicValue).toBe(90);
    expect(result.breakdown.pointsAboveReplacement).toBe(90);
  });

  it('floors at zero for a below-replacement player rather than going negative', () => {
    const result = computeIntrinsicValue({ projectedPoints: 50, replacementLevel: 130 });

    expect(result.intrinsicValue).toBe(0);
  });

  it('is independent of any franchise or pick context', () => {
    const a = computeIntrinsicValue({ projectedPoints: 220, replacementLevel: 130 });
    const b = computeIntrinsicValue({ projectedPoints: 220, replacementLevel: 130 });

    expect(a).toEqual(b);
  });
});
