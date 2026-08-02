import { formatDraftPick } from '@keeper/domain';
import type {
  DraftPickAsset,
  DraftPickAssetId,
  FranchiseId,
  KeeperDisplacement,
  KeeperRight,
  KeeperRightId,
  KeeperRightSourceType,
  Player,
  PlayerId,
  SeasonId,
  ValuationResult,
} from '@keeper/domain';
import {
  valuatePlayerForFranchise,
  type PickValueCurve,
  type ProjectionSource,
  type ReplacementLevels,
} from '@keeper/valuation';

export const DEFAULT_MAX_KEEPERS = 3;

export interface KeeperCombination {
  selectedKeeperRightIds: KeeperRightId[];
}

export type KeeperOrderingPolicy = 'nominal_early_to_late' | 'input';

export interface KeeperResolutionOptions {
  franchiseId?: FranchiseId;
  maxKeepers?: number;
  orderingPolicy?: KeeperOrderingPolicy;
}

export interface ResolvedKeeperPick {
  keeperRightId: KeeperRightId;
  playerId: PlayerId;
  nominalRound: number;
  resolvedPickAssetId: DraftPickAssetId;
  resolvedRound: number;
  resolvedOverallPick: number;
  resolvedSlot: number | null;
}

export interface KeeperCombinationResolution {
  selectedKeeperRightIds: KeeperRightId[];
  legal: boolean;
  resolutionOrder: KeeperRightId[];
  resolvedPicks: ResolvedKeeperPick[];
  displacements: KeeperDisplacement[];
  invalidReason: string | null;
  explanation: string;
}

export interface ResolveKeeperCombinationsInput {
  keeperRights: KeeperRight[];
  pickInventory: DraftPickAsset[];
  franchiseId?: FranchiseId;
  maxKeepers?: number;
  orderingPolicy?: KeeperOrderingPolicy;
  includeIllegal?: boolean;
}

export const KEEPER_OPTIMIZATION_MODES = ['expected', 'safest', 'win_now', 'future'] as const;

export type KeeperOptimizationMode = (typeof KEEPER_OPTIMIZATION_MODES)[number];

export interface KeeperPlayerValuation {
  keeperRightId: KeeperRightId;
  playerId: PlayerId;
  fullName: string;
  position: Player['position'];
  nominalRound: number;
  resolvedPickAssetId: DraftPickAssetId;
  resolvedRound: number;
  resolvedOverallPick: number;
  resolvedSlot: number | null;
  intrinsicValue: number;
  consumedPickValue: number;
  keeperSurplusValue: number;
  teamContextValue: number;
  futureKeeperOptionValue: number;
  valuation: ValuationResult;
}

export interface ValuedKeeperCombination extends KeeperCombinationResolution {
  playerValuations: KeeperPlayerValuation[];
  releasedKeeperRightIds: KeeperRightId[];
  releasedPlayerIds: PlayerId[];
  retainedIntrinsicValue: number;
  consumedPickValue: number;
  keeperSurplusValue: number;
  teamContextValue: number;
  futureKeeperOptionValue: number;
  modeScores: Record<KeeperOptimizationMode, number>;
  totalScore: number;
}

export interface OptimizeKeeperCombinationsInput {
  keeperRights: KeeperRight[];
  pickInventory: DraftPickAsset[];
  players: Player[];
  franchiseId: FranchiseId;
  seasonId: SeasonId;
  evaluatedAt: string;
  projectionSource: ProjectionSource;
  replacementLevels: ReplacementLevels;
  pickValueCurve: PickValueCurve;
  maxKeepers?: number;
  orderingPolicy?: KeeperOrderingPolicy;
  keeperSlotOpportunityCostByKeeperRightId?: ReadonlyMap<KeeperRightId, number>;
  rosterFitByPlayerId?: ReadonlyMap<PlayerId, number>;
  rulesVersion?: string;
  engineVersion?: string;
}

export interface KeeperOptimizationResult {
  combinations: ValuedKeeperCombination[];
  bestByMode: Record<KeeperOptimizationMode, ValuedKeeperCombination | null>;
}

