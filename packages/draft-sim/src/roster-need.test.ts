import { describe, expect, it } from 'vitest';
import type { LineupSettings } from '@keeper/domain';
import {
  DEFAULT_BENCH_ALLOWANCE,
  emptyCounts,
  mustPrioritiseStarters,
  needWeight,
  positionCap,
  unfilledStarterPositions,
  unfilledStarters,
  type PositionCounts,
} from './roster-need.js';

/** This league: 9 starters, 6 bench, IR excluded. */
const LINEUP: LineupSettings = {
  qb: 1,
  rb: 2,
  wr: 2,
  te: 1,
  flex: 2,
  def: 1,
  bench: 6,
  ir: 2,
};

function counts(overrides: Partial<PositionCounts> = {}): PositionCounts {
  return { ...emptyCounts(), ...overrides };
}

describe('positionCap', () => {
  it('allows exactly one defence', () => {
    // Twelve are needed league-wide and thirty-two exist, so the position is streamed.
    // Two on one roster is the outcome best-available produces and no manager would.
    expect(positionCap('DEF', LINEUP)).toBe(1);
  });

  it('allows a single backup quarterback in a one-quarterback league', () => {
    expect(positionCap('QB', LINEUP)).toBe(2);
  });

  it('gives the flex positions room for the flex slots and a bench', () => {
    expect(positionCap('RB', LINEUP)).toBe(2 + 2 + 4);
    expect(positionCap('WR', LINEUP)).toBe(2 + 2 + 4);
    expect(positionCap('TE', LINEUP)).toBe(1 + 2 + 1);
  });

  it('honours a caller-supplied allowance', () => {
    expect(positionCap('DEF', LINEUP, { ...DEFAULT_BENCH_ALLOWANCE, DEF: 1 })).toBe(2);
  });
});

describe('unfilledStarters', () => {
  it('counts only dedicated starting slots', () => {
    expect(unfilledStarters(LINEUP, counts())).toBe(1 + 2 + 2 + 1 + 1);
    expect(unfilledStarters(LINEUP, counts({ QB: 1, RB: 2, WR: 2, TE: 1, DEF: 1 }))).toBe(0);
  });

  it('does not go negative when a position is overfilled', () => {
    expect(unfilledStarters(LINEUP, counts({ RB: 6 }))).toBe(1 + 2 + 1 + 1);
  });
});

describe('needWeight', () => {
  const at = (position: Parameters<typeof needWeight>[0], held: PositionCounts, picks = 10) =>
    needWeight(position, { lineup: LINEUP, counts: held, picksRemaining: picks });

  it('is zero once the position is capped', () => {
    expect(at('DEF', counts({ DEF: 1 }))).toBe(0);
    expect(at('QB', counts({ QB: 2 }))).toBe(0);
  });

  it('is positive while a position still has room', () => {
    expect(at('DEF', counts())).toBeGreaterThan(0);
    expect(at('QB', counts({ QB: 1 }))).toBeGreaterThan(0);
  });

  it('wants an unfilled starter more than a bench body', () => {
    const starterMissing = at('TE', counts());
    const benchOnly = at('TE', counts({ TE: 1, RB: 2, WR: 2 }));
    expect(starterMissing).toBeGreaterThan(benchOnly);
  });

  it('presses harder when picks are scarce against the slots left to fill', () => {
    // The same empty roster, but one team has two picks left and the other has twelve.
    const pickPoor = at('RB', counts(), 2);
    const pickRich = at('RB', counts(), 12);
    expect(pickPoor).toBeGreaterThan(pickRich);
  });

  it('does not tell a team missing a tight end that it needs a fourth back', () => {
    // Dedicated slots full at RB and WR, tight end still empty: flex should not fire for RB.
    const held = counts({ RB: 2, WR: 2, TE: 0 });
    expect(at('TE', held)).toBeGreaterThan(at('RB', held));
  });

  it('names the starting slots still empty', () => {
    expect(unfilledStarterPositions(LINEUP, counts({ QB: 1, RB: 2, DEF: 1 }))).toEqual([
      'WR',
      'TE',
    ]);
    expect(
      unfilledStarterPositions(LINEUP, counts({ QB: 1, RB: 2, WR: 2, TE: 1, DEF: 1 })),
    ).toEqual([]);
  });

  it('switches to starters only once picks run short of empty slots', () => {
    const input = (picksRemaining: number, held = counts()) => ({
      lineup: LINEUP,
      counts: held,
      picksRemaining,
    });

    // Seven starting slots empty. Ten picks is comfortable; six is not.
    expect(mustPrioritiseStarters(input(10))).toBe(false);
    expect(mustPrioritiseStarters(input(6))).toBe(true);
    // A full starting lineup is never under the line, however few picks are left.
    expect(mustPrioritiseStarters(input(1, counts({ QB: 1, RB: 2, WR: 2, TE: 1, DEF: 1 })))).toBe(
      false,
    );
  });

  it('keeps need a tilt rather than an override', () => {
    // Even the strongest need stays within a band that intrinsic value can outweigh.
    const strongest = at('TE', counts(), 1);
    const weakest = at('RB', counts({ RB: 4, WR: 2, TE: 1 }), 12);
    expect(strongest / weakest).toBeLessThan(3);
  });
});
