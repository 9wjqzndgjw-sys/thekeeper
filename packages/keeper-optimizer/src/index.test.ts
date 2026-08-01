import { describe, expect, it } from 'vitest';
import type {
  DraftPickAsset,
  DraftPickAssetId,
  KeeperRight,
  KeeperRightId,
  PlayerSeason,
  PlayerId,
} from '@keeper/domain';
import {
  createKnownUserKeeperScenario,
  franchises,
  knownScenarioPlayers,
  knownScenarioKeeperRights,
  knownUserScenarioPickInventory,
  seasonId,
  userFranchiseId,
} from '@keeper/test-fixtures';
import {
  createPickValueCurveFromRankedValues,
  createProjectionSourceFromPlayerSeasons,
  type ReplacementLevels,
} from '@keeper/valuation';
import {
  advanceKeeperCostRound,
  enumerateKeeperCombinations,
  optimizeKeeperCombinations,
  resolveNominalKeeperCostRound,
  resolveKeeperCombination,
  resolveKeeperCombinations,
} from './index.js';

describe('enumerateKeeperCombinations', () => {
  it('returns the empty combination when there are no keeper rights', () => {
    expect(enumerateKeeperCombinations([])).toEqual([{ selectedKeeperRightIds: [] }]);
  });

  it('enumerates every subset from zero through the keeper limit', () => {
    const combinations = enumerateKeeperCombinations(knownScenarioKeeperRights, 3);

    expect(combinations.map((combination) => combination.selectedKeeperRightIds)).toEqual([
      [],
      ['keeper-jayden-daniels-r5'],
      ['keeper-jayden-daniels-r5', 'keeper-trey-mcbride-r7'],
      ['keeper-jayden-daniels-r5', 'keeper-trey-mcbride-r7', 'keeper-caleb-williams-r11'],
      ['keeper-jayden-daniels-r5', 'keeper-caleb-williams-r11'],
      ['keeper-trey-mcbride-r7'],
      ['keeper-trey-mcbride-r7', 'keeper-caleb-williams-r11'],
      ['keeper-caleb-williams-r11'],
    ]);
  });

  it('does not enumerate sets larger than the keeper limit', () => {
    const fourthRight = makeKeeperRight('keeper-extra-r12', 12);
    const combinations = enumerateKeeperCombinations(
      [...knownScenarioKeeperRights, fourthRight],
      3,
    );

    expect(combinations).toHaveLength(15);
    expect(
      combinations.some((combination) => combination.selectedKeeperRightIds.length === 4),
    ).toBe(false);
  });
});