export function enumerateKeeperCombinations(
  keeperRights: KeeperRight[],
  maxKeepers = DEFAULT_MAX_KEEPERS,
): KeeperCombination[] {
  assertNonNegativeInteger('maxKeepers', maxKeepers);

  const combinations: KeeperCombination[] = [{ selectedKeeperRightIds: [] }];
  const limit = Math.min(maxKeepers, keeperRights.length);

  function visit(startIndex: number, selectedKeeperRightIds: KeeperRightId[]): void {
    if (selectedKeeperRightIds.length === limit) {
      return;
    }

    for (let index = startIndex; index < keeperRights.length; index += 1) {
      const keeperRight = keeperRights[index];
      if (!keeperRight) {
        continue;
      }

      selectedKeeperRightIds.push(keeperRight.id);
      combinations.push({ selectedKeeperRightIds: [...selectedKeeperRightIds] });
      visit(index + 1, selectedKeeperRightIds);
      selectedKeeperRightIds.pop();
    }
  }

  visit(0, []);

  return combinations;
}

export function resolveKeeperCombinations(
  input: ResolveKeeperCombinationsInput,
): KeeperCombinationResolution[] {
  const eligibleRights = input.franchiseId
    ? input.keeperRights.filter((right) => right.franchiseId === input.franchiseId)
    : input.keeperRights;
  const rightsById = new Map(eligibleRights.map((right) => [right.id, right]));

  const resolutions = enumerateKeeperCombinations(eligibleRights, input.maxKeepers).map(
    (combination) =>
      resolveKeeperCombination(
        combination.selectedKeeperRightIds.map((id) => {
          const right = rightsById.get(id);
          if (!right) {
            throw new Error(`Unknown keeper right ${id}.`);
          }
          return right;
        }),
        input.pickInventory,
        {
          franchiseId: input.franchiseId,
          maxKeepers: input.maxKeepers,
          orderingPolicy: input.orderingPolicy,
        },
      ),
  );

  return input.includeIllegal === false
    ? resolutions.filter((resolution) => resolution.legal)
    : resolutions;
}

export function optimizeKeeperCombinations(
  input: OptimizeKeeperCombinationsInput,
): KeeperOptimizationResult {
  const eligibleRights = input.keeperRights.filter(
    (right) => right.franchiseId === input.franchiseId,
  );
  const rightsById = new Map(eligibleRights.map((right) => [right.id, right]));
  const playersById = new Map(input.players.map((player) => [player.id, player]));
  const legalResolutions = resolveKeeperCombinations({
    keeperRights: eligibleRights,
    pickInventory: input.pickInventory,
    franchiseId: input.franchiseId,
    maxKeepers: input.maxKeepers,
    orderingPolicy: input.orderingPolicy,
    includeIllegal: false,
  });

  const combinations = legalResolutions
    .map((resolution) =>
      valueKeeperCombination(resolution, {
        ...input,
        keeperRights: eligibleRights,
        rightsById,
        playersById,
      }),
    )
    .sort((a, b) => b.totalScore - a.totalScore);

  return {
    combinations,
    bestByMode: buildBestByMode(combinations),
  };
}

