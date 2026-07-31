import { describe, expect, it } from 'vitest';
import { createSyntheticLeagueSnapshot, draftPickAssets } from './synthetic-league.js';

describe('synthetic league fixture', () => {
  it('generates all 180 picks with unique overall pick numbers 1..180', () => {
    expect(draftPickAssets).toHaveLength(180);
    const overallPicks = draftPickAssets.map((asset) => asset.overallPick).sort((a, b) => a! - b!);
    expect(overallPicks).toEqual(Array.from({ length: 180 }, (_, i) => i + 1));
  });

  it('produces a snapshot with a user franchise and its keeper rights', () => {
    const snapshot = createSyntheticLeagueSnapshot();
    const userKeeperRights = snapshot.keeperRights.filter(
      (right) => right.franchiseId === snapshot.userFranchiseId,
    );
    expect(userKeeperRights).toHaveLength(2);
  });
});
