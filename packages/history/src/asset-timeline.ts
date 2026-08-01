import type { FranchiseId, PlayerId, SeasonId } from '@keeper/domain';

export type AssetEventType =
  'drafted' | 'added' | 'traded' | 'kept' | 're_drafted' | 'dropped' | 'returned_to_pool';

export type AcquisitionType = 'drafted' | 'added' | 'traded' | 'kept' | 're_drafted';

export interface PlayerAssetEvent {
  seasonYear: number;
  seasonId: SeasonId;
  type: AssetEventType;
  franchiseId: FranchiseId | null;
  fromFranchiseId: FranchiseId | null;
  /** Keeper or draft cost round, where the event has one. */
  costRound: number | null;
  overallPick: number | null;
  description: string;
}

export interface SeasonAssetRecord {
  seasonYear: number;
  seasonId: SeasonId;
  franchiseId: FranchiseId | null;
  acquisition: AcquisitionType | null;
  costRound?: number | null;
  overallPick?: number | null;
  fromFranchiseId?: FranchiseId | null;
  droppedDuringSeason?: boolean;
  returnedToPool?: boolean;
  /** Points the player actually produced above replacement that season. */
  realizedValue?: number | null;
  /** What the consumed pick was worth, so surplus is realised value minus that cost. */
  pickCostValue?: number | null;
}

export interface KeeperCostHistoryEntry {
  seasonYear: number;
  costRound: number;
  /**
   * Rounds advanced from the previous known cost, which for a first keeper season is the
   * round he was drafted in. Null only when no earlier cost round exists to compare with.
   */
  advancedBy: number | null;
}

export type TimelineDiagnosticCode =
  | 'unexpected_cost_progression'
  | 'missing_cost_round'
  | 'missing_realized_value'
  | 'out_of_order_seasons';

export interface TimelineDiagnostic {
  code: TimelineDiagnosticCode;
  seasonYear: number | null;
  message: string;
}

export interface PlayerAssetTimeline {
  playerId: PlayerId;
  fullName: string;
  events: PlayerAssetEvent[];
  keeperCostHistory: KeeperCostHistoryEntry[];
  /** Seasons the player sat on any roster. */
  seasonsHeld: number;
  /** Seasons he was retained as a keeper rather than freshly acquired. */
  keeperSeasons: number;
  /** Consecutive seasons ending with the latest, under the same franchise. */
  yearsRetainedByCurrentFranchise: number;
  /** Realised value minus pick cost, summed across keeper seasons only. */
  cumulativeKeeperSurplus: number;
  /** Average surplus per keeper season, or null before he has been kept. */
  keeperYield: number | null;
  /** Total realised value across every season divided by the original acquisition cost. */
  draftRoi: number | null;
  totalRealizedValue: number;
  originalAcquisition: {
    seasonYear: number;
    type: AcquisitionType;
    costRound: number | null;
  } | null;
  currentFranchiseId: FranchiseId | null;
  endedInPool: boolean;
  diagnostics: TimelineDiagnostic[];
}

export interface BuildPlayerAssetTimelineInput {
  playerId: PlayerId;
  fullName: string;
  records: readonly SeasonAssetRecord[];
  /** Rounds a keeper cost is expected to advance per season. Defaults to the league's one. */
  expectedCostAdvancePerSeason?: number;
}

const DEFAULT_COST_ADVANCE = 1;

/**
 * Assembles one player's history into an ordered event log plus the metrics the league
 * history view reports.
 *
 * Surplus is only counted for seasons he was actually kept. The season he was first
 * drafted or added is what created the asset, not a return on it, so folding it into
 * keeper surplus would credit the keeper decision with value it never made.
 */