export function resolveKeeperCombination(
  selectedKeeperRights: KeeperRight[],
  pickInventory: DraftPickAsset[],
  options: KeeperResolutionOptions = {},
): KeeperCombinationResolution {
  const maxKeepers = options.maxKeepers ?? DEFAULT_MAX_KEEPERS;
  assertNonNegativeInteger('maxKeepers', maxKeepers);

  const selectedKeeperRightIds = selectedKeeperRights.map((right) => right.id);

  if (selectedKeeperRights.length > maxKeepers) {
    return invalidResolution(
      selectedKeeperRightIds,
      `Selected ${selectedKeeperRights.length} keepers, but the league limit is ${maxKeepers}.`,
    );
  }

  const duplicatePlayerId = findDuplicatePlayerId(selectedKeeperRights);
  if (duplicatePlayerId) {
    return invalidResolution(
      selectedKeeperRightIds,
      `Player ${duplicatePlayerId} appears in more than one selected keeper right for this season.`,
    );
  }

  const franchiseId = inferFranchiseId(selectedKeeperRights, options.franchiseId);
  if (franchiseId.kind === 'invalid') {
    return invalidResolution(selectedKeeperRightIds, franchiseId.reason);
  }

  if (selectedKeeperRights.length === 0) {
    return {
      selectedKeeperRightIds,
      legal: true,
      resolutionOrder: [],
      resolvedPicks: [],
      displacements: [],
      invalidReason: null,
      explanation: 'No keepers selected; no draft picks consumed.',
    };
  }

  const ownedPicks = pickInventory.filter(
    (pick) => pick.currentFranchiseId === franchiseId.value && pick.overallPick !== null,
  );
  const usedPickAssignments = new Map<DraftPickAssetId, KeeperRight>();
  const resolvedPicks: ResolvedKeeperPick[] = [];
  const displacements: KeeperDisplacement[] = [];
  const orderedRights = orderKeeperRights(selectedKeeperRights, options.orderingPolicy);

  for (const keeperRight of orderedRights) {
    const resolvedPick = chooseKeeperPick(
      ownedPicks,
      usedPickAssignments,
      keeperRight.nominalRound,
    );

    if (!resolvedPick || resolvedPick.overallPick === null) {
      return invalidResolution(
        selectedKeeperRightIds,
        `No legal owned pick is available at round ${keeperRight.nominalRound} or earlier for keeper ${keeperRight.id}.`,
        orderedRights.map((right) => right.id),
        resolvedPicks,
        displacements,
      );
    }

    resolvedPicks.push({
      keeperRightId: keeperRight.id,
      playerId: keeperRight.playerId,
      nominalRound: keeperRight.nominalRound,
      resolvedPickAssetId: resolvedPick.id,
      resolvedRound: resolvedPick.round,
      resolvedOverallPick: resolvedPick.overallPick,
      resolvedSlot: resolvedPick.slot,
    });

    if (resolvedPick.round < keeperRight.nominalRound) {
      displacements.push(
        buildDisplacement(
          keeperRight,
          pickInventory,
          ownedPicks,
          resolvedPick,
          usedPickAssignments,
          franchiseId.value,
        ),
      );
    }

    usedPickAssignments.set(resolvedPick.id, keeperRight);
  }

  return {
    selectedKeeperRightIds,
    legal: true,
    resolutionOrder: orderedRights.map((right) => right.id),
    resolvedPicks,
    displacements,
    invalidReason: null,
    explanation: buildResolutionExplanation(resolvedPicks, displacements),
  };
}

/**
 * Cheapest round a keeper cost can reach. This league caps at the first round: once a
 * player has climbed to a first-round cost he stays there rather than becoming
 * unkeepable. Keeping two such players is still limited, but by pick inventory rather
 * than by cost -- each consumes a first-round pick, and nothing is earlier to displace
 * into, so a second one is only legal for a team that owns a second first-rounder.
 */
export const DEFAULT_MINIMUM_KEEPER_COST_ROUND = 1;

export function advanceKeeperCostRound(
  previousRound: number,
  seasonsElapsed = 1,
  roundsAdvancedPerSeason = 1,
  minimumRound = DEFAULT_MINIMUM_KEEPER_COST_ROUND,
): number {
  assertPositiveInteger('previousRound', previousRound);
  assertNonNegativeInteger('seasonsElapsed', seasonsElapsed);
  assertNonNegativeInteger('roundsAdvancedPerSeason', roundsAdvancedPerSeason);
  assertPositiveInteger('minimumRound', minimumRound);

  return Math.max(minimumRound, previousRound - seasonsElapsed * roundsAdvancedPerSeason);
}

export interface ResolveNominalKeeperCostRoundInput {
  sourceType: KeeperRightSourceType;
  previousRound?: number;
  undraftedKeeperRound: number;
  seasonsElapsed?: number;
  roundsAdvancedPerSeason?: number;
  overrideRound?: number;
  minimumRound?: number;
}

