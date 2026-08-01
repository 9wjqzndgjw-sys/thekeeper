import { describe, expect, it } from 'vitest';
import {
  createSurplusMarketScenario,
  hoarderFranchiseId,
  surplusSeasonId,
} from '@keeper/test-fixtures';
import {
  createPickValueCurveFromRankedValues,
  createProjectionSourceFromPlayerSeasons,
} from '@keeper/valuation';
import { compareReleaseVsRedraft, type ReleaseVsRedraftInput } from './release-vs-redraft.js';

const scenario = createSurplusMarketScenario();
const hoarderRights = scenario.keeperRights.filter(
  (right) => right.franchiseId === hoarderFranchiseId,
);

// An early pick is expensive, a late one is cheap, so re-drafting a star at 1.01 costs
// real value while the same player at 1.08 costs less.
const pickValueCurve = createPickValueCurveFromRankedValues(
  Array.from({ length: 30 }, (_, index) => Math.max(0, 120 - index * 10)),
);

describe('compareReleaseVsRedraft', () => {
  it('lays out both paths of the decision tree', () => {
    const decision = compareReleaseVsRedraft(baseInput());

    expect(decision.keepPath.keeperRightIds).toContain(decision.keeperRightId);
    expect(decision.releasePath.keeperRightIds).not.toContain(decision.keeperRightId);
    expect(decision.releasePath.reacquireBranch.probability).toBeCloseTo(0.5);
    expect(decision.releasePath.missBranch.probability).toBeCloseTo(0.5);
    expect(decision.releasePath.expectedRedraftValue).toBeCloseTo(
      decision.releasePath.reacquireBranch.weighted + decision.releasePath.missBranch.weighted,
    );
    expect(decision.releasePath.total).toBeCloseTo(
      decision.releasePath.rosterValue + decision.releasePath.expectedRedraftValue,
    );
  });

  it('spends the freed slot on the next best keeper rather than leaving it empty', () => {
    const decision = compareReleaseVsRedraft(baseInput());

    // Six candidates, three slots: dropping one promotes the next in line.
    expect(decision.releasePath.keeperRightIds).toHaveLength(3);
    expect(decision.keepPath.keeperRightIds).toHaveLength(3);
    expect(decision.releasePath.keeperRightIds).not.toEqual(decision.keepPath.keeperRightIds);
  });

  it('treats a certain re-draft as free keeper-slot liberation', () => {
    const certain = compareReleaseVsRedraft(
      baseInput({ reacquisition: { probability: 1, overallPick: 1, fallbackValue: 0 } }),
    );

    expect(certain.releasePath.missBranch.weighted).toBe(0);
    expect(certain.assumptions.join(' ')).toMatch(/frees a keeper slot at no risk/i);
  });

  it('prefers keeping as the chance of getting him back falls', () => {
    const likely = compareReleaseVsRedraft(
      baseInput({ reacquisition: { probability: 0.9, overallPick: 5, fallbackValue: 10 } }),
    );
    const unlikely = compareReleaseVsRedraft(
      baseInput({ reacquisition: { probability: 0.1, overallPick: 5, fallbackValue: 10 } }),
    );

    expect(likely.advantageOfReleasing).toBeGreaterThan(unlikely.advantageOfReleasing);
  });

  it('reports a near-tie as too close to call instead of forcing a verdict', () => {
    // A certain re-draft at a cheap late pick makes releasing clearly correct.
    const decisive = baseInput({
      reacquisition: { probability: 1, overallPick: 8, fallbackValue: 0 },
    });
    const decision = compareReleaseVsRedraft(decisive);
    expect(decision.recommendation).toBe('release');
    expect(Math.abs(decision.advantageOfReleasing)).toBeGreaterThan(1);

    // Same numbers, but a tolerance wider than the gap: the engine should decline to call it.
    const tuned = compareReleaseVsRedraft({
      ...decisive,
      decisionMarginTolerance: Math.abs(decision.advantageOfReleasing) + 1,
    });

    expect(tuned.recommendation).toBe('too_close_to_call');
    expect(tuned.advantageOfReleasing).toBeCloseTo(decision.advantageOfReleasing);
  });

  it('keeps denial value out of the totals and says so', () => {
    const decision = compareReleaseVsRedraft(baseInput());

    expect(decision.assumptions.join(' ')).toMatch(/denial value is deliberately excluded/i);
    expect(decision).not.toHaveProperty('denialValue');
  });

  it('rejects an impossible probability', () => {
    expect(() =>
      compareReleaseVsRedraft(
        baseInput({ reacquisition: { probability: 1.5, overallPick: 5, fallbackValue: 0 } }),
      ),
    ).toThrow(/between 0 and 1/);
  });

  it('explains the comparison in plain language', () => {
    const decision = compareReleaseVsRedraft(baseInput());

    expect(decision.explanation).toContain('Keep: roster value');
    expect(decision.explanation).toContain('Release: roster value');
    expect(decision.explanation).toMatch(/worth .* more than/);
  });
});

