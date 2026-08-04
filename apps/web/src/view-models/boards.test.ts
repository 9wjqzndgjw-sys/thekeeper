import { describe, expect, it } from 'vitest';
import type {
  FranchiseId,
  KeeperRight,
  KeeperRightId,
  LineupSettings,
  Player,
  PlayerId,
  PlayerSeason,
  SeasonId,
} from '@keeper/domain';
import type { TrackedSelection } from '@keeper/draft-tracker';
import {
  createPickValueCurveFromRankedValues,
  createProjectionSourceFromPlayerSeasons,
} from '@keeper/valuation';
import { buildBoards, type BoardMode } from './boards.js';

const seasonId = 'season-2026' as SeasonId;
const franchiseId = 'franchise-1' as FranchiseId;
const lineup: LineupSettings = { qb: 1, rb: 1, wr: 1, te: 0, flex: 0, def: 0, bench: 0, ir: 0 };

const players: Player[] = [
  { id: 'p-1' as PlayerId, fullName: 'Kept Star', position: 'QB', sleeperPlayerId: 's-1' },
  { id: 'p-2' as PlayerId, fullName: 'Drafted Star', position: 'RB', sleeperPlayerId: 's-2' },
  { id: 'p-3' as PlayerId, fullName: 'Still Free', position: 'WR', sleeperPlayerId: 's-3' },
];

const playerSeasons: PlayerSeason[] = players.map((player, index) => ({
  playerId: player.id,
  seasonId,
  nflTeam: 'SYN',
  age: 25,
  role: 'starter',
  injuryStatus: null,
  projectedPoints: 300 - index * 50,
  actualPoints: null,
  averageDraftPosition: null,
}));

const baseInput = {
  players,
  seasonId,
  franchiseId,
  projectionSource: createProjectionSourceFromPlayerSeasons(playerSeasons),
  pickValueCurveIgnoringDeclarations: createPickValueCurveFromRankedValues(
    Array.from({ length: 30 }, () => 10),
  ),
  pickValueCurveAssumingDeclarations: createPickValueCurveFromRankedValues(
    Array.from({ length: 30 }, () => 10),
  ),
  pickValueCurveAssumingExpected: createPickValueCurveFromRankedValues(
    Array.from({ length: 30 }, () => 10),
  ),
  declaredKeeperRights: [] as KeeperRight[],
  lineup,
  teamCount: 1,
};

