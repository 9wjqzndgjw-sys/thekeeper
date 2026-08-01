import { describe, expect, it } from 'vitest';
import type {
  DraftPickAsset,
  DraftPickAssetId,
  Franchise,
  FranchiseId,
  LeagueId,
  SeasonId,
} from '@keeper/domain';
import type { TrackedSelection } from '@keeper/draft-tracker';
import { buildPickHorizon } from './pick-horizon.js';

const seasonId = 'season-2026' as SeasonId;
const leagueId = 'league-1' as LeagueId;
const userFranchiseId = 'franchise-user' as FranchiseId;
const rivalA = 'franchise-a' as FranchiseId;
const rivalB = 'franchise-b' as FranchiseId;

const franchises: Franchise[] = [
  { id: userFranchiseId, leagueId, displayName: 'Our Team' },
  { id: rivalA, leagueId, displayName: 'Rival A' },
  { id: rivalB, leagueId, displayName: 'Rival B' },
];

// Three teams, round one: rival A, rival B, then us.
const pickInventory: DraftPickAsset[] = [
  pickAsset(1, 1, 1, rivalA),
  pickAsset(2, 1, 2, rivalB),
  pickAsset(3, 1, 3, userFranchiseId),
  pickAsset(4, 2, 3, userFranchiseId),
  pickAsset(5, 2, 2, rivalB),
  pickAsset(6, 2, 1, rivalA),
];

describe('buildPickHorizon', () => {
  it('reports the opening pick and how long until the user is up', () => {
    const horizon = buildPickHorizon({
      pickInventory,
      selections: [],
      franchises,
      userFranchiseId,
    });

    expect(horizon.currentOverallPick).toBe(1);
    expect(horizon.userNextOverallPick).toBe(3);
    expect(horizon.picksUntilUserTurn).toBe(2);
    expect(horizon.madePickCount).toBe(0);
    expect(horizon.remainingPickCount).toBe(6);
  });

  it('lists everyone picking between now and the user, ending on the user', () => {
    const horizon = buildPickHorizon({
      pickInventory,
      selections: [],
      franchises,
      userFranchiseId,
    });

    expect(horizon.upcoming.map((pick) => pick.displayName)).toEqual([
      'Rival A',
      'Rival B',
      'Our Team',
    ]);
    expect(horizon.upcoming.at(-1)).toMatchObject({ isUser: true, overallPick: 3 });
  });

  it('advances as picks are made', () => {
    const horizon = buildPickHorizon({
      pickInventory,
      selections: [selection(1), selection(2)],
      franchises,
      userFranchiseId,
    });

    expect(horizon.currentOverallPick).toBe(3);
    expect(horizon.picksUntilUserTurn).toBe(0);
    expect(horizon.madePickCount).toBe(2);
  });

  it('follows a traded pick to the franchise that now holds it', () => {
    const traded = pickInventory.map((pick) =>
      pick.overallPick === 2 ? { ...pick, currentFranchiseId: userFranchiseId } : pick,
    );

    const horizon = buildPickHorizon({
      pickInventory: traded,
      selections: [],
      franchises,
      userFranchiseId,
    });

    // We now own pick 2, so our turn arrives sooner than our original slot.
    expect(horizon.userNextOverallPick).toBe(2);
    expect(horizon.picksUntilUserTurn).toBe(1);
  });

  it('handles a completed draft', () => {
    const horizon = buildPickHorizon({
      pickInventory,
      selections: pickInventory.map((pick) => selection(pick.overallPick!)),
      franchises,
      userFranchiseId,
    });

    expect(horizon.currentOverallPick).toBeNull();
    expect(horizon.userNextOverallPick).toBeNull();
    expect(horizon.picksUntilUserTurn).toBeNull();
    expect(horizon.upcoming).toEqual([]);
  });

  it('skips picks with no resolved overall number', () => {
    const horizon = buildPickHorizon({
      pickInventory: [...pickInventory, { ...pickAsset(99, 3, 1, rivalA), overallPick: null }],
      selections: [],
      franchises,
      userFranchiseId,
    });

    expect(horizon.remainingPickCount).toBe(6);
  });

  it('caps the upcoming list', () => {
    const horizon = buildPickHorizon({
      pickInventory,
      selections: [],
      franchises,
      userFranchiseId,
      maxUpcoming: 2,
    });

    expect(horizon.upcoming).toHaveLength(2);
  });
});

function pickAsset(
  overallPick: number,
  round: number,
  slot: number,
  franchiseId: FranchiseId,
): DraftPickAsset {
  return {
    id: `pick-${overallPick}` as DraftPickAssetId,
    seasonId,
    round,
    originalFranchiseId: franchiseId,
    currentFranchiseId: franchiseId,
    slot,
    overallPick,
    ownershipConfidence: 'confirmed',
  };
}

function selection(overallPick: number): TrackedSelection {
  return {
    draftId: 'draft-1',
    overallPick,
    round: 1,
    slot: 1,
    rosterId: 1,
    playerId: `player-${overallPick}`,
    isKeeper: false,
    source: 'api',
    recordedAt: '2026-08-30T18:00:00.000Z',
  };
}
