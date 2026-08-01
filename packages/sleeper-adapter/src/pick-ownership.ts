import {
  calculateOverallPick,
  type DraftOrderConfig,
  type DraftPickAsset,
  type DraftPickAssetId,
  type FranchiseId,
  type OwnershipConfidence,
  type SeasonId,
} from '@keeper/domain';
import type {
  NormalizedSleeperDraft,
  NormalizedSleeperDraftPick,
  NormalizedSleeperTradedPick,
} from './index.js';

export type PickOwnershipDiagnosticLevel = 'warning' | 'error';

export type PickOwnershipDiagnosticCode =
  | 'draft_metadata_mismatch'
  | 'invalid_metadata_slot'
  | 'unmapped_roster'
  | 'unmapped_user'
  | 'missing_slot_owner'
  | 'conflicting_slot_owner'
  | 'duplicate_slot_franchise'
  | 'invalid_trade'
  | 'trade_asset_not_found'
  | 'ambiguous_trade_asset'
  | 'conflicting_trade_records'
  | 'invalid_selection'
  | 'selection_coordinate_mismatch'
  | 'selection_owner_unmapped'
  | 'selection_owner_conflict'
  | 'duplicate_selection'
  | 'invalid_override'
  | 'duplicate_override';

export interface PickOwnershipDiagnostic {
  level: PickOwnershipDiagnosticLevel;
  code: PickOwnershipDiagnosticCode;
  message: string;
  round?: number;
  slot?: number;
  overallPick?: number;
}

interface OwnershipOverrideAudit {
  reason: string;
  overriddenBy: string;
  overriddenAt: string;
}

export interface DraftSlotOwnershipOverride extends OwnershipOverrideAudit {
  kind: 'slot';
  slot: number;
  originalFranchiseId: FranchiseId;
}

export interface DraftPickOwnershipOverride extends OwnershipOverrideAudit {
  kind: 'pick';
  round: number;
  slot: number;
  originalFranchiseId?: FranchiseId;
  currentFranchiseId?: FranchiseId;
}

export type DraftOwnershipOverride = DraftSlotOwnershipOverride | DraftPickOwnershipOverride;

export interface AppliedDraftOwnershipOverride {
  kind: DraftOwnershipOverride['kind'];
  round: number | null;
  slot: number;
  reason: string;
  overriddenBy: string;
  overriddenAt: string;
  priorOriginalFranchiseId: FranchiseId | null;
  priorCurrentFranchiseId: FranchiseId | null;
  originalFranchiseId: FranchiseId;
  currentFranchiseId: FranchiseId | null;
}

export interface ReconstructDraftPickInventoryInput {
  seasonId: SeasonId;
  sleeperSeason: string;
  orderConfig: DraftOrderConfig;
  draft: NormalizedSleeperDraft;
  rosterIdToFranchiseId: Readonly<Record<number, FranchiseId>>;
  sleeperUserIdToFranchiseId?: Readonly<Record<string, FranchiseId>>;
  tradedPicks?: readonly NormalizedSleeperTradedPick[];
  selections?: readonly NormalizedSleeperDraftPick[];
  overrides?: readonly DraftOwnershipOverride[];
}

export interface ReconstructDraftPickInventoryResult {
  pickInventory: DraftPickAsset[];
  diagnostics: PickOwnershipDiagnostic[];
  appliedOverrides: AppliedDraftOwnershipOverride[];
}

interface SlotOwnerCandidate {
  franchiseId: FranchiseId;
  source: 'slot_to_roster_id' | 'draft_order';
}

interface PickTradeRecord {
  currentFranchiseId: FranchiseId;
  previousFranchiseId: FranchiseId | null;
}

