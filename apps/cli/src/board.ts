import { readFileSync } from 'node:fs';
import type { Position, SeasonId } from '@keeper/domain';
import { loadProjections } from '@keeper/projections';
import { computeReplacementLevels } from '@keeper/valuation';
import { LEAGUE_LINEUP, LEAGUE_SCORING, LEAGUE_TEAM_COUNT } from './league-config.js';

/**
 * Prints the draft board for this league from exported projection files.
 *
 *   npm run board -w @keeper/cli -- <skill.csv> [defense.csv] [--top=40]
 *
 * The source's own FPTS column is ignored; every player is rescored from component stats
 * under the league's real settings.
 */
const args = process.argv.slice(2);
const files = args.filter((arg) => !arg.startsWith('--'));
const topFlag = args.find((arg) => arg.startsWith('--top='));
const top = topFlag ? Number.parseInt(topFlag.slice('--top='.length), 10) : 40;

const [skillPath, defensePath] = files;
if (!skillPath) {
  console.error('Usage: npm run board -w @keeper/cli -- <skill.csv> [defense.csv] [--top=40]');
  process.exit(1);
}

const loaded = loadProjections({
  skillPositionCsv: readFileSync(skillPath, 'utf8'),
  defenseCsv: defensePath ? readFileSync(defensePath, 'utf8') : undefined,
  scoring: LEAGUE_SCORING,
  seasonId: 'season-2026' as SeasonId,
});

const projectedByPlayerId = new Map(
  loaded.playerSeasons.map((season) => [season.playerId, season.projectedPoints ?? 0]),
);

const replacementLevels = computeReplacementLevels({
  candidates: loaded.players.map((player) => ({
    position: player.position,
    projectedPoints: projectedByPlayerId.get(player.id) ?? 0,
  })),
  lineup: LEAGUE_LINEUP,
  teamCount: LEAGUE_TEAM_COUNT,
});

const board = loaded.players
  .map((player) => {
    const projected = projectedByPlayerId.get(player.id) ?? 0;
    return {
      name: player.fullName,
      position: player.position,
      projected,
      valueOverReplacement: Math.max(0, projected - (replacementLevels[player.position] ?? 0)),
    };
  })
  .sort((left, right) => right.valueOverReplacement - left.valueOverReplacement);

console.log(`Players loaded: ${loaded.players.length}`);
console.log('\nReplacement levels');
for (const position of ['QB', 'RB', 'WR', 'TE', 'DEF'] as Position[]) {
  const level = replacementLevels[position];
  if (level !== undefined) {
    console.log(`  ${position.padEnd(4)} ${level.toFixed(1)}`);
  }
}

console.log(`\nTop ${top} by value over replacement`);
console.log('  ##  POS  Player                     Proj     VOR');
board.slice(0, top).forEach((row, index) => {
  console.log(
    `  ${String(index + 1).padStart(2)}  ${row.position.padEnd(4)} ${row.name.padEnd(24)} ${row.projected
      .toFixed(1)
      .padStart(6)}  ${row.valueOverReplacement.toFixed(1).padStart(6)}`,
  );
});

console.log('\nBest at each position');
for (const position of ['QB', 'RB', 'WR', 'TE', 'DEF'] as Position[]) {
  const best = board.filter((row) => row.position === position).slice(0, 3);
  if (best.length > 0) {
    console.log(
      `  ${position.padEnd(4)} ${best
        .map((row) => `${row.name} (${row.valueOverReplacement.toFixed(0)})`)
        .join('  |  ')}`,
    );
  }
}

if (loaded.diagnostics.length > 0) {
  console.log('\nDiagnostics');
  for (const diagnostic of loaded.diagnostics) {
    console.log(`  [${diagnostic.code}] ${diagnostic.message}`);
  }
}
