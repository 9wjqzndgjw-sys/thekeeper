import { describe, expect, it } from 'vitest';
import {
  createKnownUserKeeperScenario,
  createSyntheticLeagueSnapshot,
  draftPickAssets,
  knownScenarioKeeperRights,
  knownUserScenarioPickInventory,
} from './synthetic-league.js';

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

  it('includes the documented known user pick inventory with no fifth or eighth', () => {
    expect(knownUserScenarioPickInventory.map((pick) => `${pick.round}.${pick.slot}`)).toEqual([
      '1.5',
      '2.8',
      '3.5',
      '4.8',
      '6.8',
      '7.5',
      '9.5',
      '10.8',
      '11.5',
      '12.8',
      '13.5',
      '14.8',
      '15.5',
    ]);
    expect(knownUserScenarioPickInventory.some((pick) => pick.round === 5)).toBe(false);
    expect(knownUserScenarioPickInventory.some((pick) => pick.round === 8)).toBe(false);
    expect(knownUserScenarioPickInventory.find((pick) => pick.round === 4)?.overallPick).toBe(41);
  });

  it('includes the named known-scenario keeper candidates', () => {
    const scenario = createKnownUserKeeperScenario();

    expect(scenario.keeperRights).toBe(knownScenarioKeeperRights);
    expect(knownScenarioKeeperRights.map((right) => [right.playerId, right.nominalRound])).toEqual([
      ['player-jayden-daniels', 5],
      ['player-trey-mcbride', 7],
      ['player-caleb-williams', 11],
    ]);
  });
});
