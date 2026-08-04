import type { FranchiseId, SeasonId } from '@keeper/domain';
import { buildDraftPool, createDraftSim } from '@keeper/draft-sim';
import { createServiceClientFromEnv, loadLeagueSnapshot } from '@keeper/persistence';
import { resolveSleeperLeagueId } from './league-config.js';

/**
 * Runs a draft against the real league and shows what reached each of your picks.
 *
 *   npm run rehearse -w @keeper/cli -- --team=RPG --seed=7
 *
 * The user's picks are taken best-available here, because the terminal is not where the
 * choosing happens -- that belongs in the live board. What this answers is the question
 * underneath a rehearsal: given how the room drafts, who is actually on the table when your
 * turn comes round.
 */
const args = process.argv.slice(2);
const flag = (name: string): string | undefined =>
  args.find((arg) => arg.startsWith(`--${name}=`))?.split('=')[1];

const sleeperLeagueId = resolveSleeperLeagueId(args.find((arg) => !arg.startsWith('--')));
const seasonId = `season:${sleeperLeagueId}` as SeasonId;
const seed = Number.parseInt(flag('seed') ?? '1', 10);
const teamName = flag('team');

const loaded = await loadLeagueSnapshot({
  client: createServiceClientFromEnv(),
  seasonId,
});

const franchise = teamName
  ? loaded.snapshot.franchises.find(
      (candidate) => candidate.displayName.toLowerCase() === teamName.toLowerCase(),
    )
  : loaded.snapshot.franchises.find(
      (candidate) => candidate.id === loaded.snapshot.userFranchiseId,
    );

if (!franchise) {
  console.error(
    `No franchise named "${teamName}". Teams: ` +
      loaded.snapshot.franchises.map((candidate) => candidate.displayName).join(', '),
  );
  process.exit(1);
}

const pool = buildDraftPool({
  snapshot: loaded.snapshot,
  players: loaded.players,
  declaredPlayerIds: loaded.declaredPlayerIds,
});

if (!pool.readiness.ok) {
  console.error('Not ready to rehearse');
  for (const blocker of pool.readiness.blockers) {
    console.error(`  - ${blocker}`);
  }
  process.exit(1);
}

const sim = createDraftSim({
  pool,
  userFranchiseId: franchise.id as FranchiseId,
  seed,
});

console.log(`Rehearsing as ${franchise.displayName}, seed ${seed}\n`);

let state = sim.advance();
while (state.status === 'awaiting_user') {
  const slot = state.onTheClock!;
  const board = state.available.slice(0, 5);
  const taken = board[0]!;

  console.log(
    `R${String(slot.round).padStart(2)} pick ${String(slot.overallPick).padStart(3)}  ` +
      `-> ${taken.fullName} (${taken.position}, IV ${taken.intrinsicValue.toFixed(1)})`,
  );
  console.log(
    `${' '.repeat(20)}also there: ` +
      board
        .slice(1)
        .map((candidate) => `${candidate.fullName} ${candidate.position}`)
        .join(', '),
  );

  state = sim.submitUserPick(taken.playerId);
}

const mine = state.selections.filter((selection) => selection.byUser);
console.log(`\n${franchise.displayName} finishes with ${mine.length} players\n`);
for (const selection of mine) {
  console.log(
    `  R${String(selection.round).padStart(2)} ${String(selection.overallPick).padStart(3)}  ` +
      `${selection.fullName.padEnd(24)} ${selection.position.padEnd(4)}` +
      `${selection.isKeeper ? '  (keeper)' : ''}`,
  );
}

const byPosition = new Map<string, number>();
for (const selection of mine) {
  byPosition.set(selection.position, (byPosition.get(selection.position) ?? 0) + 1);
}
console.log(
  `\n  ${[...byPosition.entries()]
    .sort()
    .map(([position, count]) => `${position} ${count}`)
    .join('   ')}`,
);
console.log(`\nDraft made ${state.selections.length} selections in total.`);
