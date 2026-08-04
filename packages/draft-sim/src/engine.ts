import type { FranchiseId, PlayerId, Position } from '@keeper/domain';
import type { DraftPool, DraftPoolPlayer, DraftSlotOwnership } from './pool.js';
import { createRng, sampleWeightedIndex, type Rng } from './rng.js';

/** One selection the rehearsal has made, keeper or live. */
export interface DraftSimSelection {
  overallPick: number;
  round: number;
  slot: number;
  franchiseId: FranchiseId;
  playerId: PlayerId;
  sleeperPlayerId: string | null;
  fullName: string;
  position: Position;
  isKeeper: boolean;
  /** True for the pick the person rehearsing made themselves. */
  byUser: boolean;
}

/**
 * The shape the draft tracker reconciles.
 *
 * Declared structurally rather than imported so the engine stays independent of the
 * polling package; the tracker's own input type is satisfied by this.
 */
export interface DraftSimSelectionInput {
  overallPick: number;
  round: number;
  slot: number | null;
  rosterId: number | null;
  playerId: string | null;
  isKeeper: boolean;
}

export type DraftSimStatus = 'awaiting_user' | 'complete';

export interface DraftSimState {
  status: DraftSimStatus;
  /** The pick waiting on the person rehearsing, or null once the draft is over. */
  onTheClock: DraftSlotOwnership | null;
  selections: readonly DraftSimSelection[];
  /** Still draftable, best first. */
  available: readonly DraftPoolPlayer[];
  /** How many picks the user has left after the current one. */
  userPicksRemaining: number;
}

export interface DraftSimOptions {
  pool: DraftPool;
  userFranchiseId: FranchiseId;
  /** Same seed, same draft. Defaults to a fixed value so runs are repeatable by default. */
  seed?: number;
  /** How many of the best available a bot will consider. */
  candidateWindow?: number;
  /**
   * How far a bot will stray from the best available, in points of intrinsic value.
   *
   * Zero makes every bot take the top of the board, which is the one thing a real draft
   * never does: nobody reaches, nobody falls, and the rehearsal only ever confirms the
   * board you already had.
   */
  reachTemperature?: number;
}

export interface DraftSim {
  getState(): DraftSimState;
  /** Runs bots until the user is on the clock or the draft ends. */
  advance(): DraftSimState;
  submitUserPick(playerId: PlayerId | string): DraftSimState;
  /** Rewinds to just before the user's last pick, bots included. */
  undoLastUserPick(): DraftSimState;
  /** The full board so far, cumulative, for the tracker to reconcile. */
  getSelections(): DraftSimSelectionInput[];
}

const DEFAULTS = {
  seed: 1,
  candidateWindow: 8,
  reachTemperature: 12,
} as const;

/**
 * A draft that stops and waits for you.
 *
 * The engine owns the pool. Its selections are the only truth about who has been taken,
 * and the tracker observes them exactly as it would observe Sleeper. Letting a pick reach
 * the board by any other route -- injecting it into the tracker directly, say -- leaves the
 * engine's pool unaware of it, and a bot drafts the same player again a few picks later.
 *
 * `advance` runs bots and returns as soon as a pick belongs to the user, so what happens
 * next genuinely depends on what they do. Everything after a pick is a consequence of it,
 * which is the difference between a rehearsal and a replay.
 */
