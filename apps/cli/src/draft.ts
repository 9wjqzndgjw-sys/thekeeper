import {
  computeLiveDraftBoard,
  createDraftTracker,
  createSleeperSelectionFetcher,
  type SleeperDraftPickLike,
  type TrackedSelection,
} from '@keeper/draft-tracker';
import type { DraftPickAsset, FranchiseId } from '@keeper/domain';
import { createMockDraftRehearsal } from '@keeper/mock-draft';
import { createSnapshotProjectionSource } from '@keeper/valuation';
import { renderLiveBoard } from './draft-board.js';

/**
 * Replays a 12-team, 15-round mock draft through the real tracker. The source is synthetic,
 * but the moving parts are not: keeper slots arrive as draft selections, the board removes
 * those players before live picks begin, and every refresh recomputes replacement levels and
 * value at the user's next available pick.
 */
const rehearsal = createMockDraftRehearsal();
const draftId = rehearsal.snapshot.draft?.sleeperDraftId ?? 'draft-mock-draft-2026';
const projectionSource = createSnapshotProjectionSource(rehearsal.snapshot, 'mock-draft-rehearsal');

let stageIndex = 0;
const tracker = createDraftTracker({
  draftId,
  fetchSelections: createSleeperSelectionFetcher(
    {
      getDraftPicks: async () => ({
        data: rehearsal.stages[Math.min(stageIndex, rehearsal.stages.length - 1)]!.picks,
      }),
    },
    draftId,
  ),
});

console.log('# Mock Draft Rehearsal');
console.log('');
console.log('12 teams x 15 rounds, full snake, no third-round reversal.');
console.log(
  `${rehearsal.snapshot.keeperRights.length} declared keepers are priced from prior rounds and posted as consumed draft slots.`,
);
console.log(
  'Keeper policy: prior round 1 or 2 -> current round 1; later drafted costs advance one round; undrafted costs round 10.',
);
console.log('');
console.log('Keeper cost samples');
for (const row of rehearsal.keeperResolutionRows.slice(0, 8)) {
  console.log(
    `- ${row.franchiseName}: ${row.playerName}, prior ${
      row.priorRound ?? 'UDFA'
    } -> round ${row.nominalRound}, consumed overall ${row.resolvedOverallPick}`,
  );
}

for (stageIndex = 0; stageIndex < rehearsal.stages.length; stageIndex += 1) {
  const stage = rehearsal.stages[stageIndex]!;
  const state = await tracker.refreshNow();
  const userNextOverallPick = findNextOwnedOverallPick({
    pickInventory: rehearsal.snapshot.pickInventory,
    selections: state.selections,
    userFranchiseId: rehearsal.snapshot.userFranchiseId,
  });
  const board = computeLiveDraftBoard({
    selections: state.selections,
    players: rehearsal.players,
    seasonId: rehearsal.snapshot.season.id,
    franchiseId: rehearsal.snapshot.userFranchiseId,
    projectionSource,
    pickValueCurve: rehearsal.pickValueCurve,
    lineup: rehearsal.snapshot.league.lineup,
    teamCount: rehearsal.snapshot.league.rules.teamCount,
    userNextOverallPick: userNextOverallPick ?? undefined,
    limit: 18,
  });

  console.log(`\n# Draft update ${stageIndex + 1} of ${rehearsal.stages.length}: ${stage.label}\n`);
  for (const line of renderLiveBoard({
    board,
    selections: state.selections,
    lastSuccessfulSyncAt: state.lastSuccessfulSyncAt,
    stale: state.stale,
    consecutiveFailureCount: state.consecutiveFailureCount,
    userNextOverallPick: userNextOverallPick ?? undefined,
  })) {
    console.log(line);
  }

  const recent = describeRecentLivePicks(stage.picks, rehearsal.playersBySleeperId);
  if (recent.length > 0) {
    console.log('');
    console.log('## Recent Live Picks');
    for (const line of recent) {
      console.log(line);
    }
  }
}

tracker.stop();

function findNextOwnedOverallPick(input: {
  pickInventory: readonly DraftPickAsset[];
  selections: readonly TrackedSelection[];
  userFranchiseId: FranchiseId;
}): number | null {
  const consumedOverallPicks = new Set(input.selections.map((selection) => selection.overallPick));
  const next = input.pickInventory
    .filter(
      (pick) =>
        pick.currentFranchiseId === input.userFranchiseId &&
        pick.overallPick !== null &&
        !consumedOverallPicks.has(pick.overallPick),
    )
    .sort((left, right) => left.overallPick! - right.overallPick!)[0];

  return next?.overallPick ?? null;
}

function describeRecentLivePicks(
  picks: readonly SleeperDraftPickLike[],
  playersBySleeperId: ReadonlyMap<string, string>,
): string[] {
  return picks
    .filter((pick) => !pick.isKeeper)
    .slice(-5)
    .map((pick) => {
      const playerName =
        pick.sleeperPlayerId === null
          ? 'Unknown player'
          : (playersBySleeperId.get(pick.sleeperPlayerId) ?? pick.sleeperPlayerId);
      return `- ${pick.pickNo}: ${playerName} (round ${pick.round}, slot ${
        pick.draftSlot ?? 'unknown'
      })`;
    });
}