export function reconstructDraftPickInventory(
  input: ReconstructDraftPickInventoryInput,
): ReconstructDraftPickInventoryResult {
  const diagnostics: PickOwnershipDiagnostic[] = [];
  const appliedOverrides: AppliedDraftOwnershipOverride[] = [];

  reportDraftMetadataMismatches(input, diagnostics);

  const slotCandidates = collectSlotOwnerCandidates(input, diagnostics);
  const slotOverrides = collectSlotOverrides(input.overrides ?? [], input.orderConfig, diagnostics);
  const pickInventory: DraftPickAsset[] = [];

  for (let slot = 1; slot <= input.orderConfig.teamCount; slot += 1) {
    const candidates = slotCandidates.get(slot) ?? [];
    const distinctCandidates = uniqueFranchiseIds(
      candidates.map((candidate) => candidate.franchiseId),
    );
    const override = slotOverrides.get(slot);
    let originalFranchiseId: FranchiseId | null = null;
    let ownershipConfidence: OwnershipConfidence = 'inferred';

    if (override) {
      originalFranchiseId = override.originalFranchiseId;
      ownershipConfidence = 'confirmed';
      const priorOriginalFranchiseId =
        distinctCandidates.length === 1 ? distinctCandidates[0]! : null;
      if (distinctCandidates.length > 1) {
        diagnostics.push({
          level: 'warning',
          code: 'conflicting_slot_owner',
          slot,
          message: `Draft slot ${slot} maps to multiple franchises (${distinctCandidates.join(', ')}); the manual slot override resolves the conflict.`,
        });
      }
      appliedOverrides.push({
        kind: 'slot',
        round: null,
        slot,
        reason: override.reason,
        overriddenBy: override.overriddenBy,
        overriddenAt: override.overriddenAt,
        priorOriginalFranchiseId,
        priorCurrentFranchiseId: priorOriginalFranchiseId,
        originalFranchiseId,
        currentFranchiseId: originalFranchiseId,
      });
    } else if (distinctCandidates.length === 1) {
      originalFranchiseId = distinctCandidates[0]!;
      ownershipConfidence = candidates.some((candidate) => candidate.source === 'slot_to_roster_id')
        ? 'confirmed'
        : 'inferred';
    } else if (distinctCandidates.length > 1) {
      diagnostics.push({
        level: 'error',
        code: 'conflicting_slot_owner',
        slot,
        message: `Draft slot ${slot} maps to multiple franchises (${distinctCandidates.join(', ')}); no picks were created for that slot.`,
      });
    } else {
      diagnostics.push({
        level: 'error',
        code: 'missing_slot_owner',
        slot,
        message: `Draft slot ${slot} has no resolvable original franchise; no picks were created for that slot.`,
      });
    }

    if (!originalFranchiseId) {
      continue;
    }

    for (let round = 1; round <= input.orderConfig.rounds; round += 1) {
      pickInventory.push(
        createPickAsset(
          input.seasonId,
          input.draft.sleeperDraftId,
          input.orderConfig,
          round,
          slot,
          originalFranchiseId,
          ownershipConfidence,
        ),
      );
    }
  }

  markDuplicateSlotFranchises(pickInventory, diagnostics);
  applyTradedPickOwnership(input, pickInventory, diagnostics);
  applySelectionOwnership(input, pickInventory, diagnostics);
  applyPickOverrides(input, pickInventory, diagnostics, appliedOverrides, input.overrides ?? []);

  return {
    pickInventory: pickInventory.sort(comparePickAssets),
    diagnostics,
    appliedOverrides,
  };
}

function reportDraftMetadataMismatches(
  input: ReconstructDraftPickInventoryInput,
  diagnostics: PickOwnershipDiagnostic[],
): void {
  if (input.draft.teamCount !== null && input.draft.teamCount !== input.orderConfig.teamCount) {
    diagnostics.push({
      level: 'warning',
      code: 'draft_metadata_mismatch',
      message: `Sleeper reports ${input.draft.teamCount} teams, but reconstruction uses ${input.orderConfig.teamCount}.`,
    });
  }
  if (input.draft.rounds !== null && input.draft.rounds !== input.orderConfig.rounds) {
    diagnostics.push({
      level: 'warning',
      code: 'draft_metadata_mismatch',
      message: `Sleeper reports ${input.draft.rounds} rounds, but reconstruction uses ${input.orderConfig.rounds}.`,
    });
  }
  if (input.draft.type !== 'unknown' && input.draft.type !== input.orderConfig.orderMethod) {
    diagnostics.push({
      level: 'warning',
      code: 'draft_metadata_mismatch',
      message: `Sleeper reports a ${input.draft.type} draft, but reconstruction uses ${input.orderConfig.orderMethod}.`,
    });
  }
  if (input.draft.season !== null && input.draft.season !== input.sleeperSeason) {
    diagnostics.push({
      level: 'warning',
      code: 'draft_metadata_mismatch',
      message: `Sleeper draft season ${input.draft.season} does not match requested season ${input.sleeperSeason}.`,
    });
  }
}

