import { createSleeperAdapter } from '@keeper/sleeper-adapter';
import { createServiceClientFromEnv, KeeperRepository } from '@keeper/persistence';
import { resolveSleeperLeagueId } from './league-config.js';

/**
 * Pulls the Sleeper player catalog and stores it.
 *
 *   npm run catalog -w @keeper/cli
 *
 * Kept as its own command rather than folded into `sync` because the response is around
 * five megabytes and Sleeper asks that it be fetched no more than once a day. Everything
 * else reads player identity from the database instead of re-fetching.
 */
// Reads .env.local as a side effect, and fails early if the environment is not set up.
resolveSleeperLeagueId(process.env.SLEEPER_LEAGUE_ID ?? '0');

const adapter = createSleeperAdapter();
const repository = new KeeperRepository(createServiceClientFromEnv());

console.log('Fetching the Sleeper player catalog (~5MB)...');
const started = Date.now();
const catalog = await adapter.getPlayers('nfl');
console.log(`  fetched in ${((Date.now() - started) / 1000).toFixed(1)}s`);

const byPosition = new Map<string, number>();
for (const player of catalog.data.players) {
  byPosition.set(player.position, (byPosition.get(player.position) ?? 0) + 1);
}

console.log(`\nUsable players: ${catalog.data.players.length}`);
for (const [position, count] of [...byPosition].sort()) {
  console.log(`  ${position.padEnd(4)} ${count}`);
}
console.log(
  `Skipped ${catalog.data.skippedSleeperPlayerIds.length} entries at positions this league does not roster.`,
);

console.log('\nPersisting...');
const written = await repository.savePlayers(
  catalog.data.players.map((player) => ({
    id: player.sleeperPlayerId ?? String(player.id),
    fullName: player.fullName,
    position: player.position,
    sleeperPlayerId: player.sleeperPlayerId,
  })),
);

console.log(`  wrote ${written}`);
console.log(`  players in database: ${await repository.countRows('players')}`);
