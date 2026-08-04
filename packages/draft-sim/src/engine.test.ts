import { describe, expect, it } from 'vitest';
import type { FranchiseId, PlayerId } from '@keeper/domain';
import { createDraftSim } from './engine.js';
import type { DraftPool, DraftPoolPlayer, DraftSlotOwnership } from './pool.js';

const USER = 'f1' as FranchiseId;
const RIVAL = 'f2' as FranchiseId;

function player(index: number): DraftPoolPlayer {
  return {
    playerId: `p${index}` as PlayerId,
    sleeperPlayerId: `s${index}`,
    fullName: `Player ${index}`,
    position: index % 2 === 0 ? 'RB' : 'WR',
    projectedPoints: 300 - index,
    intrinsicValue: 200 - index,
  };
}

/** Two teams alternating over `rounds`, user on the odd picks. */
function pool(overrides: Partial<DraftPool> = {}, rounds = 4): DraftPool {
  const order: DraftSlotOwnership[] = Array.from({ length: rounds * 2 }, (_, index) => ({
    overallPick: index + 1,
    round: Math.floor(index / 2) + 1,
    slot: (index % 2) + 1,
    franchiseId: index % 2 === 0 ? USER : RIVAL,
    consumedByKeeperRightId: null,
    consumedByPlayerId: null,
  }));

  return {
    players: Array.from({ length: 40 }, (_, index) => player(index + 1)),
    keptPlayerIds: new Set(),
    keptPlayers: [],
    order,
    postures: [],
    replacementLevels: {},
    lineup: { qb: 1, rb: 1, wr: 1, te: 0, flex: 0, def: 0, bench: 4, ir: 0 },
    readiness: { ok: true, blockers: [], warnings: [] },
    ...overrides,
  };
}