function collectSlotOwnerCandidates(
  input: ReconstructDraftPickInventoryInput,
  diagnostics: PickOwnershipDiagnostic[],
): Map<number, SlotOwnerCandidate[]> {
  const candidates = new Map<number, SlotOwnerCandidate[]>();

  for (const [rawSlot, rosterId] of Object.entries(input.draft.slotToRosterId)) {
    const slot = Number(rawSlot);
    if (!isIntegerInRange(slot, 1, input.orderConfig.teamCount)) {
      diagnostics.push({
        level: 'warning',
        code: 'invalid_metadata_slot',
        message: `Sleeper slot-to-roster metadata contains invalid slot '${rawSlot}'.`,
      });
      continue;
    }

    const franchiseId = input.rosterIdToFranchiseId[rosterId];
    if (!franchiseId) {
      diagnostics.push({
        level: 'warning',
        code: 'unmapped_roster',
        slot,
        message: `Sleeper roster ${rosterId} at draft slot ${slot} is not mapped to a franchise.`,
      });
      continue;
    }
    addSlotCandidate(candidates, slot, { franchiseId, source: 'slot_to_roster_id' });
  }

  if (input.sleeperUserIdToFranchiseId) {
    for (const [sleeperUserId, slot] of Object.entries(input.draft.draftOrder)) {
      if (!isIntegerInRange(slot, 1, input.orderConfig.teamCount)) {
        diagnostics.push({
          level: 'warning',
          code: 'invalid_metadata_slot',
          message: `Sleeper draft-order metadata assigns user ${sleeperUserId} to invalid slot '${slot}'.`,
        });
        continue;
      }

      const franchiseId = input.sleeperUserIdToFranchiseId[sleeperUserId];
      if (!franchiseId) {
        diagnostics.push({
          level: 'warning',
          code: 'unmapped_user',
          slot,
          message: `Sleeper user ${sleeperUserId} at draft slot ${slot} is not mapped to a franchise.`,
        });
        continue;
      }
      addSlotCandidate(candidates, slot, { franchiseId, source: 'draft_order' });
    }
  }

  return candidates;
}

function addSlotCandidate(
  candidates: Map<number, SlotOwnerCandidate[]>,
  slot: number,
  candidate: SlotOwnerCandidate,
): void {
  const existing = candidates.get(slot) ?? [];
  existing.push(candidate);
  candidates.set(slot, existing);
}

function collectSlotOverrides(
  overrides: readonly DraftOwnershipOverride[],
  config: DraftOrderConfig,
  diagnostics: PickOwnershipDiagnostic[],
): Map<number, DraftSlotOwnershipOverride> {
  const result = new Map<number, DraftSlotOwnershipOverride>();

  for (const override of overrides) {
    if (override.kind !== 'slot') {
      continue;
    }
    if (!isValidOverrideAudit(override) || !isIntegerInRange(override.slot, 1, config.teamCount)) {
      diagnostics.push({
        level: 'error',
        code: 'invalid_override',
        slot: override.slot,
        message: `Slot ownership override for slot ${override.slot} is invalid and was ignored.`,
      });
      continue;
    }
    if (result.has(override.slot)) {
      diagnostics.push({
        level: 'warning',
        code: 'duplicate_override',
        slot: override.slot,
        message: `Multiple slot overrides target slot ${override.slot}; the last override wins.`,
      });
    }
    result.set(override.slot, override);
  }

  return result;
}

function createPickAsset(
  seasonId: SeasonId,
  sleeperDraftId: string,
  config: DraftOrderConfig,
  round: number,
  slot: number,
  originalFranchiseId: FranchiseId,
  ownershipConfidence: OwnershipConfidence,
): DraftPickAsset {
  return {
    id: `draft-pick:${seasonId}:${sleeperDraftId}:${round}:${slot}` as DraftPickAssetId,
    seasonId,
    round,
    originalFranchiseId,
    currentFranchiseId: originalFranchiseId,
    slot,
    overallPick: calculateOverallPick(config, round, slot),
    ownershipConfidence,
  };
}