describe('resolveKeeperCombination', () => {
  it('resolves Jayden Daniels from nominal round 5 to 4.08 when the fifth is missing', () => {
    const { keeperRights, pickInventory, franchiseId } = createKnownUserKeeperScenario();
    const jayden = keeperRights.find((right) => right.id === 'keeper-jayden-daniels-r5');

    expect(jayden).toBeDefined();
    const resolution = resolveKeeperCombination([jayden!], pickInventory, { franchiseId });

    expect(resolution.legal).toBe(true);
    expect(resolution.resolvedPicks).toEqual([
      expect.objectContaining({
        keeperRightId: 'keeper-jayden-daniels-r5',
        nominalRound: 5,
        resolvedRound: 4,
        resolvedSlot: 8,
        resolvedOverallPick: 41,
      }),
    ]);
    expect(resolution.displacements).toEqual([
      expect.objectContaining({
        keeperRightId: 'keeper-jayden-daniels-r5',
        nominalRound: 5,
        resolvedRound: 4,
        resolvedOverallPick: 41,
        cause: 'missing_pick',
        causedByKeeperRightId: null,
      }),
    ]);
  });

  it('explains when the missing nominal pick is currently owned by another franchise', () => {
    const { keeperRights, pickInventory, franchiseId } = createKnownUserKeeperScenario();
    const jayden = keeperRights.find((right) => right.id === 'keeper-jayden-daniels-r5');
    const tradedAwayFifth: DraftPickAsset = {
      id: 'pick-known-traded-away-5.05' as DraftPickAssetId,
      seasonId: knownScenarioKeeperRights[0]!.seasonId,
      round: 5,
      originalFranchiseId: userFranchiseId,
      currentFranchiseId: franchises[1]!.id,
      slot: 5,
      overallPick: 53,
      ownershipConfidence: 'confirmed',
    };

    expect(jayden).toBeDefined();
    const resolution = resolveKeeperCombination([jayden!], [...pickInventory, tradedAwayFifth], {
      franchiseId,
    });

    expect(resolution.displacements[0]).toEqual(
      expect.objectContaining({
        cause: 'missing_pick',
        causedByKeeperRightId: null,
        reason: expect.stringContaining(`owned by ${franchises[1]!.id}`),
      }),
    );
  });

  it('changes Jayden Daniels to 3.05 when another keeper consumes 4.08 first', () => {
    const roundFourKeeper = makeKeeperRight('keeper-round-four-collision', 4);
    const jayden = knownScenarioKeeperRights.find(
      (right) => right.id === 'keeper-jayden-daniels-r5',
    );

    expect(jayden).toBeDefined();
    const resolution = resolveKeeperCombination(
      [jayden!, roundFourKeeper],
      knownUserScenarioPickInventory,
      { franchiseId: userFranchiseId },
    );

    expect(resolution.legal).toBe(true);
    expect(resolution.resolutionOrder).toEqual([
      'keeper-round-four-collision',
      'keeper-jayden-daniels-r5',
    ]);
    expect(resolution.resolvedPicks).toEqual([
      expect.objectContaining({
        keeperRightId: 'keeper-round-four-collision',
        resolvedRound: 4,
        resolvedSlot: 8,
        resolvedOverallPick: 41,
      }),
      expect.objectContaining({
        keeperRightId: 'keeper-jayden-daniels-r5',
        resolvedRound: 3,
        resolvedSlot: 5,
        resolvedOverallPick: 29,
      }),
    ]);
    expect(resolution.displacements).toContainEqual(
      expect.objectContaining({
        keeperRightId: 'keeper-jayden-daniels-r5',
        cause: 'keeper_collision',
        causedByKeeperRightId: 'keeper-round-four-collision',
        reason: expect.stringContaining('keeper keeper-round-four-collision'),
      }),
    );
  });

  it('does not claim the owned nominal pick is missing when a same-round collision is the only issue', () => {
    const firstRoundFourKeeper = makeKeeperRight('keeper-round-four-a', 4);
    const secondRoundFourKeeper = makeKeeperRight('keeper-round-four-b', 4);

    const resolution = resolveKeeperCombination(
      [firstRoundFourKeeper, secondRoundFourKeeper],
      knownUserScenarioPickInventory,
      { franchiseId: userFranchiseId },
    );

    expect(resolution.legal).toBe(true);
    expect(resolution.displacements).toHaveLength(1);
    expect(resolution.displacements[0]).toEqual(
      expect.objectContaining({
        keeperRightId: 'keeper-round-four-b',
        cause: 'keeper_collision',
        causedByKeeperRightId: 'keeper-round-four-a',
      }),
    );
    // The team owns round 4 outright (no trade); the only issue is the
    // collision, so the reason must not claim the pick is "missing" or
    // "owned by X, not X".
    expect(resolution.displacements[0]!.reason).not.toMatch(/owned by/);
    expect(resolution.displacements[0]!.reason).not.toMatch(/No owned/);
  });

  it('rejects duplicate player rights in one same-season keeper set', () => {
    const jayden = knownScenarioKeeperRights.find(
      (right) => right.id === 'keeper-jayden-daniels-r5',
    );
    const duplicateJaydenRight: KeeperRight = {
      ...jayden!,
      id: 'keeper-jayden-daniels-alt-r6' as KeeperRightId,
      nominalRound: 6,
    };

    expect(jayden).toBeDefined();
    const resolution = resolveKeeperCombination(
      [jayden!, duplicateJaydenRight],
      knownUserScenarioPickInventory,
      { franchiseId: userFranchiseId },
    );

    expect(resolution.legal).toBe(false);
    expect(resolution.invalidReason).toMatch(/more than one selected keeper right/);
  });

  it('filters duplicate player-right combinations from legal combination results', () => {
    const jayden = knownScenarioKeeperRights.find(
      (right) => right.id === 'keeper-jayden-daniels-r5',
    );
    const duplicateJaydenRight: KeeperRight = {
      ...jayden!,
      id: 'keeper-jayden-daniels-alt-r6' as KeeperRightId,
      nominalRound: 6,
    };

    expect(jayden).toBeDefined();
    const legalResolutions = resolveKeeperCombinations({
      keeperRights: [jayden!, duplicateJaydenRight],
      pickInventory: knownUserScenarioPickInventory,
      franchiseId: userFranchiseId,
      includeIllegal: false,
    });

    expect(legalResolutions).toHaveLength(3);
    expect(
      legalResolutions.some((resolution) => resolution.selectedKeeperRightIds.length === 2),
    ).toBe(false);
  });

  it('invalidates a keeper set when no earlier owned pick exists', () => {
    const firstRoundKeeper = makeKeeperRight('keeper-first-round', 1);
    const resolution = resolveKeeperCombination(
      [firstRoundKeeper],
      knownUserScenarioPickInventory.filter((pick) => pick.round !== 1),
      { franchiseId: userFranchiseId },
    );

    expect(resolution.legal).toBe(false);
    expect(resolution.invalidReason).toMatch(/No legal owned pick/);
  });

  it('resolves all legal known-scenario combinations without reusing a pick', () => {
    const { keeperRights, pickInventory, franchiseId } = createKnownUserKeeperScenario();
    const resolutions = resolveKeeperCombinations({
      keeperRights,
      pickInventory,
      franchiseId,
      maxKeepers: 3,
      includeIllegal: false,
    });

    expect(resolutions).toHaveLength(8);
    for (const resolution of resolutions) {
      const consumedPickIds = resolution.resolvedPicks.map((pick) => pick.resolvedPickAssetId);
      expect(new Set(consumedPickIds).size).toBe(consumedPickIds.length);
    }
  });

  it('explains same-round keeper collisions without claiming the owner lacks their own pick', () => {
    const firstRoundFiveKeeper = makeKeeperRight('keeper-round-five-first', 5);
    const secondRoundFiveKeeper = makeKeeperRight('keeper-round-five-second', 5);
    const ownedFifth: DraftPickAsset = {
      id: 'pick-owned-5.05' as DraftPickAssetId,
      seasonId,
      round: 5,
      originalFranchiseId: userFranchiseId,
      currentFranchiseId: userFranchiseId,
      slot: 5,
      overallPick: 53,
      ownershipConfidence: 'confirmed',
    };

    const resolution = resolveKeeperCombination(
      [firstRoundFiveKeeper, secondRoundFiveKeeper],
      [...knownUserScenarioPickInventory, ownedFifth],
      { franchiseId: userFranchiseId },
    );

    expect(resolution.displacements).toContainEqual(
      expect.objectContaining({
        keeperRightId: 'keeper-round-five-second',
        cause: 'keeper_collision',
        causedByKeeperRightId: 'keeper-round-five-first',
        reason: expect.not.stringContaining(`not ${userFranchiseId}`),
      }),
    );
  });
});