export function createDraftSim(options: DraftSimOptions): DraftSim {
  if (!options.pool.readiness.ok) {
    throw new Error(
      `Refusing to rehearse an unready pool: ${options.pool.readiness.blockers.join(' ')}`,
    );
  }

  const config = {
    seed: options.seed ?? DEFAULTS.seed,
    candidateWindow: options.candidateWindow ?? DEFAULTS.candidateWindow,
    reachTemperature: options.reachTemperature ?? DEFAULTS.reachTemperature,
  };
  if (config.candidateWindow < 1) {
    throw new Error(`candidateWindow must be at least 1; received ${config.candidateWindow}.`);
  }
  if (config.reachTemperature < 0) {
    throw new Error(`reachTemperature cannot be negative; received ${config.reachTemperature}.`);
  }

  const order = [...options.pool.order].sort((left, right) => left.overallPick - right.overallPick);
  const playerById = new Map(
    options.pool.players.map((player) => [String(player.playerId), player]),
  );
  const keptById = new Map(
    options.pool.keptPlayers.map((player) => [String(player.playerId), player]),
  );

  let rng: Rng;
  let available: DraftPoolPlayer[];
  let selections: DraftSimSelection[];
  let cursor: number;

  reset();

  function reset(): void {
    rng = createRng(config.seed);
    available = [...options.pool.players];
    selections = [];
    cursor = 0;
  }

  /** The pick under the cursor, or null once the order is exhausted. */
  function currentSlot(): DraftSlotOwnership | null {
    return cursor < order.length ? order[cursor]! : null;
  }

  function isUserTurn(slot: DraftSlotOwnership | null): boolean {
    return (
      slot !== null &&
      slot.consumedByKeeperRightId === null &&
      slot.franchiseId === options.userFranchiseId
    );
  }

  function recordKeeper(slot: DraftSlotOwnership): void {
    // A keeper occupies the pick without taking anyone off the board -- he was never in the
    // pool to begin with -- so nothing is removed from `available` here. He is looked up in
    // the kept list rather than the draftable one, which is precisely the pool he is absent
    // from.
    const player = slot.consumedByPlayerId
      ? keptById.get(String(slot.consumedByPlayerId))
      : undefined;

    if (!player) {
      throw new Error(
        `Overall pick ${slot.overallPick} is consumed by a keeper the pool cannot identify ` +
          `(${String(slot.consumedByPlayerId)}). The board would show a fabricated player.`,
      );
    }

    selections.push({
      overallPick: slot.overallPick,
      round: slot.round,
      slot: slot.slot,
      franchiseId: slot.franchiseId,
      playerId: player.playerId,
      sleeperPlayerId: player.sleeperPlayerId,
      fullName: player.fullName,
      position: player.position,
      isKeeper: true,
      byUser: slot.franchiseId === options.userFranchiseId,
    });
  }

  function takePlayer(index: number, slot: DraftSlotOwnership, byUser: boolean): void {
    const [player] = available.splice(index, 1);
    if (!player) {
      throw new Error(`No player at index ${index} to draft at overall pick ${slot.overallPick}.`);
    }

    selections.push({
      overallPick: slot.overallPick,
      round: slot.round,
      slot: slot.slot,
      franchiseId: slot.franchiseId,
      playerId: player.playerId,
      sleeperPlayerId: player.sleeperPlayerId,
      fullName: player.fullName,
      position: player.position,
      isKeeper: false,
      byUser,
    });
  }

  /**
   * Best available, softened.
   *
   * Weight falls off exponentially with how far a candidate sits below the best remaining
   * player, so the top of the board is usually taken and occasionally is not. That is the
   * whole behavioural model for now: no roster need, no market, no manager tendencies.
   */
  function botPick(slot: DraftSlotOwnership): void {
    const window = available.slice(0, config.candidateWindow);
    if (window.length === 0) {
      throw new Error(`The pool ran out at overall pick ${slot.overallPick}.`);
    }

    const best = window[0]!.intrinsicValue;
    const weights =
      config.reachTemperature === 0
        ? window.map((_, index) => (index === 0 ? 1 : 0))
        : window.map((candidate) =>
            Math.exp((candidate.intrinsicValue - best) / config.reachTemperature),
          );

    takePlayer(sampleWeightedIndex(weights, rng), slot, false);
  }

  function runToUser(): void {
    while (cursor < order.length) {
      const slot = order[cursor]!;
      if (slot.consumedByKeeperRightId !== null) {
        recordKeeper(slot);
        cursor += 1;
        continue;
      }
      if (slot.franchiseId === options.userFranchiseId) {
        return;
      }
      botPick(slot);
      cursor += 1;
    }
  }

  function state(): DraftSimState {
    const slot = currentSlot();
    return {
      status: slot === null ? 'complete' : 'awaiting_user',
      onTheClock: slot,
      selections,
      available,
      userPicksRemaining: order
        .slice(cursor)
        .filter(
          (candidate) =>
            candidate.consumedByKeeperRightId === null &&
            candidate.franchiseId === options.userFranchiseId,
        ).length,
    };
  }

  return {
    getState: state,

    advance(): DraftSimState {
      runToUser();
      return state();
    },

    submitUserPick(playerId: PlayerId | string): DraftSimState {
      const slot = currentSlot();
      if (!isUserTurn(slot)) {
        throw new Error(
          slot === null
            ? 'The draft is over; there is no pick to make.'
            : `Overall pick ${slot.overallPick} belongs to another franchise.`,
        );
      }

      const index = available.findIndex(
        (candidate) => String(candidate.playerId) === String(playerId),
      );
      if (index === -1) {
        const known = playerById.has(String(playerId));
        throw new Error(
          known
            ? `${String(playerId)} has already been taken.`
            : `${String(playerId)} is not in this draft pool.`,
        );
      }

      takePlayer(index, slot!, true);
      cursor += 1;
      runToUser();
      return state();
    },

    /**
     * Replays the draft from the start, stopping one user pick earlier.
     *
     * Rewinding by replay rather than by unwinding state keeps undo honest: the bots'
     * choices after the undone pick were consequences of it, so they have to be drawn
     * again rather than restored. The seed makes that reproducible.
     */
    undoLastUserPick(): DraftSimState {
      const userPicks = selections.filter((selection) => selection.byUser && !selection.isKeeper);
      const target = userPicks.at(-1);
      if (!target) {
        return state();
      }

      const replayed = userPicks.slice(0, -1).map((selection) => selection.playerId);
      reset();
      runToUser();
      for (const playerId of replayed) {
        const index = available.findIndex(
          (candidate) => String(candidate.playerId) === String(playerId),
        );
        if (index === -1) {
          break;
        }
        takePlayer(index, currentSlot()!, true);
        cursor += 1;
        runToUser();
      }
      return state();
    },

    getSelections(): DraftSimSelectionInput[] {
      // Always the whole board. The reconciler treats a shorter list as removals and an
      // empty one as a failed read, so a delta here would either erase picks or be ignored.
      return selections.map((selection) => ({
        overallPick: selection.overallPick,
        round: selection.round,
        slot: selection.slot,
        rosterId: null,
        playerId: selection.sleeperPlayerId ?? String(selection.playerId),
        isKeeper: selection.isKeeper,
      }));
    },
  };
}
