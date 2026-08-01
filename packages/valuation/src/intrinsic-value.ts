export interface IntrinsicValueBreakdown {
  pointsAboveReplacement: number;
  // Not yet implemented (require lineup-elasticity, scarcity, and multi-year
  // modeling that don't exist yet); kept explicit rather than folded into
  // pointsAboveReplacement so the gap is visible instead of hidden.
  lineupFlexibility: number;
  scarcityAdjustment: number;
  riskAdjustedFutureValue: number;
}

export interface ComputeIntrinsicValueInput {
  projectedPoints: number;
  replacementLevel: number;
}

export interface IntrinsicValueResult {
  intrinsicValue: number;
  breakdown: IntrinsicValueBreakdown;
}

export function computeIntrinsicValue(input: ComputeIntrinsicValueInput): IntrinsicValueResult {
  const breakdown: IntrinsicValueBreakdown = {
    pointsAboveReplacement: Math.max(0, input.projectedPoints - input.replacementLevel),
    lineupFlexibility: 0,
    scarcityAdjustment: 0,
    riskAdjustedFutureValue: 0,
  };

  return {
    intrinsicValue:
      breakdown.pointsAboveReplacement +
      breakdown.lineupFlexibility +
      breakdown.scarcityAdjustment +
      breakdown.riskAdjustedFutureValue,
    breakdown,
  };
}