function markDuplicateSlotFranchises(
  pickInventory: DraftPickAsset[],
  diagnostics: PickOwnershipDiagnostic[],
): void {
  const slotsByFranchise = new Map<FranchiseId, Set<number>>();
  for (const pick of pickInventory) {
    const slots = slotsByFranchise.get(pick.originalFranchiseId) ?? new Set<number>();
    if (pick.slot !== null) {
      slots.add(pick.slot);
    }
    slotsByFranchise.set(pick.originalFranchiseId, slots);
  }

  for (const [franchiseId, slots] of slotsByFranchise) {
    if (slots.size <= 1) {
      continue;
    }
    diagnostics.push({
      level: 'warning',
      code: 'duplicate_slot_franchise',
      message: `Franchise ${franchiseId} is assigned to multiple draft slots (${[...slots].sort((a, b) => a - b).join(', ')}).`,
    });
    for (const pick of pickInventory) {
      if (pick.originalFranchiseId === franchiseId) {
        pick.ownershipConfidence = 'disputed';
      }
    }
  }
}

function applyTradedPickOwnership(
  input: ReconstructDraftPickInventoryInput,
  pickInventory: DraftPickAsset[],
  diagnostics: PickOwnershipDiagnostic[],
): void {
  const tradesByAssetId = new Map<
    DraftPickAssetId,
    { pick: DraftPickAsset; records: PickTradeRecord[] }
  >();

  for (const tradedPick of input.tradedPicks ?? []) {
    if (tradedPick.season !== input.sleeperSeason) {
      continue;
    }
    if (!isIntegerInRange(tradedPick.round, 1, input.orderConfig.rounds)) {
      diagnostics.push({
        level: 'error',
        code: 'invalid_trade',
        round: tradedPick.round,
        message: `Traded-pick record has invalid round ${tradedPick.round}.`,
      });
      continue;
    }

    const originalFranchiseId = input.rosterIdToFranchiseId[tradedPick.originalRosterId];
    const currentFranchiseId = input.rosterIdToFranchiseId[tradedPick.currentOwnerRosterId];
    const previousFranchiseId =
      input.rosterIdToFranchiseId[tradedPick.previousOwnerRosterId] ?? null;
    if (!originalFranchiseId || !currentFranchiseId) {
      diagnostics.push({
        level: 'error',
        code: 'invalid_trade',
        round: tradedPick.round,
        message: `Traded round ${tradedPick.round} pick references an unmapped ${!originalFranchiseId ? 'original' : 'current'} roster.`,
      });
      continue;
    }

    const matches = pickInventory.filter(
      (pick) => pick.round === tradedPick.round && pick.originalFranchiseId === originalFranchiseId,
    );
    if (matches.length === 0) {
      diagnostics.push({
        level: 'error',
        code: 'trade_asset_not_found',
        round: tradedPick.round,
        message: `No round ${tradedPick.round} pick was found for original franchise ${originalFranchiseId}.`,
      });
      continue;
    }
    if (matches.length > 1) {
      diagnostics.push({
        level: 'error',
        code: 'ambiguous_trade_asset',
        round: tradedPick.round,
        message: `Round ${tradedPick.round} has multiple picks for original franchise ${originalFranchiseId}; the trade was not applied.`,
      });
      matches.forEach((pick) => {
        pick.ownershipConfidence = 'disputed';
      });
      continue;
    }

    const pick = matches[0]!;
    const entry = tradesByAssetId.get(pick.id) ?? { pick, records: [] };
    entry.records.push({ currentFranchiseId, previousFranchiseId });
    tradesByAssetId.set(pick.id, entry);
  }

  for (const { pick, records } of tradesByAssetId.values()) {
    applyPickTradeRecords(pick, records, diagnostics);
  }
}

