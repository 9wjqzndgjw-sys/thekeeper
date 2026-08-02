import type { OwnershipConfidence } from './draft.js';
import type { FranchiseId, KeeperRightId, PlayerId, SeasonId } from './ids.js';

export type KeeperRightSourceType =
  'drafted' | 'kept' | 'undrafted_free_agent' | 'traded' | 'manual_override';

/**
 * What it would cost a franchise to keep one player: a possibility, not a choice. Every
 * rostered player has one. What a manager actually declared is a `KeeperDecision`.
 */
export interface KeeperRight {
  id: KeeperRightId;
  seasonId: SeasonId;
  playerId: PlayerId;
  franchiseId: FranchiseId;
  sourceType: KeeperRightSourceType;
  nominalRound: number;
  /** The round this player went in last season, or null if he was never drafted. */
  priorSeasonRound: number | null;
  effectiveOverallPick: number | null;
  confidence: OwnershipConfidence;
  manualOverrideReason: string | null;
}

export type KeeperDisplacementCause = 'missing_pick' | 'keeper_collision';

export interface KeeperDisplacement {
  keeperRightId: KeeperRightId;
  nominalRound: number;
  resolvedRound: number;
  resolvedOverallPick: number;
  cause: KeeperDisplacementCause;
  causedByKeeperRightId: KeeperRightId | null;
  reason: string;
}

export interface KeeperDecision {
  seasonId: SeasonId;
  franchiseId: FranchiseId;
  kind: 'actual' | 'simulated';
  selectedKeeperRightIds: KeeperRightId[];
  displacements: KeeperDisplacement[];
  resolutionOrder: KeeperRightId[];
  explanation: string;
}