export function resolveNominalKeeperCostRound(input: ResolveNominalKeeperCostRoundInput): number {
  assertPositiveInteger('undraftedKeeperRound', input.undraftedKeeperRound);

  if (input.sourceType === 'undrafted_free_agent') {
    return input.undraftedKeeperRound;
  }

  if (input.sourceType === 'manual_override') {
    if (input.overrideRound === undefined) {
      throw new Error('overrideRound is required for manual_override keeper costs.');
    }
    assertPositiveInteger('overrideRound', input.overrideRound);
    return input.overrideRound;
  }

  if (input.previousRound === undefined) {
    throw new Error(`previousRound is required for ${input.sourceType} keeper costs.`);
  }

  return advanceKeeperCostRound(
    input.previousRound,
    input.seasonsElapsed,
    input.roundsAdvancedPerSeason,
    input.minimumRound,
  );
}

type KeeperValuationContext = OptimizeKeeperCombinationsInput & {
  rightsById: ReadonlyMap<KeeperRightId, KeeperRight>;
  playersById: ReadonlyMap<PlayerId, Player>;
};

function valueKeeperCombination(
  resolution: KeeperCombinationResolution,
  context: KeeperValuationContext,
): ValuedKeeperCombination {
  const playerValuations = resolution.resolvedPicks.map((resolvedPick) =>
    valueResolvedKeeperPick(resolvedPick, context),
  );

  const retainedIntrinsicValue = sumBy(playerValuations, (player) => player.intrinsicValue);
  const consumedPickValue = sumBy(playerValuations, (player) => player.consumedPickValue);
  const keeperSurplusValue = sumBy(playerValuations, (player) => player.keeperSurplusValue);
  const teamContextValue = sumBy(playerValuations, (player) => player.teamContextValue);
  const futureKeeperOptionValue = sumBy(
    playerValuations,
    (player) => player.futureKeeperOptionValue,
  );
  const selectedKeeperRightIds = new Set(resolution.selectedKeeperRightIds);
  const releasedRights = context.keeperRights.filter(
    (right) => !selectedKeeperRightIds.has(right.id),
  );
  const modeScores = buildModeScores({
    retainedIntrinsicValue,
    consumedPickValue,
    keeperSurplusValue,
    teamContextValue,
    futureKeeperOptionValue,
  });

  return {
    ...resolution,
    playerValuations,
    releasedKeeperRightIds: releasedRights.map((right) => right.id),
    releasedPlayerIds: releasedRights.map((right) => right.playerId),
    retainedIntrinsicValue,
    consumedPickValue,
    keeperSurplusValue,
    teamContextValue,
    futureKeeperOptionValue,
    modeScores,
    totalScore: modeScores.expected,
    explanation: buildValuedCombinationExplanation(resolution, playerValuations, modeScores),
  };
}

function valueResolvedKeeperPick(
  resolvedPick: ResolvedKeeperPick,
  context: KeeperValuationContext,
): KeeperPlayerValuation {
  const keeperRight = context.rightsById.get(resolvedPick.keeperRightId);
  if (!keeperRight) {
    throw new Error(`Cannot value unknown keeper right ${resolvedPick.keeperRightId}.`);
  }

  const player = context.playersById.get(resolvedPick.playerId);
  if (!player) {
    throw new Error(
      `Cannot value keeper ${keeperRight.id}; missing player ${resolvedPick.playerId}.`,
    );
  }

  const valuation = valuatePlayerForFranchise({
    playerId: player.id,
    position: player.position,
    franchiseId: context.franchiseId,
    seasonId: context.seasonId,
    evaluatedAt: context.evaluatedAt,
    projectionSource: context.projectionSource,
    replacementLevels: context.replacementLevels,
    pickValueCurve: context.pickValueCurve,
    exactOverallPick: resolvedPick.resolvedOverallPick,
    keeperSlotOpportunityCost: context.keeperSlotOpportunityCostByKeeperRightId?.get(
      keeperRight.id,
    ),
    rosterFit: context.rosterFitByPlayerId?.get(player.id),
    rulesVersion: context.rulesVersion,
    engineVersion: context.engineVersion,
  });

  const consumedPickValue = getRequiredBreakdownValue(valuation, 'ksv.pickOpportunityCost');
  const futureKeeperOptionValue =
    valuation.components.breakdown['tcv.futureKeeperOptionValue'] ?? 0;

  return {
    keeperRightId: keeperRight.id,
    playerId: player.id,
    fullName: player.fullName,
    position: player.position,
    nominalRound: keeperRight.nominalRound,
    resolvedPickAssetId: resolvedPick.resolvedPickAssetId,
    resolvedRound: resolvedPick.resolvedRound,
    resolvedOverallPick: resolvedPick.resolvedOverallPick,
    resolvedSlot: resolvedPick.resolvedSlot,
    intrinsicValue: valuation.components.intrinsicValue,
    consumedPickValue,
    keeperSurplusValue: requireNumber(
      valuation.components.keeperSurplusValue,
      `keeperSurplusValue for ${keeperRight.id}`,
    ),
    teamContextValue: requireNumber(
      valuation.components.teamContextValue,
      `teamContextValue for ${keeperRight.id}`,
    ),
    futureKeeperOptionValue,
    valuation,
  };
}

