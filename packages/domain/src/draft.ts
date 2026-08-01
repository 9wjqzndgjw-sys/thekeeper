import type { DraftId, DraftPickAssetId, FranchiseId, PlayerId, SeasonId } from './ids.js';

export type DraftOrderMethod = 'snake' | 'linear' | 'auction';
export type DraftStatus = 'pre_draft' | 'drafting' | 'complete';
export type OwnershipConfidence = 'confirmed' | 'inferred' | 'disputed';

export interface DraftOrderConfig {
  orderMethod: DraftOrderMethod;
  teamCount: number;
  rounds: number;
  thirdRoundReversal: boolean;
}

export interface DraftSlot {
  round: number;
  slot: number;
  overallPick: number;
}

export interface DraftOrderStrategy {
  config: DraftOrderConfig;
  toOverallPick(round: number, slot: number): number;
  fromOverallPick(overallPick: number): DraftSlot;
  listSlots(): DraftSlot[];
}

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

export function draftToOrderConfig(draft: Draft): DraftOrderConfig {
  return {
    orderMethod: draft.orderMethod,
    teamCount: draft.teamCount,
    rounds: draft.rounds,
    thirdRoundReversal: draft.thirdRoundReversal,
  };
}

export function createDraftOrderStrategy(config: DraftOrderConfig): DraftOrderStrategy {
  assertSupportedDraftOrder(config);

  return {
    config,
    toOverallPick(round: number, slot: number): number {
      return calculateOverallPick(config, round, slot);
    },
    fromOverallPick(overallPick: number): DraftSlot {
      return calculateDraftSlot(config, overallPick);
    },
    listSlots(): DraftSlot[] {
      return listDraftSlots(config);
    },
  };
}

export function calculateOverallPick(
  config: DraftOrderConfig,
  round: number,
  slot: number,
): number {
  assertSupportedDraftOrder(config);
  assertIntegerInRange('round', round, 1, config.rounds);
  assertIntegerInRange('slot', slot, 1, config.teamCount);

  const positionInRound =
    config.orderMethod === 'linear' || roundUsesForwardOrder(config, round)
      ? slot
      : config.teamCount + 1 - slot;

  return (round - 1) * config.teamCount + positionInRound;
}

export function calculateDraftSlot(config: DraftOrderConfig, overallPick: number): DraftSlot {
  assertSupportedDraftOrder(config);
  assertIntegerInRange('overallPick', overallPick, 1, config.teamCount * config.rounds);

  const round = Math.floor((overallPick - 1) / config.teamCount) + 1;
  const positionInRound = ((overallPick - 1) % config.teamCount) + 1;
  const slot =
    config.orderMethod === 'linear' || roundUsesForwardOrder(config, round)
      ? positionInRound
      : config.teamCount + 1 - positionInRound;

  return { round, slot, overallPick };
}

export function listDraftSlots(config: DraftOrderConfig): DraftSlot[] {
  assertSupportedDraftOrder(config);

  const slots: DraftSlot[] = [];
  for (let round = 1; round <= config.rounds; round += 1) {
    for (let slot = 1; slot <= config.teamCount; slot += 1) {
      slots.push({
        round,
        slot,
        overallPick: calculateOverallPick(config, round, slot),
      });
    }
  }
  return slots.sort((a, b) => a.overallPick - b.overallPick);
}

export function formatDraftPick(round: number, slot: number): string {
  return `${round}.${String(slot).padStart(2, '0')}`;
}

function assertSupportedDraftOrder(config: DraftOrderConfig): void {
  assertPositiveInteger('teamCount', config.teamCount);
  assertPositiveInteger('rounds', config.rounds);

  if (config.orderMethod === 'auction') {
    throw new Error('Auction drafts do not have round/slot overall-pick math.');
  }
}

function assertIntegerInRange(name: string, value: number, min: number, max: number): void {
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${name} must be an integer from ${min} through ${max}; received ${value}.`);
  }
}

function assertPositiveInteger(name: string, value: number): void {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer; received ${value}.`);
  }
}

function roundUsesForwardOrder(config: DraftOrderConfig, round: number): boolean {
  if (config.orderMethod === 'linear') {
    return true;
  }

  if (!config.thirdRoundReversal) {
    return round % 2 === 1;
  }

  if (round === 1 || round === 2) {
    return true;
  }

  if (round === 3) {
    return false;
  }

  return round % 2 === 0;
}
