export interface PickValueCurve {
  version: string;
  getValueForPick(overallPick: number): number;
}

// Deliberately takes a caller-supplied ranked-value list rather than deriving one
// internally: a real curve needs the full draftable pool ranked by IV, which is a
// projections-and-ADP concern outside this package's remit (see 07_SLEEPER_API_PLAN.md).
export function createPickValueCurveFromRankedValues(
  rankedValuesDescending: number[],
  version = 'fixture-curve-0',
): PickValueCurve {
  return {
    version,
    getValueForPick(overallPick: number): number {
      assertPositiveInteger('overallPick', overallPick);
      return rankedValuesDescending[overallPick - 1] ?? 0;
    },
  };
}

function assertPositiveInteger(name: string, value: number): void {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer; received ${value}.`);
  }
}
