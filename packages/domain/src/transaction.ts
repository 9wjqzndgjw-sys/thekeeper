import type { DraftPickAssetId, FranchiseId, PlayerId, SeasonId, TransactionId } from './ids.js';

export type TransactionType = 'add' | 'drop' | 'trade' | 'draft_selection' | 'keeper_declaration';

export interface TradeAssetMovement {
  fromFranchiseId: FranchiseId;
  toFranchiseId: FranchiseId;
  playerId: PlayerId | null;
  pickAssetId: DraftPickAssetId | null;
}

export interface Transaction {
  id: TransactionId;
  seasonId: SeasonId;
  type: TransactionType;
  occurredAt: string;
  movements: TradeAssetMovement[];
  sourceSnapshotId: string | null;
}
