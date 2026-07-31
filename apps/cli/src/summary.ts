import type { LeagueStateSnapshot } from '@keeper/domain';
import { enumerateKeeperCombinations } from '@keeper/keeper-optimizer';

export function buildLeagueSummary(snapshot: LeagueStateSnapshot): string[] {
  const userRights = snapshot.keeperRights.filter(
    (right) => right.franchiseId === snapshot.userFranchiseId,
  );
  const combinations = enumerateKeeperCombinations(userRights);

  return [
    `League: ${snapshot.league.name} (${snapshot.season.year})`,
    `Teams: ${snapshot.league.rules.teamCount}, Draft rounds: ${snapshot.league.rules.draftRounds}`,
    `Pick inventory loaded: ${snapshot.pickInventory.length} assets`,
    `User franchise ${snapshot.userFranchiseId} has ${userRights.length} keeper-eligible player(s):`,
    ...userRights.map(
      (right) =>
        `  - ${right.playerId} (nominal round ${right.nominalRound}, source: ${right.sourceType})`,
    ),
    `Keeper combinations enumerated (placeholder engine): ${combinations.length}`,
    'Full keeper-cost resolution, IV/KSV/TCV, and boards arrive in later implementation phases.',
  ];
}
