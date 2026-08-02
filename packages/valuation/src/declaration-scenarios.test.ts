import { describe, expect, it } from 'vitest';
import type { LineupSettings, Position } from '@keeper/domain';
import {
  buildDeclarationScenarios,
  type DeclarationScenarioCandidate,
} from './declaration-scenarios.js';
import { computeReplacementLevels } from './replacement.js';

const lineup: LineupSettings = { qb: 1, rb: 2, wr: 2, te: 1, flex: 2, def: 1, bench: 6, ir: 0 };

const build = (position: Position, count: number, top: number, step: number) =>
  Array.from({ length: count }, (_, index) => ({
    position,
    projectedPoints: top - index * step,
    declared: false,
  }));

/**
 * A pool deep enough that a twelve team league leaves players unrostered.
 *
 * `declaredPerPosition` says how many of each position's best players are declared. Real
 * declarations land near the top of a position -- nobody keeps their twenty-fourth
 * quarterback -- and that matters, because a declaration beyond the depth the demand model
 * rosters is the one case where replacement level does move. See the boundary test below.
 */
function pool(
  declaredPerPosition: Partial<Record<Position, number>> = {},
): DeclarationScenarioCandidate[] {
  const byPosition: Record<string, DeclarationScenarioCandidate[]> = {
    QB: build('QB', 40, 400, 4),
    RB: build('RB', 90, 320, 2),
    WR: build('WR', 110, 300, 1.5),
    TE: build('TE', 60, 215, 2),
    DEF: build('DEF', 32, 120, 2),
  };

  for (const [position, count] of Object.entries(declaredPerPosition)) {
    for (const candidate of byPosition[position]!.slice(0, count)) {
      candidate.declared = true;
    }
  }
  return Object.values(byPosition).flat();
}

/** Thirty-two keepers spread the way a real twelve team league declares them. */
const realisticDeclarations: Partial<Record<Position, number>> = {
  QB: 4,
  RB: 12,
  WR: 12,
  TE: 4,
};

describe('buildDeclarationScenarios', () => {
  it('leaves replacement level untouched by declarations', () => {
    // The property the whole design rests on: a declaration removes a player and the roster
    // slot he fills together, so the waiver line does not move. If this drifted, the two
    // scenarios would not be comparable, because intrinsic value itself would differ.
    const none = buildDeclarationScenarios({ candidates: pool(), lineup, teamCount: 12 });
    const many = buildDeclarationScenarios({
      candidates: pool(realisticDeclarations),
      lineup,
      teamCount: 12,
    });

    expect(many.replacementLevels).toEqual(none.replacementLevels);
  });

  it('agrees with computing replacement over the whole pool directly', () => {
    const candidates = pool(realisticDeclarations);
    const scenarios = buildDeclarationScenarios({ candidates, lineup, teamCount: 12 });

    expect(scenarios.replacementLevels).toEqual(
      computeReplacementLevels({ candidates, lineup, teamCount: 12 }),
    );
  });

  it('makes every pick buy less once declarations are assumed to hold', () => {
    const scenarios = buildDeclarationScenarios({
      candidates: pool(realisticDeclarations),
      lineup,
      teamCount: 12,
    });

    for (const pick of [1, 12, 36, 84, 120]) {
      expect(scenarios.assumingDeclarations.getValueForPick(pick)).toBeLessThan(
        scenarios.ignoringDeclarations.getValueForPick(pick),
      );
    }
  });

  it('collapses to one answer when nobody has declared', () => {
    const scenarios = buildDeclarationScenarios({ candidates: pool(), lineup, teamCount: 12 });

    for (const pick of [1, 12, 36, 84, 120]) {
      expect(scenarios.assumingDeclarations.getValueForPick(pick)).toBe(
        scenarios.ignoringDeclarations.getValueForPick(pick),
      );
    }
  });

  it('does move replacement when a declaration falls outside rostered depth', () => {
    // The stated limit of the invariance above, pinned so it is a known property rather
    // than a surprise.
    //
    // The demand model rosters a fixed number of players per position. Keeping someone it
    // would not have rostered -- a twenty-fourth quarterback in a one-quarterback league --
    // means a roster slot is occupied that the model handed to somebody else, and the
    // league is carrying one more player than the model thinks. Replacement drops by a
    // player as a result.
    //
    // Real declarations do not do this: managers keep players near the top of a position,
    // and against this league's live data the two scenarios agree to the decimal. The case
    // is recorded because a synthetic pool reaches it easily and a reader deserves to know
    // where the model's accounting stops being exact.
    const deep = pool({ QB: 30 });
    const shallow = pool({ QB: 4 });

    expect(
      buildDeclarationScenarios({ candidates: deep, lineup, teamCount: 12 }).replacementLevels.QB!,
    ).toBeLessThan(
      buildDeclarationScenarios({ candidates: shallow, lineup, teamCount: 12 }).replacementLevels
        .QB!,
    );
  });

  it('keeps both curves monotonic', () => {
    // A curve that rises with a later pick would price an early pick below a late one and
    // silently invert the cost of keeping someone.
    const scenarios = buildDeclarationScenarios({
      candidates: pool(realisticDeclarations),
      lineup,
      teamCount: 12,
    });

    for (const curve of [scenarios.ignoringDeclarations, scenarios.assumingDeclarations]) {
      for (let pick = 1; pick < 180; pick += 1) {
        expect(curve.getValueForPick(pick + 1)).toBeLessThanOrEqual(curve.getValueForPick(pick));
      }
    }
  });
});
