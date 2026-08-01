import { useEffect, useMemo, useState } from 'react';
import type { DraftTrackerState } from '@keeper/draft-tracker';
import { createAppContext } from './app-state.js';
import { buildBoards, type BoardMode } from './view-models/boards.js';
import { buildPickHorizon } from './view-models/pick-horizon.js';
import { buildSyncStatus } from './view-models/sync-status.js';
import {
  BoardPanel,
  KeeperCombinationsPanel,
  PickHorizonPanel,
  RecommendationPanel,
  SetupPanel,
  SyncStatusPanel,
} from './components/panels.js';

const context = createAppContext();

export function App() {
  const [trackerState, setTrackerState] = useState<DraftTrackerState>(() =>
    context.tracker.getState(),
  );
  // Re-renders the relative "synced Ns ago" reading without waiting on a poll.
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [activeBoard, setActiveBoard] = useState<BoardMode>('live');

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
  }, []);

  const horizon = useMemo(
    () =>
      buildPickHorizon({
        pickInventory: context.snapshot.pickInventory,
        selections: trackerState.selections,
        franchises: context.snapshot.franchises,
        userFranchiseId: context.snapshot.userFranchiseId,
        maxUpcoming: 12,
      }),
    [trackerState.selections],
  );

  const boards = useMemo(
    () =>
      buildBoards({
        players: context.players,
        seasonId: context.snapshot.season.id,
        franchiseId: context.snapshot.userFranchiseId,
        projectionSource: context.projectionSource,
        pickValueCurve: context.pickValueCurve,
        lineup: context.snapshot.league.lineup,
        teamCount: context.snapshot.league.rules.teamCount,
        declaredKeeperRights: context.snapshot.keeperRights,
        selections: trackerState.selections,
        userNextOverallPick: horizon.userNextOverallPick ?? undefined,
      }),
    [trackerState.selections, horizon.userNextOverallPick],
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

      <SyncStatusPanel status={syncStatus} />
      <SetupPanel snapshot={context.snapshot} />
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

      <RecommendationPanel optimization={context.optimization} />
      <KeeperCombinationsPanel optimization={context.optimization} />
    </main>
  );
}
