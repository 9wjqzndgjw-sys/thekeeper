import { describe, expect, it } from 'vitest';
import type { FranchiseId, Position } from '@keeper/domain';
import {
  buildDraftMarket,
  marketWeight,
  positionalSharesByRound,
  type HistoricalSelection,
} from './market.js';

function pick(
  round: number,
  position: Position,
  franchiseId: string | null = 'f1',
  seasonYear = 2025,
  isKeeper = false,
): HistoricalSelection {
  return { seasonYear, round, franchiseId, position, isKeeper };
}

/** Defences only ever late, running backs only ever early. */
function polarisedHistory(): HistoricalSelection[] {
  const selections: HistoricalSelection[] = [];
  for (let season = 2021; season <= 2025; season += 1) {
    for (let n = 0; n < 12; n += 1) {
      selections.push(pick(1, 'RB', `f${n}`, season));
      selections.push(pick(2, 'RB', `f${n}`, season));
      selections.push(pick(14, 'DEF', `f${n}`, season));
      selections.push(pick(15, 'DEF', `f${n}`, season));
    }
  }
  return selections;
}

describe('buildDraftMarket', () => {
  it('is neutral and says so when there is no history', () => {
    const market = buildDraftMarket({ selections: [], rounds: 15 });

    expect(market.picksObserved).toBe(0);
    expect(marketWeight(market, 'DEF', 1, null, 1)).toBe(1);
    expect(market.notes.join(' ')).toMatch(/No past drafts/);
  });

  it('learns that a position goes late', () => {
    const market = buildDraftMarket({ selections: polarisedHistory(), rounds: 15 });

    const early = marketWeight(market, 'DEF', 1, null, 1);
    const late = marketWeight(market, 'DEF', 15, null, 1);
    expect(late).toBeGreaterThan(early);
  });

  it('learns that a position goes early', () => {
    const market = buildDraftMarket({ selections: polarisedHistory(), rounds: 15 });

    expect(marketWeight(market, 'RB', 1, null, 1)).toBeGreaterThan(
      marketWeight(market, 'RB', 15, null, 1),
    );
  });

  it('ignores keepers, which are not market decisions', () => {
    // A keeper at round 2 was priced years earlier; counting it would read as the league
    // drafting tight ends early.
    const withKeepers = [
      ...polarisedHistory(),
      ...Array.from({ length: 40 }, () => pick(2, 'TE', 'f1', 2025, true)),
    ];

    const plain = buildDraftMarket({ selections: polarisedHistory(), rounds: 15 });
    const keepered = buildDraftMarket({ selections: withKeepers, rounds: 15 });

    expect(keepered.picksObserved).toBe(plain.picksObserved);
    expect(marketWeight(keepered, 'TE', 2, null, 1)).toBeCloseTo(
      marketWeight(plain, 'TE', 2, null, 1),
    );
  });

  it('never rules a position out entirely, however one-sided the record', () => {
    // No defence was ever taken in round one across five seasons, but that is forty-odd
    // observations, not a law.
    const market = buildDraftMarket({ selections: polarisedHistory(), rounds: 15 });

    expect(marketWeight(market, 'DEF', 1, null, 1)).toBeGreaterThan(0);
  });

  it('groups rounds, because per-round cells are too thin to carry a multiplier', () => {
    const market = buildDraftMarket({
      selections: polarisedHistory(),
      rounds: 15,
      roundsPerBucket: 5,
    });

    // Rounds inside one bucket share a bias; rounds across buckets do not.
    expect(marketWeight(market, 'DEF', 11, null, 1)).toBe(marketWeight(market, 'DEF', 15, null, 1));
    expect(marketWeight(market, 'DEF', 1, null, 1)).not.toBe(
      marketWeight(market, 'DEF', 15, null, 1),
    );
  });

  it('measures against a value baseline rather than raw share when one is given', () => {
    // Value alone already takes running backs first, so history doing the same says nothing
    // new and the bias should stay near neutral.
    const baseline = new Map<number, Record<Position, number>>();
    for (let round = 1; round <= 15; round += 1) {
      baseline.set(
        round,
        round <= 5
          ? { QB: 0, RB: 1, WR: 0, TE: 0, DEF: 0 }
          : { QB: 0, RB: 0, WR: 0, TE: 0, DEF: 1 },
      );
    }

    const calibrated = buildDraftMarket({
      selections: polarisedHistory(),
      rounds: 15,
      valueBaseline: baseline,
    });
    const raw = buildDraftMarket({ selections: polarisedHistory(), rounds: 15 });

    expect(marketWeight(calibrated, 'RB', 1, null, 1)).toBeLessThan(
      marketWeight(raw, 'RB', 1, null, 1),
    );
  });

  it('trusts a manager tendency in proportion to how much of it was seen', () => {
    // Two managers with the identical habit -- every pick a quarterback -- seen three times
    // and sixty times. The habit is the same; the evidence for it is not.
    const selections = [
      ...polarisedHistory(),
      ...Array.from({ length: 3 }, () => pick(5, 'QB', 'thin', 2025)),
      ...Array.from({ length: 60 }, () => pick(5, 'QB', 'thick', 2025)),
    ];
    const market = buildDraftMarket({ selections, rounds: 15, managerConfidencePicks: 60 });

    const thin = market.managerTendencies.get('thin' as FranchiseId)!;
    const thick = market.managerTendencies.get('thick' as FranchiseId)!;

    expect(thin.picksObserved).toBe(3);
    expect(thick.picksObserved).toBe(60);
    // Both lean the same way, but the thin record leans far less far.
    expect(thin.positionBias.QB).toBeGreaterThan(1);
    expect(thick.positionBias.QB).toBeGreaterThan(thin.positionBias.QB);
    expect(thin.positionBias.QB - 1).toBeLessThan((thick.positionBias.QB - 1) / 5);
  });

  it('leaves a manager with no record at league-average', () => {
    const market = buildDraftMarket({ selections: polarisedHistory(), rounds: 15 });

    expect(market.managerTendencies.has('never-played' as FranchiseId)).toBe(false);
    expect(marketWeight(market, 'RB', 1, 'never-played' as FranchiseId, 1)).toBe(
      marketWeight(market, 'RB', 1, null, 1),
    );
  });

  it('treats influence as an exponent, so lowering it moves toward neutral', () => {
    const market = buildDraftMarket({ selections: polarisedHistory(), rounds: 15 });

    const full = marketWeight(market, 'DEF', 15, null, 1);
    const half = marketWeight(market, 'DEF', 15, null, 0.5);
    expect(half).toBeLessThan(full);
    expect(half).toBeGreaterThan(1);
    expect(marketWeight(market, 'DEF', 15, null, 0)).toBe(1);
  });
});

describe('positionalSharesByRound', () => {
  it('reports each round as proportions that sum to one', () => {
    const shares = positionalSharesByRound(
      [
        { round: 1, position: 'RB', isKeeper: false },
        { round: 1, position: 'RB', isKeeper: false },
        { round: 1, position: 'WR', isKeeper: false },
      ],
      2,
    );

    expect(shares.get(1)!.RB).toBeCloseTo(2 / 3);
    expect(shares.get(1)!.WR).toBeCloseTo(1 / 3);
    // A round with nothing in it is all zeroes rather than a guess.
    expect(shares.get(2)!.RB).toBe(0);
  });

  it('leaves keepers out', () => {
    const shares = positionalSharesByRound(
      [
        { round: 1, position: 'RB', isKeeper: false },
        { round: 1, position: 'TE', isKeeper: true },
      ],
      1,
    );

    expect(shares.get(1)!.RB).toBe(1);
    expect(shares.get(1)!.TE).toBe(0);
  });
});
