import {
  buildFranchiseMap,
  createSleeperAdapter,
  deriveLeagueRules,
  deriveLineupSettings,
  importSeasonDraftState,
  reconstructKeeperRights,
  RECORDED_LEAGUE_POLICY,
  type SleeperRawSnapshot,
} from '@keeper/sleeper-adapter';
import { createServiceClientFromEnv, KeeperRepository } from '@keeper/persistence';
import type { LeagueId, SeasonId } from '@keeper/domain';
import { LEAGUE_LINEUP, resolveSleeperLeagueId } from './league-config.js';

/**
 * Imports a live league and persists it.
 *
 *   npm run sync -w @keeper/cli [-- <sleeperLeagueId>]
 *
 * Re-running is safe: every write is an upsert keyed on the same identity the schema
 * enforces, so a second run updates in place rather than duplicating.
 */
const sleeperLeagueId = resolveSleeperLeagueId(
  process.argv.slice(2).find((arg) => !arg.startsWith('--')),
);
const leagueId = `league:${sleeperLeagueId}` as LeagueId;
const seasonId = `season:${sleeperLeagueId}` as SeasonId;

// Raw payloads are captured as they arrive, before validation, so a response that later
// fails a schema check is still on record.
const capturedSnapshots: SleeperRawSnapshot[] = [];
const adapter = createSleeperAdapter({
  snapshotSink: (snapshot) => {
    capturedSnapshots.push(snapshot);
  },
});

const repository = new KeeperRepository(createServiceClientFromEnv());

console.log(`Importing league ${sleeperLeagueId}...`);
const imported = await importSeasonDraftState({
  adapter,
  leagueId,
  seasonId,
  sleeperLeagueId,
});

const league = await adapter.getLeague(sleeperLeagueId);
const rosters = await adapter.getLeagueRosters(sleeperLeagueId);
const users = await adapter.getLeagueUsers(sleeperLeagueId);

const franchiseMap = buildFranchiseMap({
  leagueId,
  rosters: rosters.data,
  users: users.data,
});

// Keeper costs come from the previous season's draft, so the chain has to be followed.
let keeperRights: ReturnType<typeof reconstructKeeperRights>['keeperRights'] = [];
let declaredSleeperPlayerIds: string[] = [];
const priorLeagueId = league.data.previousSleeperLeagueId;
const playerNames: Record<string, string> = {};

if (priorLeagueId) {
  const priorDrafts = await adapter.getLeagueDrafts(priorLeagueId);
  const priorDraft = priorDrafts.data[0];
  if (priorDraft) {
    const priorPicks = await adapter.getDraftPicks(priorDraft.sleeperDraftId);
    for (const pick of priorPicks.data) {
      const metadata = pick.metadata as { first_name?: string; last_name?: string };
      if (pick.sleeperPlayerId && metadata?.first_name) {
        playerNames[pick.sleeperPlayerId] =
          `${metadata.first_name} ${metadata.last_name ?? ''}`.trim();
      }
    }
    const reconstructed = reconstructKeeperRights({
      seasonId,
      rosters: rosters.data,
      rosterIdToFranchiseId: franchiseMap.rosterIdToFranchiseId,
      priorSeasonSelections: priorPicks.data,
      undraftedKeeperRound: RECORDED_LEAGUE_POLICY.undraftedKeeperRound,
      costAdvancePerSeason: RECORDED_LEAGUE_POLICY.keeperCostAdvancePerSeason,
      playerNameBySleeperId: playerNames,
    });
    keeperRights = reconstructed.keeperRights;
    declaredSleeperPlayerIds = reconstructed.declaredSleeperPlayerIds;

    for (const diagnostic of reconstructed.diagnostics) {
      console.warn(`  [${diagnostic.code}] ${diagnostic.message}`);
    }
  }
}

// Lineup and rules are read from the league payload rather than the checked-in constants,
// so the stored season describes the league as Sleeper actually has it configured.
const teamCount = imported.orderConfig?.teamCount ?? league.data.totalRosters;
const draftRounds = imported.orderConfig?.rounds ?? 15;
const derivedLineup = deriveLineupSettings(league.data.rosterPositions);
const lineup =
  derivedLineup.qb + derivedLineup.rb + derivedLineup.wr > 0 ? derivedLineup : LEAGUE_LINEUP;
// Reversal comes from the draft the importer already read, not from the league payload,
// which carries no such field. `orderConfig.orderMethod` is deliberately not passed through:
// it says whether the draft snakes or runs linear, a different question from how the order
// is decided.
const { rules, assumedFromPolicy } = deriveLeagueRules({
  settings: league.data.settings,
  policy: RECORDED_LEAGUE_POLICY,
  teamCount,
  draftRounds,
  thirdRoundReversal: imported.orderConfig?.thirdRoundReversal,
});

