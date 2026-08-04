import { describe, expect, it } from 'vitest';
import type {
  DraftPickAsset,
  FranchiseId,
  KeeperRight,
  LeagueId,
  LeagueStateSnapshot,
  Player,
  PlayerId,
  SeasonId,
} from '@keeper/domain';
import { buildDraftPool } from './pool.js';

const seasonId = 'season:test' as SeasonId;
const TEAMS = 2;
const ROUNDS = 3;

/** Two teams, three rounds, snake. Small enough to reason about pick by pick. */
function snapshot(overrides: Partial<LeagueStateSnapshot> = {}): LeagueStateSnapshot {
  return {
    league: {
      id: 'league:test' as LeagueId,
      name: 'Test League',
      rulesVersion: 'test',
      rules: {
        teamCount: TEAMS,
        draftRounds: ROUNDS,
        thirdRoundReversal: false,
        maxKeepers: 2,
        keeperDurationIndefinite: true,
        keeperCostAdvancePerSeason: 1,
        undraftedKeeperRound: 3,
        keeperRightsTradeable: false,
        tradesProcessImmediately: true,
        keeperDeadlineDaysBeforeDraft: 7,
        keeperDeclarationsPublicPreDraft: true,
        draftOrderMethod: 'manual',
        toiletBowlAwardPick: { round: 1, slot: 1 },
        futurePicksTradeable: true,
      },
      scoring: {} as LeagueStateSnapshot['league']['scoring'],
      // One starter each plus one bench: three roster spots, matching three picks a team.
      lineup: { qb: 1, rb: 1, wr: 0, te: 0, flex: 0, def: 0, bench: 1, ir: 0 },
    },
    season: {
      id: seasonId,
      leagueId: 'league:test' as LeagueId,
      year: 2026,
      sleeperLeagueId: 'test',
      previousSleeperLeagueId: null,
      status: 'pre_draft',
      draftId: null,
      keeperDeadline: '',
      draftTime: '',
    },
    franchises: [
      { id: 'f1' as FranchiseId, leagueId: 'league:test' as LeagueId, displayName: 'One' },
      { id: 'f2' as FranchiseId, leagueId: 'league:test' as LeagueId, displayName: 'Two' },
    ],
    rosters: [],
    keeperRights: [],
    pickInventory: picks(),
    draft: null,
    draftSelections: [],
    playerSeasons: players().map((player, index) => ({
      playerId: player.id,
      seasonId,
      nflTeam: null,
      age: null,
      role: null,
      injuryStatus: null,
      projectedPoints: 200 - index * 10,
      actualPoints: null,
      averageDraftPosition: null,
    })),
    userFranchiseId: 'f1' as FranchiseId,
    evaluatedAt: '2026-08-01T00:00:00.000Z',
    assumptions: {},
    ...overrides,
  };
}

/** Snake order over two teams: 1,2 / 2,1 / 1,2. */
function picks(): DraftPickAsset[] {
  const owners: FranchiseId[][] = [
    ['f1', 'f2'] as FranchiseId[],
    ['f2', 'f1'] as FranchiseId[],
    ['f1', 'f2'] as FranchiseId[],
  ];
  return owners.flatMap((roundOwners, roundIndex) =>
    roundOwners.map((owner, slotIndex) => ({
      id: `pick-r${roundIndex + 1}-s${slotIndex + 1}` as DraftPickAsset['id'],
      seasonId,
      round: roundIndex + 1,
      originalFranchiseId: owner,
      currentFranchiseId: owner,
      slot: slotIndex + 1,
      overallPick: roundIndex * TEAMS + slotIndex + 1,
      ownershipConfidence: 'confirmed' as const,
    })),
  );
}

function players(): Player[] {
  return Array.from({ length: 8 }, (_, index) => ({
    id: `p${index + 1}` as PlayerId,
    fullName: `Player ${index + 1}`,
    position: index % 2 === 0 ? ('QB' as const) : ('RB' as const),
    sleeperPlayerId: `s${index + 1}`,
  }));
}

function right(
  id: string,
  playerId: string,
  franchiseId: string,
  nominalRound: number,
): KeeperRight {
  return {
    id: id as KeeperRight['id'],
    seasonId,
    playerId: playerId as PlayerId,
    franchiseId: franchiseId as FranchiseId,
    sourceType: 'drafted',
    nominalRound,
    priorSeasonRound: nominalRound + 1,
    effectiveOverallPick: null,
    confidence: 'confirmed',
    manualOverrideReason: null,
  };
}