describe('draft-slot scenarios', () => {
  // The toilet-bowl prize is 1.01. Holding an earlier pick makes a release safer, because
  // fewer teams can take the player before he comes back around.
  const slots = [
    { label: '1.01', overallPick: 1, probability: 1 },
    { label: '1.02', overallPick: 2, probability: 0.9 },
    { label: '1.05', overallPick: 5, probability: 0.5 },
    { label: '1.08', overallPick: 8, probability: 0.2 },
  ];

  it('makes releasing least risky at 1.01 and most risky at 1.08', () => {
    const missRisk = slots.map(
      (slot) =>
        compareReleaseVsRedraft(
          baseInput({
            reacquisition: {
              probability: slot.probability,
              overallPick: slot.overallPick,
              fallbackValue: 0,
            },
          }),
        ).releasePath.missBranch.probability,
    );

    expect(missRisk[0]).toBe(0);
    expect(missRisk).toEqual([...missRisk].sort((left, right) => left - right));
  });

  it('charges more of the pick back when he is re-drafted early', () => {
    const atFirst = compareReleaseVsRedraft(
      baseInput({ reacquisition: { probability: 1, overallPick: 1, fallbackValue: 0 } }),
    );
    const atEighth = compareReleaseVsRedraft(
      baseInput({ reacquisition: { probability: 1, overallPick: 8, fallbackValue: 0 } }),
    );

    // Same player, same certainty: the later pick simply costs less to spend.
    expect(atEighth.releasePath.reacquireBranch.value).toBeGreaterThan(
      atFirst.releasePath.reacquireBranch.value,
    );
  });

  it('produces a decision for every documented slot', () => {
    for (const slot of slots) {
      const decision = compareReleaseVsRedraft(
        baseInput({
          reacquisition: {
            probability: slot.probability,
            overallPick: slot.overallPick,
            fallbackValue: 5,
          },
        }),
      );

      expect(['keep', 'release', 'too_close_to_call']).toContain(decision.recommendation);
      expect(decision.assumptions.join(' ')).toContain(`overall pick ${slot.overallPick}`);
    }
  });
});

function baseInput(overrides: Partial<ReleaseVsRedraftInput> = {}): ReleaseVsRedraftInput {
  return {
    keeperRightId: hoarderRights[0]!.id,
    franchiseId: hoarderFranchiseId,
    seasonId: surplusSeasonId,
    evaluatedAt: '2026-08-01T00:00:00.000Z',
    keeperRights: hoarderRights,
    pickInventory: scenario.pickInventory,
    players: scenario.players,
    projectionSource: createProjectionSourceFromPlayerSeasons(scenario.playerSeasons),
    replacementLevels: { QB: 200, RB: 180, WR: 180, TE: 150 },
    pickValueCurve,
    maxKeepers: scenario.keeperLimit,
    reacquisition: { probability: 0.5, overallPick: 5, fallbackValue: 20 },
    ...overrides,
  };
}
