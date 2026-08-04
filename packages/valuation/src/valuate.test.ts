import { describe, expect, it } from 'vitest';
import type { FranchiseId, PlayerId, PlayerSeason, SeasonId } from '@keeper/domain';
import { createPickValueCurveFromRankedValues } from './pick-value-curve.js';
import { createProjectionSourceFromPlayerSeasons } from './projections.js';
import type { ReplacementLevels } from './replacement.js';
import { valuatePlayerForFranchise } from './valuate.js';

const seasonId = 'season-2026' as SeasonId;
const playerId = 'player-jayden-daniels' as PlayerId;
const franchiseA = 'franchise-01' as FranchiseId;
const franchiseB = 'franchise-02' as FranchiseId;

const playerSeasons: PlayerSeason[] = [
  {
    playerId,
    seasonId,
    nflTeam: 'WAS',
    age: 24,
    role: 'starter',
    injuryStatus: null,
    projectedPoints: 320,
    actualPoints: null,
    averageDraftPosition: null,
  },
];

const projectionSource = createProjectionSourceFromPlayerSeasons(playerSeasons);
const replacementLevels: ReplacementLevels = { QB: 220 };
// Rank 41 (Jayden's resolved overall pick in the documented scenario) is worth 60;
// rank 29 (an earlier, pricier pick) is worth 130.
const rankedPickValues = Array.from({ length: 180 }, (_, index) =>
  index === 28 ? 130 : index === 40 ? 60 : 0,
);
const pickValueCurve = createPickValueCurveFromRankedValues(rankedPickValues);

describe('valuatePlayerForFranchise', () => {
  it('computes intrinsic value independent of franchise or exact pick', () => {
    const noKeeperContext = valuatePlayerForFranchise({
      playerId,
      position: 'QB',
      franchiseId: franchiseA,
      seasonId,
      evaluatedAt: '2026-07-30T00:00:00.000Z',
      projectionSource,
      replacementLevels,
      pickValueCurve,
      exactOverallPick: null,
    });
    const asKeeperForFranchiseB = valuatePlayerForFranchise({
      playerId,
      position: 'QB',
      franchiseId: franchiseB,
      seasonId,
      evaluatedAt: '2026-07-30T00:00:00.000Z',
      projectionSource,
      replacementLevels,
      pickValueCurve,
      exactOverallPick: 41,
    });

    expect(noKeeperContext.components.intrinsicValue).toBe(100);
    expect(asKeeperForFranchiseB.components.intrinsicValue).toBe(100);
    expect(noKeeperContext.components.keeperSurplusValue).toBeNull();
  });

  it('resolves a different keeper surplus value for a different exact overall pick', () => {
    const cheapPick = valuatePlayerForFranchise({
      playerId,
      position: 'QB',
      franchiseId: franchiseA,
      seasonId,
      evaluatedAt: '2026-07-30T00:00:00.000Z',
      projectionSource,
      replacementLevels,
      pickValueCurve,
      exactOverallPick: 41,
    });
    const expensivePick = valuatePlayerForFranchise({
      playerId,
      position: 'QB',
      franchiseId: franchiseA,
      seasonId,
      evaluatedAt: '2026-07-30T00:00:00.000Z',
      projectionSource,
      replacementLevels,
      pickValueCurve,
      exactOverallPick: 29,
    });

    expect(cheapPick.components.keeperSurplusValue).toBe(40); // 100 - 60
    expect(expensivePick.components.keeperSurplusValue).toBe(-30); // 100 - 130
  });

  it('subtracts the pick cost exactly once in the reported breakdown', () => {
    const result = valuatePlayerForFranchise({
      playerId,
      position: 'QB',
      franchiseId: franchiseA,
      seasonId,
      evaluatedAt: '2026-07-30T00:00:00.000Z',
      projectionSource,
      replacementLevels,
      pickValueCurve,
      exactOverallPick: 41,
    });

    const reconstructedKsv =
      result.components.breakdown['ksv.intrinsicValue']! -
      result.components.breakdown['ksv.pickOpportunityCost']! -
      result.components.breakdown['ksv.keeperSlotOpportunityCost']!;

    expect(reconstructedKsv).toBe(result.components.keeperSurplusValue);
  });

  it('lets the same player differ in team context value across franchises', () => {
    const openSlotTeam = valuatePlayerForFranchise({
      playerId,
      position: 'QB',
      franchiseId: franchiseA,
      seasonId,
      evaluatedAt: '2026-07-30T00:00:00.000Z',
      projectionSource,
      replacementLevels,
      pickValueCurve,
      exactOverallPick: 41,
      rosterFit: 10,
    });
    const staffedTeam = valuatePlayerForFranchise({
      playerId,
      position: 'QB',
      franchiseId: franchiseB,
      seasonId,
      evaluatedAt: '2026-07-30T00:00:00.000Z',
      projectionSource,
      replacementLevels,
      pickValueCurve,
      exactOverallPick: 41,
      rosterFit: 0,
    });

    expect(openSlotTeam.components.keeperSurplusValue).toBe(
      staffedTeam.components.keeperSurplusValue,
    );
    expect(openSlotTeam.components.teamContextValue).not.toBe(
      staffedTeam.components.teamContextValue,
    );
    expect(openSlotTeam.components.teamContextValue).toBe(50); // 40 KSV + 10 roster fit
    expect(staffedTeam.components.teamContextValue).toBe(40); // 40 KSV + 0 roster fit
  });

  it('throws when no projection exists rather than silently valuing at zero', () => {
    expect(() =>
      valuatePlayerForFranchise({
        playerId: 'player-unknown' as PlayerId,
        position: 'QB',
        franchiseId: franchiseA,
        seasonId,
        evaluatedAt: '2026-07-30T00:00:00.000Z',
        projectionSource,
        replacementLevels,
        pickValueCurve,
        exactOverallPick: null,
      }),
    ).toThrow(/No projection available/);
  });

  it('includes an explanation and version metadata', () => {
    const result = valuatePlayerForFranchise({
      playerId,
      position: 'QB',
      franchiseId: franchiseA,
      seasonId,
      evaluatedAt: '2026-07-30T00:00:00.000Z',
      projectionSource,
      replacementLevels,
      pickValueCurve,
      exactOverallPick: 41,
    });

    expect(result.explanation).toContain('Projected contribution');
    expect(result.explanation).toContain('Team Context Value');
    expect(result.projectionVersion).toBe(projectionSource.version);
    expect(result.evaluatedAt).toBe('2026-07-30T00:00:00.000Z');
  });
});
