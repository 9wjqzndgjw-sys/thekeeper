import { describe, expect, it } from 'vitest';
import type { FranchiseId, PlayerId, SeasonId } from '@keeper/domain';
import {
  createKeeperHistoryScenario,
  eighthRoundRookieId,
  eighthRoundRookieName,
  historyFranchiseId,
  releasedRookieSeasons,
} from '@keeper/test-fixtures';
import { buildPlayerAssetTimeline, type SeasonAssetRecord } from './asset-timeline.js';

const scenario = createKeeperHistoryScenario();

describe('the eighth-round rookie kept through rounds 7, 6, 5 and 4', () => {
  const timeline = buildPlayerAssetTimeline({
    playerId: scenario.playerId,
    fullName: scenario.fullName,
    records: scenario.seasons,
  });

  it('records the draft and every keeper season in order', () => {
    expect(timeline.events.map((event) => [event.seasonYear, event.type])).toEqual([
      [2021, 'drafted'],
      [2022, 'kept'],
      [2023, 'kept'],
      [2024, 'kept'],
      [2025, 'kept'],
    ]);
  });

  it('tracks the cost climbing one round a season', () => {
    // The first keeper season advances from his draft cost, not from nothing: an
    // eighth-round pick in 2021 becomes a seventh-round keeper in 2022.
    expect(timeline.keeperCostHistory).toEqual([
      { seasonYear: 2022, costRound: 7, advancedBy: 1 },
      { seasonYear: 2023, costRound: 6, advancedBy: 1 },
      { seasonYear: 2024, costRound: 5, advancedBy: 1 },
      { seasonYear: 2025, costRound: 4, advancedBy: 1 },
    ]);
    expect(timeline.diagnostics).toEqual([]);
  });

  it('counts four keeper seasons across five held', () => {
    expect(timeline.seasonsHeld).toBe(5);
    expect(timeline.keeperSeasons).toBe(4);
    expect(timeline.yearsRetainedByCurrentFranchise).toBe(5);
    expect(timeline.currentFranchiseId).toBe(historyFranchiseId);
    expect(timeline.endedInPool).toBe(false);
  });

  it('sums surplus over keeper seasons only, excluding the year he was drafted', () => {
    // (160-35) + (155-50) + (150-70) + (140-95) = 125 + 105 + 80 + 45
    expect(timeline.cumulativeKeeperSurplus).toBe(355);
    expect(timeline.keeperYield).toBeCloseTo(355 / 4);
  });

  it('shows the surplus narrowing as the keeper cost catches up', () => {
    const perSeason = scenario.seasons
      .filter((season) => season.acquisition === 'kept')
      .map((season) => season.realizedValue! - season.pickCostValue!);

    expect(perSeason).toEqual([125, 105, 80, 45]);
    expect(perSeason).toEqual([...perSeason].sort((left, right) => right - left));
  });

  it('reports draft ROI against the pick that originally bought him', () => {
    // 755 realised across five seasons against a 20-point eighth-round pick.
    expect(timeline.totalRealizedValue).toBe(755);
    expect(timeline.draftRoi).toBeCloseTo(755 / 20);
    expect(timeline.originalAcquisition).toEqual({
      seasonYear: 2021,
      type: 'drafted',
      costRound: 8,
    });
  });
});

