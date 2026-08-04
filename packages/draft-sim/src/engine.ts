import type { FranchiseId, PlayerId, Position } from '@keeper/domain';
import type { DraftPool, DraftPoolPlayer, DraftSlotOwnership } from './pool.js';
import { createRng, sampleWeightedIndex, type Rng } from './rng.js';
import {
  emptyCounts,
  mustPrioritiseStarters,
  needWeight,
  unfilledStarterPositions,
  type PositionCounts,
  DEFAULT_BENCH_ALLOWANCE,
} from './roster-need.js';

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
  /**
   * How many of the best available to score before choosing among them.
   *
   * Wider than `candidateWindow` because roster need can lift a player well down the board
   * -- the best remaining tight end may be fortieth by raw value and still the right pick
   * for a team without one.
   */
  scanWindow?: number;
  /** Bench depth a position may occupy. See `DEFAULT_BENCH_ALLOWANCE`. */
  benchAllowance?: Partial<Record<Position, number>>;
  /** Set false to draft pure best-available, ignoring rosters entirely. */
  useRosterNeed?: boolean;
}

/** A candidate for the pick on the clock, scored the way a bot would score it. */
export interface DraftRecommendation {
  player: DraftPoolPlayer;
  /** Intrinsic value tilted by what this roster still needs. */
  score: number;
  needWeight: number;
}

export interface DraftSim {
  getState(): DraftSimState;
  /**
   * The best fits for whoever is on the clock, best first.
   *
   * Exposed because the same question gets asked from three places -- the bots, the
   * terminal, and the live board -- and answering it differently in each is how a rehearsal
   * ends up teaching something the real tool would never recommend.
   */
  getRecommendations(limit?: number): DraftRecommendation[];
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
  scanWindow: 60,
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
    scanWindow: options.scanWindow ?? DEFAULTS.scanWindow,
    benchAllowance: options.benchAllowance ?? DEFAULT_BENCH_ALLOWANCE,
    useRosterNeed: options.useRosterNeed ?? true,
    lineup: options.pool.lineup,
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

  // Live picks each franchise owns, so a bot can tell how many chances it has left. Keeper
  // picks are excluded: they are already spent.
  const livePicksByFranchise = new Map<FranchiseId, number[]>();
  for (const slot of order) {
    if (slot.consumedByKeeperRightId !== null) {
      continue;
    }
    const owned = livePicksByFranchise.get(slot.franchiseId) ?? [];
    owned.push(slot.overallPick);
    livePicksByFranchise.set(slot.franchiseId, owned);
  }

  let rng: Rng;
  let available: DraftPoolPlayer[];
  let selections: DraftSimSelection[];
  let rosters: Map<FranchiseId, PositionCounts>;
  let cursor: number;

  reset();

  function reset(): void {
    rng = createRng(config.seed);
    available = [...options.pool.players];
    selections = [];
    cursor = 0;

    // Every keeper counts from the first pick, not from the round his pick falls in. A
    // manager knows in advance who they are keeping, so a team holding a tight end at a
    // seventh-round cost does not spend pick one on a tight end and discover the clash
    // eighty picks later.
    rosters = new Map(options.pool.order.map((slot) => [slot.franchiseId, emptyCounts()]));
    for (const slot of options.pool.order) {
      if (slot.consumedByPlayerId === null) {
        continue;
      }
      const kept = keptById.get(String(slot.consumedByPlayerId));
      if (kept) {
        rosters.get(slot.franchiseId)![kept.position] += 1;
      }
    }
  }