interface CombinationModeScoreInput {
  retainedIntrinsicValue: number;
  consumedPickValue: number;
  keeperSurplusValue: number;
  teamContextValue: number;
  futureKeeperOptionValue: number;
}

function buildModeScores(input: CombinationModeScoreInput): Record<KeeperOptimizationMode, number> {
  return {
    expected: input.teamContextValue,
    safest: input.keeperSurplusValue,
    // Win-now favors maximum current-season production and deliberately ignores
    // pick cost: a contender doesn't care what a keeper "cost" in draft-value
    // terms, only how many points it adds right now. Reusing KSV's shape here
    // (retainedIntrinsicValue - consumedPickValue) would make this mode
    // numerically identical to `safest` whenever keeperSlotOpportunityCost is
    // unset, which is every current caller.
    win_now: input.retainedIntrinsicValue,
    future: input.teamContextValue + input.futureKeeperOptionValue,
  };
}

function buildBestByMode(
  combinations: ValuedKeeperCombination[],
): Record<KeeperOptimizationMode, ValuedKeeperCombination | null> {
  return Object.fromEntries(
    KEEPER_OPTIMIZATION_MODES.map((mode) => [
      mode,
      combinations.reduce<ValuedKeeperCombination | null>(
        (best, combination) =>
          best === null || combination.modeScores[mode] > best.modeScores[mode]
            ? combination
            : best,
        null,
      ),
    ]),
  ) as Record<KeeperOptimizationMode, ValuedKeeperCombination | null>;
}

function buildValuedCombinationExplanation(
  resolution: KeeperCombinationResolution,
  playerValuations: KeeperPlayerValuation[],
  modeScores: Record<KeeperOptimizationMode, number>,
): string {
  if (playerValuations.length === 0) {
    return 'No keepers selected; retained IV, pick cost, KSV, and TCV are all zero.';
  }

  const valueLines = playerValuations.map(
    (player) =>
      `${player.fullName}: IV ${formatNumber(player.intrinsicValue)}, pick cost ${formatNumber(
        player.consumedPickValue,
      )}, KSV ${formatNumber(player.keeperSurplusValue)}, TCV ${formatNumber(
        player.teamContextValue,
      )}.`,
  );

  return [
    resolution.explanation,
    ...valueLines,
    `Expected score ${formatNumber(modeScores.expected)}; safest ${formatNumber(
      modeScores.safest,
    )}; win-now ${formatNumber(modeScores.win_now)}; future ${formatNumber(modeScores.future)}.`,
  ].join('\n');
}

function getRequiredBreakdownValue(valuation: ValuationResult, key: string): number {
  return requireNumber(valuation.components.breakdown[key], `valuation breakdown ${key}`);
}

function requireNumber(value: number | null | undefined, label: string): number {
  if (value === null || value === undefined) {
    throw new Error(`Missing ${label}.`);
  }
  return value;
}

