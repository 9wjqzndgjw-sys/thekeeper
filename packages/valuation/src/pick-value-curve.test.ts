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
