import { useEffect, useMemo, useState, type ReactNode } from 'react';
import type { FranchiseId } from '@keeper/domain';
import type { DraftTrackerState } from '@keeper/draft-tracker';
import {
  createMockDraftAppContext,
  loadAppContext,
  optimizeForFranchise,
  type AppContext,
} from './app-state.js';
import {
  createRehearsal,
  readRehearsal,
  submitPick,
  undoPick,
  type Rehearsal,
} from './rehearsal.js';
import { OnTheClockPanel } from './components/on-the-clock.js';
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

const MOCK_DRAFT_DEMO_PARAM = 'mock-draft';
const REHEARSE_PARAM = 'rehearse';

/**
 * Loads the league, then renders it. The load is a real network read, so the three states
 * are all rendered rather than assumed away -- a page that shows an empty board while it is
 * still loading looks exactly like a league with no players in it.
 */
export function App() {
  const [state, setState] = useState<LoadState>({ status: 'loading' });
  const [demoMode] = useState(() => readDemoMode());
  const [rehearse] = useState(() => readRehearseMode());

  useEffect(() => {
    let cancelled = false;
    const load = demoMode ? Promise.resolve(createMockDraftAppContext()) : loadAppContext();

    load
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
  }, [demoMode]);

  if (state.status === 'loading') {
    return (
      <main>
        <PageHeader demoMode={demoMode} />
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
        <PageHeader demoMode={demoMode} />
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

  return <Dashboard context={state.context} demoMode={demoMode} rehearse={rehearse} />;
}

/**
 * The dashboard proper. Takes a fully assembled context so it can be rendered in a test
 * without a database.
 */
export function Dashboard({
  context,
  demoMode = false,
  rehearse = false,
}: {
  context: AppContext;
  demoMode?: boolean;
  rehearse?: boolean;
}) {
  const [franchiseId, setFranchiseId] = useState<FranchiseId>(context.snapshot.userFranchiseId);

  // Rebuilt whenever the team being viewed changes, because a rehearsal is drafted *as*
  // somebody. Built once and left alone, it went on drafting as whichever team the snapshot
  // happened to default to while every label around it followed the picker -- so the panel
  // announced one team's pick over another team's roster, which is worse than being stuck.
  //
  // Switching teams therefore restarts the draft. There is no honest alternative: a draft in
  // progress belongs to the team that made its picks.
  const [rehearsal, setRehearsal] = useState(() =>
    rehearse ? createRehearsal({ context, franchiseId: context.snapshot.userFranchiseId }) : null,
  );

  useEffect(() => {
    if (!rehearse) {
      return;
    }
    setRehearsal(createRehearsal({ context, franchiseId }));
  }, [rehearse, context, franchiseId]);

  const activeRehearsal = rehearsal && 'sim' in rehearsal ? rehearsal : null;
  const rehearsalError = rehearsal && 'error' in rehearsal ? rehearsal.error : null;

  // The rehearsal's own tracker replaces the polling one, so every panel below reads the
  // simulated board through the same pipeline it uses for a real draft.
  const tracker = activeRehearsal?.tracker ?? context.tracker;

  const [rehearsalView, setRehearsalView] = useState(() =>
    activeRehearsal ? readRehearsal(activeRehearsal) : null,
  );
  const [busy, setBusy] = useState(false);

  // Follows the rehearsal rather than the render, so a stale view cannot outlive the draft
  // it described.
  useEffect(() => {
    setRehearsalView(activeRehearsal ? readRehearsal(activeRehearsal) : null);
  }, [activeRehearsal]);

  const [trackerState, setTrackerState] = useState<DraftTrackerState>(() => tracker.getState());
  // Re-renders the relative "synced Ns ago" reading without waiting on a poll.
  const [nowMs, setNowMs] = useState(() => Date.now());
  // The live board is only the interesting one once a draft is actually running. Landing on
  // it before then shows a board whose every row is still hypothetical.
  const [activeBoard, setActiveBoard] = useState<BoardMode>(() =>
    context.snapshot.draft?.status === 'drafting' ? 'live' : 'as_declared',
  );

  useEffect(() => {
    const unsubscribe = tracker.subscribe((_events, state) => {
      setTrackerState(state);
      setNowMs(Date.now());
    });
    tracker.start();
    const ticker = setInterval(() => setNowMs(Date.now()), 1_000);

    return () => {
      unsubscribe();
      tracker.stop();
      clearInterval(ticker);
    };
  }, [tracker]);

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
        pickValueCurveAssumingExpected: context.pickValueCurveAssumingExpected,
        lineup: context.snapshot.league.lineup,
        teamCount: context.snapshot.league.rules.teamCount,
        declaredKeeperRights: context.declaredKeepers,
        expectedKeeperRights: context.expectedKeepers,
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

  // Read off the rehearsal itself, never off the picker. The two agree now, but a label
  // sourced from the selector is a label that can describe a draft nobody is playing -- and
  // the failure is silent, because a wrong team name still reads as a right one.
  const rehearsalFranchiseName = activeRehearsal
    ? (context.snapshot.franchises.find(
        (franchise) => franchise.id === activeRehearsal.userFranchiseId,
      )?.displayName ?? String(activeRehearsal.userFranchiseId))
    : 'your team';

  // Awaited so the board a person sees after picking already includes everything the room
  // did in response to it.
  const runPick = (action: (rehearsal: Rehearsal) => Promise<void>) => {
    if (!activeRehearsal || busy) {
      return;
    }
    setBusy(true);
    action(activeRehearsal)
      .then(() => setRehearsalView(readRehearsal(activeRehearsal)))
      .finally(() => setBusy(false));
  };

  return (
    <main>
      <PageHeader demoMode={demoMode} rehearsing={rehearse}>
        {!rehearse && (
          <button type="button" onClick={() => void tracker.refreshNow()}>
            Refresh now
          </button>
        )}
      </PageHeader>

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
      {rehearsalError && (
        <section className="panel tone-error">
          <h2>Cannot rehearse this league</h2>
          <p>{rehearsalError}</p>
        </section>
      )}

      {activeRehearsal && rehearsalView && (
        <OnTheClockPanel
          view={rehearsalView}
          franchiseName={rehearsalFranchiseName}
          busy={busy}
          onPick={(playerId) => runPick((rehearsal) => submitPick(rehearsal, playerId))}
          onUndo={() => runPick(undoPick)}
        />
      )}

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

function PageHeader({
  demoMode,
  rehearsing = false,
  children,
}: {
  demoMode: boolean;
  rehearsing?: boolean;
  children?: ReactNode;
}) {
  return (
    <header>
      <h1>Keeper League Intelligence</h1>
      <div className="header-actions">
        {children}
        <button type="button" onClick={rehearsing ? stopRehearsing : startRehearsing}>
          {rehearsing ? 'Stop rehearsing' : 'Rehearse the draft'}
        </button>
        <button type="button" onClick={demoMode ? openLiveLeague : openMockDraftDemo}>
          {demoMode ? 'Live league' : 'Mock draft demo'}
        </button>
      </div>
    </header>
  );
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function readDemoMode(): boolean {
  if (typeof window === 'undefined') {
    return false;
  }
  return new URL(window.location.href).searchParams.get('demo') === MOCK_DRAFT_DEMO_PARAM;
}

function readRehearseMode(): boolean {
  if (typeof window === 'undefined') {
    return false;
  }
  return new URL(window.location.href).searchParams.has(REHEARSE_PARAM);
}

/**
 * Reloads rather than toggling in place.
 *
 * A rehearsal holds a draft in progress, and flipping it on or off mid-page would either
 * abandon that state silently or resume one built against a different league. A reload
 * makes the restart explicit.
 */
function startRehearsing(): void {
  if (typeof window === 'undefined') {
    return;
  }
  const url = new URL(window.location.href);
  url.searchParams.set(REHEARSE_PARAM, '1');
  window.location.assign(url.toString());
}

function stopRehearsing(): void {
  if (typeof window === 'undefined') {
    return;
  }
  const url = new URL(window.location.href);
  url.searchParams.delete(REHEARSE_PARAM);
  window.location.assign(url.toString());
}

function openMockDraftDemo(): void {
  if (typeof window === 'undefined') {
    return;
  }
  const url = new URL(window.location.href);
  url.searchParams.set('demo', MOCK_DRAFT_DEMO_PARAM);
  window.location.assign(url.toString());
}

function openLiveLeague(): void {
  if (typeof window === 'undefined') {
    return;
  }
  const url = new URL(window.location.href);
  url.searchParams.delete('demo');
  window.location.assign(url.toString());
}