if (assumedFromPolicy.length > 0) {
  console.warn(
    `\n  Sleeper did not state: ${assumedFromPolicy.join(', ')}. Recorded league policy was used.`,
  );
}

console.log('Persisting...');

const snapshotCount = await repository.saveRawSnapshots(
  capturedSnapshots.map((snapshot) => ({
    mapperVersion: snapshot.mapperVersion,
    endpoint: snapshot.endpoint,
    url: snapshot.url,
    fetchedAt: snapshot.fetchedAt,
    payload: snapshot.raw,
  })),
);

await repository.saveLeagueSeason({
  leagueId,
  leagueName: league.data.name,
  rulesVersion: '2026.1',
  seasonId,
  seasonYear: Number.parseInt(league.data.season, 10),
  sleeperLeagueId,
  previousSleeperLeagueId: league.data.previousSleeperLeagueId,
  status: league.data.status,
  sleeperDraftId: league.data.draftId,
  teamCount,
  draftRounds,
  scoringSettings: league.data.scoringSettings as Record<string, unknown>,
  lineup: lineup as unknown as Record<string, unknown>,
  rules: rules as unknown as Record<string, unknown>,
});

const franchiseCount = await repository.saveFranchises(
  seasonId,
  franchiseMap.mapped.map((entry) => ({
    franchise: {
      id: entry.franchiseId,
      leagueId,
      displayName: entry.displayName,
    },
    sleeperRosterId: entry.rosterId,
    sleeperOwnerId: entry.ownerSleeperUserId,
    identitySource: entry.source,
  })),
);

// Keeper rights reference players, so those rows must exist first. There is now one right
// per rostered player rather than one per declaration, so this covers whole rosters.
// Identity still comes from the stored catalog rather than being invented here: prior-draft
// metadata carries a name but no position, and guessing one would put a real player at the
// wrong position.
const keeperPlayerIds = [...new Set(keeperRights.map((right) => String(right.playerId)))];
console.log(`
Rostered players priced as keeper candidates: ${keeperPlayerIds.length}`);
const knownPlayers = await repository.readPlayersBySleeperId(keeperPlayerIds);
const missingPlayerIds = keeperPlayerIds.filter((id) => !knownPlayers.has(id));

if (missingPlayerIds.length > 0) {
  console.warn(
    `\n  ${missingPlayerIds.length} keeper(s) are not in the player catalog: ${missingPlayerIds.join(', ')}`,
  );
  console.warn('  Run "npm run catalog -w @keeper/cli" to refresh it, then sync again.');
}

// Only players the catalog already knows are written; the rest are reported above rather
// than persisted with a placeholder position that would silently misprice them.
const playerCount = await repository.savePlayers(
  keeperPlayerIds
    .map((sleeperPlayerId) => knownPlayers.get(sleeperPlayerId))
    .filter((player): player is NonNullable<typeof player> => player !== undefined),
);

const persistableRights = keeperRights.filter((right) => knownPlayers.has(String(right.playerId)));

// A right is what a keeper would cost; a decision is what someone actually declared. Only
// the declared ones become decisions, and that set is what removes players from the draft
// pool -- writing a decision per right would take every rostered player off the board.
const declared = new Set(declaredSleeperPlayerIds);
const declaredRights = persistableRights.filter((right) => declared.has(String(right.playerId)));

const pickCount = await repository.savePickInventory(imported.pickInventory);
const rightCount = await repository.saveKeeperRights(persistableRights);
const decisionCount = await repository.saveKeeperDecisions(
  declaredRights.map((right) => ({
    seasonId,
    franchiseId: String(right.franchiseId),
    playerId: String(right.playerId),
    keeperRightId: String(right.id),
    resolvedPickAssetId: null,
    source: 'sleeper' as const,
    declaredAt: null,
  })),
);

console.log('\nWritten');
console.log(`  raw snapshots     ${snapshotCount}`);
console.log(`  franchises        ${franchiseCount}`);
console.log(`  players           ${playerCount} (from catalog)`);
console.log(`  pick assets       ${pickCount}`);
console.log(`  keeper rights     ${rightCount} (one per rostered player)`);
console.log(`  keeper decisions  ${decisionCount} (declared)`);

console.log('\nRead back from the database');
for (const table of [
  'raw_api_snapshots',
  'franchises',
  'franchise_seasons',
  'draft_pick_assets',
  'keeper_rights',
  'keeper_decisions',
]) {
  console.log(`  ${table.padEnd(20)} ${await repository.countRows(table)}`);
}

const readBack = await repository.readFranchises(seasonId);
console.log(`\nFranchises read back: ${readBack.length}`);
console.log(`  ${readBack.map((f) => f.displayName).join(', ')}`);