  /** Live picks this franchise still has, the one under the cursor included. */
  function picksRemainingFor(franchiseId: FranchiseId): number {
    const owned = livePicksByFranchise.get(franchiseId) ?? [];
    const current = cursor < order.length ? order[cursor]!.overallPick : Number.POSITIVE_INFINITY;
    return owned.filter((overallPick) => overallPick >= current).length;
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

    rosters.get(slot.franchiseId)![player.position] += 1;

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
   * What this player is worth to this franchise, as opposed to in the abstract.
   *
   * Need multiplies value rather than replacing it, so the board still does most of the
   * work. A manager who abandons the board to fill slots drafts a worse team than one who
   * mostly takes the best player left; the tilt is what stops them taking a fifth running
   * back while starting nobody at tight end. A zero means the roster is full there.
   */
  function weightsFor(franchiseId: FranchiseId): Record<Position, number> {
    if (!config.useRosterNeed) {
      return { QB: 1, RB: 1, WR: 1, TE: 1, DEF: 1 };
    }
    const counts = rosters.get(franchiseId)!;
    const picksRemaining = picksRemainingFor(franchiseId);
    const input = {
      lineup: config.lineup,
      counts,
      picksRemaining,
      benchAllowance: config.benchAllowance,
    };
    return {
      QB: needWeight('QB', input),
      RB: needWeight('RB', input),
      WR: needWeight('WR', input),
      TE: needWeight('TE', input),
      DEF: needWeight('DEF', input),
    };
  }

  /**
   * Candidates worth considering for this franchise, best fit first.
   *
   * Capped positions are dropped *before* the board is sliced, not after. Slicing first
   * looked equivalent and was not: late in the draft the top of the board by value is
   * almost entirely defences -- their replacement level sits far below the position's
   * ceiling, while every remaining skill player is priced at roughly nothing -- so a window
   * taken off the top contained only players the roster had no room for, and the fallback
   * then drafted one. Every team ended up with two defences, which is precisely the
   * absurdity roster need exists to prevent.
   */
  function candidatesFor(
    franchiseId: FranchiseId,
  ): { player: DraftPoolPlayer; index: number; score: number; needWeight: number }[] {
    const weights = weightsFor(franchiseId);
    const needInput = {
      lineup: config.lineup,
      counts: rosters.get(franchiseId)!,
      picksRemaining: picksRemainingFor(franchiseId),
      benchAllowance: config.benchAllowance,
    };
    // Out of picks to spare, so only an empty starting slot is worth one. Applied as a
    // filter rather than a weight because no tilt survives a large enough value gap, and a
    // backup quarterback really does outscore the last startable tight end.
    const starterOnly =
      config.useRosterNeed && mustPrioritiseStarters(needInput)
        ? new Set(unfilledStarterPositions(config.lineup, needInput.counts))
        : null;

    const scored: { player: DraftPoolPlayer; index: number; score: number; needWeight: number }[] =
      [];

    for (let index = 0; index < available.length; index += 1) {
      const player = available[index]!;
      const weight = weights[player.position];
      if (weight <= 0 || (starterOnly !== null && !starterOnly.has(player.position))) {
        continue;
      }
      scored.push({
        player,
        index,
        score: player.intrinsicValue * weight,
        needWeight: weight,
      });
      if (scored.length >= config.scanWindow) {
        break;
      }
    }

    return scored.sort((left, right) => right.score - left.score || left.index - right.index);
  }

  /**
   * Best fit, softened.
   *
   * A wide slice of the board is scored for this franchise, then the choice is sampled from
   * the best few so that the top usually goes and occasionally does not. The slice has to be
   * wide because need can lift a player a long way: the best remaining tight end may be
   * fortieth by raw value and still the obvious pick for a team without one.
   */
  function botPick(slot: DraftSlotOwnership): void {
    if (available.length === 0) {
      throw new Error(`The pool ran out at overall pick ${slot.overallPick}.`);
    }

    // Only when every position is genuinely full does the roster stop having a preference,
    // and the pick still has to happen.
    const scored = candidatesFor(slot.franchiseId);
    const window = (scored.length > 0 ? scored : [{ index: 0, score: 0 }]).slice(
      0,
      config.candidateWindow,
    );

    const best = window[0]!.score;
    const weights =
      config.reachTemperature === 0
        ? window.map((_, index) => (index === 0 ? 1 : 0))
        : window.map((entry) => Math.exp((entry.score - best) / config.reachTemperature));

    takePlayer(window[sampleWeightedIndex(weights, rng)]!.index, slot, false);
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

    getRecommendations(limit = 5): DraftRecommendation[] {
      const slot = currentSlot();
      if (slot === null) {
        return [];
      }

      return candidatesFor(slot.franchiseId)
        .slice(0, limit)
        .map((entry) => ({
          player: entry.player,
          score: entry.score,
          needWeight: entry.needWeight,
        }));
    },

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
