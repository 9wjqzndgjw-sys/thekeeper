import { readFileSync } from 'node:fs';
import type { SeasonId } from '@keeper/domain';
import { createServiceClientFromEnv, KeeperRepository } from '@keeper/persistence';
import { loadProjections, matchProjectionsToCatalog } from '@keeper/projections';
import type { SleeperScoringSettings } from '@keeper/valuation';
import { LEAGUE_SCORING, resolveSleeperLeagueId } from './league-config.js';
import { canReplaceProjections, MINIMUM_PROJECTION_MATCH_RATE } from './replacement-authority.js';

/**
 * Scores projection exports under this league's settings and stores the result.
 *
 *   npm run project -w @keeper/cli
 *
 * The dashboard cannot read a CSV off your disk, so this is what puts projections somewhere
 * a hosted page can reach. The source's own fantasy point totals are ignored throughout;
 * every player is rescored from component stats, because an export scored for full PPR says
 * nothing useful about a half-PPR league with a tight end bonus.
 */
const sleeperLeagueId = resolveSleeperLeagueId(
  process.argv.slice(2).find((arg) => !arg.startsWith('--')),
);
const seasonId = `season:${sleeperLeagueId}` as SeasonId;

const skillCsv = process.env.KEEPER_SKILL_PROJECTIONS_CSV;
const defenseCsv = process.env.KEEPER_DEFENSE_PROJECTIONS_CSV;
if (!skillCsv) {
  console.error('Set KEEPER_SKILL_PROJECTIONS_CSV in .env.local.');
  process.exit(1);
}

const repository = new KeeperRepository(createServiceClientFromEnv());

// Scoring comes from the imported league rather than the checked-in constant. The two
// agree today, but a rule change lands in Sleeper and the constant would keep rescoring
// every player under last year's rules while looking entirely confident about it.
const storedSeason = await repository.readLeagueSeason(seasonId);
const storedScoring = storedSeason?.scoringSettings ?? {};
const usingStoredScoring = Object.keys(storedScoring).length > 0;

if (!usingStoredScoring) {
  console.warn(
    '  No scoring settings stored for this season, so the checked-in constant was used. Run ' +
      '"npm run sync -w @keeper/cli" first to score under the rules the league actually has.',
  );
}

const loaded = loadProjections({
  skillPositionCsv: readFileSync(skillCsv, 'utf8'),
  defenseCsv: defenseCsv ? readFileSync(defenseCsv, 'utf8') : undefined,
  scoring: usingStoredScoring ? (storedScoring as SleeperScoringSettings) : LEAGUE_SCORING,
  seasonId,
});

console.log(
  `Scoring source:      ${usingStoredScoring ? 'imported league settings' : 'checked-in constant'}`,
);

const projectedById = new Map(
  loaded.playerSeasons.map((season) => [String(season.playerId), season.projectedPoints ?? 0]),
);

const catalog = await repository.readAllPlayers();
if (catalog.length === 0) {
  console.error('The player catalog is empty. Run "npm run catalog -w @keeper/cli" first.');
  process.exit(1);
}

// Identity comes from the catalog, so a stored projection always points at a real player.
const matched = matchProjectionsToCatalog({
  catalog,
  projections: loaded.players.map((player) => ({
    fullName: player.fullName,
    position: player.position,
    projectedPoints: projectedById.get(String(player.id)) ?? 0,
  })),
});

const catalogIdBySleeperId = new Map(
  catalog.filter((player) => player.sleeperPlayerId).map((p) => [p.sleeperPlayerId!, p.id]),
);

console.log(`Projections loaded:  ${loaded.players.length}`);
console.log(`Matched to catalog:  ${matched.pointsBySleeperId.size}`);
if (matched.unmatchedProjectionNames.length > 0) {
  console.log(`Unmatched:           ${matched.unmatchedProjectionNames.length}`);
  console.log(`  ${matched.unmatchedProjectionNames.slice(0, 12).join(', ')}`);
}

// Replacement is only safe when the load actually succeeded.
//
// The parser refuses to guess at an unreadable export and returns no players, which is
// right -- but replacing on that result deletes the last good projections and leaves the
// season empty or, worse, defences only. A file that could not be read is not a statement
// that the season has no players in it.
const loadErrors = loaded.diagnostics.filter((diagnostic) => diagnostic.level === 'error');
const projectionsAreAuthoritative = canReplaceProjections({
  loadErrorCount: loadErrors.length,
  loadedPlayerCount: loaded.players.length,
  matchedPlayerCount: matched.pointsBySleeperId.size,
});

if (!projectionsAreAuthoritative) {
  console.error('\nRefusing to replace stored projections; nothing was written.');
  for (const diagnostic of loadErrors) {
    console.error(`  [${diagnostic.code}] ${diagnostic.message}`);
  }
  if (loadErrors.length === 0) {
    console.error(
      loaded.players.length === 0
        ? '  The export produced no players at all.'
        : `  Only ${matched.pointsBySleeperId.size} of ${loaded.players.length} exported players matched the catalog; at least ${MINIMUM_PROJECTION_MATCH_RATE * 100}% must match. Refresh the catalog and retry.`,
    );
  }
  process.exit(1);
}

// Replaced rather than merged: a player dropped from the export should leave the board,
// not linger on last week's projection.
const { written, removed } = await repository.replacePlayerSeasons(
  seasonId,
  [...matched.pointsBySleeperId.entries()].flatMap(([sleeperId, projectedPoints]) => {
    const playerId = catalogIdBySleeperId.get(sleeperId);
    return playerId === undefined
      ? []
      : [
          {
            seasonId,
            playerId,
            projectedPoints,
            projectionSource: 'fantasy-pros-rescored',
          },
        ];
  }),
);

console.log(`\nWrote ${written} player season(s)${removed > 0 ? `, removed ${removed}` : ''}.`);
console.log(`  player_seasons rows: ${await repository.countRows('player_seasons')}`);

if (loaded.diagnostics.length > 0) {
  console.log('\nDiagnostics');
  for (const diagnostic of loaded.diagnostics) {
    console.log(`  [${diagnostic.code}] ${diagnostic.message}`);
  }
}
