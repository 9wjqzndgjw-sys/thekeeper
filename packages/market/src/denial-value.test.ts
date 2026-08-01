import { describe, expect, it } from 'vitest';
import {
  balancedFranchiseId,
  createSurplusMarketScenario,
  hoarderFranchiseId,
  rebuildAFranchiseId,
  surplusSeasonId,
} from '@keeper/test-fixtures';
import {
  createPickValueCurveFromRankedValues,
  createProjectionSourceFromPlayerSeasons,
} from '@keeper/valuation';
import { computeDenialValue, type ComputeDenialValueInput } from './denial-value.js';

const scenario = createSurplusMarketScenario();
const pickValueCurve = createPickValueCurveFromRankedValues(Array.from({ length: 24 }, () => 20));

const contestedRight = scenario.keeperRights.find(
  (right) => right.franchiseId === hoarderFranchiseId,
)!;

describe('computeDenialValue', () => {
  it('weighs each rival by their own gain, the odds, and the rivalry', () => {
    const assessment = computeDenialValue(baseInput());
    const rival = assessment.perRival[0]!;

    expect(rival.contribution).toBeCloseTo(
      rival.probabilityPlayerReaches * rival.rivalIncrementalGain * rival.rivalryWeight,
    );
    expect(assessment.total).toBeCloseTo(
      assessment.perRival.reduce((sum, entry) => sum + entry.contribution, 0),
    );
  });

  it('is worth more against a rival who would actually gain from him', () => {
    const assessment = computeDenialValue(baseInput());

    const openSlotRival = assessment.perRival.find(
      (entry) => entry.franchiseId === rebuildAFranchiseId,
    )!;
    expect(openSlotRival.rivalIncrementalGain).toBeGreaterThan(0);
  });

  it('scales with the caller-supplied probability', () => {
    const unlikely = computeDenialValue(baseInput({ rivals: rivals(0.1) }));
    const likely = computeDenialValue(baseInput({ rivals: rivals(0.9) }));

    expect(likely.total).toBeGreaterThan(unlikely.total);
  });

  it('lets rivalry weight express that some rivals matter more', () => {
    const neutral = computeDenialValue(baseInput());
    const weighted = computeDenialValue(
      baseInput({
        rivals: rivals(0.5).map((rival) =>
          rival.franchiseId === rebuildAFranchiseId ? { ...rival, rivalryWeight: 2 } : rival,
        ),
      }),
    );

    expect(weighted.total).toBeGreaterThan(neutral.total);
  });

  it('is zero when no rival can use him', () => {
    const assessment = computeDenialValue(baseInput({ rivals: rivals(0) }));

    expect(assessment.total).toBe(0);
  });

  it('marks itself as excluded from decision totals', () => {
    const assessment = computeDenialValue(baseInput());

    expect(assessment.excludedFromDecisionTotals).toBe(true);
    expect(assessment.assumptions.join(' ')).toMatch(/counted twice/i);
    expect(assessment.assumptions.join(' ')).toMatch(/reported separately/i);
  });

  it('rejects an impossible probability', () => {
    expect(() => computeDenialValue(baseInput({ rivals: rivals(1.4) }))).toThrow(/between 0 and 1/);
  });
});

function rivals(probability: number): ComputeDenialValueInput['rivals'] {
  return [
    {
      franchiseId: rebuildAFranchiseId,
      displayName: 'Rebuild A',
      keeperRights: scenario.keeperRights.filter(
        (right) => right.franchiseId === rebuildAFranchiseId,
      ),
      probabilityPlayerReaches: probability,
    },
    {
      franchiseId: balancedFranchiseId,
      displayName: 'Balanced',
      keeperRights: scenario.keeperRights.filter(
        (right) => right.franchiseId === balancedFranchiseId,
      ),
      probabilityPlayerReaches: probability,
    },
  ];
}

function baseInput(overrides: Partial<ComputeDenialValueInput> = {}): ComputeDenialValueInput {
  return {
    keeperRight: contestedRight,
    rivals: rivals(0.5),
    pickInventory: scenario.pickInventory,
    players: scenario.players,
    seasonId: surplusSeasonId,
    evaluatedAt: '2026-08-01T00:00:00.000Z',
    projectionSource: createProjectionSourceFromPlayerSeasons(scenario.playerSeasons),
    replacementLevels: { QB: 200, RB: 180, WR: 180, TE: 150 },
    pickValueCurve,
    keeperLimit: scenario.keeperLimit,
    ...overrides,
  };
}
