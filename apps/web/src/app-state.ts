import type { LeagueStateSnapshot, Player } from '@keeper/domain';
import {
  createDraftTracker,
  createSleeperSelectionFetcher,
  type DraftTracker,
  type SleeperDraftPickLike,
} from '@keeper/draft-tracker';
import {
  optimizeKeeperCombinations,
  type KeeperOptimizationResult,
} from '@keeper/keeper-optimizer';
import {
  createPickValueCurveFromRankedValues,
  createSnapshotProjectionSource,
  type PickValueCurve,
  type ProjectionSource,
} from '@keeper/valuation';
import { createSyntheticLeagueSnapshot, players } from '@keeper/test-fixtures';

export interface AppContext {
  snapshot: LeagueStateSnapshot;
  players: Player[];
  projectionSource: ProjectionSource;
  pickValueCurve: PickValueCurve;
  optimization: KeeperOptimizationResult;
  tracker: DraftTracker;
}

/**
 * Assembles everything the views read from. Nothing here touches React, so the wiring can
 * be exercised without rendering. The fixture stands in for a real Sleeper import until
 * league credentials are available; swapping it for `importSeasonDraftState` changes only
 * this function.
 */
export function createAppContext(): AppContext {
  const snapshot = createSyntheticLeagueSnapshot();
  const projectionSource = createSnapshotProjectionSource(snapshot);
  const pickValueCurve = createPickValueCurveFromRankedValues(
    Array.from({ length: 180 }, (_, index) => Math.max(0, 120 - index * 0.75)),
  );

  const optimization = optimizeKeeperCombinations({
    keeperRights: snapshot.keeperRights,
    pickInventory: snapshot.pickInventory,
    players,
    franchiseId: snapshot.userFranchiseId,
    seasonId: snapshot.season.id,
    evaluatedAt: snapshot.evaluatedAt,
    projectionSource,
    replacementLevels: {},
    pickValueCurve,
    maxKeepers: snapshot.league.rules.maxKeepers,
    rulesVersion: snapshot.league.rulesVersion,
  });

  return {
    snapshot,
    players: [...players],
    projectionSource,
    pickValueCurve,
    optimization,
    tracker: createDraftTracker({
      draftId: snapshot.draft?.sleeperDraftId ?? 'draft-demo',
      fetchSelections: createSleeperSelectionFetcher(createDemoPickSource(), 'draft-demo'),
      intervalMs: 3_000,
    }),
  };
}

/**
 * Stands in for the Sleeper adapter so the dashboard has something moving to render.
 * Reveals one scripted pick every few polls; the real adapter satisfies the same shape.
 */
function createDemoPickSource() {
  const script: SleeperDraftPickLike[] = [
    {
      pickNo: 1,
      round: 1,
      draftSlot: 1,
      rosterId: 1,
      sleeperPlayerId: 'player-a',
      isKeeper: false,
    },
    {
      pickNo: 2,
      round: 1,
      draftSlot: 2,
      rosterId: 2,
      sleeperPlayerId: 'player-c',
      isKeeper: false,
    },
    {
      pickNo: 3,
      round: 1,
      draftSlot: 3,
      rosterId: 3,
      sleeperPlayerId: 'player-b',
      isKeeper: false,
    },
  ];
  let revealed = 0;

  return {
    getDraftPicks: async () => {
      const data = script.slice(0, revealed);
      revealed = Math.min(script.length, revealed + 1);
      return { data };
    },
  };
}