function sumBy<T>(items: T[], selectValue: (item: T) => number): number {
  return items.reduce((total, item) => total + selectValue(item), 0);
}

function formatNumber(value: number): string {
  const rounded = Math.round(value * 100) / 100;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(2);
}

function orderKeeperRights(
  keeperRights: KeeperRight[],
  orderingPolicy: KeeperOrderingPolicy = 'nominal_early_to_late',
): KeeperRight[] {
  if (orderingPolicy === 'input') {
    return [...keeperRights];
  }

  return [...keeperRights].sort((a, b) => {
    if (a.nominalRound !== b.nominalRound) {
      return a.nominalRound - b.nominalRound;
    }
    return String(a.id).localeCompare(String(b.id));
  });
}

function chooseKeeperPick(
  ownedPicks: DraftPickAsset[],
  usedPickAssignments: Map<DraftPickAssetId, KeeperRight>,
  nominalRound: number,
): DraftPickAsset | null {
  return (
    ownedPicks
      .filter(
        (pick) =>
          pick.round <= nominalRound &&
          pick.overallPick !== null &&
          !usedPickAssignments.has(pick.id),
      )
      .sort((a, b) => {
        if (a.round !== b.round) {
          return b.round - a.round;
        }
        return b.overallPick! - a.overallPick!;
      })[0] ?? null
  );
}

function buildDisplacement(
  keeperRight: KeeperRight,
  pickInventory: DraftPickAsset[],
  ownedPicks: DraftPickAsset[],
  resolvedPick: DraftPickAsset,
  usedPickAssignments: Map<DraftPickAssetId, KeeperRight>,
  franchiseId: FranchiseId | undefined,
): KeeperDisplacement {
  const bestCandidateWithoutKeeperCollisions = chooseKeeperPick(
    ownedPicks,
    new Map(),
    keeperRight.nominalRound,
  );
  const resolvedPickLabel = describePick(resolvedPick);

  if (bestCandidateWithoutKeeperCollisions) {
    const causingKeeper = usedPickAssignments.get(bestCandidateWithoutKeeperCollisions.id);
    if (causingKeeper) {
      const skippedPickLabel = describePick(bestCandidateWithoutKeeperCollisions);
      // If the best candidate ignoring collisions is exactly the nominal round,
      // the team owns that round outright and the only issue is the collision
      // itself; a "missing pick" preamble would be misleading (or, when the
      // team owns its own nominal pick, self-contradictory).
      const isPureCollision =
        bestCandidateWithoutKeeperCollisions.round === keeperRight.nominalRound;
      const missingNominalPickContext = isPureCollision
        ? ''
        : buildMissingNominalPickContext(keeperRight, pickInventory, franchiseId);

      return {
        keeperRightId: keeperRight.id,
        nominalRound: keeperRight.nominalRound,
        resolvedRound: resolvedPick.round,
        resolvedOverallPick: resolvedPick.overallPick!,
        cause: 'keeper_collision',
        causedByKeeperRightId: causingKeeper.id,
        reason: `${missingNominalPickContext}${skippedPickLabel} was already consumed by keeper ${causingKeeper.id}; consumed next earlier owned pick ${resolvedPickLabel}.`,
      };
    }
  }

  const missingPickReason = `${buildMissingNominalPickContext(
    keeperRight,
    pickInventory,
    franchiseId,
  )}Consumed next earlier owned pick ${resolvedPickLabel}.`;

  return {
    keeperRightId: keeperRight.id,
    nominalRound: keeperRight.nominalRound,
    resolvedRound: resolvedPick.round,
    resolvedOverallPick: resolvedPick.overallPick!,
    cause: 'missing_pick',
    causedByKeeperRightId: null,
    reason: missingPickReason,
  };
}

