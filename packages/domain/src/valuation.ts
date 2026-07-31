import type { DraftPickAssetId, FranchiseId, PlayerId, ValuationRunId } from './ids.js';

export interface ValuationComponents {
  intrinsicValue: number;
  keeperSurplusValue: number | null;
  teamContextValue: number | null;
  breakdown: Record<string, number>;
}

export interface UncertaintyBounds {
  low: number;
  high: number;
}

export interface ValuationResult {
  id: ValuationRunId;
  franchiseId: FranchiseId | null;
  playerId: PlayerId | null;
  pickAssetId: DraftPickAssetId | null;
  components: ValuationComponents;
  uncertainty: UncertaintyBounds | null;
  explanation: string;
  engineVersion: string;
  projectionVersion: string;
  rulesVersion: string;
  evaluatedAt: string;
}