export function buildPlayerAssetTimeline(
  input: BuildPlayerAssetTimelineInput,
): PlayerAssetTimeline {
  const diagnostics: TimelineDiagnostic[] = [];
  const records = [...input.records].sort((left, right) => left.seasonYear - right.seasonYear);

  if (
    records.some(
      (record, index) => index > 0 && record.seasonYear === records[index - 1]!.seasonYear,
    )
  ) {
    diagnostics.push({
      code: 'out_of_order_seasons',
      seasonYear: null,
      message: 'More than one record was supplied for the same season; metrics may double count.',
    });
  }

  const events: PlayerAssetEvent[] = [];
  const keeperCostHistory: KeeperCostHistoryEntry[] = [];
  const expectedAdvance = input.expectedCostAdvancePerSeason ?? DEFAULT_COST_ADVANCE;

  let cumulativeKeeperSurplus = 0;
  let totalRealizedValue = 0;
  let keeperSeasons = 0;
  let seasonsHeld = 0;
  let previousKeeperCostRound: number | null = null;
  let originalAcquisition: PlayerAssetTimeline['originalAcquisition'] = null;

  for (const record of records) {
    if (record.acquisition !== null) {
      events.push(buildAcquisitionEvent(record, record.acquisition));

      if (originalAcquisition === null) {
        originalAcquisition = {
          seasonYear: record.seasonYear,
          type: record.acquisition,
          costRound: record.costRound ?? null,
        };
      }
    }

    if (record.franchiseId !== null) {
      seasonsHeld += 1;
    }

    if (record.acquisition === 'kept') {
      keeperSeasons += 1;
      const costRound = record.costRound ?? null;

      if (costRound === null) {
        diagnostics.push({
          code: 'missing_cost_round',
          seasonYear: record.seasonYear,
          message: `Keeper season ${record.seasonYear} has no cost round, so its progression cannot be checked.`,
        });
      } else {
        const advancedBy =
          previousKeeperCostRound === null ? null : previousKeeperCostRound - costRound;
        keeperCostHistory.push({ seasonYear: record.seasonYear, costRound, advancedBy });

        if (advancedBy !== null && advancedBy !== expectedAdvance) {
          diagnostics.push({
            code: 'unexpected_cost_progression',
            seasonYear: record.seasonYear,
            message: `Keeper cost moved from round ${previousKeeperCostRound} to ${costRound}, which advances ${advancedBy} round(s) rather than the expected ${expectedAdvance}.`,
          });
        }
        previousKeeperCostRound = costRound;
      }

      const surplus = seasonSurplus(record, diagnostics);
      cumulativeKeeperSurplus += surplus;
    } else if (record.costRound !== null && record.costRound !== undefined) {
      // A fresh acquisition resets the progression baseline.
      previousKeeperCostRound = record.costRound;
    }

    totalRealizedValue += record.realizedValue ?? 0;

    if (record.droppedDuringSeason) {
      events.push({
        seasonYear: record.seasonYear,
        seasonId: record.seasonId,
        type: 'dropped',
        franchiseId: record.franchiseId,
        fromFranchiseId: null,
        costRound: null,
        overallPick: null,
        description: `Dropped during ${record.seasonYear}.`,
      });
    }

    if (record.returnedToPool) {
      events.push({
        seasonYear: record.seasonYear,
        seasonId: record.seasonId,
        type: 'returned_to_pool',
        franchiseId: null,
        fromFranchiseId: record.franchiseId,
        costRound: null,
        overallPick: null,
        description: `Not kept for ${record.seasonYear}; returned to the draft pool.`,
      });
    }
  }

  const lastRecord = records.at(-1) ?? null;
  const endedInPool = lastRecord?.returnedToPool === true || lastRecord?.franchiseId === null;

  return {
    playerId: input.playerId,
    fullName: input.fullName,
    events,
    keeperCostHistory,
    seasonsHeld,
    keeperSeasons,
    yearsRetainedByCurrentFranchise: countTrailingRetention(records),
    cumulativeKeeperSurplus,
    keeperYield: keeperSeasons === 0 ? null : cumulativeKeeperSurplus / keeperSeasons,
    draftRoi: computeDraftRoi(records, totalRealizedValue),
    totalRealizedValue,
    originalAcquisition,
    currentFranchiseId: endedInPool ? null : (lastRecord?.franchiseId ?? null),
    endedInPool,
    diagnostics,
  };
}

function buildAcquisitionEvent(
  record: SeasonAssetRecord,
  acquisition: AcquisitionType,
): PlayerAssetEvent {
  return {
    seasonYear: record.seasonYear,
    seasonId: record.seasonId,
    type: acquisition,
    franchiseId: record.franchiseId,
    fromFranchiseId: record.fromFranchiseId ?? null,
    costRound: record.costRound ?? null,
    overallPick: record.overallPick ?? null,
    description: describeAcquisition(record, acquisition),
  };
}

function describeAcquisition(record: SeasonAssetRecord, acquisition: AcquisitionType): string {
  const cost =
    record.costRound === null || record.costRound === undefined
      ? ''
      : ` at a round ${record.costRound} cost`;
  const pick =
    record.overallPick === null || record.overallPick === undefined
      ? ''
      : ` (overall ${record.overallPick})`;

  switch (acquisition) {
    case 'drafted':
      return `Drafted in ${record.seasonYear}${cost}${pick}.`;
    case 'added':
      return `Added off waivers or free agency in ${record.seasonYear}.`;
    case 'traded':
      return `Acquired by trade in ${record.seasonYear}${
        record.fromFranchiseId ? ` from ${record.fromFranchiseId}` : ''
      }.`;
    case 'kept':
      return `Kept for ${record.seasonYear}${cost}${pick}.`;
    case 're_drafted':
      return `Released and re-drafted in ${record.seasonYear}${pick}.`;
  }
}

function seasonSurplus(record: SeasonAssetRecord, diagnostics: TimelineDiagnostic[]): number {
  if (record.realizedValue === null || record.realizedValue === undefined) {
    diagnostics.push({
      code: 'missing_realized_value',
      seasonYear: record.seasonYear,
      message: `Keeper season ${record.seasonYear} has no realised value, so it contributes nothing to cumulative surplus.`,
    });
    return 0;
  }
  return record.realizedValue - (record.pickCostValue ?? 0);
}

/** Consecutive seasons ending with the most recent, all held by the same franchise. */
function countTrailingRetention(records: readonly SeasonAssetRecord[]): number {
  const last = records.at(-1);
  if (!last || last.franchiseId === null || last.returnedToPool === true) {
    return 0;
  }

  let streak = 0;
  for (let index = records.length - 1; index >= 0; index -= 1) {
    const record = records[index]!;
    if (record.franchiseId !== last.franchiseId || record.returnedToPool === true) {
      break;
    }
    streak += 1;
  }
  return streak;
}

/**
 * Return on the pick that originally bought the asset. Null when he cost no pick, since a
 * waiver add has no denominator and reporting an infinite return would be meaningless.
 */
function computeDraftRoi(
  records: readonly SeasonAssetRecord[],
  totalRealizedValue: number,
): number | null {
  const first = records.find((record) => record.acquisition !== null);
  const originalCost = first?.pickCostValue ?? null;
  if (originalCost === null || originalCost <= 0) {
    return null;
  }
  return totalRealizedValue / originalCost;
}
