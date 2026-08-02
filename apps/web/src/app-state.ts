import type {
  FranchiseId,
  KeeperRight,
  LeagueStateSnapshot,
  Player,
  Position,
} from '@keeper/domain';
import {
  createDraftTracker,
  createSleeperSelectionFetcher,
  type DraftTracker,
  type SleeperDraftPickLike,
} from '@keeper/draft-tracker';
import {
  optimizeKeeperCombinations,
  resolveKeeperCombination,
  type KeeperOptimizationResult,
} from '@keeper/keeper-optimizer';
import {
  buildDeclarationScenarios,
  buildPickValueCurveForPool,
  createSnapshotProjectionSource,
  type DeclarationScenarios,
  type PickValueCurve,
  type ProjectionSource,
} from '@keeper/valuation';
import { createAnonClient, loadLeagueSnapshot } from '@keeper/persistence';
import { createSleeperAdapter } from '@keeper/sleeper-adapter';
import { createSyntheticLeagueSnapshot, players as fixturePlayers } from '@keeper/test-fixtures';

/**
 * A franchise's keeper answer under both readings of the league.
 *
 * `floor` assumes nothing about anyone else's declarations; `assumingDeclarations` takes
 * them at face value. A set that wins under both is not borrowing its value from twelve
 * other managers' choices.
 */
export interface FranchiseOutlook {
  floor: KeeperOptimizationResult;
  assumingDeclarations: KeeperOptimizationResult;
}

export interface AppContext {
  snapshot: LeagueStateSnapshot;
  players: Player[];
  projectionSource: ProjectionSource;
  scenarios: DeclarationScenarios;
  /** Players some franchise has declared. Drives which pool each board is priced against. */
  declaredPlayerIds: Set<string>;
  /** The keepers managers have actually declared. Drives the as-declared board. */
  declaredKeepers: KeeperRight[];
  /** Each franchise's best set, capped by the keeper limit. Drives the expected board. */
  expectedKeepers: KeeperRight[];
  /**
   * What a pick buys once every franchise holds its best set. Its own curve rather than a
   * reuse of the declared one, because the expected board removes a different set of
   * players and a board is only coherent priced against its own pool.
   */
  pickValueCurveAssumingExpected: PickValueCurve;
  optimization: FranchiseOutlook;
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
  declaredPlayerIds?: Iterable<string>;
  source: AppContext['source'];
  caveats?: readonly string[];
}): AppContext {
  const { snapshot } = input;
  const projectionSource = createSnapshotProjectionSource(snapshot);
  const players = [...input.players];

  const projectedFor = (player: Player): number =>
    projectionSource.getProjectedPoints(player.id, snapshot.season.id) ?? 0;

  // A declaration is what a manager chose; a keeper right is only what a player would cost.
  // Every rostered player has a right, so reading declarations off the rights would take
  // whole rosters out of the draft pool.
  const declaredPlayerIds = new Set(input.declaredPlayerIds ?? []);

  const declaredRights = snapshot.keeperRights.filter((right) =>
    declaredPlayerIds.has(String(right.playerId)),
  );

  const scenarios = buildDeclarationScenarios({
    candidates: players.map((player) => ({
      position: player.position as Position,
      projectedPoints: projectedFor(player),
      declared: declaredPlayerIds.has(String(player.id)),
    })),
    lineup: snapshot.league.lineup,
    teamCount: snapshot.league.rules.teamCount,
    declaredKeeperOverallPicks: resolveKeeperOverallPicks(snapshot, declaredRights),
  });

  const context: BaseContext = {
    snapshot,
    players,
    projectionSource,
    scenarios,
    declaredPlayerIds,
    source: input.source,
    caveats: [...(input.caveats ?? [])],
    tracker: createTracker(snapshot),
  };

  const expectedKeepers = projectLeagueKeepers(context);
  const expectedPlayerIds = new Set(expectedKeepers.map((right) => String(right.playerId)));

  return {
    ...context,
    declaredKeepers: declaredRights,
    expectedKeepers,
    pickValueCurveAssumingExpected: buildPickValueCurveForPool({
      candidates: players
        .filter((player) => !expectedPlayerIds.has(String(player.id)))
        .map((player) => ({
          position: player.position as Position,
          projectedPoints: projectedFor(player),
        })),
      replacementLevels: scenarios.replacementLevels,
      version: 'post-expected-keepers',
      keeperConsumedOverallPicks: resolveKeeperOverallPicks(snapshot, expectedKeepers),
    }),
    optimization: optimizeForFranchise(context, snapshot.userFranchiseId),
  };
}

/** The context before the parts that depend on running the optimizer over the league. */
type BaseContext = Omit<
  AppContext,
  'optimization' | 'expectedKeepers' | 'declaredKeepers' | 'pickValueCurveAssumingExpected'