describe('optimizeKeeperCombinations', () => {
  it('values every legal keeper set and exposes best views by mode', () => {
    const result = optimizeKeeperCombinations({
      keeperRights: knownScenarioKeeperRights,
      pickInventory: knownUserScenarioPickInventory,
      players: knownScenarioPlayers,
      franchiseId: userFranchiseId,
      seasonId,
      evaluatedAt: '2026-07-31T00:00:00.000Z',
      projectionSource: createProjectionSourceFromPlayerSeasons(knownScenarioPlayerSeasons),
      replacementLevels: knownScenarioReplacementLevels,
      pickValueCurve: knownScenarioPickValueCurve,
      maxKeepers: 3,
      rosterFitByPlayerId: new Map([[knownScenarioPlayers[0]!.id, 10]]),
    });

    expect(result.combinations).toHaveLength(8);
    expect(result.bestByMode.expected?.selectedKeeperRightIds).toEqual([
      'keeper-jayden-daniels-r5',
      'keeper-trey-mcbride-r7',
      'keeper-caleb-williams-r11',
    ]);
    expect(result.bestByMode.safest).not.toBeNull();
    expect(result.bestByMode.win_now).not.toBeNull();
    expect(result.bestByMode.future).not.toBeNull();

    const jaydenOnly = result.combinations.find(
      (combination) =>
        combination.selectedKeeperRightIds.length === 1 &&
        combination.selectedKeeperRightIds[0] === 'keeper-jayden-daniels-r5',
    );

    expect(jaydenOnly).toEqual(
      expect.objectContaining({
        retainedIntrinsicValue: 100,
        consumedPickValue: 60,
        keeperSurplusValue: 40,
        teamContextValue: 50,
        totalScore: 50,
      }),
    );
    expect(jaydenOnly?.playerValuations[0]).toEqual(
      expect.objectContaining({
        fullName: 'Jayden Daniels',
        nominalRound: 5,
        resolvedRound: 4,
        resolvedOverallPick: 41,
        intrinsicValue: 100,
        consumedPickValue: 60,
      }),
    );
  });

  it('throws clearly when a selected keeper cannot be matched to player metadata', () => {
    expect(() =>
      optimizeKeeperCombinations({
        keeperRights: [knownScenarioKeeperRights[0]!],
        pickInventory: knownUserScenarioPickInventory,
        players: [],
        franchiseId: userFranchiseId,
        seasonId,
        evaluatedAt: '2026-07-31T00:00:00.000Z',
        projectionSource: createProjectionSourceFromPlayerSeasons(knownScenarioPlayerSeasons),
        replacementLevels: knownScenarioReplacementLevels,
        pickValueCurve: knownScenarioPickValueCurve,
      }),
    ).toThrow(/missing player/);
  });
});

