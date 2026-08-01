import type {
  DraftPickAsset,
  FranchiseId,
  KeeperRight,
  KeeperRightId,
  Player,
  PlayerId,
  SeasonId,
} from '@keeper/domain';
import {
  valuatePlayerForFranchise,
  type PickValueCurve,
  type ProjectionSource,
  type ReplacementLevels,
} from '@keeper/valuation';
import { optimizeKeeperCombinations, type ValuedKeeperCombination } from './index.js';

export interface ReacquisitionOutlook {
  /**
   * Probability the player is still on the board at `overallPick`. Supplied by the caller:
   * the engine does not invent it, because it depends on how eleven other managers behave.
   * At 1.01 it is 1 by construction, since nobody picks first.
   */
  probability: number;
  /** The exact pick that would be spent re-drafting him. */
  overallPick: number;
  /**
   * Value of the best alternative use of that pick if he is gone. Supplied by the caller
   * because it depends on the board at that moment.
   */
  fallbackValue: number;
}

export interface ReleaseVsRedraftInput {
  keeperRightId: KeeperRightId;
  franchiseId: FranchiseId;
  seasonId: SeasonId;
  evaluatedAt: string;
  keeperRights: readonly KeeperRight[];
  pickInventory: readonly DraftPickAsset[];
  players: readonly Player[];
  projectionSource: ProjectionSource;
  replacementLevels: ReplacementLevels;
  pickValueCurve: PickValueCurve;
  maxKeepers?: number;
  reacquisition: ReacquisitionOutlook;
  /** Advantage smaller than this is reported as too close to call. */
  decisionMarginTolerance?: number;
}

export interface KeepPath {
  keeperRightIds: KeeperRightId[];
  rosterValue: number;
}

export interface ReleasePath {
  keeperRightIds: KeeperRightId[];
  rosterValue: number;
  /**
   * Roster value change from spending the freed slot on someone else instead of him.
   * Positive means the slot is worth more to another keeper than to him: that is the
   * keeper-slot liberation the league rules describe around the 1.01 prize.
   */
  slotLiberationValue: number;
  reacquireBranch: { probability: number; value: number; weighted: number };
  missBranch: { probability: number; value: number; weighted: number };
  expectedRedraftValue: number;
  total: number;
}

export type ReleaseRecommendation = 'keep' | 'release' | 'too_close_to_call';

export interface ReleaseVsRedraftDecision {
  keeperRightId: KeeperRightId;
  playerId: PlayerId;
  fullName: string;
  keepPath: KeepPath;
  releasePath: ReleasePath;
  /** Release total minus keep total. Positive favours releasing. */
  advantageOfReleasing: number;
  recommendation: ReleaseRecommendation;
  assumptions: string[];
  explanation: string;
}

const DEFAULT_DECISION_MARGIN = 1;

/**
 * Compares keeping a player against releasing him, using the freed slot on the next best
 * keeper, and trying to draft him back.
 *
 *   keep    = best keeper set that includes him
 *   release = best keeper set that excludes him
 *             + P(available) x his surplus at that pick
 *             + P(gone)      x the fallback that pick returns instead
 *
 * Both roster values come from the same combination-level optimiser, so the freed slot is
 * already spent on whoever actually deserves it rather than assumed empty. Re-acquisition
 * probability and fallback value are caller inputs; nothing here guesses how rivals draft.
 */
