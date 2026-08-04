import {
  buildFranchiseMap,
  createSleeperAdapter,
  deriveLeagueRules,
  deriveLineupSettings,
  importSeasonDraftState,
  reconstructKeeperRights,
  RECORDED_LEAGUE_POLICY,
  resolveSleeperLeagueContinuity,
} from '@keeper/sleeper-adapter';
import { createServiceClientFromEnv, KeeperRepository } from '@keeper/persistence';
import type { LeagueId, SeasonId } from '@keeper/domain';
import { LEAGUE_LINEUP, resolveSleeperLeagueId } from './league-config.js';
import { canReplaceKeeperState, canReplacePickInventory } from './replacement-authority.js';

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
const seasonId = `season:${sleeperLeagueId}` as SeasonId;

const repository = new KeeperRepository(createServiceClientFromEnv());

// Raw payloads are captured as they arrive, before validation, so a response that later
// fails a schema check is still on record.
//
// Collecting them in memory and writing at the end did not achieve that: a validation
// error thrown mid-import exited before the write, and the malformed payload that caused it
// was the one thing lost. That is exactly backwards -- the run that fails is the run whose
// payloads someone needs. They are flushed as they arrive instead.
//
// A failed flush must not abort the import it is only observing, so it is reported and the
// import continues.
let snapshotCount = 0;
const pendingSnapshotWrites: Promise<void>[] = [];

const adapter = createSleeperAdapter({
  snapshotSink: (snapshot) => {
    pendingSnapshotWrites.push(
      repository
        .saveRawSnapshots([
          {
            mapperVersion: snapshot.mapperVersion,
            endpoint: snapshot.endpoint,
            url: snapshot.url,
            fetchedAt: snapshot.fetchedAt,
            payload: snapshot.raw,
          },
        ])
        .then(() => {
          snapshotCount += 1;
        })
        .catch((error: unknown) => {
          console.warn(
            `  Could not persist the ${snapshot.endpoint} snapshot: ${
              error instanceof Error ? error.message : String(error)
            }`,
          );
        }),
    );
  },
});

console.log(`Importing league ${sleeperLeagueId}...`);

let imported: Awaited<ReturnType<typeof importSeasonDraftState>>;
let league: Awaited<ReturnType<typeof adapter.getLeague>>;
let leagueId: LeagueId;
try {
  league = await adapter.getLeague(sleeperLeagueId);
  const continuity = await resolveSleeperLeagueContinuity({
    current: league.data,
    loadLeague: async (id) => (await adapter.getLeague(id)).data,
  });
  leagueId = `league:${continuity.rootSleeperLeagueId}` as LeagueId;
  console.log(
    `Stable league identity: ${leagueId} (${continuity.sleeperLeagueIds.length} season(s) traced)`,
  );

  imported = await importSeasonDraftState({
    adapter,
    leagueId,
    seasonId,
    sleeperLeagueId,
  });
} catch (error) {
  // Whatever was captured before the failure is on record before the process leaves.
  await Promise.all(pendingSnapshotWrites);
  console.error(`
Import failed after persisting ${snapshotCount} raw snapshot(s).`);
  throw error;
}

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
let keeperReconstructionErrorCount = 0;
const priorLeagueId = league.data.previousSleeperLeagueId;
const playerNames: Record<string, string> = {};

/**
 * The prior season as a persistable record.
 *
 * Gathered here but written in the persist phase below, so the import keeps its shape of
 * reading everything first and writing once.
 */
