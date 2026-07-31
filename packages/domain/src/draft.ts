import type { DraftId, DraftPickAssetId, FranchiseId, PlayerId, SeasonId } from './ids.js';

export type DraftOrderMethod = 'snake' | 'linear' | 'auction';
export type DraftStatus = 'pre_draft' | 'drafting' | 'complete';
export type OwnershipConfidence = 'confirmed' | 'inferred' | 'disputed';

export interface Draft {
  id: DraftId;
  seasonId: SeasonId;
  sleeperDraftId: string | null;
  rounds: number;
  teamCount: number;
  orderMethod: DraftOrderMethod;
  thirdRoundReversal: boolean;
  status: DraftStatus;
}

export interface DraftPickAsset {
  id: DraftPickAssetId;
  seasonId: SeasonId;
  round: number;
  originalFranchiseId: FranchiseId;
  currentFranchiseId: FranchiseId;
  slot: number | null;
  overallPick: number | null;
  ownershipConfidence: OwnershipConfidence;
}

export interface DraftSelection {
  draftId: DraftId;
  overallPick: number;
  round: number;
  slot: number;
  franchiseId: FranchiseId;
  playerId: PlayerId;
  pickAssetId: DraftPickAssetId | null;
}