function buildMissingNominalPickContext(
  keeperRight: KeeperRight,
  pickInventory: DraftPickAsset[],
  franchiseId: FranchiseId | undefined,
): string {
  const originalNominalPick = pickInventory.find(
    (pick) => pick.round === keeperRight.nominalRound && pick.originalFranchiseId === franchiseId,
  );

  if (originalNominalPick) {
    if (originalNominalPick.currentFranchiseId !== franchiseId) {
      return `Original round ${keeperRight.nominalRound} pick is owned by ${originalNominalPick.currentFranchiseId}, not ${franchiseId}. `;
    }

    if (originalNominalPick.overallPick === null) {
      return `Original round ${keeperRight.nominalRound} pick is owned by ${franchiseId}, but its exact overall pick is unknown. `;
    }

    return '';
  }

  return `No owned round ${keeperRight.nominalRound} pick is available in the inventory. `;
}

function buildResolutionExplanation(
  resolvedPicks: ResolvedKeeperPick[],
  displacements: KeeperDisplacement[],
): string {
  if (resolvedPicks.length === 0) {
    return 'No keepers selected; no draft picks consumed.';
  }

  const resolvedLines = resolvedPicks.map(
    (pick) =>
      `${pick.keeperRightId}: nominal round ${pick.nominalRound} -> ${formatResolvedPick(pick)}`,
  );
  const displacementLines = displacements.map((event) => `${event.keeperRightId}: ${event.reason}`);

  return [...resolvedLines, ...displacementLines].join('\n');
}

function formatResolvedPick(pick: ResolvedKeeperPick): string {
  const slotLabel =
    pick.resolvedSlot === null
      ? `round ${pick.resolvedRound}`
      : formatDraftPick(pick.resolvedRound, pick.resolvedSlot);
  return `${slotLabel} (overall ${pick.resolvedOverallPick})`;
}

function describePick(pick: DraftPickAsset): string {
  const slotLabel =
    pick.slot === null ? `round ${pick.round}` : formatDraftPick(pick.round, pick.slot);
  const overallLabel =
    pick.overallPick === null ? 'unknown overall' : `overall ${pick.overallPick}`;
  return `${slotLabel} (${overallLabel})`;
}

function inferFranchiseId(
  keeperRights: KeeperRight[],
  explicitFranchiseId: FranchiseId | undefined,
): { kind: 'valid'; value: FranchiseId | undefined } | { kind: 'invalid'; reason: string } {
  if (explicitFranchiseId) {
    const mismatchedRight = keeperRights.find((right) => right.franchiseId !== explicitFranchiseId);
    if (mismatchedRight) {
      return {
        kind: 'invalid',
        reason: `Keeper ${mismatchedRight.id} belongs to a different franchise than ${explicitFranchiseId}.`,
      };
    }
    return { kind: 'valid', value: explicitFranchiseId };
  }

  const franchiseIds = new Set(keeperRights.map((right) => right.franchiseId));
  if (franchiseIds.size > 1) {
    return {
      kind: 'invalid',
      reason: 'Keeper resolution requires keepers from exactly one franchise.',
    };
  }

  return { kind: 'valid', value: keeperRights[0]?.franchiseId };
}

function findDuplicatePlayerId(keeperRights: KeeperRight[]): PlayerId | null {
  const seenPlayerIds = new Set<PlayerId>();

  for (const keeperRight of keeperRights) {
    if (seenPlayerIds.has(keeperRight.playerId)) {
      return keeperRight.playerId;
    }
    seenPlayerIds.add(keeperRight.playerId);
  }

  return null;
}

function invalidResolution(
  selectedKeeperRightIds: KeeperRightId[],
  invalidReason: string,
  resolutionOrder: KeeperRightId[] = [],
  resolvedPicks: ResolvedKeeperPick[] = [],
  displacements: KeeperDisplacement[] = [],
): KeeperCombinationResolution {
  return {
    selectedKeeperRightIds,
    legal: false,
    resolutionOrder,
    resolvedPicks,
    displacements,
    invalidReason,
    explanation: invalidReason,
  };
}

function assertPositiveInteger(name: string, value: number): void {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer; received ${value}.`);
  }
}

function assertNonNegativeInteger(name: string, value: number): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${name} must be a non-negative integer; received ${value}.`);
  }
}

export * from './release-vs-redraft.js';
