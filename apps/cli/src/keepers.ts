import type { FranchiseId, LeagueId, SeasonId } from '@keeper/domain';
import {
  buildFranchiseMap,
  createSleeperAdapter,
  reconstructKeeperRights,
} from '@keeper/sleeper-adapter';
import { resolveSleeperLeagueId } from './league-config.js';

/** Reconstructs this season's declared keepers and their costs from Sleeper. */
const SLEEPER_LEAGUE_ID = resolveSleeperLeagueId(
  process.argv.slice(2).find((arg) => !arg.startsWith('--')),
);
const adapter = createSleeperAdapter();
const league = await adapter.getLeague(SLEEPER_LEAGUE_ID);
const rosters = await adapter.getLeagueRosters(SLEEPER_LEAGUE_ID);
const users = await adapter.getLeagueUsers(SLEEPER_LEAGUE_ID);

const priorLeagueId = league.data.previousSleeperLeagueId;
if (!priorLeagueId) {
  console.error('No previous league in the chain; keeper costs cannot be reconstructed.');
  process.exit(1);
}
const priorDrafts = await adapter.getLeagueDrafts(priorLeagueId);
const priorDraft = priorDrafts.data[0];
if (!priorDraft) {
  console.error('Previous league has no draft.');
  process.exit(1);
}
const priorPicks = await adapter.getDraftPicks(priorDraft.sleeperDraftId);

const nameById: Record<string, string> = {};
for (const pick of priorPicks.data) {
  const meta = pick.metadata as { first_name?: string; last_name?: string };
  if (pick.sleeperPlayerId && meta?.first_name) {
    nameById[pick.sleeperPlayerId] = `${meta.first_name} ${meta.last_name ?? ''}`.trim();
  }
}

const franchiseMap = buildFranchiseMap({
  leagueId: `league:${SLEEPER_LEAGUE_ID}` as LeagueId,
  rosters: rosters.data,
  users: users.data,
});

const result = reconstructKeeperRights({
  seasonId: 'season-2026' as SeasonId,
  rosters: rosters.data,
  rosterIdToFranchiseId: franchiseMap.rosterIdToFranchiseId,
  priorSeasonSelections: priorPicks.data,
  undraftedKeeperRound: 10,
  playerNameBySleeperId: nameById,
});

const displayName = new Map(franchiseMap.franchises.map((f) => [f.id, f.displayName]));
const byFranchise = new Map<FranchiseId, typeof result.keeperRights>();
for (const right of result.keeperRights) {
  byFranchise.set(right.franchiseId, [...(byFranchise.get(right.franchiseId) ?? []), right]);
}

console.log(`Declared keepers priced: ${result.keeperRights.length}\n`);
for (const [franchiseId, rights] of byFranchise) {
  console.log(`${displayName.get(franchiseId) ?? franchiseId}`);
  for (const right of [...rights].sort((a, b) => a.nominalRound - b.nominalRound)) {
    console.log(
      `   round ${String(right.nominalRound).padStart(2)}  ${nameById[String(right.playerId)] ?? right.playerId}`,
    );
  }
}

if (result.unresolved.length > 0) {
  console.log(`\nUnresolved (${result.unresolved.length}) - need a league ruling:`);
  for (const entry of result.unresolved) {
    console.log(
      `  ${nameById[entry.sleeperPlayerId] ?? entry.sleeperPlayerId} (${displayName.get(entry.franchiseId!) ?? '?'}) - prior round ${entry.priorRound}, ${entry.reason}`,
    );
  }
}
