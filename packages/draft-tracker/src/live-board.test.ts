import { describe, expect, it } from 'vitest';
import type {
  FranchiseId,
  LineupSettings,
  Player,
  PlayerId,
  PlayerSeason,
  SeasonId,
} from '@keeper/domain';
import {
  createPickValueCurveFromRankedValues,
  createProjectionSourceFromPlayerSeasons,
} from '@keeper/valuation';
import { computeLiveDraftBoard } from './live-board.js';
import type { TrackedSelection } from './reconcile.js';

const seasonId = 'season-2026' as SeasonId;
const franchiseId = 'franchise-1' as FranchiseId;

const lineup: LineupSettings = { qb: 1, rb: 1, wr: 1, te: 0, flex: 0, def: 0, bench: 0, ir: 0 };

const players: Player[] = [
  player('qb-elite', 'Elite QB', 'QB', 'sleeper-1'),
  player('qb-good', 'Good QB', 'QB', 'sleeper-2'),
  player('qb-replacement', 'Replacement QB', 'QB', 'sleeper-3'),
  player('rb-elite', 'Elite RB', 'RB', 'sleeper-4'),
  player('rb-replacement', 'Replacement RB', 'RB', 'sleeper-5'),
  player('wr-one', 'Only WR', 'WR', 'sleeper-6'),
];

const playerSeasons: PlayerSeason[] = [
  projection('qb-elite', 400),
  projection('qb-good', 300),
  projection('qb-replacement', 200),
  projection('rb-elite', 250),
  projection('rb-replacement', 150),
  projection('wr-one', 180),
];

const projectionSource = createProjectionSourceFromPlayerSeasons(playerSeasons);
const pickValueCurve = createPickValueCurveFromRankedValues(
  Array.from({ length: 50 }, (_, index) => Math.max(0, 100 - index * 5)),
);

