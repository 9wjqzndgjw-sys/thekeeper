import type { PickValueCurve } from './pick-value-curve.js';

export interface KeeperSurplusValueBreakdown {
  intrinsicValue: number;
  pickOpportunityCost: number;
  keeperSlotOpportunityCost: number;
}

export interface ComputeKeeperSurplusValueInput {
  intrinsicValue: number;
  pickValueCurve: PickValueCurve;
  exactOverallPick: number;
  keeperSlotOpportunityCost?: number;
}

export interface KeeperSurplusValueResult {
  keeperSurplusValue: number;
  breakdown: KeeperSurplusValueBreakdown;
}

export function computeKeeperSurplusValue(
  input: ComputeKeeperSurplusValueInput,
): KeeperSurplusValueResult {
  const pickOpportunityCost = input.pickValueCurve.getValueForPick(input.exactOverallPick);
  const keeperSlotOpportunityCost = input.keeperSlotOpportunityCost ?? 0;

  const breakdown: KeeperSurplusValueBreakdown = {
    intrinsicValue: input.intrinsicValue,
    pickOpportunityCost,
    keeperSlotOpportunityCost,
  };

  return {
    keeperSurplusValue:
      breakdown.intrinsicValue -
      breakdown.pickOpportunityCost -
      breakdown.keeperSlotOpportunityCost,
    breakdown,
  };
}