describe('buildPlayerAssetTimeline', () => {
  it('records a return to the pool and clears the current owner', () => {
    const timeline = buildPlayerAssetTimeline({
      playerId: eighthRoundRookieId,
      fullName: eighthRoundRookieName,
      records: releasedRookieSeasons,
    });

    expect(timeline.events.at(-1)).toMatchObject({ type: 'returned_to_pool', seasonYear: 2024 });
    expect(timeline.endedInPool).toBe(true);
    expect(timeline.currentFranchiseId).toBeNull();
    expect(timeline.yearsRetainedByCurrentFranchise).toBe(0);
  });

  it('supports every lifecycle event', () => {
    const timeline = buildPlayerAssetTimeline({
      playerId: 'player-well-travelled' as PlayerId,
      fullName: 'Well Travelled',
      records: [
        record(2021, { acquisition: 'added' }),
        record(2022, { acquisition: 'kept', costRound: 10 }),
        record(2023, { acquisition: 'traded', fromFranchiseId: 'franchise-a' as FranchiseId }),
        record(2024, { acquisition: 'kept', costRound: 9, droppedDuringSeason: true }),
        record(2025, { acquisition: 're_drafted', overallPick: 30 }),
      ],
    });

    expect(timeline.events.map((event) => event.type)).toEqual([
      'added',
      'kept',
      'traded',
      'kept',
      'dropped',
      're_drafted',
    ]);
  });

  it('resets the cost baseline after a fresh acquisition instead of flagging it', () => {
    const timeline = buildPlayerAssetTimeline({
      playerId: 'player-redrafted' as PlayerId,
      fullName: 'Redrafted',
      records: [
        record(2023, { acquisition: 'kept', costRound: 6, realizedValue: 100, pickCostValue: 40 }),
        record(2024, { acquisition: 're_drafted', costRound: 12 }),
        record(2025, { acquisition: 'kept', costRound: 11, realizedValue: 90, pickCostValue: 20 }),
      ],
    });

    expect(timeline.diagnostics).toEqual([]);
    expect(timeline.keeperCostHistory.at(-1)).toEqual({
      seasonYear: 2025,
      costRound: 11,
      advancedBy: 1,
    });
  });

  it('flags a cost progression that breaks the league rule', () => {
    const timeline = buildPlayerAssetTimeline({
      playerId: 'player-odd' as PlayerId,
      fullName: 'Odd Progression',
      records: [
        record(2024, { acquisition: 'kept', costRound: 8, realizedValue: 10, pickCostValue: 0 }),
        record(2025, { acquisition: 'kept', costRound: 4, realizedValue: 10, pickCostValue: 0 }),
      ],
    });

    expect(timeline.diagnostics).toContainEqual(
      expect.objectContaining({ code: 'unexpected_cost_progression', seasonYear: 2025 }),
    );
  });

  it('says when a keeper season has no realised value rather than inventing one', () => {
    const timeline = buildPlayerAssetTimeline({
      playerId: 'player-unknown' as PlayerId,
      fullName: 'Unknown Value',
      records: [record(2025, { acquisition: 'kept', costRound: 5, realizedValue: null })],
    });

    expect(timeline.cumulativeKeeperSurplus).toBe(0);
    expect(timeline.diagnostics).toContainEqual(
      expect.objectContaining({ code: 'missing_realized_value' }),
    );
  });

  it('reports no draft ROI for a player who cost no pick', () => {
    const timeline = buildPlayerAssetTimeline({
      playerId: 'player-waiver' as PlayerId,
      fullName: 'Waiver Add',
      records: [record(2025, { acquisition: 'added', realizedValue: 120, pickCostValue: null })],
    });

    expect(timeline.draftRoi).toBeNull();
  });

  it('orders records by season regardless of input order', () => {
    const [ascending, descending] = [scenario.seasons, [...scenario.seasons].reverse()].map(
      (records) =>
        buildPlayerAssetTimeline({
          playerId: scenario.playerId,
          fullName: scenario.fullName,
          records,
        }),
    );

    expect(descending!.events).toEqual(ascending!.events);
    expect(descending!.cumulativeKeeperSurplus).toBe(ascending!.cumulativeKeeperSurplus);
  });
});

function record(seasonYear: number, overrides: Partial<SeasonAssetRecord> = {}): SeasonAssetRecord {
  return {
    seasonYear,
    seasonId: `season-${seasonYear}` as SeasonId,
    franchiseId: historyFranchiseId,
    acquisition: null,
    costRound: null,
    overallPick: null,
    realizedValue: 0,
    pickCostValue: 0,
    ...overrides,
  };
}