function applyPickTradeRecords(
  pick: DraftPickAsset,
  records: readonly PickTradeRecord[],
  diagnostics: PickOwnershipDiagnostic[],
): void {
  const uniqueRecords: PickTradeRecord[] = [];
  for (const record of records) {
    const alreadySeen = uniqueRecords.some(
      (seen) =>
        seen.currentFranchiseId === record.currentFranchiseId &&
        seen.previousFranchiseId === record.previousFranchiseId,
    );
    if (alreadySeen) {
      diagnostics.push({
        level: 'warning',
        code: 'conflicting_trade_records',
        round: pick.round,
        slot: pick.slot ?? undefined,
        overallPick: pick.overallPick ?? undefined,
        message: `Duplicate traded-pick records were supplied for ${describePick(pick)}; the duplicate was ignored.`,
      });
      continue;
    }
    uniqueRecords.push(record);
  }

  const lastRecord = uniqueRecords[uniqueRecords.length - 1];
  if (!lastRecord) {
    return;
  }

  const chainOwner = resolveTradeChainOwner(pick.originalFranchiseId, uniqueRecords);
  if (chainOwner === null) {
    diagnostics.push({
      level: 'warning',
      code: 'conflicting_trade_records',
      round: pick.round,
      slot: pick.slot ?? undefined,
      overallPick: pick.overallPick ?? undefined,
      message: `Traded-pick records for ${describePick(pick)} do not form a single ownership chain; the last record wins.`,
    });
    pick.ownershipConfidence = 'disputed';
  }

  pick.currentFranchiseId = chainOwner ?? lastRecord.currentFranchiseId;
  if (pick.ownershipConfidence !== 'disputed') {
    pick.ownershipConfidence = 'confirmed';
  }
}

/**
 * Follows previous-owner -> current-owner links out from the original owner, so a pick
 * traded more than once resolves to the end of the chain no matter what order Sleeper
 * returned the records in. Returns null when the records cannot be read as one
 * unambiguous chain: an unmapped previous owner, two records leaving the same owner, a
 * cycle, or any record left over once the walk ends.
 */
function resolveTradeChainOwner(
  originalFranchiseId: FranchiseId,
  records: readonly PickTradeRecord[],
): FranchiseId | null {
  // A lone record is Sleeper's normal representation and may already collapse several
  // hops, so its previous owner is not required to be the original owner.
  if (records.length === 1) {
    return records[0]!.currentFranchiseId;
  }

  const recordByPreviousOwner = new Map<FranchiseId, PickTradeRecord>();
  for (const record of records) {
    if (
      record.previousFranchiseId === null ||
      recordByPreviousOwner.has(record.previousFranchiseId)
    ) {
      return null;
    }
    recordByPreviousOwner.set(record.previousFranchiseId, record);
  }

  let owner = originalFranchiseId;
  const visitedOwners = new Set<FranchiseId>([owner]);
  let hops = 0;

  for (;;) {
    const nextRecord = recordByPreviousOwner.get(owner);
    if (!nextRecord) {
      break;
    }
    if (visitedOwners.has(nextRecord.currentFranchiseId)) {
      return null;
    }
    owner = nextRecord.currentFranchiseId;
    visitedOwners.add(owner);
    hops += 1;
  }

  return hops === records.length ? owner : null;
}

