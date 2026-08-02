import type {
  DraftPickAsset,
  Franchise,
  FranchiseId,
  KeeperRight,
  KeeperRightId,
  Player,
  PlayerId,
  SeasonId,
} from '@keeper/domain';
import {
  optimizeKeeperCombinations,
  type KeeperOptimizationResult,
} from '@keeper/keeper-optimizer';
import type { PickValueCurve, ProjectionSource, ReplacementLevels } from '@keeper/valuation';

export interface KeeperMarketInput {
  franchises: readonly Franchise[];
  keeperRights: readonly KeeperRight[];
  pickInventory: readonly DraftPickAsset[];
  players: readonly Player[];
  seasonId: SeasonId;
  evaluatedAt: string;
  projectionSource: ProjectionSource;
  replacementLevels: ReplacementLevels;
  pickValueCurve: PickValueCurve;
  keeperLimit: number;
  /**
   * Drives expiration urgency. Omit when the deadline is unknown; urgency is then reported
   * as unknown rather than guessed.
   */
  daysUntilKeeperDeadline?: number;
  /** Window over which urgency ramps from none to full. */
  urgencyWindowDays?: number;
}

export interface ExcessKeeperCandidate {
  keeperRightId: KeeperRightId;
  playerId: PlayerId;
  fullName: string;
  nominalRound: number;
  /** What this player is worth to his current owner as a marginal addition to their best set. */
  marginalValueToOwner: number;
  /** What he would be worth kept on his own, ignoring the slot competition he loses. */
  standaloneValue: number;
  /** Value the owner cannot capture because the slot goes to someone better. */
  strandedValue: number;
}

export interface FranchiseMarketPosition {
  franchiseId: FranchiseId;
  displayName: string;
  keeperLimit: number;
  valuableKeeperCount: number;
  keeperSurplus: number;
  keeperDemand: number;
  bestSetKeeperRightIds: KeeperRightId[];
  bestSetTeamContextValue: number;
  excessCandidates: ExcessKeeperCandidate[];
  totalStrandedValue: number;
}

export interface BuyerFit {
  buyerFranchiseId: FranchiseId;
  buyerDisplayName: string;
  /** Best-set value the buyer gains by adding this player, after their own slot competition. */
  marginalValueToBuyer: number;
  /** How much more the player is worth to the buyer than to his current owner. */
  gainOverCurrentOwner: number;
  buyerKeeperDemand: number;
}

export type UrgencyConfidence = 'known' | 'unknown';

export interface SellPressureFactors {
  /** Owner value that goes unrealised if nothing happens, normalised against the roster's stranded value. */
  strandedValueShare: number;
  /** 0 when the deadline is far away, 1 at the deadline. Reported as null when unknown. */
  expirationUrgency: number | null;
  /** Share of rival franchises who would gain from acquiring him. */
  buyerDepth: number;
  /** How strongly the best buyer values him relative to his standalone worth. */
  marketability: number;
}

export interface SellPressureAssessment {
  keeperRightId: KeeperRightId;
  playerId: PlayerId;
  fullName: string;
  ownerFranchiseId: FranchiseId;
  /** Product of the exposed factors. An incentive score, not a prediction. */
  score: number;
  factors: SellPressureFactors;
  urgencyConfidence: UrgencyConfidence;
  buyerFits: BuyerFit[];
  interpretation: string;
}

export type DraftPoolOutlook =
  'likely_kept' | 'contested' | 'likely_reaches_pool' | 'insufficient_data';

export interface DraftRemovalInputs {
  playerId: PlayerId;
  fullName: string;
  ownerFranchiseId: FranchiseId;
  /** True when the player is in his owner's current best keeper set. */
  inOwnerBestSet: boolean;
  /** Null when the owner is keeping him, where the figure is not computed. */
  marginalValueToOwner: number | null;
  bestRivalGain: number;
  interestedRivalCount: number;
  /**
   * A coarse label over the inputs above, not a probability. The doc calls for simulation
   * before any number is attached, because these events are dependent.
   */
  outlook: DraftPoolOutlook;
}

export interface KeeperMarketAnalysis {
  positions: FranchiseMarketPosition[];
  sellPressure: SellPressureAssessment[];
  draftRemovalInputs: DraftRemovalInputs[];
  assumptions: string[];
}

