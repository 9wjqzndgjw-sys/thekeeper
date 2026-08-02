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
  /**
   * Overall picks consumed by a keeper rather than by a selection from `rankedValues`.
   *
   * A keeper occupies a draft slot but takes nobody off the board, so the ranked pool is
   * not consumed one player per overall pick. Without this, pick N reads N-1 deep into a
   * pool that only N-1-keepersBefore(N) players have actually left, which understates what
   * the pick would have bought and inflates every surplus measured against it. On a twelve
   * team league with thirty-odd keepers the error reaches about sixteen points by the
   * middle rounds -- the whole surplus of some late keepers.
   */
  keeperConsumedOverallPicks: readonly number[] = [],
): PickValueCurve {
  const keeperPicks = [...keeperConsumedOverallPicks].sort((left, right) => left - right);

  return {
    version,
    getValueForPick(overallPick: number): number {
      assertPositiveInteger('overallPick', overallPick);
      const keepersBefore = countBelow(keeperPicks, overallPick);
      return rankedValuesDescending[overallPick - 1 - keepersBefore] ?? 0;
    },
  };
}

/** How many sorted entries fall strictly below `value`. */
function countBelow(sortedAscending: readonly number[], value: number): number {
  let low = 0;
  let high = sortedAscending.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (sortedAscending[middle]! < value) {
      low = middle + 1;
    } else {
      high = middle;
    }
  }
  return low;
}

function assertPositiveInteger(name: string, value: number): void {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer; received ${value}.`);
  }
}
