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
import { buildBoards } from './boards.js';

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
  lineup,
  teamCount: 1,
};

describe('buildBoards', () => {
  it('returns the three boards in reading order', () => {
    const boards = buildBoards({ ...baseInput, declaredKeeperRights: [], selections: [] });

    expect(boards.map((board) => board.mode)).toEqual(['pre_keeper', 'post_keeper', 'live']);
  });

  it('keeps the whole pool on the pre-keeper board', () => {
    const [preKeeper] = buildBoards({
      ...baseInput,
      declaredKeeperRights: [keeperRight('p-1')],
      selections: [selection('s-2')],
    });

    expect(preKeeper!.board.availablePlayerCount).toBe(3);
  });

  it('removes declared keepers from the post-keeper pool only', () => {
    const [, postKeeper] = buildBoards({
      ...baseInput,
      declaredKeeperRights: [keeperRight('p-1')],
      selections: [],
    });

    expect(postKeeper!.board.availablePlayerCount).toBe(2);
    expect(postKeeper!.board.rows.some((row) => row.fullName === 'Kept Star')).toBe(false);
    expect(postKeeper!.poolDescription).toContain('1 declared keeper');
  });

  it('removes recorded picks from the live pool', () => {
    const [, , live] = buildBoards({
      ...baseInput,
      declaredKeeperRights: [],
      selections: [selection('s-2')],
    });

    expect(live!.board.rows.some((row) => row.fullName === 'Drafted Star')).toBe(false);
    expect(live!.board.availablePlayerCount).toBe(2);
  });

  it('does not let a keeper placeholder collide with a real selection', () => {
    const [, postKeeper] = buildBoards({
      ...baseInput,
      declaredKeeperRights: [keeperRight('p-1'), keeperRight('p-2', 'keeper-2', 10)],
      selections: [],
    });

    // Both keepers are removed, so neither placeholder overwrote the other.
    expect(postKeeper!.board.availablePlayerCount).toBe(1);
    expect(postKeeper!.board.rows[0]).toMatchObject({ fullName: 'Still Free' });
  });

  it('says plainly when a board is limited by what is not yet modelled', () => {
    const [preKeeper, postKeeper] = buildBoards({
      ...baseInput,
      declaredKeeperRights: [],
      selections: [],
    });

    expect(preKeeper!.caveats[0]).toMatch(/entry probabilities are not modelled/i);
    expect(postKeeper!.caveats[0]).toMatch(/No keepers are declared/i);
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