interface PriorSeasonState {
  seasonId: SeasonId;
  sleeperLeagueId: string;
  seasonYear: number;
  status: 'pre_draft' | 'drafting' | 'in_season' | 'complete';
  sleeperDraftId: string;
  leagueName: string;
  teamCount: number;
  draftRounds: number;
  scoringSettings: Record<string, unknown>;
  lineup: Record<string, unknown>;
  rules: Record<string, unknown>;
  franchises: Parameters<KeeperRepository['saveFranchises']>[1];
  selections: readonly {
    sleeperDraftId: string;
    pickNo: number;
    round: number;
    draftSlot: number | null;
    rosterId: number | null;
    sleeperPlayerId: string | null;
    isKeeper: boolean;
  }[];
  rosterIdToFranchiseId: Record<number, string>;
}
let priorSeason: PriorSeasonState | null = null;

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
      if (diagnostic.level === 'error') {
        keeperReconstructionErrorCount += 1;
      }
    }

    // The picks above are the evidence behind every keeper cost this season. Deriving the
    // costs and discarding the picks left `prior_season_round` unauditable: a number with
    // nothing in the database to check it against. They are kept from here on.
    //
    // Franchise identity is owner-derived and league-scoped, and the league id here is the
    // stable root from the continuity chain, so a manager resolves to the same franchise in
    // both seasons and a prior selection can be attributed to whoever actually made it.
    try {
      const priorLeague = await adapter.getLeague(priorLeagueId);
      const priorRosters = await adapter.getLeagueRosters(priorLeagueId);
      const priorUsers = await adapter.getLeagueUsers(priorLeagueId);
      const priorFranchiseMap = buildFranchiseMap({
        leagueId,
        rosters: priorRosters.data,
        users: priorUsers.data,
      });
      const priorTeamCount = priorDraft.teamCount ?? priorLeague.data.totalRosters;
      const priorRounds =
        priorDraft.rounds ?? draftRoundsFallback(priorPicks.data.length, priorTeamCount);
      const priorLineup = deriveLineupSettings(priorLeague.data.rosterPositions);

      priorSeason = {
        seasonId: `season:${priorLeagueId}` as SeasonId,
        sleeperLeagueId: priorLeagueId,
        seasonYear: Number.parseInt(priorLeague.data.season, 10),
        status: priorLeague.data.status,
        sleeperDraftId: priorDraft.sleeperDraftId,
        leagueName: priorLeague.data.name,
        teamCount: priorTeamCount,
        draftRounds: priorRounds,
        scoringSettings: priorLeague.data.scoringSettings as Record<string, unknown>,
        lineup: (priorLineup.qb + priorLineup.rb + priorLineup.wr > 0
          ? priorLineup
          : LEAGUE_LINEUP) as unknown as Record<string, unknown>,
        rules: deriveLeagueRules({
          settings: priorLeague.data.settings,
          policy: RECORDED_LEAGUE_POLICY,
          teamCount: priorTeamCount,
          draftRounds: priorRounds,
          thirdRoundReversal: undefined,
        }).rules as unknown as Record<string, unknown>,
        franchises: priorFranchiseMap.mapped.map((entry) => ({
          franchise: { id: entry.franchiseId, leagueId, displayName: entry.displayName },
          sleeperRosterId: entry.rosterId,
          sleeperOwnerId: entry.ownerSleeperUserId,
          identitySource: entry.source,
        })),
        selections: priorPicks.data,
        rosterIdToFranchiseId: priorFranchiseMap.rosterIdToFranchiseId,
      };
    } catch (error) {
      // The prior season is a historical record, not something this season's correctness
      // depends on. Failing to capture it is reported and the import continues.
      console.warn(
        `\n  Could not capture the prior season for persistence: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }
}

/** Rounds implied by a completed draft when the draft payload does not state them. */
function draftRoundsFallback(pickCount: number, teamCount: number): number {
  return teamCount > 0 ? Math.max(1, Math.round(pickCount / teamCount)) : 15;
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

await Promise.all(pendingSnapshotWrites);

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

// The prior season, written before its selections so the foreign keys resolve: the season
// row, then the franchises the picks are attributed to, then the players they took.
//
// Every write here is an upsert and none of them replace. A completed draft does not lose
// picks, so there is no stale row to prune, and a failed read must never be able to delete
// a historical record it simply could not see.
let priorSelectionCount = 0;

if (priorSeason) {
  await repository.saveLeagueSeason({
    leagueId,
    leagueName: priorSeason.leagueName,
    rulesVersion: '2026.1',
    seasonId: priorSeason.seasonId,
    seasonYear: priorSeason.seasonYear,
    sleeperLeagueId: priorSeason.sleeperLeagueId,
    previousSleeperLeagueId: null,
    status: priorSeason.status,
    sleeperDraftId: priorSeason.sleeperDraftId,
    teamCount: priorSeason.teamCount,
    draftRounds: priorSeason.draftRounds,
    scoringSettings: priorSeason.scoringSettings,
    lineup: priorSeason.lineup,
    rules: priorSeason.rules,
  });

  await repository.saveFranchises(priorSeason.seasonId, priorSeason.franchises);

  const priorPlayerIds = [
    ...new Set(
      priorSeason.selections
        .map((selection) => selection.sleeperPlayerId)
        .filter((id): id is string => id !== null),
    ),
  ];
  const priorPlayers = await repository.readPlayersBySleeperId(priorPlayerIds);
  const priorUnmatchedPlayerCount = priorPlayerIds.filter((id) => !priorPlayers.has(id)).length;

  await repository.savePlayers(
    priorPlayerIds
      .map((sleeperPlayerId) => priorPlayers.get(sleeperPlayerId))
      .filter((player): player is NonNullable<typeof player> => player !== undefined),
  );

  // A pick whose player or roster cannot be resolved is still recorded, with the unresolved
  // side left null. The row is evidence the pick happened; dropping it would put a hole in
  // the very record this exists to make auditable.
  priorSelectionCount = await repository.saveDraftSelections(
    priorSeason.selections.map((selection) => ({
      sleeperDraftId: selection.sleeperDraftId,
      seasonId: priorSeason!.seasonId,
      overallPick: selection.pickNo,
      round: selection.round,
      slot: selection.draftSlot,
      franchiseId:
        selection.rosterId === null
          ? null
          : (priorSeason!.rosterIdToFranchiseId[selection.rosterId] ?? null),
      playerId:
        selection.sleeperPlayerId === null
          ? null
          : (priorPlayers.get(selection.sleeperPlayerId)?.id ?? null),
      isKeeper: selection.isKeeper,
      source: 'sleeper' as const,
    })),
  );

  if (priorUnmatchedPlayerCount > 0) {
    console.warn(
      `\n  ${priorUnmatchedPlayerCount} player(s) from the ${priorSeason.seasonYear} draft are not in ` +
        'the catalog; those selections were recorded without a player link.',
    );
  }
}

const persistableRights = keeperRights.filter((right) => knownPlayers.has(String(right.playerId)));

// A right is what a keeper would cost; a decision is what someone actually declared. Only
// the declared ones become decisions, and that set is what removes players from the draft
// pool -- writing a decision per right would take every rostered player off the board.
const declared = new Set(declaredSleeperPlayerIds);
const declaredRights = persistableRights.filter((right) => declared.has(String(right.playerId)));

// An import states what the season *is*, so anything it omits has to be removed rather
// than left behind: upserting alone meant a withdrawn declaration kept its player off the
// draft board forever.
//
// Order is forced by the foreign keys. Rights are written first so decisions can reference
// them, decisions are replaced next, and only then are stale rights and picks pruned --
// deleting a right or a pick still referenced by a decision would be rejected.
// Whether this import is entitled to speak for the whole season.
//
// `importSeasonDraftState` returns an error diagnostic and an empty pick inventory when it
// cannot find or read the draft, and that is a recoverable condition -- a rate limit, a
// draft not yet created. Replacing on it deletes all 180 stored picks. An empty prior draft
// does the same to every keeper right and declaration. A failed read is not a statement
// that the season is empty, so partial imports fall back to merging and say so.
const importErrors = imported.diagnostics.filter((diagnostic) => diagnostic.level === 'error');
const inventoryIsAuthoritative = canReplacePickInventory({
  importErrorCount: importErrors.length,
  pickCount: imported.pickInventory.length,
});
const rightsAreAuthoritative = canReplaceKeeperState({
  reconstructionErrorCount: keeperReconstructionErrorCount,
  reconstructedRightCount: keeperRights.length,
  persistableRightCount: persistableRights.length,
  missingPlayerCount: missingPlayerIds.length,
});

for (const diagnostic of importErrors) {
  console.warn(`  [${diagnostic.code}] ${diagnostic.message}`);
}

await repository.saveKeeperRights(persistableRights);

const decisionRecords = declaredRights.map((right) => ({
  seasonId,
  franchiseId: String(right.franchiseId),
  playerId: String(right.playerId),
  keeperRightId: String(right.id),
  resolvedPickAssetId: null,
  source: 'sleeper' as const,
  declaredAt: null,
}));

const decisions = rightsAreAuthoritative
  ? await repository.replaceKeeperDecisions(seasonId, decisionRecords)
  : { written: await repository.saveKeeperDecisions(decisionRecords), removed: 0 };

const rights = rightsAreAuthoritative
  ? await repository.replaceKeeperRights(seasonId, persistableRights)
  : { written: await repository.saveKeeperRights(persistableRights), removed: 0 };

const picks = inventoryIsAuthoritative
  ? await repository.replacePickInventory(seasonId, imported.pickInventory)
  : { written: await repository.savePickInventory(imported.pickInventory), removed: 0 };

if (!inventoryIsAuthoritative || !rightsAreAuthoritative) {
  console.warn(
    '\n  This import was incomplete, so stored rows it did not mention were left in place ' +
      'rather than deleted. Re-run once the underlying problem is fixed.',
  );
}

const pickCount = picks.written;
const rightCount = rights.written;
const decisionCount = decisions.written;

console.log('\nWritten');
console.log(`  raw snapshots     ${snapshotCount}`);
console.log(`  franchises        ${franchiseCount}`);
console.log(`  players           ${playerCount} (from catalog)`);
console.log(`  pick assets       ${pickCount}${removedSuffix(picks.removed)}`);
console.log(
  `  keeper rights     ${rightCount} (one per rostered player)${removedSuffix(rights.removed)}`,
);
console.log(`  keeper decisions  ${decisionCount} (declared)${removedSuffix(decisions.removed)}`);
console.log(
  `  prior selections  ${priorSelectionCount}` +
    (priorSeason ? ` (${priorSeason.seasonYear} draft)` : ' (no prior season captured)'),
);

console.log('\nRead back from the database');
for (const table of [
  'raw_api_snapshots',
  'franchises',
  'franchise_seasons',
  'draft_pick_assets',
  'draft_selections',
  'keeper_rights',
  'keeper_decisions',
]) {
  console.log(`  ${table.padEnd(20)} ${await repository.countRows(table)}`);
}

const readBack = await repository.readFranchises(seasonId);
console.log(`\nFranchises read back: ${readBack.length}`);
console.log(`  ${readBack.map((f) => f.displayName).join(', ')}`);

/** Removals are the part a merge-only import used to hide, so they are always reported. */
function removedSuffix(removed: number): string {
  return removed > 0 ? `, ${removed} removed` : '';
}
