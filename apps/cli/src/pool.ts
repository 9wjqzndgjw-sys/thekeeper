import type { SeasonId } from '@keeper/domain';
import { buildDraftPool } from '@keeper/draft-sim';
import { createServiceClientFromEnv, loadLeagueSnapshot } from '@keeper/persistence';
import { resolveSleeperLeagueId } from './league-config.js';

/**
 * Reports whether the stored league can actually be rehearsed, and what the draft looks
 * like before anyone picks.
 *
 *   npm run pool -w @keeper/cli
 *
 * This is the gate in front of the simulator rather than a feature of it. A rehearsal fails
 * silently: a pool missing forty players, or an order handing picks to the wrong manager,
 * still produces a draft that looks entirely plausible and teaches the wrong thing. Better
 * to refuse and say why.
 */
const sleeperLeagueId = resolveSleeperLeagueId(
  process.argv.slice(2).find((arg) => !arg.startsWith('--')),
);
const seasonId = `season:${sleeperLeagueId}` as SeasonId;

const loaded = await loadLeagueSnapshot({
  client: createServiceClientFromEnv(),
  seasonId,
});

const pool = buildDraftPool({
  snapshot: loaded.snapshot,
  players: loaded.players,
  declaredPlayerIds: loaded.declaredPlayerIds,
});

const liveSelections = pool.order.filter((slot) => slot.consumedByKeeperRightId === null).length;
const keeperPicks = pool.order.length - liveSelections;

console.log(`League               ${loaded.snapshot.league.name}`);
console.log(
  `Season               ${loaded.snapshot.season.year} (${loaded.snapshot.season.status})`,
);
console.log(`Draftable players    ${pool.players.length}`);
console.log(`Kept, off the board  ${pool.keptPlayerIds.size}`);
console.log(`Picks in the order   ${pool.order.length}`);
console.log(`  consumed by keeper ${keeperPicks}`);
console.log(`  live selections    ${liveSelections}`);

console.log('\nPool by position');
const byPosition = new Map<string, number>();
for (const player of pool.players) {
  byPosition.set(player.position, (byPosition.get(player.position) ?? 0) + 1);
}
for (const [position, count] of [...byPosition.entries()].sort()) {
  const replacement = pool.replacementLevels[position as keyof typeof pool.replacementLevels] ?? 0;
  console.log(
    `  ${position.padEnd(4)} ${String(count).padStart(4)}   replacement ${replacement.toFixed(1)}`,
  );
}

console.log('\nHow each team arrives');
console.log(
  `  ${'team'.padEnd(14)} ${'picks'.padStart(5)} ${'keep'.padStart(5)} ${'live'.padStart(5)} ${'gap'.padStart(5)}`,
);
for (const posture of pool.postures) {
  const gap = posture.rosterGap > 0 ? `+${posture.rosterGap}` : String(posture.rosterGap);
  console.log(
    `  ${posture.displayName.padEnd(14)} ${String(posture.picksOwned).padStart(5)} ` +
      `${String(posture.keeperPicks).padStart(5)} ${String(posture.liveSelections).padStart(5)} ${gap.padStart(5)}`,
  );
}

console.log('\nTop of the board');
for (const player of pool.players.slice(0, 10)) {
  console.log(
    `  ${player.fullName.padEnd(24)} ${player.position.padEnd(4)} ` +
      `${player.projectedPoints.toFixed(1).padStart(7)} pts   IV ${player.intrinsicValue.toFixed(1).padStart(6)}`,
  );
}

if (pool.readiness.warnings.length > 0) {
  console.log('\nWarnings');
  for (const warning of pool.readiness.warnings) {
    console.log(`  - ${warning}`);
  }
}

if (loaded.caveats.length > 0) {
  console.log('\nCaveats from the stored league');
  for (const caveat of loaded.caveats) {
    console.log(`  - ${caveat}`);
  }
}

if (!pool.readiness.ok) {
  console.error('\nNot ready to rehearse');
  for (const blocker of pool.readiness.blockers) {
    console.error(`  - ${blocker}`);
  }
  process.exit(1);
}

console.log('\nReady to rehearse.');