describe('computeLiveDraftBoard', () => {
  it('ranks every available player when nothing has been drafted', () => {
    const board = computeLiveDraftBoard(baseInput({ selections: [] }));

    expect(board.draftedPlayerCount).toBe(0);
    expect(board.availablePlayerCount).toBe(6);
    expect(board.rows[0]).toMatchObject({ rank: 1, fullName: 'Elite QB' });
    expect(board.rows.map((row) => row.rank)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it('drops drafted players off the board', () => {
    const board = computeLiveDraftBoard(
      baseInput({ selections: [selection({ overallPick: 1, playerId: 'sleeper-1' })] }),
    );

    expect(board.draftedPlayerCount).toBe(1);
    expect(board.rows.some((row) => row.fullName === 'Elite QB')).toBe(false);
    expect(board.availableCountByPosition.QB).toBe(2);
  });

  it('holds replacement level steady as the draft consumes supply and demand together', () => {
    // A draft does not thin the pool in isolation. Every pick removes a player *and* fills
    // the roster slot that created the demand for one, so the player who ends up last on
    // the waiver wire is the same one either way. A board that let replacement slide as
    // picks came in would inflate everyone still available, and the error would compound
    // through the rounds -- worst in the late rounds, when the board is leaned on most.
    const twoTeamLineup: LineupSettings = {
      qb: 1,
      rb: 1,
      wr: 1,
      te: 0,
      flex: 0,
      def: 0,
      bench: 0,
      ir: 0,
    };
    const deepPlayers: Player[] = [
      player('qb-1', 'QB One', 'QB', 'qb-1'),
      player('qb-2', 'QB Two', 'QB', 'qb-2'),
      player('qb-3', 'QB Three', 'QB', 'qb-3'),
      player('qb-4', 'QB Four', 'QB', 'qb-4'),
      player('rb-1', 'RB One', 'RB', 'rb-1'),
      player('rb-2', 'RB Two', 'RB', 'rb-2'),
      player('rb-3', 'RB Three', 'RB', 'rb-3'),
      player('wr-1', 'WR One', 'WR', 'wr-1'),
      player('wr-2', 'WR Two', 'WR', 'wr-2'),
      player('wr-3', 'WR Three', 'WR', 'wr-3'),
    ];
    const deepSource = createProjectionSourceFromPlayerSeasons([
      projection('qb-1', 400),
      projection('qb-2', 300),
      projection('qb-3', 200),
      projection('qb-4', 100),
      projection('rb-1', 250),
      projection('rb-2', 220),
      projection('rb-3', 190),
      projection('wr-1', 240),
      projection('wr-2', 210),
      projection('wr-3', 180),
    ]);
    const deepInput = (selections: TrackedSelection[]) =>
      baseInput({
        selections,
        players: deepPlayers,
        projectionSource: deepSource,
        lineup: twoTeamLineup,
        teamCount: 2,
      });

    // Two teams starting one quarterback each: replacement is the third-best, 200.
    const beforeRun = computeLiveDraftBoard(deepInput([]));
    expect(beforeRun.replacementLevels.QB).toBe(200);

    // Both quarterback slots in the league now filled. Two fewer quarterbacks available,
    // but two fewer needed, so the level does not move.
    const afterRun = computeLiveDraftBoard(
      deepInput([
        selection({ overallPick: 1, playerId: 'qb-1' }),
        selection({ overallPick: 2, playerId: 'qb-2' }),
      ]),
    );
    expect(afterRun.replacementLevels.QB).toBe(200);

    // And the player measured against it is worth the same before and after.
    const remainingBefore = beforeRun.rows.find((row) => row.fullName === 'QB Four');
    const remainingAfter = afterRun.rows.find((row) => row.fullName === 'QB Four');
    expect(remainingAfter!.intrinsicValue).toBe(remainingBefore!.intrinsicValue);

    // An untouched position is likewise unmoved.
    expect(afterRun.replacementLevels.RB).toBe(beforeRun.replacementLevels.RB);
  });

  it('reprices a position once the league has drafted past its need', () => {
    // Replacement holds while picks track demand, but a run genuinely past that demand is
    // different: with every starting spot filled and no bench, one more quarterback adds
    // nothing, so the last one standing sits at replacement rather than being worth his
    // whole projection.
    const board = computeLiveDraftBoard(
      baseInput({
        selections: [
          selection({ overallPick: 1, playerId: 'sleeper-1' }),
          selection({ overallPick: 2, playerId: 'sleeper-2' }),
        ],
      }),
    );

    expect(board.replacementLevels.QB).toBe(200);
    expect(board.rows.find((row) => row.fullName === 'Replacement QB')!.intrinsicValue).toBe(0);
  });

  it('is deterministic and does not depend on selection order', () => {
    const ascending = computeLiveDraftBoard(
      baseInput({
        selections: [
          selection({ overallPick: 1, playerId: 'sleeper-1' }),
          selection({ overallPick: 2, playerId: 'sleeper-4' }),
        ],
      }),
    );
    const descending = computeLiveDraftBoard(
      baseInput({
        selections: [
          selection({ overallPick: 2, playerId: 'sleeper-4' }),
          selection({ overallPick: 1, playerId: 'sleeper-1' }),
        ],
      }),
    );

    expect(descending).toEqual(ascending);
  });

  it('values a player at the pick the user actually holds', () => {
    const early = computeLiveDraftBoard(baseInput({ selections: [], userNextOverallPick: 1 }));
    const late = computeLiveDraftBoard(baseInput({ selections: [], userNextOverallPick: 20 }));

    const earlyTop = early.rows[0]!;
    const lateTop = late.rows[0]!;
    expect(earlyTop.intrinsicValue).toBe(lateTop.intrinsicValue);
    // The same player is worth more when the pick spent on him costs less.
    expect(lateTop.valueAtUserNextPick!).toBeGreaterThan(earlyTop.valueAtUserNextPick!);
  });

  it('leaves value at the next pick unset when no pick was supplied', () => {
    const board = computeLiveDraftBoard(baseInput({ selections: [] }));

    expect(board.rows.every((row) => row.valueAtUserNextPick === null)).toBe(true);
  });

  it('groups a clear value cliff into separate tiers', () => {
    const board = computeLiveDraftBoard(baseInput({ selections: [] }));

    expect(board.rows[0]!.tier).toBe(1);
    expect(board.rows.at(-1)!.tier).toBeGreaterThan(1);
    // Tiers never move backwards as rank increases.
    const tiers = board.rows.map((row) => row.tier);
    expect([...tiers].sort((a, b) => a - b)).toEqual(tiers);
  });

  it('matches a selection that carries the domain player id instead of a Sleeper id', () => {
    const board = computeLiveDraftBoard(
      baseInput({ selections: [selection({ overallPick: 1, playerId: 'qb-elite' })] }),
    );

    expect(board.rows.some((row) => row.fullName === 'Elite QB')).toBe(false);
    expect(board.unmatchedDraftedPlayerIds).toEqual([]);
  });

  it('reports drafted players the catalog cannot identify', () => {
    const board = computeLiveDraftBoard(
      baseInput({ selections: [selection({ overallPick: 1, playerId: 'sleeper-unknown' })] }),
    );

    expect(board.unmatchedDraftedPlayerIds).toEqual(['sleeper-unknown']);
    expect(board.availablePlayerCount).toBe(6);
  });

  it('honours a row limit without changing the ranking', () => {
    const full = computeLiveDraftBoard(baseInput({ selections: [] }));
    const limited = computeLiveDraftBoard(baseInput({ selections: [], limit: 2 }));

    expect(limited.rows).toEqual(full.rows.slice(0, 2));
    expect(limited.availablePlayerCount).toBe(6);
  });
});

function baseInput(
  overrides: Partial<Parameters<typeof computeLiveDraftBoard>[0]>,
): Parameters<typeof computeLiveDraftBoard>[0] {
  return {
    selections: [],
    players,
    seasonId,
    franchiseId,
    projectionSource,
    pickValueCurve,
    lineup,
    teamCount: 1,
    ...overrides,
  };
}

function player(id: string, fullName: string, position: Player['position'], sleeperId: string) {
  return { id: id as PlayerId, fullName, position, sleeperPlayerId: sleeperId };
}

function projection(playerId: string, projectedPoints: number): PlayerSeason {
  return {
    playerId: playerId as PlayerId,
    seasonId,
    nflTeam: 'SYN',
    age: 25,
    role: 'starter',
    injuryStatus: null,
    projectedPoints,
    actualPoints: null,
  };
}

function selection(overrides: Partial<TrackedSelection>): TrackedSelection {
  return {
    draftId: 'draft-1',
    overallPick: 1,
    round: 1,
    slot: 1,
    rosterId: 1,
    playerId: 'sleeper-1',
    isKeeper: false,
    source: 'api',
    recordedAt: '2026-08-30T18:00:00.000Z',
    ...overrides,
  };
}