>;

/**
 * The exact overall picks a set of keepers consumes, resolved per franchise so displacement
 * onto an earlier owned pick is accounted for rather than assumed away.
 */
function resolveKeeperOverallPicks(
  snapshot: LeagueStateSnapshot,
  rights: readonly KeeperRight[],
): number[] {
  const byFranchise = new Map<string, KeeperRight[]>();
  for (const right of rights) {
    const key = String(right.franchiseId);
    byFranchise.set(key, [...(byFranchise.get(key) ?? []), right]);
  }

  return [...byFranchise.entries()].flatMap(([franchiseId, franchiseRights]) =>
    resolveKeeperCombination(franchiseRights, snapshot.pickInventory, {
      franchiseId: franchiseId as FranchiseId,
      maxKeepers: snapshot.league.rules.maxKeepers,
    }).resolvedPicks.map((pick) => pick.resolvedOverallPick),
  );
}

/**
 * The keepers the league is expected to hold: each franchise's best set, capped by the
 * league's keeper limit.
 *
 * A keeper right exists for every rostered player, so the post-keeper pool cannot be
 * derived from rights alone -- that would take all 188 rostered players off the board
 * instead of the 36 a twelve team league can actually keep.
 *
 * Sets are chosen under the pool-intact curve. Using the post-keeper curve would be
 * circular: it is built from whoever is left after keepers are removed, which is the very
 * thing being decided here.
 */
export function projectLeagueKeepers(context: BaseContext): KeeperRight[] {
  const { snapshot } = context;
  const projected = new Set(context.players.map((player) => String(player.id)));

  return snapshot.franchises.flatMap((franchise) => {
    const rights = snapshot.keeperRights.filter(
      (right) => right.franchiseId === franchise.id && projected.has(String(right.playerId)),
    );
    if (rights.length === 0) {
      return [];
    }

    const best = optimizeKeeperCombinations({
      keeperRights: rights,
      pickInventory: snapshot.pickInventory,
      players: context.players,
      franchiseId: franchise.id,
      seasonId: snapshot.season.id,
      evaluatedAt: snapshot.evaluatedAt,
      projectionSource: context.projectionSource,
      replacementLevels: context.scenarios.replacementLevels,
      pickValueCurve: context.scenarios.ignoringDeclarations,
      maxKeepers: snapshot.league.rules.maxKeepers,
      rulesVersion: snapshot.league.rulesVersion,
    }).bestByMode.expected;

    const selected = new Set(best?.selectedKeeperRightIds ?? []);
    return rights.filter((right) => selected.has(right.id));
  });
}

/**
 * Recommendations answer for one franchise: which of *their* keepers to hold, against the
 * picks *they* own. Kept separate from context assembly so switching teams re-runs only the
 * optimizer, rather than re-reading the league.
 */
export function optimizeForFranchise(
  context: BaseContext,
  franchiseId: FranchiseId,
): FranchiseOutlook {
  const { snapshot } = context;

  // A candidate with no projection cannot be valued, and the optimizer refuses to guess
  // rather than scoring him zero. Those are left out here; the loader reports the count.
  const projected = new Set(context.players.map((player) => String(player.id)));
  const keeperRights = snapshot.keeperRights.filter((right) =>
    projected.has(String(right.playerId)),
  );

  const run = (pickValueCurve: PickValueCurve) =>
    optimizeKeeperCombinations({
      keeperRights,
      pickInventory: snapshot.pickInventory,
      players: context.players,
      franchiseId,
      seasonId: snapshot.season.id,
      evaluatedAt: snapshot.evaluatedAt,
      projectionSource: context.projectionSource,
      replacementLevels: context.scenarios.replacementLevels,
      pickValueCurve,
      maxKeepers: snapshot.league.rules.maxKeepers,
      rulesVersion: snapshot.league.rulesVersion,
    });

  return {
    floor: run(context.scenarios.ignoringDeclarations),
    assumingDeclarations: run(context.scenarios.assumingDeclarations),
  };
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
    declaredPlayerIds: loaded.declaredPlayerIds,
    caveats: loaded.caveats,
    source: 'database',
  });
}

/**
 * The synthetic league, for tests and for a look at the interface without credentials. Kept
 * clearly labelled so a fixture is never mistaken for a real recommendation.
 */
export function createFixtureAppContext(): AppContext {
  const snapshot = createSyntheticLeagueSnapshot();
  return createAppContext({
    snapshot,
    players: fixturePlayers,
    // The fixture carries no separate decision list, so its rights stand in as declarations.
    declaredPlayerIds: snapshot.keeperRights.map((right) => String(right.playerId)),
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