export function compareReleaseVsRedraft(input: ReleaseVsRedraftInput): ReleaseVsRedraftDecision {
  assertProbability(input.reacquisition.probability);

  const optimization = optimizeKeeperCombinations({
    keeperRights: [...input.keeperRights],
    pickInventory: [...input.pickInventory],
    players: [...input.players],
    franchiseId: input.franchiseId,
    seasonId: input.seasonId,
    evaluatedAt: input.evaluatedAt,
    projectionSource: input.projectionSource,
    replacementLevels: input.replacementLevels,
    pickValueCurve: input.pickValueCurve,
    maxKeepers: input.maxKeepers,
  });

  const right = input.keeperRights.find((candidate) => candidate.id === input.keeperRightId);
  if (!right) {
    throw new Error(`Keeper right ${input.keeperRightId} is not held by ${input.franchiseId}.`);
  }
  const player = input.players.find((candidate) => candidate.id === right.playerId);
  if (!player) {
    throw new Error(`Cannot compare keeper ${right.id}; missing player ${right.playerId}.`);
  }

  const withHim = bestCombination(optimization.combinations, input.keeperRightId, true);
  const withoutHim = bestCombination(optimization.combinations, input.keeperRightId, false);

  const keepValue = withHim?.teamContextValue ?? 0;
  const releaseRosterValue = withoutHim?.teamContextValue ?? 0;

  const redraftValuation = valuatePlayerForFranchise({
    playerId: player.id,
    position: player.position,
    franchiseId: input.franchiseId,
    seasonId: input.seasonId,
    evaluatedAt: input.evaluatedAt,
    projectionSource: input.projectionSource,
    replacementLevels: input.replacementLevels,
    pickValueCurve: input.pickValueCurve,
    exactOverallPick: input.reacquisition.overallPick,
  });
  const reacquiredValue = redraftValuation.components.keeperSurplusValue ?? 0;

  const missProbability = 1 - input.reacquisition.probability;
  const reacquireBranch = {
    probability: input.reacquisition.probability,
    value: reacquiredValue,
    weighted: input.reacquisition.probability * reacquiredValue,
  };
  const missBranch = {
    probability: missProbability,
    value: input.reacquisition.fallbackValue,
    weighted: missProbability * input.reacquisition.fallbackValue,
  };
  const expectedRedraftValue = reacquireBranch.weighted + missBranch.weighted;
  const releaseTotal = releaseRosterValue + expectedRedraftValue;
  const advantageOfReleasing = releaseTotal - keepValue;
  const tolerance = input.decisionMarginTolerance ?? DEFAULT_DECISION_MARGIN;

  const releasePath: ReleasePath = {
    keeperRightIds: withoutHim?.selectedKeeperRightIds ?? [],
    rosterValue: releaseRosterValue,
    slotLiberationValue: releaseRosterValue - keepValue,
    reacquireBranch,
    missBranch,
    expectedRedraftValue,
    total: releaseTotal,
  };

  return {
    keeperRightId: input.keeperRightId,
    playerId: player.id,
    fullName: player.fullName,
    keepPath: {
      keeperRightIds: withHim?.selectedKeeperRightIds ?? [],
      rosterValue: keepValue,
    },
    releasePath,
    advantageOfReleasing,
    recommendation:
      Math.abs(advantageOfReleasing) < tolerance
        ? 'too_close_to_call'
        : advantageOfReleasing > 0
          ? 'release'
          : 'keep',
    assumptions: buildAssumptions(input),
    explanation: buildExplanation(player.fullName, keepValue, releasePath, advantageOfReleasing),
  };
}

function bestCombination(
  combinations: readonly ValuedKeeperCombination[],
  keeperRightId: KeeperRightId,
  shouldContain: boolean,
): ValuedKeeperCombination | null {
  return combinations
    .filter(
      (combination) => combination.selectedKeeperRightIds.includes(keeperRightId) === shouldContain,
    )
    .reduce<ValuedKeeperCombination | null>(
      (best, combination) =>
        best === null || combination.teamContextValue > best.teamContextValue ? combination : best,
      null,
    );
}

function buildAssumptions(input: ReleaseVsRedraftInput): string[] {
  const assumptions = [
    `Re-acquisition probability of ${input.reacquisition.probability} at overall pick ${input.reacquisition.overallPick} was supplied by the caller, not modelled.`,
    `Fallback value of ${input.reacquisition.fallbackValue} is what that pick is assumed to return if he is gone.`,
    'Denial value is deliberately excluded from these totals and reported separately, so it cannot be double counted.',
  ];

  if (input.reacquisition.probability === 1) {
    assumptions.push(
      'A probability of 1 means he cannot be taken before this pick, so releasing him frees a keeper slot at no risk.',
    );
  }
  return assumptions;
}

function buildExplanation(
  fullName: string,
  keepValue: number,
  releasePath: ReleasePath,
  advantageOfReleasing: number,
): string {
  const verdict =
    advantageOfReleasing > 0
      ? `Releasing ${fullName} is worth ${round2(advantageOfReleasing)} more than keeping him.`
      : `Keeping ${fullName} is worth ${round2(-advantageOfReleasing)} more than releasing him.`;

  return [
    `Keep: roster value ${round2(keepValue)}.`,
    `Release: roster value ${round2(releasePath.rosterValue)} with the slot spent elsewhere (${round2(
      releasePath.slotLiberationValue,
    )} from freeing the slot), plus an expected ${round2(releasePath.expectedRedraftValue)} from the re-draft attempt (${round2(
      releasePath.reacquireBranch.probability * 100,
    )}% at ${round2(releasePath.reacquireBranch.value)}, otherwise ${round2(
      releasePath.missBranch.value,
    )}).`,
    verdict,
  ].join('\n');
}

function assertProbability(value: number): void {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error(`Re-acquisition probability must be between 0 and 1; received ${value}.`);
  }
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