const DEFAULT_URGENCY_WINDOW_DAYS = 30;

/**
 * A transparent first pass over the pre-deadline market.
 *
 * Everything here measures incentive, never intent: a high sell-pressure score says a
 * manager has reason to move a player, not that they will. Values come from the same
 * combination-level optimiser the keeper planner uses, so a player's worth already
 * accounts for the slot he would have to win, and no probability is attached to a trade
 * or a keep, because those events are dependent and need simulation to model honestly.
 */
export function analyzeKeeperMarket(input: KeeperMarketInput): KeeperMarketAnalysis {
  const assumptions: string[] = [
    'Values come from combination-level optimisation, so a player is measured by what he adds to a best keeper set rather than in isolation.',
    'Sell pressure and buyer fit describe incentives, not predictions about what a manager will do.',
    'No trade or keep probability is produced; draft-removal outputs are inputs and a coarse label only.',
  ];

  if (input.daysUntilKeeperDeadline === undefined) {
    assumptions.push(
      'The keeper deadline was not supplied, so expiration urgency is reported as unknown and excluded from the sell-pressure score.',
    );
  }

  const rightsByFranchise = groupRightsByFranchise(input.keeperRights);
  const optimizationByFranchise = new Map<FranchiseId, KeeperOptimizationResult>();
  for (const franchise of input.franchises) {
    optimizationByFranchise.set(
      franchise.id,
      optimizeFor(input, franchise.id, rightsByFranchise.get(franchise.id) ?? []),
    );
  }

  const positions = input.franchises.map((franchise) =>
    buildPosition(
      input,
      franchise,
      rightsByFranchise.get(franchise.id) ?? [],
      optimizationByFranchise.get(franchise.id)!,
    ),
  );

  const sellPressure = positions.flatMap((position) =>
    position.excessCandidates.map((candidate) =>
      assessSellPressure(input, position, candidate, rightsByFranchise, optimizationByFranchise),
    ),
  );

  return {
    positions,
    sellPressure: sellPressure.sort((left, right) => right.score - left.score),
    draftRemovalInputs: buildDraftRemovalInputs(input, positions, sellPressure),
    assumptions,
  };
}

function buildPosition(
  input: KeeperMarketInput,
  franchise: Franchise,
  rights: readonly KeeperRight[],
  optimization: KeeperOptimizationResult,
): FranchiseMarketPosition {
  const best = optimization.bestByMode.expected;
  const bestSetIds = new Set(best?.selectedKeeperRightIds ?? []);
  const playersById = new Map(input.players.map((player) => [player.id, player]));

  const standaloneByRightId = new Map<KeeperRightId, number>();
  for (const right of rights) {
    standaloneByRightId.set(right.id, standaloneValue(input, franchise.id, right));
  }

  const valuableRights = rights.filter((right) => (standaloneByRightId.get(right.id) ?? 0) > 0);
  const baselineValue = best?.teamContextValue ?? 0;

  const excessCandidates = valuableRights
    .filter((right) => !bestSetIds.has(right.id))
    .map((right) => {
      const standalone = standaloneByRightId.get(right.id) ?? 0;
      const marginal = marginalValueToFranchise(input, franchise.id, rights, right, baselineValue);
      return {
        keeperRightId: right.id,
        playerId: right.playerId,
        fullName: playersById.get(right.playerId)?.fullName ?? String(right.playerId),
        nominalRound: right.nominalRound,
        marginalValueToOwner: marginal,
        standaloneValue: standalone,
        strandedValue: Math.max(0, standalone - marginal),
      };
    })
    .sort((left, right) => right.strandedValue - left.strandedValue);

  return {
    franchiseId: franchise.id,
    displayName: franchise.displayName,
    keeperLimit: input.keeperLimit,
    valuableKeeperCount: valuableRights.length,
    keeperSurplus: Math.max(0, valuableRights.length - input.keeperLimit),
    keeperDemand: Math.max(0, input.keeperLimit - valuableRights.length),
    bestSetKeeperRightIds: [...bestSetIds],
    bestSetTeamContextValue: baselineValue,
    excessCandidates,
    totalStrandedValue: excessCandidates.reduce(
      (total, candidate) => total + candidate.strandedValue,
      0,
    ),
  };
}