function applySelectionOwnership(
  input: ReconstructDraftPickInventoryInput,
  pickInventory: DraftPickAsset[],
  diagnostics: PickOwnershipDiagnostic[],
): void {
  const picksByOverall = new Map(
    pickInventory
      .filter((pick): pick is DraftPickAsset & { overallPick: number } => pick.overallPick !== null)
      .map((pick) => [pick.overallPick, pick]),
  );
  const seenSelections = new Map<number, NormalizedSleeperDraftPick>();

  for (const selection of input.selections ?? []) {
    if (input.draft.sleeperDraftId && selection.sleeperDraftId !== input.draft.sleeperDraftId) {
      diagnostics.push({
        level: 'error',
        code: 'invalid_selection',
        overallPick: selection.pickNo,
        message: `Selection ${selection.pickNo} belongs to draft ${selection.sleeperDraftId}, not ${input.draft.sleeperDraftId}; it was ignored.`,
      });
      continue;
    }
    if (
      !isIntegerInRange(selection.pickNo, 1, input.orderConfig.teamCount * input.orderConfig.rounds)
    ) {
      diagnostics.push({
        level: 'error',
        code: 'invalid_selection',
        overallPick: selection.pickNo,
        message: `Selection has invalid overall pick ${selection.pickNo}; it was ignored.`,
      });
      continue;
    }

    const pick = picksByOverall.get(selection.pickNo);
    if (!pick) {
      diagnostics.push({
        level: 'error',
        code: 'invalid_selection',
        overallPick: selection.pickNo,
        message: `Selection ${selection.pickNo} has no reconstructed pick asset.`,
      });
      continue;
    }

    const expectedSlot = pick.slot!;
    if (
      selection.round !== pick.round ||
      (selection.draftSlot !== null && selection.draftSlot !== expectedSlot)
    ) {
      diagnostics.push({
        level: 'warning',
        code: 'selection_coordinate_mismatch',
        round: pick.round,
        slot: expectedSlot,
        overallPick: selection.pickNo,
        message: `Selection ${selection.pickNo} reports round ${selection.round}, slot ${selection.draftSlot ?? 'unknown'}, but draft math resolves it to round ${pick.round}, slot ${expectedSlot}.`,
      });
      pick.ownershipConfidence = 'disputed';
    }

    const priorSelection = seenSelections.get(selection.pickNo);
    if (priorSelection) {
      diagnostics.push({
        level: 'warning',
        code: 'duplicate_selection',
        round: pick.round,
        slot: expectedSlot,
        overallPick: selection.pickNo,
        message: `Multiple selections were supplied for overall pick ${selection.pickNo}; the last mapped owner wins.`,
      });
      pick.ownershipConfidence = 'disputed';
    }
    seenSelections.set(selection.pickNo, selection);

    const owner = resolveSelectionOwner(input, selection, pick, diagnostics);
    if (!owner) {
      continue;
    }
    if (pick.currentFranchiseId !== owner.franchiseId) {
      diagnostics.push({
        level: 'warning',
        code: 'selection_owner_conflict',
        round: pick.round,
        slot: expectedSlot,
        overallPick: selection.pickNo,
        message: `Selection ${selection.pickNo} belongs to ${owner.franchiseId}, overriding reconstructed owner ${pick.currentFranchiseId}.`,
      });
    }
    pick.currentFranchiseId = owner.franchiseId;
    if (pick.ownershipConfidence !== 'disputed') {
      pick.ownershipConfidence = owner.confidence;
    }
  }
}

function resolveSelectionOwner(
  input: ReconstructDraftPickInventoryInput,
  selection: NormalizedSleeperDraftPick,
  pick: DraftPickAsset,
  diagnostics: PickOwnershipDiagnostic[],
): { franchiseId: FranchiseId; confidence: OwnershipConfidence } | null {
  const rosterFranchiseId =
    selection.rosterId === null ? null : (input.rosterIdToFranchiseId[selection.rosterId] ?? null);
  const userFranchiseId =
    selection.pickedBySleeperUserId === null || !input.sleeperUserIdToFranchiseId
      ? null
      : (input.sleeperUserIdToFranchiseId[selection.pickedBySleeperUserId] ?? null);

  if (rosterFranchiseId && userFranchiseId && rosterFranchiseId !== userFranchiseId) {
    diagnostics.push({
      level: 'warning',
      code: 'selection_owner_conflict',
      round: pick.round,
      slot: pick.slot ?? undefined,
      overallPick: selection.pickNo,
      message: `Selection ${selection.pickNo} maps its roster to ${rosterFranchiseId} but its user to ${userFranchiseId}; roster ownership wins.`,
    });
    pick.ownershipConfidence = 'disputed';
  }

  if (rosterFranchiseId) {
    return { franchiseId: rosterFranchiseId, confidence: 'confirmed' };
  }
  if (userFranchiseId) {
    return { franchiseId: userFranchiseId, confidence: 'inferred' };
  }

  diagnostics.push({
    level: 'warning',
    code: 'selection_owner_unmapped',
    round: pick.round,
    slot: pick.slot ?? undefined,
    overallPick: selection.pickNo,
    message: `Selection ${selection.pickNo} has no roster or user that maps to a franchise.`,
  });
  return null;
}