describe('advanceKeeperCostRound', () => {
  it('advances keeper costs one round per season', () => {
    expect(advanceKeeperCostRound(8)).toBe(7);
    expect(advanceKeeperCostRound(8, 4)).toBe(4);
  });

  it('errors explicitly when progression would pass round one', () => {
    expect(() => advanceKeeperCostRound(1)).toThrow(/cannot advance/);
  });
});

describe('resolveNominalKeeperCostRound', () => {
  it('assigns undrafted free agents the league undrafted keeper round', () => {
    expect(
      resolveNominalKeeperCostRound({
        sourceType: 'undrafted_free_agent',
        undraftedKeeperRound: 10,
      }),
    ).toBe(10);
  });

  it('advances drafted or previously kept players from their prior keeper round', () => {
    expect(
      resolveNominalKeeperCostRound({
        sourceType: 'kept',
        previousRound: 8,
        undraftedKeeperRound: 10,
        seasonsElapsed: 2,
      }),
    ).toBe(6);
  });

  it('requires a previous round for non-undrafted sources', () => {
    expect(() =>
      resolveNominalKeeperCostRound({
        sourceType: 'drafted',
        undraftedKeeperRound: 10,
      }),
    ).toThrow(/previousRound/);
  });

  it('uses the manual override round directly, ignoring progression math', () => {
    expect(
      resolveNominalKeeperCostRound({
        sourceType: 'manual_override',
        undraftedKeeperRound: 10,
        overrideRound: 6,
        // A wildly different previousRound must be ignored: overrides win.
        previousRound: 1,
        seasonsElapsed: 5,
      }),
    ).toBe(6);
  });

  it('requires an override round for manual_override sources', () => {
    expect(() =>
      resolveNominalKeeperCostRound({
        sourceType: 'manual_override',
        undraftedKeeperRound: 10,
      }),
    ).toThrow(/overrideRound/);
  });
});

const knownScenarioPlayerSeasons: PlayerSeason[] = [
  {
    playerId: 'player-jayden-daniels' as PlayerId,
    seasonId,
    nflTeam: 'WAS',
    age: 25,
    role: 'starter',
    injuryStatus: null,
    projectedPoints: 320,
    actualPoints: null,
  },
  {
    playerId: 'player-trey-mcbride' as PlayerId,
    seasonId,
    nflTeam: 'ARI',
    age: 26,
    role: 'starter',
    injuryStatus: null,
    projectedPoints: 210,
    actualPoints: null,
  },
  {
    playerId: 'player-caleb-williams' as PlayerId,
    seasonId,
    nflTeam: 'CHI',
    age: 24,
    role: 'starter',
    injuryStatus: null,
    projectedPoints: 250,
    actualPoints: null,
  },
];

const knownScenarioReplacementLevels: ReplacementLevels = {
  QB: 220,
  TE: 110,
};

const knownScenarioPickValues = Array.from({ length: 180 }, (_, index) =>
  index === 40 ? 60 : index === 76 ? 20 : index === 124 ? 5 : 0,
);

const knownScenarioPickValueCurve = createPickValueCurveFromRankedValues(knownScenarioPickValues);

function makeKeeperRight(id: string, nominalRound: number): KeeperRight {
  return {
    id: id as KeeperRightId,
    seasonId: knownScenarioKeeperRights[0]!.seasonId,
    playerId: `${id}-player` as PlayerId,
    franchiseId: userFranchiseId,
    sourceType: 'drafted',
    nominalRound,
    effectiveOverallPick: null,
    confidence: 'confirmed',
    manualOverrideReason: null,
  };
}
