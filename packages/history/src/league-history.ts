import type { FranchiseId } from '@keeper/domain';
import type { PlayerAssetTimeline } from './asset-timeline.js';

export interface FranchiseHistorySummary {
  franchiseId: FranchiseId;
  /** Surplus captured across every keeper season this franchise ran. */
  cumulativeKeeperSurplus: number;
  keeperSeasons: number;
  /** Average surplus per keeper season, or null if they have never kept anyone. */
  keeperYield: number | null;
  distinctPlayersKept: number;
  /** The keeper decisions that produced the most surplus, best first. */
  bestKeepers: { playerId: string; fullName: string; surplus: number; keeperSeasons: number }[];
  /** Keeper decisions that cost more than they returned. */
  negativeKeepers: { playerId: string; fullName: string; surplus: number }[];
}

export interface LeagueHistorySummary {
  franchises: FranchiseHistorySummary[];
  totalKeeperSurplus: number;
  /** Timelines whose diagnostics mean their numbers should be read with care. */
  timelinesWithDiagnostics: string[];
}

export interface BuildLeagueHistoryInput {
  timelines: readonly PlayerAssetTimeline[];
  topKeeperCount?: number;
}

const DEFAULT_TOP_KEEPER_COUNT = 5;

/**
 * Rolls player timelines up per franchise.
 *
 * Surplus is credited to the franchise that held the player during each keeper season
 * rather than to whoever holds him now, so a manager does not inherit the record of a
 * keeper decision somebody else made.
 */
export function buildLeagueHistory(input: BuildLeagueHistoryInput): LeagueHistorySummary {
  const byFranchise = new Map<
    FranchiseId,
    {
      surplus: number;
      keeperSeasons: number;
      players: Map<string, { fullName: string; surplus: number; keeperSeasons: number }>;
    }
  >();

  for (const timeline of input.timelines) {
    for (const event of timeline.events) {
      if (event.type !== 'kept' || event.franchiseId === null) {
        continue;
      }

      const entry = byFranchise.get(event.franchiseId) ?? {
        surplus: 0,
        keeperSeasons: 0,
        players: new Map(),
      };

      // Split the player's total evenly across his keeper seasons, so a franchise that held
      // him for two of four seasons is credited with the half it actually ran.
      const perSeasonSurplus =
        timeline.keeperSeasons === 0
          ? 0
          : timeline.cumulativeKeeperSurplus / timeline.keeperSeasons;

      entry.surplus += perSeasonSurplus;
      entry.keeperSeasons += 1;

      const player = entry.players.get(String(timeline.playerId)) ?? {
        fullName: timeline.fullName,
        surplus: 0,
        keeperSeasons: 0,
      };
      player.surplus += perSeasonSurplus;
      player.keeperSeasons += 1;
      entry.players.set(String(timeline.playerId), player);

      byFranchise.set(event.franchiseId, entry);
    }
  }

  const topCount = input.topKeeperCount ?? DEFAULT_TOP_KEEPER_COUNT;
  const franchises = [...byFranchise.entries()]
    .map(([franchiseId, entry]) => {
      const players = [...entry.players.entries()].map(([playerId, player]) => ({
        playerId,
        ...player,
      }));

      return {
        franchiseId,
        cumulativeKeeperSurplus: entry.surplus,
        keeperSeasons: entry.keeperSeasons,
        keeperYield: entry.keeperSeasons === 0 ? null : entry.surplus / entry.keeperSeasons,
        distinctPlayersKept: players.length,
        bestKeepers: players
          .filter((player) => player.surplus > 0)
          .sort((left, right) => right.surplus - left.surplus)
          .slice(0, topCount),
        negativeKeepers: players
          .filter((player) => player.surplus < 0)
          .sort((left, right) => left.surplus - right.surplus)
          .map(({ playerId, fullName, surplus }) => ({ playerId, fullName, surplus })),
      };
    })
    .sort((left, right) => right.cumulativeKeeperSurplus - left.cumulativeKeeperSurplus);

  return {
    franchises,
    totalKeeperSurplus: franchises.reduce(
      (total, franchise) => total + franchise.cumulativeKeeperSurplus,
      0,
    ),
    timelinesWithDiagnostics: input.timelines
      .filter((timeline) => timeline.diagnostics.length > 0)
      .map((timeline) => timeline.fullName),
  };
}
