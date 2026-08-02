import { describe, expect, it } from 'vitest';
import type { KeeperOptimizationResult, ValuedKeeperCombination } from '@keeper/keeper-optimizer';
import { buildKeeperModes } from './keeper-modes.js';

/** A combination carrying only the fields this view model reads. */
function combination(overrides: Partial<ValuedKeeperCombination>): ValuedKeeperCombination {
  return {
    selectedKeeperRightIds: [],
    playerValuations: [],
    retainedIntrinsicValue: 0,
    consumedPickValue: 0,
    keeperSurplusValue: 0,
    teamContextValue: 0,
    futureKeeperOptionValue: 0,
    modeScores: { expected: 0, safest: 0, win_now: 0, future: 0 },
    ...overrides,
  } as ValuedKeeperCombination;
}

/** The shape this league actually produces: cost is real, context components are zero. */
function realisticResult(): KeeperOptimizationResult {
  const cheap = combination({
    selectedKeeperRightIds: ['a', 'b'] as never,
    retainedIntrinsicValue: 229,
    consumedPickValue: 58,
    keeperSurplusValue: 171,
    teamContextValue: 171,
    futureKeeperOptionValue: 0,
    modeScores: { expected: 171, safest: 171, win_now: 229, future: 171 },
  });
  const expensive = combination({
    selectedKeeperRightIds: ['a', 'c'] as never,
    retainedIntrinsicValue: 265,
    consumedPickValue: 132,
    keeperSurplusValue: 133,
    teamContextValue: 133,
    futureKeeperOptionValue: 0,
    modeScores: { expected: 133, safest: 133, win_now: 265, future: 133 },
  });

  return {
    combinations: [cheap, expensive],
    bestByMode: { expected: cheap, safest: cheap, win_now: expensive, future: cheap },
  };
}

describe('buildKeeperModes', () => {
  it('names the quantity each mode maximises, so a score can be read in its own units', () => {
    const rows = buildKeeperModes(realisticResult()).rows;

    expect(rows.map((row) => [row.mode, row.optimises])).toEqual([
      ['expected', 'Team context value'],
      ['safest', 'Keeper surplus value'],
      ['win_now', 'Retained intrinsic value'],
      ['future', 'Team context value + future option'],
    ]);
  });

  it('carries the components beside the score so win-now is legible', () => {
    // Win-now reads 265 against safest 171, which looks like a better answer rather than a
    // different unit. The components are what make it readable: 265 buys a 132-point pick.
    const winNow = buildKeeperModes(realisticResult()).rows.find((row) => row.mode === 'win_now')!;

    expect(winNow.score).toBe(265);
    expect(winNow.retainedIntrinsicValue).toBe(265);
    expect(winNow.consumedPickValue).toBe(132);
    expect(winNow.keeperSurplusValue).toBe(133);
  });

  it('says win-now is on a different scale whenever a pick is actually spent', () => {
    const notes = buildKeeperModes(realisticResult()).notes;

    expect(notes.some((note) => /different scale/i.test(note))).toBe(true);
  });

  it('reports which modes chose the same set rather than leaving it to be spotted', () => {
    const rows = buildKeeperModes(realisticResult()).rows;

    expect(rows.find((row) => row.mode === 'expected')!.agreesWith).toEqual(['safest', 'future']);
    expect(rows.find((row) => row.mode === 'win_now')!.agreesWith).toEqual([]);
  });

  it('explains that unmodelled components are why three modes collapse', () => {
    // Four identical rows read as four strategies agreeing. They are one calculation printed
    // four times, and the reason is that the components separating them are still zero.
    const notes = buildKeeperModes(realisticResult()).notes;

    expect(notes.some((note) => /future keeper option value is not modelled/i.test(note))).toBe(
      true,
    );
    expect(notes.some((note) => /team context components are not modelled/i.test(note))).toBe(true);
  });

  it('drops those notes once the components carry real values', () => {
    // Derived from the numbers rather than asserted, so modelling a component removes its
    // note without anyone remembering to.
    const modelled = combination({
      retainedIntrinsicValue: 229,
      consumedPickValue: 58,
      keeperSurplusValue: 171,
      teamContextValue: 190,
      futureKeeperOptionValue: 12,
      modeScores: { expected: 190, safest: 171, win_now: 229, future: 202 },
    });
    const notes = buildKeeperModes({
      combinations: [modelled],
      bestByMode: {
        expected: modelled,
        safest: modelled,
        win_now: modelled,
        future: modelled,
      },
    }).notes;

    expect(notes.some((note) => /not modelled/i.test(note))).toBe(false);
  });

  it('skips a mode that found no legal set', () => {
    const result: KeeperOptimizationResult = {
      combinations: [],
      bestByMode: { expected: null, safest: null, win_now: null, future: null },
    };

    expect(buildKeeperModes(result).rows).toEqual([]);
    expect(buildKeeperModes(result).notes).toEqual([]);
  });
});
