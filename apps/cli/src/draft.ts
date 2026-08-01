import {
  computeLiveDraftBoard,
  createDraftTracker,
  createSleeperSelectionFetcher,
  type SleeperDraftPickLike,
} from '@keeper/draft-tracker';
import {
  createPickValueCurveFromRankedValues,
  createSnapshotProjectionSource,
} from '@keeper/valuation';
import { createSyntheticLeagueSnapshot, players } from '@keeper/test-fixtures';
import { renderLiveBoard } from './draft-board.js';

/**
 * Replays a scripted draft through the real tracker to show the whole chain working
 * headlessly: a pick source feeds reconciliation, and every change recomputes the board.
 * The source stands in for the Sleeper adapter, which satisfies the same shape.
 */
const snapshot = createSyntheticLeagueSnapshot();
const draftId = 'draft-synthetic-2026';
const userNextOverallPick = 5;

const scriptedPicks: SleeperDraftPickLike[][] = [
  [],
  [pick(1, 1, 1, 'player-a')],
  [pick(1, 1, 1, 'player-a'), pick(2, 1, 2, 'player-c')],
  [pick(1, 1, 1, 'player-a'), pick(2, 1, 2, 'player-c'), pick(3, 1, 3, 'player-b')],
];

let round = 0;
const tracker = createDraftTracker({
  draftId,
  fetchSelections: createSleeperSelectionFetcher(
    {
      getDraftPicks: async () => ({
        data: scriptedPicks[Math.min(round, scriptedPicks.length - 1)]!,
      }),
    },
    draftId,
  ),
});

const projectionSource = createSnapshotProjectionSource(snapshot);
const pickValueCurve = createPickValueCurveFromRankedValues(
  Array.from({ length: 180 }, (_, index) => Math.max(0, 120 - index * 0.75)),
);

for (round = 0; round < scriptedPicks.length; round += 1) {
  const state = await tracker.refreshNow();
  const board = computeLiveDraftBoard({
    selections: state.selections,
    players,
    seasonId: snapshot.season.id,
    franchiseId: snapshot.userFranchiseId,
    projectionSource,
    pickValueCurve,
    lineup: snapshot.league.lineup,
    teamCount: snapshot.league.rules.teamCount,
    userNextOverallPick,
  });

  console.log(`\n# Draft update ${round + 1} of ${scriptedPicks.length}\n`);
  for (const line of renderLiveBoard({
    board,
    selections: state.selections,
    lastSuccessfulSyncAt: state.lastSuccessfulSyncAt,
    stale: state.stale,
    consecutiveFailureCount: state.consecutiveFailureCount,
    userNextOverallPick,
  })) {
    console.log(line);
  }
}

tracker.stop();

function pick(
  pickNo: number,
  round_: number,
  draftSlot: number,
  sleeperPlayerId: string,
): SleeperDraftPickLike {
  return {
    pickNo,
    round: round_,
    draftSlot,
    rosterId: draftSlot,
    sleeperPlayerId,
    isKeeper: false,
  };
}
