import { describe, expect, it } from 'vitest';
import {
  balancedFranchiseId,
  createSurplusMarketScenario,
  hoarderFranchiseId,
  rebuildAFranchiseId,
} from '@keeper/test-fixtures';
import {
  createPickValueCurveFromRankedValues,
  createProjectionSourceFromPlayerSeasons,
} from '@keeper/valuation';
import { analyzeKeeperMarket, type KeeperMarketInput } from './keeper-market.js';

const scenario = createSurplusMarketScenario();

// A flat, cheap curve keeps every keeper clearly worth its pick, so the analysis is driven
// by slot scarcity rather than by pick cost.
const pickValueCurve = createPickValueCurveFromRankedValues(Array.from({ length: 24 }, () => 20));

describe('analyzeKeeperMarket', () => {
  it('reports surplus for a crowded roster and demand for an empty one', () => {
    const analysis = analyzeKeeperMarket(baseInput());

    const hoarder = position(analysis, hoarderFranchiseId);
    expect(hoarder.valuableKeeperCount).toBe(6);
    expect(hoarder.keeperSurplus).toBe(3);
    expect(hoarder.keeperDemand).toBe(0);

    const rebuild = position(analysis, rebuildAFranchiseId);
    expect(rebuild.keeperSurplus).toBe(0);
    expect(rebuild.keeperDemand).toBe(2);
  });

  it('keeps only the keeper limit and strands the rest', () => {
    const hoarder = position(analyzeKeeperMarket(baseInput()), hoarderFranchiseId);

    expect(hoarder.bestSetKeeperRightIds).toHaveLength(scenario.keeperLimit);
    expect(hoarder.excessCandidates).toHaveLength(3);
    expect(hoarder.totalStrandedValue).toBeGreaterThan(0);
  });

  it('values an excess player above what he adds to his own owner', () => {
    const analysis = analyzeKeeperMarket(baseInput());
    const assessment = analysis.sellPressure[0]!;
    const owner = position(analysis, assessment.ownerFranchiseId);
    const candidate = owner.excessCandidates.find(
      (entry) => entry.keeperRightId === assessment.keeperRightId,
    )!;

    // He cannot crack his owner's best three, so keeping him adds nothing there,
    // even though he is plainly worth keeping on his own.
    expect(candidate.marginalValueToOwner).toBe(0);
    expect(candidate.standaloneValue).toBeGreaterThan(0);
    expect(candidate.strandedValue).toBe(candidate.standaloneValue);

    // A rival with a free slot captures the value the owner cannot.
    const bestFit = assessment.buyerFits[0]!;
    expect(bestFit.marginalValueToBuyer).toBeGreaterThan(0);
    expect(bestFit.gainOverCurrentOwner).toBe(bestFit.marginalValueToBuyer);
  });

  it('prefers a buyer with an open keeper slot over one already full', () => {
    const analysis = analyzeKeeperMarket(baseInput());
    const assessment = analysis.sellPressure[0]!;

    const rebuildFit = assessment.buyerFits.find(
      (fit) => fit.buyerFranchiseId === rebuildAFranchiseId,
    );
    const balancedFit = assessment.buyerFits.find(
      (fit) => fit.buyerFranchiseId === balancedFranchiseId,
    );

    expect(rebuildFit).toBeDefined();
    expect(rebuildFit!.buyerKeeperDemand).toBeGreaterThan(balancedFit?.buyerKeeperDemand ?? 0);
  });

  it('exposes every sell-pressure factor rather than only a score', () => {
    const assessment = analyzeKeeperMarket(baseInput({ daysUntilKeeperDeadline: 3 }))
      .sellPressure[0]!;

    expect(assessment.factors).toEqual({
      strandedValueShare: expect.any(Number),
      expirationUrgency: expect.any(Number),
      buyerDepth: expect.any(Number),
      marketability: expect.any(Number),
    });
    expect(assessment.score).toBeGreaterThan(0);
    expect(assessment.urgencyConfidence).toBe('known');
  });

  it('raises urgency as the keeper deadline approaches', () => {
    const far = analyzeKeeperMarket(baseInput({ daysUntilKeeperDeadline: 25 })).sellPressure[0]!;
    const near = analyzeKeeperMarket(baseInput({ daysUntilKeeperDeadline: 2 })).sellPressure[0]!;

    expect(near.factors.expirationUrgency!).toBeGreaterThan(far.factors.expirationUrgency!);
    expect(near.score).toBeGreaterThan(far.score);
  });

  it('marks urgency unknown instead of guessing when no deadline is supplied', () => {
    const analysis = analyzeKeeperMarket(baseInput());

    expect(analysis.sellPressure[0]!.factors.expirationUrgency).toBeNull();
    expect(analysis.sellPressure[0]!.urgencyConfidence).toBe('unknown');
    expect(analysis.assumptions.join(' ')).toMatch(/deadline was not supplied/i);
  });

  it('describes incentives without predicting that a manager will trade', () => {
    const analysis = analyzeKeeperMarket(baseInput({ daysUntilKeeperDeadline: 1 }));
    const prose = [
      ...analysis.assumptions,
      ...analysis.sellPressure.map((assessment) => assessment.interpretation),
    ].join(' ');

    expect(prose).toMatch(/incentive/i);
    expect(prose).toMatch(/not a prediction/i);
    expect(prose).not.toMatch(/\bwill trade\b/i);
    expect(prose).not.toMatch(/\bwill keep\b/i);
  });

  it('labels draft-pool outlook without attaching a probability', () => {
    const analysis = analyzeKeeperMarket(baseInput());

    const kept = analysis.draftRemovalInputs.find((entry) => entry.inOwnerBestSet);
    expect(kept?.outlook).toBe('likely_kept');

    const contested = analysis.draftRemovalInputs.find((entry) => entry.outlook === 'contested');
    expect(contested?.interestedRivalCount).toBeGreaterThan(0);
    expect(contested?.bestRivalGain).toBeGreaterThan(0);

    for (const entry of analysis.draftRemovalInputs) {
      expect(entry).not.toHaveProperty('probability');
    }
  });

  it('says a player reaches the pool when nobody gains more than his owner', () => {
    // A league of one franchise has no rivals, so nothing is contested.
    const soloAnalysis = analyzeKeeperMarket(
      baseInput({
        franchises: scenario.franchises.slice(0, 1),
        keeperRights: scenario.keeperRights.filter(
          (right) => right.franchiseId === hoarderFranchiseId,
        ),
      }),
    );

    const outlooks = new Set(soloAnalysis.draftRemovalInputs.map((entry) => entry.outlook));
    expect(outlooks.has('contested')).toBe(false);
    expect(outlooks.has('likely_reaches_pool')).toBe(true);
  });

  it('finds no market when every roster is under the keeper limit', () => {
    const analysis = analyzeKeeperMarket(
      baseInput({
        keeperRights: scenario.keeperRights.filter(
          (right) => right.franchiseId !== hoarderFranchiseId,
        ),
      }),
    );

    expect(analysis.sellPressure).toEqual([]);
    expect(analysis.positions.every((entry) => entry.keeperSurplus === 0)).toBe(true);
  });
});

function baseInput(overrides: Partial<KeeperMarketInput> = {}): KeeperMarketInput {
  return {
    franchises: scenario.franchises,
    keeperRights: scenario.keeperRights,
    pickInventory: scenario.pickInventory,
    players: scenario.players,
    seasonId: scenario.seasonId,
    evaluatedAt: '2026-08-01T00:00:00.000Z',
    projectionSource: createProjectionSourceFromPlayerSeasons(scenario.playerSeasons),
    replacementLevels: { QB: 200, RB: 180, WR: 180, TE: 150 },
    pickValueCurve,
    keeperLimit: scenario.keeperLimit,
    ...overrides,
  };
}

function position(
  analysis: ReturnType<typeof analyzeKeeperMarket>,
  franchiseId: (typeof scenario.franchises)[number]['id'],
) {
  const found = analysis.positions.find((entry) => entry.franchiseId === franchiseId);
  expect(found).toBeDefined();
  return found!;
}
