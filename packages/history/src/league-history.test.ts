import { describe, expect, it } from 'vitest';
import type { FranchiseId, PlayerId, SeasonId } from '@keeper/domain';
import { buildPlayerAssetTimeline, type SeasonAssetRecord } from './asset-timeline.js';
import { buildLeagueHistory } from './league-history.js';

const alpha = 'franchise-alpha' as FranchiseId;
const beta = 'franchise-beta' as FranchiseId;

describe('buildLeagueHistory', () => {
  it('rolls keeper surplus up per franchise', () => {
    const history = buildLeagueHistory({
      timelines: [
        timeline('player-1', 'Great Keeper', [
          kept(2024, alpha, 6, 200, 50),
          kept(2025, alpha, 5, 190, 60),
        ]),
        timeline('player-2', 'Modest Keeper', [kept(2025, beta, 4, 100, 80)]),
      ],
    });

    const alphaSummary = history.franchises.find((entry) => entry.franchiseId === alpha)!;
    expect(alphaSummary.cumulativeKeeperSurplus).toBeCloseTo(280);
    expect(alphaSummary.keeperSeasons).toBe(2);
    expect(alphaSummary.keeperYield).toBeCloseTo(140);
    expect(history.totalKeeperSurplus).toBeCloseTo(300);
  });

  it('ranks franchises by the surplus they actually captured', () => {
    const history = buildLeagueHistory({
      timelines: [
        timeline('player-1', 'Great Keeper', [kept(2025, alpha, 6, 200, 20)]),
        timeline('player-2', 'Modest Keeper', [kept(2025, beta, 6, 100, 90)]),
      ],
    });

    expect(history.franchises.map((entry) => entry.franchiseId)).toEqual([alpha, beta]);
  });

  it('credits each owner what his own seasons were worth, not the average', () => {
    // The case an even split cannot distinguish, and the reason the test above passes under
    // both behaviours: its seasons are identical. Here one owner produced 90 and the next
    // 10, so splitting the lifetime total evenly would report 50 apiece and move 40 points
    // of record from the manager who earned it to the one who did not.
    const history = buildLeagueHistory({
      timelines: [
        timeline('player-shared', 'Traded Keeper', [
          kept(2024, alpha, 6, 190, 100),
          kept(2025, beta, 5, 110, 100),
        ]),
      ],
    });

    const alphaSummary = history.franchises.find((entry) => entry.franchiseId === alpha)!;
    const betaSummary = history.franchises.find((entry) => entry.franchiseId === beta)!;

    expect(alphaSummary.cumulativeKeeperSurplus).toBeCloseTo(90);
    expect(betaSummary.cumulativeKeeperSurplus).toBeCloseTo(10);
    expect(alphaSummary.cumulativeKeeperSurplus).not.toBeCloseTo(
      betaSummary.cumulativeKeeperSurplus,
    );
    // The league total is unchanged; only its attribution was wrong.
    expect(history.totalKeeperSurplus).toBeCloseTo(100);
  });

  it('credits each franchise only for the seasons it held him', () => {
    // Four keeper seasons split evenly, two under each owner.
    const history = buildLeagueHistory({
      timelines: [
        timeline('player-shared', 'Traded Keeper', [
          kept(2022, alpha, 7, 100, 0),
          kept(2023, alpha, 6, 100, 0),
          kept(2024, beta, 5, 100, 0),
          kept(2025, beta, 4, 100, 0),
        ]),
      ],
    });

    const alphaSummary = history.franchises.find((entry) => entry.franchiseId === alpha)!;
    const betaSummary = history.franchises.find((entry) => entry.franchiseId === beta)!;

    expect(alphaSummary.cumulativeKeeperSurplus).toBeCloseTo(200);
    expect(betaSummary.cumulativeKeeperSurplus).toBeCloseTo(200);
    expect(alphaSummary.keeperSeasons).toBe(2);
    expect(betaSummary.keeperSeasons).toBe(2);
  });

  it('separates the keeper decisions that lost value', () => {
    const history = buildLeagueHistory({
      timelines: [
        timeline('player-good', 'Worth It', [kept(2025, alpha, 6, 150, 40)]),
        timeline('player-bad', 'Overpriced', [kept(2025, alpha, 2, 60, 130)]),
      ],
    });

    const alphaSummary = history.franchises.find((entry) => entry.franchiseId === alpha)!;
    expect(alphaSummary.bestKeepers.map((keeper) => keeper.fullName)).toEqual(['Worth It']);
    expect(alphaSummary.negativeKeepers.map((keeper) => keeper.fullName)).toEqual(['Overpriced']);
    expect(alphaSummary.distinctPlayersKept).toBe(2);
  });

  it('limits the best-keeper list', () => {
    const history = buildLeagueHistory({
      timelines: Array.from({ length: 6 }, (_, index) =>
        timeline(`player-${index}`, `Keeper ${index}`, [
          kept(2025, alpha, 6, 100 + index * 10, 10),
        ]),
      ),
      topKeeperCount: 2,
    });

    expect(history.franchises[0]!.bestKeepers).toHaveLength(2);
    expect(history.franchises[0]!.bestKeepers[0]!.fullName).toBe('Keeper 5');
  });

  it('names timelines whose numbers carry a data warning', () => {
    const history = buildLeagueHistory({
      timelines: [timeline('player-unknown', 'Unknown Value', [kept(2025, alpha, 5, null, 0)])],
    });

    expect(history.timelinesWithDiagnostics).toEqual(['Unknown Value']);
  });

  it('ignores players who were never kept', () => {
    const history = buildLeagueHistory({
      timelines: [
        timeline('player-drafted', 'Just Drafted', [
          {
            seasonYear: 2025,
            seasonId: 'season-2025' as SeasonId,
            franchiseId: alpha,
            acquisition: 'drafted',
            costRound: 3,
            realizedValue: 200,
            pickCostValue: 100,
          },
        ]),
      ],
    });

    expect(history.franchises).toEqual([]);
    expect(history.totalKeeperSurplus).toBe(0);
  });
});

function timeline(playerId: string, fullName: string, records: SeasonAssetRecord[]) {
  return buildPlayerAssetTimeline({
    playerId: playerId as PlayerId,
    fullName,
    records,
  });
}

function kept(
  seasonYear: number,
  franchiseId: FranchiseId,
  costRound: number,
  realizedValue: number | null,
  pickCostValue: number,
): SeasonAssetRecord {
  return {
    seasonYear,
    seasonId: `season-${seasonYear}` as SeasonId,
    franchiseId,
    acquisition: 'kept',
    costRound,
    overallPick: null,
    realizedValue,
    pickCostValue,
  };
}
