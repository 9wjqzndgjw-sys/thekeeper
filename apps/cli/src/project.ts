import { readFileSync } from 'node:fs';
import type { SeasonId } from '@keeper/domain';
import { createServiceClientFromEnv, KeeperRepository } from '@keeper/persistence';
import { loadProjections, matchProjectionsToCatalog } from '@keeper/projections';
import { LEAGUE_SCORING, resolveSleeperLeagueId } from './league-config.js';

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

const loaded = loadProjections({
  skillPositionCsv: readFileSync(skillCsv, 'utf8'),
  defenseCsv: defenseCsv ? readFileSync(defenseCsv, 'utf8') : undefined,
  scoring: LEAGUE_SCORING,
  seasonId,
});

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

const written = await repository.savePlayerSeasons(
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

console.log(`\nWrote ${written} player season(s).`);
console.log(`  player_seasons rows: ${await repository.countRows('player_seasons')}`);

if (loaded.diagnostics.length > 0) {
  console.log('\nDiagnostics');
  for (const diagnostic of loaded.diagnostics) {
    console.log(`  [${diagnostic.code}] ${diagnostic.message}`);
  }
}