describe('buildBoards', () => {
  // Selected by mode rather than by position: a board added in the middle should not
  // silently repoint an assertion at a different pool.
  const board = (input: Parameters<typeof buildBoards>[0], mode: BoardMode) =>
    buildBoards(input).find((candidate) => candidate.mode === mode)!;

  it('returns the four boards in reading order', () => {
    const boards = buildBoards({ ...baseInput, expectedKeeperRights: [], selections: [] });

    expect(boards.map((entry) => entry.mode)).toEqual([
      'pre_keeper',
      'as_declared',
      'expected',
      'live',
    ]);
  });

  it('keeps the whole pool on the pre-keeper board', () => {
    const preKeeper = board(
      {
        ...baseInput,
        declaredKeeperRights: [keeperRight('p-1')],
        expectedKeeperRights: [keeperRight('p-1')],
        selections: [selection('s-2')],
      },
      'pre_keeper',
    );

    expect(preKeeper.board.availablePlayerCount).toBe(3);
  });

  it('removes only what was actually declared from the as-declared pool', () => {
    // The two keeper boards answer different questions, so they must be able to disagree:
    // here a manager has declared nobody while the model expects him to keep someone.
    const input = {
      ...baseInput,
      declaredKeeperRights: [] as KeeperRight[],
      expectedKeeperRights: [keeperRight('p-1')],
      selections: [],
    };

    expect(board(input, 'as_declared').board.availablePlayerCount).toBe(3);
    expect(board(input, 'expected').board.availablePlayerCount).toBe(2);
  });

  it('removes expected keepers from the expected pool', () => {
    const expected = board(
      {
        ...baseInput,
        declaredKeeperRights: [],
        expectedKeeperRights: [keeperRight('p-1')],
        selections: [],
      },
      'expected',
    );

    expect(expected.board.availablePlayerCount).toBe(2);
    expect(expected.board.rows.some((row) => row.fullName === 'Kept Star')).toBe(false);
    expect(expected.poolDescription).toContain('1 keeper(s)');
  });

  it('removes recorded picks from the live pool', () => {
    const live = board(
      { ...baseInput, expectedKeeperRights: [], selections: [selection('s-2')] },
      'live',
    );

    expect(live.board.rows.some((row) => row.fullName === 'Drafted Star')).toBe(false);
    expect(live.board.availablePlayerCount).toBe(2);
  });

  it('keeps declared keepers off the live board as well as recorded picks', () => {
    // The live board is what gets read during a draft. Built from selections alone it opened
    // on the whole pool -- headed by whichever keeper was the best player in the league, a
    // recommendation for somebody nobody can draft.
    const live = board(
      {
        ...baseInput,
        declaredKeeperRights: [keeperRight('p-1')],
        expectedKeeperRights: [keeperRight('p-1')],
        selections: [],
      },
      'live',
    );

    expect(live.board.rows.some((row) => row.fullName === 'Kept Star')).toBe(false);
    expect(live.board.availablePlayerCount).toBe(2);
    expect(live.caveats[0]).toMatch(/no picks have been recorded/i);
  });

  it('shows a forecast keeper his manager did not declare', () => {
    // The live board must not hide a draftable player behind a prediction. If the optimizer
    // said someone should be kept and his manager released him instead, he is in the draft,
    // and a board that removed him would quietly deny a real pick.
    const live = board(
      {
        ...baseInput,
        declaredKeeperRights: [],
        expectedKeeperRights: [keeperRight('p-1')],
        selections: [],
      },
      'live',
    );

    expect(live.board.rows.some((row) => row.fullName === 'Kept Star')).toBe(true);
    expect(live.board.availablePlayerCount).toBe(3);
  });

  it('removes declared keepers and recorded picks together once the draft is running', () => {
    const live = board(
      {
        ...baseInput,
        declaredKeeperRights: [keeperRight('p-1')],
        expectedKeeperRights: [],
        selections: [selection('s-2')],
      },
      'live',
    );

    expect(live.board.availablePlayerCount).toBe(1);
    expect(live.board.rows[0]).toMatchObject({ fullName: 'Still Free' });
    expect(live.caveats).toEqual([]);
  });

  it('does not let a keeper placeholder collide with a real selection', () => {
    const expected = board(
      {
        ...baseInput,
        declaredKeeperRights: [],
        expectedKeeperRights: [keeperRight('p-1'), keeperRight('p-2', 'keeper-2', 10)],
        selections: [],
      },
      'expected',
    );

    // Both keepers are removed, so neither placeholder overwrote the other.
    expect(expected.board.availablePlayerCount).toBe(1);
    expect(expected.board.rows[0]).toMatchObject({ fullName: 'Still Free' });
  });

  it('says plainly when a board is limited by what is not yet modelled', () => {
    const input = {
      ...baseInput,
      declaredKeeperRights: [] as KeeperRight[],
      expectedKeeperRights: [],
      selections: [],
    };

    expect(board(input, 'pre_keeper').caveats[0]).toMatch(/entry probabilities are not modelled/i);
    expect(board(input, 'as_declared').caveats[0]).toMatch(/Nobody has declared/i);
    expect(board(input, 'expected').caveats[0]).toMatch(/forecast, not a record/i);
  });
});

function keeperRight(playerId: string, id = 'keeper-1', nominalRound = 4): KeeperRight {
  return {
    id: id as KeeperRightId,
    seasonId,
    playerId: playerId as PlayerId,
    franchiseId,
    sourceType: 'kept',
    nominalRound,
    priorSeasonRound: null,
    effectiveOverallPick: null,
    confidence: 'confirmed',
    manualOverrideReason: null,
  };
}

function selection(sleeperPlayerId: string): TrackedSelection {
  return {
    draftId: 'draft-1',
    overallPick: 1,
    round: 1,
    slot: 1,
    rosterId: 1,
    playerId: sleeperPlayerId,
    isKeeper: false,
    source: 'api',
    recordedAt: '2026-08-30T18:00:00.000Z',
  };
}
