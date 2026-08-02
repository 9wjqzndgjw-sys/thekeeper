import type { FranchiseId, LeagueStateSnapshot, Player, Position } from '@keeper/domain';
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
  computeIntrinsicValue,
  computeReplacementLevels,
  createPickValueCurveFromRankedValues,
  createSnapshotProjectionSource,
  type PickValueCurve,
  type ProjectionSource,
  type ReplacementLevels,
} from '@keeper/valuation';
import { createAnonClient, loadLeagueSnapshot } from '@keeper/persistence';
import { createSleeperAdapter } from '@keeper/sleeper-adapter';
import { createSyntheticLeagueSnapshot, players as fixturePlayers } from '@keeper/test-fixtures';

export interface AppContext {
  snapshot: LeagueStateSnapshot;
  players: Player[];
  projectionSource: ProjectionSource;
  pickValueCurve: PickValueCurve;
  replacementLevels: ReplacementLevels;
  optimization: KeeperOptimizationResult;
  tracker: DraftTracker;
  /** Where this league came from, and anything a reader should discount. */
  source: 'database' | 'fixture';
  caveats: string[];
}

/**
 * Assembles everything the views read from. Nothing here touches React, so the wiring can
 * be exercised without rendering.
 *
 * Replacement levels and the pick value curve are derived from the league's own projections
 * rather than assumed. That matters more than it looks: an empty replacement map values
 * every player at his full projected points, which makes a quarterback in a one-quarterback
 * league appear to tower over any running back and turns every recommendation below into
 * confident nonsense.
 */
export function createAppContext(input: {
  snapshot: LeagueStateSnapshot;
  players: readonly Player[];
  source: AppContext['source'];
  caveats?: readonly string[];
}): AppContext {
  const { snapshot } = input;
  const projectionSource = createSnapshotProjectionSource(snapshot);
  const players = [...input.players];

  const projectedFor = (player: Player): number =>
    projectionSource.getProjectedPoints(player.id, snapshot.season.id) ?? 0;

  // Declared keepers are already on a roster: they take a player and the slot he fills off
  // the board together, so they count toward demand rather than being dropped from supply.
  const declaredPlayerIds = new Set(snapshot.keeperRights.map((right) => String(right.playerId)));
  const asCandidate = (player: Player) => ({
    position: player.position as Position,
    projectedPoints: projectedFor(player),
  });
  const draftable = players.filter((player) => !declaredPlayerIds.has(String(player.id)));

  const replacementLevels = computeReplacementLevels({
    candidates: draftable.map(asCandidate),
    rosteredCandidates: players.filter((p) => declaredPlayerIds.has(String(p.id))).map(asCandidate),
    lineup: snapshot.league.lineup,
    teamCount: snapshot.league.rules.teamCount,
  });

  // One player leaves the pool per pick, so the draftable pool ranked by value gives what
  // pick N can buy. Ranking by projected points instead would price a quarterback's raw
  // total against a running back's, and ranking by ADP produces a curve that rises.
  const pickValueCurve = createPickValueCurveFromRankedValues(
    draftable
      .map(
        (player) =>
          computeIntrinsicValue({
            projectedPoints: projectedFor(player),
            replacementLevel: replacementLevels[player.position] ?? 0,
          }).intrinsicValue,
      )
      .sort((left, right) => right - left),
  );

  const context: Omit<AppContext, 'optimization'> = {
    snapshot,
    players,
    projectionSource,
    pickValueCurve,
    replacementLevels,
    source: input.source,
    caveats: [...(input.caveats ?? [])],
    tracker: createTracker(snapshot),
  };

  return { ...context, optimization: optimizeForFranchise(context, snapshot.userFranchiseId) };
}

/**
 * Recommendations answer for one franchise: which of *their* keepers to hold, against the
 * picks *they* own. Kept separate from context assembly so switching teams re-runs only the
 * optimizer, rather than re-reading the league.
 */
export function optimizeForFranchise(
  context: Omit<AppContext, 'optimization'>,
  franchiseId: FranchiseId,
): KeeperOptimizationResult {
  const { snapshot } = context;
  return optimizeKeeperCombinations({
    keeperRights: snapshot.keeperRights,
    pickInventory: snapshot.pickInventory,
    players: context.players,
    franchiseId,
    seasonId: snapshot.season.id,
    evaluatedAt: snapshot.evaluatedAt,
    projectionSource: context.projectionSource,
    replacementLevels: context.replacementLevels,
    pickValueCurve: context.pickValueCurve,
    maxKeepers: snapshot.league.rules.maxKeepers,
    rulesVersion: snapshot.league.rulesVersion,
  });
}

/**
 * Loads the real league out of the database.
 *
 * Reads with the anon key under row level security, so the page ships no privileged
 * credential. Projections come from the database rather than a file, because the browser
 * has no access to the exports the command line reads.
 */
export async function loadAppContext(
  env: Record<string, string | undefined> = import.meta.env as unknown as Record<
    string,
    string | undefined
  >,
): Promise<AppContext> {
  const seasonId = env.VITE_KEEPER_SEASON_ID;
  if (!seasonId) {
    throw new Error(
      'Set VITE_KEEPER_SEASON_ID to the season to display, for example season:<sleeperLeagueId>.',
    );
  }

  const loaded = await loadLeagueSnapshot({
    client: createAnonClient(env),
    seasonId: seasonId as LeagueStateSnapshot['season']['id'],
    userFranchiseId: env.VITE_KEEPER_FRANCHISE_ID as
      LeagueStateSnapshot['userFranchiseId'] | undefined,
  });

  return createAppContext({
    snapshot: loaded.snapshot,
    players: loaded.players,
    caveats: loaded.caveats,
    source: 'database',
  });
}

/**
 * The synthetic league, for tests and for a look at the interface without credentials. Kept
 * clearly labelled so a fixture is never mistaken for a real recommendation.
 */
export function createFixtureAppContext(): AppContext {
  return createAppContext({
    snapshot: createSyntheticLeagueSnapshot(),
    players: fixturePlayers,
    source: 'fixture',
    caveats: ['This is synthetic demonstration data, not your league.'],
  });
}

/**
 * Polls the real Sleeper draft when the season has one. Before a draft is created there is
 * nothing to poll, so the tracker is pointed at an empty source rather than a scripted one:
 * a demo drip of fake picks on a page showing real data would be indistinguishable from a
 * draft actually starting.
 */
function createTracker(snapshot: LeagueStateSnapshot): DraftTracker {
  const draftId = snapshot.draft?.sleeperDraftId ?? null;
  if (!draftId) {
    return createDraftTracker({
      draftId: 'no-draft',
      fetchSelections: async () => [],
      intervalMs: 60_000,
    });
  }

  const adapter = createSleeperAdapter();
  return createDraftTracker({
    draftId,
    fetchSelections: createSleeperSelectionFetcher(
      {
        getDraftPicks: async (id: string) => {
          const response = await adapter.getDraftPicks(id);
          return { data: response.data as unknown as SleeperDraftPickLike[] };
        },
      },
      draftId,
    ),
    intervalMs: 15_000,
  });
}
