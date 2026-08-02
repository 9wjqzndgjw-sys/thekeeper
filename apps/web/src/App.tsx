import { useEffect, useMemo, useState } from 'react';
import type { FranchiseId } from '@keeper/domain';
import type { DraftTrackerState } from '@keeper/draft-tracker';
import { loadAppContext, optimizeForFranchise, type AppContext } from './app-state.js';
import { buildBoards, type BoardMode } from './view-models/boards.js';
import { buildPickHorizon } from './view-models/pick-horizon.js';
import { buildSyncStatus } from './view-models/sync-status.js';
import {
  BoardPanel,
  DataSourcePanel,
  KeeperCombinationsPanel,
  PickHorizonPanel,
  RecommendationPanel,
  SetupPanel,
  SyncStatusPanel,
} from './components/panels.js';

type LoadState =
  | { status: 'loading' }
  | { status: 'ready'; context: AppContext }
  | { status: 'failed'; message: string };

/**
 * Loads the league, then renders it. The load is a real network read, so the three states
 * are all rendered rather than assumed away -- a page that shows an empty board while it is
 * still loading looks exactly like a league with no players in it.
 */
export function App() {
  const [state, setState] = useState<LoadState>({ status: 'loading' });

  useEffect(() => {
    let cancelled = false;
    loadAppContext()
      .then((context) => {
        if (!cancelled) {
          setState({ status: 'ready', context });
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setState({ status: 'failed', message: describeError(error) });
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  if (state.status === 'loading') {
    return (
      <main>
        <header>
          <h1>Keeper League Intelligence</h1>
        </header>
        <section className="panel">
          <h2>Loading the league…</h2>
          <p className="muted">Reading players, keepers and pick inventory.</p>
        </section>
      </main>
    );
  }

  if (state.status === 'failed') {
    return (
      <main>
        <header>
          <h1>Keeper League Intelligence</h1>
        </header>
        <section className="panel tone-error">
          <h2>Could not load the league</h2>
          <p>{state.message}</p>
          <p className="muted">
            The page needs VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY and VITE_KEEPER_SEASON_ID.
            Nothing is shown here rather than a board built from partial data.
          </p>
        </section>
      </main>
    );
  }

  return <Dashboard context={state.context} />;
}

/**
 * The dashboard proper. Takes a fully assembled context so it can be rendered in a test
 * without a database.
 */
export function Dashboard({ context }: { context: AppContext }) {
  const [trackerState, setTrackerState] = useState<DraftTrackerState>(() =>
    context.tracker.getState(),
  );
  // Re-renders the relative "synced Ns ago" reading without waiting on a poll.
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [activeBoard, setActiveBoard] = useState<BoardMode>('live');
  const [franchiseId, setFranchiseId] = useState<FranchiseId>(context.snapshot.userFranchiseId);

  useEffect(() => {
    const unsubscribe = context.tracker.subscribe((_events, state) => {
      setTrackerState(state);
      setNowMs(Date.now());
    });
    context.tracker.start();
    const ticker = setInterval(() => setNowMs(Date.now()), 1_000);

    return () => {
      unsubscribe();
      context.tracker.stop();
      clearInterval(ticker);
    };
  }, [context]);

  // Recommendations and the pick horizon both follow whichever team is being viewed. Only
  // the optimizer re-runs; the league itself is not re-read.
  const optimization = useMemo(
    () => optimizeForFranchise(context, franchiseId),
    [context, franchiseId],
  );

  const horizon = useMemo(
    () =>
      buildPickHorizon({
        pickInventory: context.snapshot.pickInventory,
        selections: trackerState.selections,
        franchises: context.snapshot.franchises,
        userFranchiseId: franchiseId,
        maxUpcoming: 12,
      }),
    [context, franchiseId, trackerState.selections],
  );

  const boards = useMemo(
    () =>
      buildBoards({
        players: context.players,
        seasonId: context.snapshot.season.id,
        franchiseId,
        projectionSource: context.projectionSource,
        pickValueCurveIgnoringDeclarations: context.scenarios.ignoringDeclarations,
        pickValueCurveAssumingDeclarations: context.scenarios.assumingDeclarations,
        lineup: context.snapshot.league.lineup,
        teamCount: context.snapshot.league.rules.teamCount,
        declaredKeeperRights: context.snapshot.keeperRights,
        selections: trackerState.selections,
        userNextOverallPick: horizon.userNextOverallPick ?? undefined,
        limit: 60,
      }),
    [context, franchiseId, trackerState.selections, horizon.userNextOverallPick],
  );

  const syncStatus = useMemo(
    () => buildSyncStatus({ state: trackerState, now: nowMs }),
    [trackerState, nowMs],
  );

  const visibleBoard = boards.find((board) => board.mode === activeBoard) ?? boards[0]!;

  return (
    <main>
      <header>
        <h1>Keeper League Intelligence</h1>
        <button type="button" onClick={() => void context.tracker.refreshNow()}>
          Refresh now
        </button>
      </header>

      <DataSourcePanel
        context={context}
        franchiseId={franchiseId}
        onFranchiseChange={setFranchiseId}
      />
      <SyncStatusPanel status={syncStatus} />
      <SetupPanel
        snapshot={context.snapshot}
        replacementLevels={context.scenarios.replacementLevels}
      />
      <PickHorizonPanel horizon={horizon} />

      <nav className="board-tabs">
        {boards.map((board) => (
          <button
            key={board.mode}
            type="button"
            aria-pressed={board.mode === activeBoard}
            className={board.mode === activeBoard ? 'active' : undefined}
            onClick={() => setActiveBoard(board.mode)}
          >
            {board.title}
          </button>
        ))}
      </nav>
      <BoardPanel board={visibleBoard} />

      <RecommendationPanel outlook={optimization} />
      <KeeperCombinationsPanel outlook={optimization} />
    </main>
  );
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