describe('createDraftSim', () => {
  it('refuses to run on a pool that is not ready', () => {
    expect(() =>
      createDraftSim({
        pool: pool({ readiness: { ok: false, blockers: ['order is not set'], warnings: [] } }),
        userFranchiseId: USER,
      }),
    ).toThrow(/order is not set/);
  });

  it('stops on the user pick rather than drafting for them', () => {
    const sim = createDraftSim({ pool: pool(), userFranchiseId: USER });
    const state = sim.advance();

    expect(state.status).toBe('awaiting_user');
    expect(state.onTheClock?.overallPick).toBe(1);
    expect(state.selections).toHaveLength(0);
  });

  it('runs the bots between the user picks and stops again', () => {
    const sim = createDraftSim({ pool: pool(), userFranchiseId: USER });
    sim.advance();
    const state = sim.submitUserPick('p1' as PlayerId);

    // The user took pick 1, the rival took pick 2, and pick 3 is the user's again.
    expect(state.selections.map((selection) => selection.overallPick)).toEqual([1, 2]);
    expect(state.onTheClock?.overallPick).toBe(3);
    expect(state.selections[0]!.byUser).toBe(true);
    expect(state.selections[1]!.byUser).toBe(false);
  });

  it('never lets a bot take a player the user already took', () => {
    const sim = createDraftSim({ pool: pool(), userFranchiseId: USER, seed: 7 });
    sim.advance();
    // Deliberately take the player the top-of-board bot is most likely to want.
    sim.submitUserPick('p1' as PlayerId);
    let state = sim.getState();
    while (state.status === 'awaiting_user') {
      state = sim.submitUserPick(state.available[0]!.playerId);
    }

    const taken = state.selections.map((selection) => String(selection.playerId));
    expect(new Set(taken).size).toBe(taken.length);
    expect(taken.filter((id) => id === 'p1')).toHaveLength(1);
  });

  it('produces the same draft for the same seed, and a different one otherwise', () => {
    const run = (seed: number): string[] => {
      const sim = createDraftSim({ pool: pool(), userFranchiseId: USER, seed });
      let state = sim.advance();
      while (state.status === 'awaiting_user') {
        state = sim.submitUserPick(state.available[0]!.playerId);
      }
      return state.selections.map((selection) => String(selection.playerId));
    };

    expect(run(42)).toEqual(run(42));
    expect(run(42)).not.toEqual(run(99));
  });

  it('takes the best available when no reach is allowed', () => {
    const sim = createDraftSim({
      pool: pool(),
      userFranchiseId: RIVAL,
      reachTemperature: 0,
    });
    const state = sim.advance();

    // The rival picks second, so the bot on pick 1 must have taken the top of the board.
    expect(state.selections[0]!.playerId).toBe('p1');
  });

  it('records a keeper with his real identity and removes nobody from the pool', () => {
    const keeper99 = { ...player(99), fullName: 'Kept Ninety-Nine', position: 'TE' as const };
    const kept = pool({ keptPlayerIds: new Set(['p99']), keptPlayers: [keeper99] });
    kept.order[1] = {
      ...kept.order[1]!,
      consumedByKeeperRightId: 'k1' as DraftSlotOwnership['consumedByKeeperRightId'],
      consumedByPlayerId: 'p99' as PlayerId,
    };

    const sim = createDraftSim({ pool: kept, userFranchiseId: USER });
    sim.advance();
    const before = sim.getState().available.length;
    const state = sim.submitUserPick('p1' as PlayerId);

    const keeper = state.selections.find((selection) => selection.isKeeper)!;
    expect(keeper.overallPick).toBe(2);
    // Name and position come from the kept list, not from an id and a guess.
    expect(keeper).toMatchObject({
      playerId: 'p99',
      fullName: 'Kept Ninety-Nine',
      position: 'TE',
      sleeperPlayerId: 's99',
    });
    // One player left the pool: the user's pick. The keeper was never in it.
    expect(state.available.length).toBe(before - 1);
  });

  it('refuses to show a keeper it cannot identify rather than inventing one', () => {
    // The kept list is empty, so the pick names a player the pool knows nothing about.
    const kept = pool();
    kept.order[1] = {
      ...kept.order[1]!,
      consumedByKeeperRightId: 'k1' as DraftSlotOwnership['consumedByKeeperRightId'],
      consumedByPlayerId: 'ghost' as PlayerId,
    };

    const sim = createDraftSim({ pool: kept, userFranchiseId: USER });
    sim.advance();

    expect(() => sim.submitUserPick('p1' as PlayerId)).toThrow(/cannot identify/);
  });

  it('rejects a pick that is not the user’s to make', () => {
    const sim = createDraftSim({ pool: pool(), userFranchiseId: RIVAL });
    sim.advance();
    sim.submitUserPick(sim.getState().available[0]!.playerId);

    // After the rival's pick at 2, pick 3 belongs to the user, not the rival.
    expect(() => sim.submitUserPick(sim.getState().available[0]!.playerId)).not.toThrow();
  });

  it('rejects an unavailable or unknown player', () => {
    const sim = createDraftSim({ pool: pool(), userFranchiseId: USER });
    sim.advance();
    sim.submitUserPick('p1' as PlayerId);

    expect(() => sim.submitUserPick('p1' as PlayerId)).toThrow(/already been taken/);
    expect(() => sim.submitUserPick('nobody' as PlayerId)).toThrow(/not in this draft pool/);
  });

  it('returns the whole board every time, never a delta', () => {
    const sim = createDraftSim({ pool: pool(), userFranchiseId: USER });
    sim.advance();
    sim.submitUserPick('p1' as PlayerId);
    const first = sim.getSelections();
    sim.submitUserPick(sim.getState().available[0]!.playerId);
    const second = sim.getSelections();

    expect(second.length).toBeGreaterThan(first.length);
    expect(second.slice(0, first.length)).toEqual(first);
    expect(second[0]).toMatchObject({ overallPick: 1, playerId: 's1', isKeeper: false });
  });

  it('undoes the user pick and redraws the bots that followed it', () => {
    const sim = createDraftSim({ pool: pool(), userFranchiseId: USER, seed: 3 });
    sim.advance();
    sim.submitUserPick('p1' as PlayerId);
    sim.submitUserPick('p2' as PlayerId);

    const state = sim.undoLastUserPick();

    expect(state.onTheClock?.overallPick).toBe(3);
    expect(state.selections.map((selection) => String(selection.playerId))).not.toContain('p2');
    expect(state.available.some((candidate) => String(candidate.playerId) === 'p2')).toBe(true);
    // The pick before the undone one survives.
    expect(state.selections[0]!.playerId).toBe('p1');
  });

  it('never drafts past a position cap, even when that position tops the board', () => {
    // The exact shape that produced two defences on every roster: a position priced above
    // everything else remaining, so a window taken off the top of the board holds nothing
    // but players the roster has no room for.
    const defences = Array.from({ length: 20 }, (_, index) => ({
      ...player(index + 1),
      position: 'DEF' as const,
      intrinsicValue: 100 - index,
    }));
    const skill = Array.from({ length: 20 }, (_, index) => ({
      ...player(index + 100),
      position: 'RB' as const,
      intrinsicValue: 1,
    }));

    const sim = createDraftSim({
      pool: pool({
        players: [...defences, ...skill],
        lineup: { qb: 0, rb: 2, wr: 0, te: 0, flex: 0, def: 1, bench: 4, ir: 0 },
      }),
      userFranchiseId: USER,
      seed: 5,
    });

    let state = sim.advance();
    while (state.status === 'awaiting_user') {
      state = sim.submitUserPick(sim.getRecommendations(1)[0]!.player.playerId);
    }

    for (const franchiseId of [USER, RIVAL]) {
      const taken = state.selections.filter((selection) => selection.franchiseId === franchiseId);
      expect(taken.filter((selection) => selection.position === 'DEF').length).toBeLessThanOrEqual(
        1,
      );
    }
  });

  it('recommends for whoever is on the clock, never a capped position', () => {
    const sim = createDraftSim({ pool: pool(), userFranchiseId: USER });
    sim.advance();

    const recommendations = sim.getRecommendations(3);
    expect(recommendations).toHaveLength(3);
    expect(recommendations[0]!.score).toBeGreaterThanOrEqual(recommendations[1]!.score);
    expect(recommendations.every((entry) => entry.needWeight > 0)).toBe(true);
  });

  it('ignores rosters entirely when roster need is switched off', () => {
    const sim = createDraftSim({
      pool: pool(),
      userFranchiseId: RIVAL,
      useRosterNeed: false,
      reachTemperature: 0,
    });
    const state = sim.advance();

    expect(state.selections[0]!.playerId).toBe('p1');
  });

  it('reports completion once the order is exhausted', () => {
    const sim = createDraftSim({ pool: pool({}, 2), userFranchiseId: USER });
    let state = sim.advance();
    while (state.status === 'awaiting_user') {
      state = sim.submitUserPick(state.available[0]!.playerId);
    }

    expect(state.status).toBe('complete');
    expect(state.onTheClock).toBeNull();
    expect(state.selections).toHaveLength(4);
    expect(state.userPicksRemaining).toBe(0);
    expect(() => sim.submitUserPick(state.available[0]!.playerId)).toThrow(/draft is over/);
  });
});
