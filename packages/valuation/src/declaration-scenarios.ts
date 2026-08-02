import type { Position } from '@keeper/domain';
import { computeIntrinsicValue } from './intrinsic-value.js';
import { createPickValueCurveFromRankedValues, type PickValueCurve } from './pick-value-curve.js';
import { computeReplacementLevels, type ReplacementLevels } from './replacement.js';

export interface DeclarationScenarioCandidate {
  position: Position;
  projectedPoints: number;
  /** True when some franchise has declared this player a keeper. */
  declared: boolean;
}

export interface DeclarationScenarios {
  /**
   * Shared by both scenarios. Replacement level is a property of the league's talent supply
   * and its roster demand, and declarations move both together -- a kept player takes a
   * roster slot with him. So intrinsic value does not depend on what anyone declares, and
   * the two scenarios differ only in what a pick can buy.
   *
   * That holds exactly while declarations land within the depth the demand model rosters,
   * which is what real ones do. Keeping a player the model would not have rostered at all
   * occupies a slot it gave to somebody else, and replacement falls by one player; the
   * tests pin that boundary.
   */
  replacementLevels: ReplacementLevels;
  /**
   * What a pick buys if declarations are not assumed to hold: the whole pool is on the
   * board. The conservative reading, and the right one before a deadline, when twelve other
   * managers can still change their minds.
   */
  ignoringDeclarations: PickValueCurve;
  /**
   * What a pick buys once every declared keeper is held back. Keepers are disproportionately
   * good players, so the board thins at the top and each pick buys less.
   */
  assumingDeclarations: PickValueCurve;
}

/**
 * Builds the two pick value curves a keeper decision has to be read against.
 *
 * The same keeper is worth different amounts depending on whether the rest of the league's
 * declarations hold, because that is what decides how strong a player the pick he consumes
 * would otherwise have bought. The gap between the two is not noise: it is the part of a
 * keeper's surplus that is borrowed from other managers' choices, and a keeper that only
 * clears its cost under `assumingDeclarations` is a bet on nobody changing their mind.
 *
 * Both curves are built from the same replacement levels, so the two numbers are directly
 * comparable -- only the pool differs.
 */
export function buildDeclarationScenarios(input: {
  candidates: readonly DeclarationScenarioCandidate[];
  lineup: Parameters<typeof computeReplacementLevels>[0]['lineup'];
  teamCount: number;
}): DeclarationScenarios {
  const declared = input.candidates.filter((candidate) => candidate.declared);
  const undeclared = input.candidates.filter((candidate) => !candidate.declared);

  const replacementLevels = computeReplacementLevels({
    candidates: undeclared,
    rosteredCandidates: declared,
    lineup: input.lineup,
    teamCount: input.teamCount,
  });

  const rankedValues = (pool: readonly DeclarationScenarioCandidate[]): number[] =>
    pool
      .map(
        (candidate) =>
          computeIntrinsicValue({
            projectedPoints: candidate.projectedPoints,
            replacementLevel: replacementLevels[candidate.position] ?? 0,
          }).intrinsicValue,
      )
      .sort((left, right) => right - left);

  return {
    replacementLevels,
    ignoringDeclarations: createPickValueCurveFromRankedValues(
      rankedValues(input.candidates),
      'pool-intact',
    ),
    assumingDeclarations: createPickValueCurveFromRankedValues(
      rankedValues(undeclared),
      'post-declaration',
    ),
  };
}
