import type { FranchiseId, PlayerId, SeasonId } from '@keeper/domain';

/**
 * The keeper-cost progression worked through in the league rules: a rookie taken in the
 * eighth round in 2021 and kept every season after, his cost climbing one round each time
 * until a fourth-round price in 2025.
 *
 * Shape matches `SeasonAssetRecord` in @keeper/history structurally, so the fixture does
 * not need a dependency on that package.
 */
export interface KeeperHistorySeasonFixture {
  seasonYear: number;
  seasonId: SeasonId;
  franchiseId: FranchiseId | null;
  acquisition: 'drafted' | 'added' | 'traded' | 'kept' | 're_drafted' | null;
  costRound: number | null;
  overallPick: number | null;
  realizedValue: number | null;
  pickCostValue: number | null;
  returnedToPool?: boolean;
}

export const historyFranchiseId = 'franchise-history' as FranchiseId;
export const eighthRoundRookieId = 'player-eighth-round-rookie' as PlayerId;
export const eighthRoundRookieName = 'Eighth Round Rookie';

// Cost rises one round a season while production holds, so the surplus narrows each year.
// That squeeze is the whole point of the progression rule.
export const eighthRoundRookieSeasons: KeeperHistorySeasonFixture[] = [
  season(2021, 'drafted', 8, 92, 150, 20),
  season(2022, 'kept', 7, 80, 160, 35),
  season(2023, 'kept', 6, 68, 155, 50),
  season(2024, 'kept', 5, 56, 150, 70),
  season(2025, 'kept', 4, 44, 140, 95),
];

/** The same asset, but let go before the cost caught up with him. */
export const releasedRookieSeasons: KeeperHistorySeasonFixture[] = [
  ...eighthRoundRookieSeasons.slice(0, 3),
  {
    seasonYear: 2024,
    seasonId: 'season-2024' as SeasonId,
    franchiseId: historyFranchiseId,
    acquisition: null,
    costRound: null,
    overallPick: null,
    realizedValue: null,
    pickCostValue: null,
    returnedToPool: true,
  },
];

export function createKeeperHistoryScenario(): {
  playerId: PlayerId;
  fullName: string;
  franchiseId: FranchiseId;
  seasons: KeeperHistorySeasonFixture[];
} {
  return {
    playerId: eighthRoundRookieId,
    fullName: eighthRoundRookieName,
    franchiseId: historyFranchiseId,
    seasons: eighthRoundRookieSeasons,
  };
}

function season(
  seasonYear: number,
  acquisition: KeeperHistorySeasonFixture['acquisition'],
  costRound: number,
  overallPick: number,
  realizedValue: number,
  pickCostValue: number,
): KeeperHistorySeasonFixture {
  return {
    seasonYear,
    seasonId: `season-${seasonYear}` as SeasonId,
    franchiseId: historyFranchiseId,
    acquisition,
    costRound,
    overallPick,
    realizedValue,
    pickCostValue,
  };
}
