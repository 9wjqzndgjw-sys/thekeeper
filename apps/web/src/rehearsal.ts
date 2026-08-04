import type { FranchiseId, PlayerId } from '@keeper/domain';
import {
  buildDraftPool,
  createDraftSim,
  type DraftPool,
  type DraftRecommendation,
  type DraftSim,
  type DraftSimState,
} from '@keeper/draft-sim';
import { createDraftTracker, type DraftTracker } from '@keeper/draft-tracker';
import type { AppContext } from './app-state.js';

export interface Rehearsal {
  sim: DraftSim;
  tracker: DraftTracker;
  pool: DraftPool;
  userFranchiseId: FranchiseId;
  seed: number;
}

export interface RehearsalView {
  status: DraftSimState['status'];
  onTheClock: DraftSimState['onTheClock'];
  recommendations: DraftRecommendation[];
  available: DraftSimState['available'];
  selections: DraftSimState['selections'];
  userPicksRemaining: number;
  canUndo: boolean;
}

/**
 * A draft you can sit in, built over whichever league the page is already showing.
 *
 * The engine owns the pool and the tracker only observes it, exactly as it observes Sleeper
 * during a real draft. The pick a person makes here goes into the engine, never straight
 * into the tracker: the tracker accepts manual entries, so that shortcut compiles and works
 * for about four picks, until a bot drafts the player you just took because the engine was
 * never told.
 *
 * That also means the live board, the pick horizon and the recommendation panels all keep
 * reading from the tracker and need no idea a rehearsal is happening.
 */
export function createRehearsal(input: {
  context: AppContext;
  franchiseId?: FranchiseId;
  seed?: number;
}): Rehearsal | { error: string } {
  const { context } = input;
  const pool = buildDraftPool({
    snapshot: context.snapshot,
    players: context.players,
    declaredPlayerIds: context.declaredPlayerIds,
  });

  if (!pool.readiness.ok) {
    return { error: pool.readiness.blockers.join(' ') };
  }

  const userFranchiseId = input.franchiseId ?? context.snapshot.userFranchiseId;
  const seed = input.seed ?? 1;

  // No market model here. The history it learns from lives in `draft_selections`, which is
  // readable only with the service role -- the browser holds the anon key by design. The
  // rehearsal therefore runs on value and roster need, which is the same engine minus the
  // positional clock, and says so on screen rather than pretending otherwise.
  const sim = createDraftSim({ pool, userFranchiseId, seed });

  const draftId = context.snapshot.draft?.sleeperDraftId ?? 'rehearsal';
  const tracker = createDraftTracker({
    draftId,
    // Always the whole board. A delta would read as removals to the reconciler.
    fetchSelections: async () => sim.getSelections(),
    // Nothing arrives on its own here: the board changes only when a pick is made, and the
    // rehearsal refreshes the tracker itself at that moment. A short poll would just re-read
    // an unchanged list.
    intervalMs: 60_000,
    jitterRatio: 0,
  });

  sim.advance();

  return { sim, tracker, pool, userFranchiseId, seed };
}

/** Everything the on-the-clock panel needs, read fresh from the engine. */
export function readRehearsal(rehearsal: Rehearsal, recommendationCount = 6): RehearsalView {
  const state = rehearsal.sim.getState();
  return {
    status: state.status,
    onTheClock: state.onTheClock,
    recommendations: rehearsal.sim.getRecommendations(recommendationCount),
    available: state.available,
    selections: state.selections,
    userPicksRemaining: state.userPicksRemaining,
    canUndo: state.selections.some((selection) => selection.byUser && !selection.isKeeper),
  };
}

/**
 * Makes the pick, then lets the tracker notice.
 *
 * The refresh is awaited so the board a person sees after picking is the board that includes
 * their pick and everything the room did in response to it.
 */
export async function submitPick(rehearsal: Rehearsal, playerId: PlayerId | string): Promise<void> {
  rehearsal.sim.submitUserPick(playerId);
  await rehearsal.tracker.refreshNow();
}

export async function undoPick(rehearsal: Rehearsal): Promise<void> {
  rehearsal.sim.undoLastUserPick();
  await rehearsal.tracker.refreshNow();
}
