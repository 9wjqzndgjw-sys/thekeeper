import type {
  DraftPickAsset,
  FranchiseId,
  KeeperRight,
  Player,
  PlayerId,
  SeasonId,
} from '@keeper/domain';
import { optimizeKeeperCombinations } from '@keeper/keeper-optimizer';
import type { PickValueCurve, ProjectionSource, ReplacementLevels } from '@keeper/valuation';

export interface RivalDenialInput {
  franchiseId: FranchiseId;
  displayName: string;
  keeperRights: readonly KeeperRight[];
  /**
   * Probability this rival ends up with the player if the buyer does not acquire him.
   * Caller-supplied: it depends on rival behaviour the engine does not model.
   */
  probabilityPlayerReaches: number;
  /** How much this particular rival gaining hurts, from 0 to 1. Defaults to 1. */
  rivalryWeight?: number;
}

export interface RivalDenialContribution {
  franchiseId: FranchiseId;
  displayName: string;
  probabilityPlayerReaches: number;
  rivalIncrementalGain: number;
  rivalryWeight: number;
  contribution: number;
}

export interface DenialValueAssessment {
  playerId: PlayerId;
  fullName: string;
  perRival: RivalDenialContribution[];
  total: number;
  /**
   * Always true. Denial value is reported on its own and is never folded into keeper
   * surplus, team context value, or the release-versus-redraft totals.
   */
  excludedFromDecisionTotals: true;
  assumptions: string[];
}

export interface ComputeDenialValueInput {
  keeperRight: KeeperRight;
  rivals: readonly RivalDenialInput[];
  pickInventory: readonly DraftPickAsset[];
  players: readonly Player[];
  seasonId: SeasonId;
  evaluatedAt: string;
  projectionSource: ProjectionSource;
  replacementLevels: ReplacementLevels;
  pickValueCurve: PickValueCurve;
  keeperLimit: number;
}

/**
 * Value of keeping a player away from rivals, per the market doc:
 *
 *   sum over rivals of P(player reaches rival) x rival incremental gain x rivalry weight
 *
 * Kept deliberately separate from every other number the engine produces. Acquiring a
 * player already shows up as your own gain; counting the harm avoided to a rival in the
 * same total would bank the same swing twice. Expose it, weigh it by judgement, but do
 * not add it to a keeper decision.
 */
export function computeDenialValue(input: ComputeDenialValueInput): DenialValueAssessment {
  const player = input.players.find((candidate) => candidate.id === input.keeperRight.playerId);
  if (!player) {
    throw new Error(`Cannot value denial; missing player ${input.keeperRight.playerId}.`);
  }

  const perRival = input.rivals.map((rival) => {
    assertProbability(rival.probabilityPlayerReaches, rival.franchiseId);
    const rivalryWeight = rival.rivalryWeight ?? 1;

    const baseline = bestValueFor(input, rival.franchiseId, rival.keeperRights);
    const withPlayer = bestValueFor(input, rival.franchiseId, [
      ...rival.keeperRights,
      { ...input.keeperRight, franchiseId: rival.franchiseId },
    ]);
    const rivalIncrementalGain = Math.max(0, withPlayer - baseline);

    return {
      franchiseId: rival.franchiseId,
      displayName: rival.displayName,
      probabilityPlayerReaches: rival.probabilityPlayerReaches,
      rivalIncrementalGain,
      rivalryWeight,
      contribution: rival.probabilityPlayerReaches * rivalIncrementalGain * rivalryWeight,
    };
  });

  return {
    playerId: player.id,
    fullName: player.fullName,
    perRival: perRival.sort((left, right) => right.contribution - left.contribution),
    total: perRival.reduce((sum, rival) => sum + rival.contribution, 0),
    excludedFromDecisionTotals: true,
    assumptions: [
      'Probabilities that the player reaches each rival are caller-supplied, not modelled.',
      'A rival gain is their own combination-level gain, so it already respects their keeper-slot scarcity.',
      'This total is reported separately and must not be added to keeper surplus, team context value, or a release-versus-redraft comparison, because the same swing would then be counted twice.',
    ],
  };
}

function bestValueFor(
  input: ComputeDenialValueInput,
  franchiseId: FranchiseId,
  keeperRights: readonly KeeperRight[],
): number {
  const optimization = optimizeKeeperCombinations({
    keeperRights: keeperRights.map((right) => ({ ...right, franchiseId })),
    pickInventory: [...input.pickInventory],
    players: [...input.players],
    franchiseId,
    seasonId: input.seasonId,
    evaluatedAt: input.evaluatedAt,
    projectionSource: input.projectionSource,
    replacementLevels: input.replacementLevels,
    pickValueCurve: input.pickValueCurve,
    maxKeepers: input.keeperLimit,
  });

  return optimization.bestByMode.expected?.teamContextValue ?? 0;
}

function assertProbability(value: number, franchiseId: FranchiseId): void {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error(
      `Probability for rival ${franchiseId} must be between 0 and 1; received ${value}.`,
    );
  }
}
