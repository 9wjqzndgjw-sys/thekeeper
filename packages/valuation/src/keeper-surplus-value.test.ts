import { describe, expect, it } from 'vitest';
import { createPickValueCurveFromRankedValues } from './pick-value-curve.js';
import { computeKeeperSurplusValue } from './keeper-surplus-value.js';

describe('computeKeeperSurplusValue', () => {
  const pickValueCurve = createPickValueCurveFromRankedValues([50, 40, 30, 20]);

  it('subtracts the exact pick cost from intrinsic value', () => {
    const result = computeKeeperSurplusValue({
      intrinsicValue: 90,
      pickValueCurve,
      exactOverallPick: 2,
    });

    expect(result.breakdown.pickOpportunityCost).toBe(40);
    expect(result.keeperSurplusValue).toBe(50);
  });

  it('subtracts the pick cost exactly once even alongside a keeper-slot cost', () => {
    const result = computeKeeperSurplusValue({
      intrinsicValue: 90,
      pickValueCurve,
      exactOverallPick: 2,
      keeperSlotOpportunityCost: 15,
    });

    expect(result.keeperSurplusValue).toBe(35);
    expect(
      result.breakdown.intrinsicValue -
        result.breakdown.pickOpportunityCost -
        result.breakdown.keeperSlotOpportunityCost,
    ).toBe(result.keeperSurplusValue);
  });

  it('resolves a different pick cost for a different exact overall pick, same player', () => {
    const cheaperPick = computeKeeperSurplusValue({
      intrinsicValue: 90,
      pickValueCurve,
      exactOverallPick: 4,
    });
    const pricierPick = computeKeeperSurplusValue({
      intrinsicValue: 90,
      pickValueCurve,
      exactOverallPick: 1,
    });

    expect(cheaperPick.keeperSurplusValue).toBeGreaterThan(pricierPick.keeperSurplusValue);
  });
});