function applyPickOverrides(
  input: ReconstructDraftPickInventoryInput,
  pickInventory: DraftPickAsset[],
  diagnostics: PickOwnershipDiagnostic[],
  appliedOverrides: AppliedDraftOwnershipOverride[],
  overrides: readonly DraftOwnershipOverride[],
): void {
  const lastOverrideByCoordinate = new Map<string, DraftPickOwnershipOverride>();

  for (const override of overrides) {
    if (override.kind !== 'pick') {
      continue;
    }
    const validCoordinates =
      isIntegerInRange(override.round, 1, input.orderConfig.rounds) &&
      isIntegerInRange(override.slot, 1, input.orderConfig.teamCount);
    const hasOwnershipChange =
      override.originalFranchiseId !== undefined || override.currentFranchiseId !== undefined;
    if (!validCoordinates || !hasOwnershipChange || !isValidOverrideAudit(override)) {
      diagnostics.push({
        level: 'error',
        code: 'invalid_override',
        round: override.round,
        slot: override.slot,
        message: `Pick ownership override for round ${override.round}, slot ${override.slot} is invalid and was ignored.`,
      });
      continue;
    }

    const coordinate = `${override.round}:${override.slot}`;
    if (lastOverrideByCoordinate.has(coordinate)) {
      diagnostics.push({
        level: 'warning',
        code: 'duplicate_override',
        round: override.round,
        slot: override.slot,
        message: `Multiple pick overrides target round ${override.round}, slot ${override.slot}; the last override wins.`,
      });
    }
    lastOverrideByCoordinate.set(coordinate, override);
  }

  for (const override of lastOverrideByCoordinate.values()) {
    let pick = pickInventory.find(
      (candidate) => candidate.round === override.round && candidate.slot === override.slot,
    );
    const pickExisted = pick !== undefined;
    if (!pick) {
      if (!override.originalFranchiseId) {
        diagnostics.push({
          level: 'error',
          code: 'invalid_override',
          round: override.round,
          slot: override.slot,
          message: `Pick override cannot create round ${override.round}, slot ${override.slot} without an original franchise.`,
        });
        continue;
      }
      pick = createPickAsset(
        input.seasonId,
        input.draft.sleeperDraftId,
        input.orderConfig,
        override.round,
        override.slot,
        override.originalFranchiseId,
        'confirmed',
      );
      pickInventory.push(pick);
    }

    const priorOriginalFranchiseId = pickExisted ? pick.originalFranchiseId : null;
    const priorCurrentFranchiseId = pickExisted ? pick.currentFranchiseId : null;
    pick.originalFranchiseId = override.originalFranchiseId ?? pick.originalFranchiseId;
    pick.currentFranchiseId = override.currentFranchiseId ?? pick.currentFranchiseId;
    pick.ownershipConfidence = 'confirmed';

    appliedOverrides.push({
      kind: 'pick',
      round: override.round,
      slot: override.slot,
      reason: override.reason,
      overriddenBy: override.overriddenBy,
      overriddenAt: override.overriddenAt,
      priorOriginalFranchiseId,
      priorCurrentFranchiseId,
      originalFranchiseId: pick.originalFranchiseId,
      currentFranchiseId: pick.currentFranchiseId,
    });
  }
}

function uniqueFranchiseIds(franchiseIds: readonly FranchiseId[]): FranchiseId[] {
  return [...new Set(franchiseIds)];
}

function comparePickAssets(left: DraftPickAsset, right: DraftPickAsset): number {
  return (
    (left.overallPick ?? Number.MAX_SAFE_INTEGER) - (right.overallPick ?? Number.MAX_SAFE_INTEGER)
  );
}

function describePick(pick: DraftPickAsset): string {
  return `round ${pick.round}, slot ${pick.slot ?? 'unknown'}`;
}

function isValidOverrideAudit(override: OwnershipOverrideAudit): boolean {
  return (
    override.reason.trim().length > 0 &&
    override.overriddenBy.trim().length > 0 &&
    override.overriddenAt.trim().length > 0 &&
    !Number.isNaN(Date.parse(override.overriddenAt))
  );
}

function isIntegerInRange(value: number, min: number, max: number): boolean {
  return Number.isInteger(value) && value >= min && value <= max;
}