function assessSellPressure(
  input: KeeperMarketInput,
  position: FranchiseMarketPosition,
  candidate: ExcessKeeperCandidate,
  rightsByFranchise: ReadonlyMap<FranchiseId, KeeperRight[]>,
  optimizationByFranchise: ReadonlyMap<FranchiseId, KeeperOptimizationResult>,
): SellPressureAssessment {
  const right = (rightsByFranchise.get(position.franchiseId) ?? []).find(
    (candidateRight) => candidateRight.id === candidate.keeperRightId,
  )!;

  const buyerFits = input.franchises
    .filter((franchise) => franchise.id !== position.franchiseId)
    .map((franchise) => {
      const buyerRights = rightsByFranchise.get(franchise.id) ?? [];
      const baseline =
        optimizationByFranchise.get(franchise.id)?.bestByMode.expected?.teamContextValue ?? 0;
      const marginal = marginalValueToFranchise(
        input,
        franchise.id,
        [...buyerRights, { ...right, franchiseId: franchise.id }],
        right,
        baseline,
        { alreadyIncluded: true },
      );

      return {
        buyerFranchiseId: franchise.id,
        buyerDisplayName: franchise.displayName,
        marginalValueToBuyer: marginal,
        gainOverCurrentOwner: marginal - candidate.marginalValueToOwner,
        // Open keeper slots, measured against what the buyer would actually keep rather
        // than how many players he has. A keeper right exists for every rostered player, so
        // counting rights reported that a sixteen player roster had already used sixteen of
        // its three slots and nobody in the league had room for anyone.
        buyerKeeperDemand: Math.max(
          0,
          input.keeperLimit -
            (optimizationByFranchise.get(franchise.id)?.bestByMode.expected?.selectedKeeperRightIds
              .length ?? 0),
        ),
      };
    })
    .filter((fit) => fit.gainOverCurrentOwner > 0)
    .sort((left, right_) => right_.gainOverCurrentOwner - left.gainOverCurrentOwner);

  const rivalCount = Math.max(1, input.franchises.length - 1);
  const bestGain = buyerFits[0]?.gainOverCurrentOwner ?? 0;
  const expirationUrgency = resolveUrgency(input);

  const factors: SellPressureFactors = {
    strandedValueShare:
      position.totalStrandedValue === 0 ? 0 : candidate.strandedValue / position.totalStrandedValue,
    expirationUrgency,
    buyerDepth: buyerFits.length / rivalCount,
    marketability:
      candidate.standaloneValue <= 0 ? 0 : clamp01(bestGain / candidate.standaloneValue),
  };

  // Urgency is excluded rather than defaulted when the deadline is unknown, so an unknown
  // never silently inflates or deflates the score.
  const score =
    factors.strandedValueShare *
    factors.buyerDepth *
    factors.marketability *
    (factors.expirationUrgency ?? 1);

  return {
    keeperRightId: candidate.keeperRightId,
    playerId: candidate.playerId,
    fullName: candidate.fullName,
    ownerFranchiseId: position.franchiseId,
    score,
    factors,
    urgencyConfidence: expirationUrgency === null ? 'unknown' : 'known',
    buyerFits,
    interpretation: buildInterpretation(candidate, buyerFits.length),
  };
}

