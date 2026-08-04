import {
  buildFranchiseMap,
  createSleeperAdapter,
  deriveLeagueRules,
  deriveLineupSettings,
  importSeasonDraftState,
  reconstructKeeperRights,
  RECORDED_LEAGUE_POLICY,
  resolveSleeperLeagueContinuity,
  type NormalizedSleeperDraftPick,
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
let continuity: Awaited<ReturnType<typeof resolveSleeperLeagueContinuity>>;
try {
  league = await adapter.getLeague(sleeperLeagueId);
  continuity = await resolveSleeperLeagueContinuity({
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
 * A past season as a persistable record.
 *
 * Gathered here but written in the persist phase below, so the import keeps its shape of
 * reading everything first and writing once.
 */
interface HistoricalSeasonState {
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
  selections: readonly NormalizedSleeperDraftPick[];
  rosterIdToFranchiseId: Record<number, string>;
}

/**
 * Every completed season the chain knows about, oldest last.
 *
 * One season back is enough to price this year's keepers, but not to check them. A keeper
 * displaced onto an earlier pick is recorded at the round it actually consumed, so reading
 * next year's cost off that recorded round accelerates the player's curve permanently --
 * and telling that apart from ordinary progression needs the season before it too. With
 * the whole chain stored, nominal and effective can be compared for every keeper in every
 * season rather than assumed equal.
 */
const historicalSeasons: HistoricalSeasonState[] = [];
for (const historicalLeagueId of continuity.sleeperLeagueIds.filter(
  (id) => id !== sleeperLeagueId,
)) {
  const captured = await captureHistoricalSeason(historicalLeagueId);
  if (captured) {
    historicalSeasons.push(captured);
  }
}

// Keeper costs come from the season immediately before this one, which the chain walk has
// already read. Reusing it here avoids fetching the same draft twice.
const priorSeason =
  historicalSeasons.find((season) => season.sleeperLeagueId === priorLeagueId) ?? null;

if (priorSeason) {
  for (const pick of priorSeason.selections) {
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
    priorSeasonSelections: [...priorSeason.selections],
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
}

/**
 * Reads one past season into a persistable record, or reports why it could not.
 *
 * Franchise identity is owner-derived and league-scoped, and the league id is the stable
 * root from the continuity chain, so a manager resolves to the same franchise in every
 * season and a selection can be attributed to whoever actually made it.
 *
 * A season that cannot be read is a gap in the history, not a failure of the import that
 * only observes it, so this returns null and the run continues.
 */
async function captureHistoricalSeason(
  historicalLeagueId: string,
): Promise<HistoricalSeasonState | null> {
  try {
    const drafts = await adapter.getLeagueDrafts(historicalLeagueId);
    const draft = drafts.data[0];
    if (!draft) {
      console.warn(`\n  Season ${historicalLeagueId} has no draft to record.`);
      return null;
    }

    const [historicalLeague, picks, historicalRosters, historicalUsers] = await Promise.all([
      adapter.getLeague(historicalLeagueId),
      adapter.getDraftPicks(draft.sleeperDraftId),
      adapter.getLeagueRosters(historicalLeagueId),
      adapter.getLeagueUsers(historicalLeagueId),
    ]);

    const historicalFranchiseMap = buildFranchiseMap({
      leagueId,
      rosters: historicalRosters.data,
      users: historicalUsers.data,
    });
    const historicalTeamCount = draft.teamCount ?? historicalLeague.data.totalRosters;
    const historicalRounds =
      draft.rounds ?? draftRoundsFallback(picks.data.length, historicalTeamCount);
    const historicalLineup = deriveLineupSettings(historicalLeague.data.rosterPositions);

    return {
      seasonId: `season:${historicalLeagueId}` as SeasonId,
      sleeperLeagueId: historicalLeagueId,
      seasonYear: Number.parseInt(historicalLeague.data.season, 10),
      status: historicalLeague.data.status,
      sleeperDraftId: draft.sleeperDraftId,
      leagueName: historicalLeague.data.name,
      teamCount: historicalTeamCount,
      draftRounds: historicalRounds,
      scoringSettings: historicalLeague.data.scoringSettings as Record<string, unknown>,
      lineup: (historicalLineup.qb + historicalLineup.rb + historicalLineup.wr > 0
        ? historicalLineup
        : LEAGUE_LINEUP) as unknown as Record<string, unknown>,
      rules: deriveLeagueRules({
        settings: historicalLeague.data.settings,
        policy: RECORDED_LEAGUE_POLICY,
        teamCount: historicalTeamCount,
        draftRounds: historicalRounds,
        thirdRoundReversal: undefined,
      }).rules as unknown as Record<string, unknown>,
      franchises: historicalFranchiseMap.mapped.map((entry) => ({
        franchise: { id: entry.franchiseId, leagueId, displayName: entry.displayName },
        sleeperRosterId: entry.rosterId,
        sleeperOwnerId: entry.ownerSleeperUserId,
        identitySource: entry.source,
      })),
      selections: picks.data,
      rosterIdToFranchiseId: historicalFranchiseMap.rosterIdToFranchiseId,
    };
  } catch (error) {
    console.warn(
      `\n  Could not capture season ${historicalLeagueId}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    return null;
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

// Each past season, written before its selections so the foreign keys resolve: the season
// row, then the franchises the picks are attributed to, then the players they took.
//
// Every write here is an upsert and none of them replace. A completed draft does not lose
// picks, so there is no stale row to prune, and a failed read must never be able to delete
// a historical record it simply could not see.
//
// Seasons are written oldest first so that `previous_sleeper_league_id` always points at a
// row that already exists, making the stored chain walkable in the same direction Sleeper's
// is.
let historicalSelectionCount = 0;

for (const season of [...historicalSeasons].sort(
  (left, right) => left.seasonYear - right.seasonYear,
)) {
  const previousInChain =
    historicalSeasons.find((candidate) => candidate.seasonYear === season.seasonYear - 1)
      ?.sleeperLeagueId ?? null;

  await repository.saveLeagueSeason({
    leagueId,
    leagueName: season.leagueName,
    rulesVersion: '2026.1',
    seasonId: season.seasonId,
    seasonYear: season.seasonYear,
    sleeperLeagueId: season.sleeperLeagueId,
    previousSleeperLeagueId: previousInChain,
    status: season.status,
    sleeperDraftId: season.sleeperDraftId,
    teamCount: season.teamCount,
    draftRounds: season.draftRounds,
    scoringSettings: season.scoringSettings,
    lineup: season.lineup,
    rules: season.rules,
  });

  await repository.saveFranchises(season.seasonId, season.franchises);

  const seasonPlayerIds = [
    ...new Set(
      season.selections
        .map((selection) => selection.sleeperPlayerId)
        .filter((id): id is string => id !== null),
    ),
  ];
  const seasonPlayers = await repository.readPlayersBySleeperId(seasonPlayerIds);
  const unmatchedPlayerCount = seasonPlayerIds.filter((id) => !seasonPlayers.has(id)).length;

  await repository.savePlayers(
    seasonPlayerIds
      .map((sleeperPlayerId) => seasonPlayers.get(sleeperPlayerId))
      .filter((player): player is NonNullable<typeof player> => player !== undefined),
  );

  // A pick whose player or roster cannot be resolved is still recorded, with the unresolved
  // side left null. The row is evidence the pick happened; dropping it would put a hole in
  // the very record this exists to make auditable.
  historicalSelectionCount += await repository.saveDraftSelections(
    season.selections.map((selection) => ({
      sleeperDraftId: selection.sleeperDraftId,
      seasonId: season.seasonId,
      overallPick: selection.pickNo,
      round: selection.round,
      slot: selection.draftSlot,
      franchiseId:
        selection.rosterId === null
          ? null
          : (season.rosterIdToFranchiseId[selection.rosterId] ?? null),
      playerId:
        selection.sleeperPlayerId === null
          ? null
          : (seasonPlayers.get(selection.sleeperPlayerId)?.id ?? null),
      isKeeper: selection.isKeeper,
      source: 'sleeper' as const,
    })),
  );

  if (unmatchedPlayerCount > 0) {
    console.warn(
      `\n  ${unmatchedPlayerCount} player(s) from the ${season.seasonYear} draft are not in ` +
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
  `  past selections   ${historicalSelectionCount}` +
    (historicalSeasons.length > 0
      ? ` (${historicalSeasons.length} season(s): ${historicalSeasons
          .map((season) => season.seasonYear)
          .sort()
          .join(', ')})`
      : ' (no past season captured)'),
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