describe('buildDraftPool', () => {
  it('is ready on a complete league and keeps every pick in the order', () => {
    const pool = buildDraftPool({
      snapshot: snapshot(),
      players: players(),
      declaredPlayerIds: new Set(),
    });

    expect(pool.readiness.ok).toBe(true);
    expect(pool.readiness.blockers).toEqual([]);
    expect(pool.order).toHaveLength(TEAMS * ROUNDS);
    expect(pool.order.map((slot) => slot.overallPick)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it('takes the pick owner from the inventory rather than the snake slot', () => {
    // Round 2 reverses, so overall pick 3 sits at slot 1 but belongs to f2.
    const pool = buildDraftPool({
      snapshot: snapshot(),
      players: players(),
      declaredPlayerIds: new Set(),
    });

    expect(pool.order.find((slot) => slot.overallPick === 3)).toMatchObject({
      slot: 1,
      franchiseId: 'f2',
    });
  });

  it('follows a traded pick to its new owner and counts it against that team', () => {
    const traded = picks().map((pick) =>
      pick.overallPick === 5 ? { ...pick, currentFranchiseId: 'f2' as FranchiseId } : pick,
    );
    const pool = buildDraftPool({
      snapshot: snapshot({ pickInventory: traded }),
      players: players(),
      declaredPlayerIds: new Set(),
    });

    expect(pool.order.find((slot) => slot.overallPick === 5)?.franchiseId).toBe('f2');
    const one = pool.postures.find((posture) => posture.displayName === 'One')!;
    const two = pool.postures.find((posture) => posture.displayName === 'Two')!;
    expect(one.picksOwned).toBe(2);
    expect(two.picksOwned).toBe(4);
    // Three roster spots against two picks leaves that team a player short.
    expect(one.rosterGap).toBe(1);
    expect(two.rosterGap).toBe(-1);
  });

  it('removes a declared keeper from the pool and marks the pick it consumes', () => {
    const rights = [right('k1', 'p1', 'f1', 3)];
    const pool = buildDraftPool({
      snapshot: snapshot({ keeperRights: rights }),
      players: players(),
      declaredPlayerIds: new Set(['p1']),
    });

    expect(pool.keptPlayerIds.has('p1')).toBe(true);
    expect(pool.players.map((player) => String(player.playerId))).not.toContain('p1');

    const consumed = pool.order.filter((slot) => slot.consumedByKeeperRightId !== null);
    expect(consumed).toHaveLength(1);
    expect(consumed[0]!.franchiseId).toBe('f1');
    expect(pool.postures.find((p) => p.displayName === 'One')!.keeperPicks).toBe(1);
  });

  it('leaves an undeclared keeper right in the pool', () => {
    // Every rostered player has a right; only a declaration takes someone off the board.
    const pool = buildDraftPool({
      snapshot: snapshot({ keeperRights: [right('k1', 'p1', 'f1', 3)] }),
      players: players(),
      declaredPlayerIds: new Set(),
    });

    expect(pool.keptPlayerIds.size).toBe(0);
    expect(pool.players.map((player) => String(player.playerId))).toContain('p1');
  });

  it('blocks when the draft order has not been set', () => {
    const unplaced = picks().map((pick) =>
      pick.overallPick === 4 ? { ...pick, overallPick: null, slot: null } : pick,
    );
    const pool = buildDraftPool({
      snapshot: snapshot({ pickInventory: unplaced }),
      players: players(),
      declaredPlayerIds: new Set(),
    });

    expect(pool.readiness.ok).toBe(false);
    expect(pool.readiness.blockers.join(' ')).toMatch(/no draft slot/);
  });

  it('blocks when the pool cannot fill the live selections', () => {
    const pool = buildDraftPool({
      snapshot: snapshot(),
      players: players().slice(0, 3),
      declaredPlayerIds: new Set(),
    });

    expect(pool.readiness.ok).toBe(false);
    expect(pool.readiness.blockers.join(' ')).toMatch(/run out before the draft ends/);
  });

  it('warns rather than blocks when ownership is only inferred', () => {
    const inferred = picks().map((pick) => ({ ...pick, ownershipConfidence: 'inferred' as const }));
    const pool = buildDraftPool({
      snapshot: snapshot({ pickInventory: inferred }),
      players: players(),
      declaredPlayerIds: new Set(),
    });

    expect(pool.readiness.ok).toBe(true);
    expect(pool.readiness.warnings.join(' ')).toMatch(/inferred or disputed/);
  });
});