function buildDraftRemovalInputs(
  input: KeeperMarketInput,
  positions: readonly FranchiseMarketPosition[],
  sellPressure: readonly SellPressureAssessment[],
): DraftRemovalInputs[] {
  const playersById = new Map(input.players.map((player) => [player.id, player]));
  const sellPressureByRightId = new Map(
    sellPressure.map((assessment) => [assessment.keeperRightId, assessment]),
  );

  return input.keeperRights.map((right) => {
    const position = positions.find((entry) => entry.franchiseId === right.franchiseId);
    const inBestSet = position?.bestSetKeeperRightIds.includes(right.id) ?? false;
    const assessment = sellPressureByRightId.get(right.id);
    const excess = position?.excessCandidates.find(
      (candidate) => candidate.keeperRightId === right.id,
    );
    const bestRivalGain = assessment?.buyerFits[0]?.gainOverCurrentOwner ?? 0;

    return {
      playerId: right.playerId,
      fullName: playersById.get(right.playerId)?.fullName ?? String(right.playerId),
      ownerFranchiseId: right.franchiseId,
      inOwnerBestSet: inBestSet,
      // Null, not NaN, when the owner keeps him: his marginal value is the loss from
      // dropping him out of a set he is already in, which this pass does not compute. NaN
      // was the worse of the two, since it poisons any arithmetic downstream and serializes
      // to null anyway -- an unknown that looks like a number until it ruins a total.
      marginalValueToOwner: excess?.marginalValueToOwner ?? (inBestSet ? null : 0),
      bestRivalGain,
      interestedRivalCount: assessment?.buyerFits.length ?? 0,
      outlook: resolveOutlook(position === undefined, inBestSet, bestRivalGain),
    };
  });
}

function resolveOutlook(
  positionMissing: boolean,
  inBestSet: boolean,
  bestRivalGain: number,
): DraftPoolOutlook {
  if (positionMissing) {
    return 'insufficient_data';
  }
  if (inBestSet) {
    return 'likely_kept';
  }
  return bestRivalGain > 0 ? 'contested' : 'likely_reaches_pool';
}

function standaloneValue(
  input: KeeperMarketInput,
  franchiseId: FranchiseId,
  right: KeeperRight,
): number {
  const optimization = optimizeFor(input, franchiseId, [right]);
  return optimization.bestByMode.expected?.teamContextValue ?? 0;
}

/**
 * Value of a player to a franchise measured the only way that respects keeper-slot
 * scarcity: the difference between their best set with him available and without him.
 */
function marginalValueToFranchise(
  input: KeeperMarketInput,
  franchiseId: FranchiseId,
  rights: readonly KeeperRight[],
  right: KeeperRight,
  baselineValue: number,
  options: { alreadyIncluded?: boolean } = {},
): number {
  const withPlayer = options.alreadyIncluded
    ? rights
    : [...rights.filter((candidate) => candidate.id !== right.id), right];
  const withoutPlayer = rights.filter((candidate) => candidate.id !== right.id);

  const withValue =
    optimizeFor(input, franchiseId, withPlayer).bestByMode.expected?.teamContextValue ?? 0;
  const withoutValue = options.alreadyIncluded
    ? (optimizeFor(input, franchiseId, withoutPlayer).bestByMode.expected?.teamContextValue ?? 0)
    : baselineValue;

  return withValue - withoutValue;
}

function optimizeFor(
  input: KeeperMarketInput,
  franchiseId: FranchiseId,
  rights: readonly KeeperRight[],
): KeeperOptimizationResult {
  return optimizeKeeperCombinations({
    keeperRights: rights.map((right) => ({ ...right, franchiseId })),
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
}

function resolveUrgency(input: KeeperMarketInput): number | null {
  if (input.daysUntilKeeperDeadline === undefined) {
    return null;
  }
  const window = input.urgencyWindowDays ?? DEFAULT_URGENCY_WINDOW_DAYS;
  return clamp01(1 - input.daysUntilKeeperDeadline / window);
}

function buildInterpretation(candidate: ExcessKeeperCandidate, buyerCount: number): string {
  if (buyerCount === 0) {
    return `${candidate.fullName} is surplus to his owner's best keeper set, but no rival gains more from him than the owner does. He has no natural buyer right now.`;
  }
  return `${candidate.fullName} is surplus to his owner's best keeper set, stranding ${round2(
    candidate.strandedValue,
  )} points of value, and ${buyerCount} rival(s) would gain more from him than his owner does. This is an incentive to trade, not a prediction that a trade happens.`;
}

function groupRightsByFranchise(
  keeperRights: readonly KeeperRight[],
): Map<FranchiseId, KeeperRight[]> {
  const byFranchise = new Map<FranchiseId, KeeperRight[]>();
  for (const right of keeperRights) {
    const existing = byFranchise.get(right.franchiseId) ?? [];
    existing.push(right);
    byFranchise.set(right.franchiseId, existing);
  }
  return byFranchise;
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
