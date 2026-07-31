import type { OwnershipConfidence } from './draft.js';
import type { FranchiseId, KeeperRightId, PlayerId, SeasonId } from './ids.js';

export type KeeperRightSourceType =
  'drafted' | 'kept' | 'undrafted_free_agent' | 'traded' | 'manual_override';

export interface KeeperRight {
  id: KeeperRightId;
  seasonId: SeasonId;
  playerId: PlayerId;
  franchiseId: FranchiseId;
  sourceType: KeeperRightSourceType;
  nominalRound: number;
  effectiveOverallPick: number | null;
  confidence: OwnershipConfidence;
  manualOverrideReason: string | null;
}

export interface KeeperDisplacement {
  keeperRightId: KeeperRightId;
  nominalRound: number;
  resolvedRound: number;
  resolvedOverallPick: number;
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
