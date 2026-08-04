import type { LineupSettings, Position } from '@keeper/domain';
import { FLEX_ELIGIBLE_POSITIONS } from '@keeper/valuation';

export const POSITIONS: readonly Position[] = ['QB', 'RB', 'WR', 'TE', 'DEF'];

export type PositionCounts = Record<Position, number>;

/**
 * Bench depth by position, as a real manager treats it.
 *
 * Defence gets nothing: a league of twelve needs twelve and thirty-two exist, so the
 * position is streamed off waivers and a second one is a wasted roster spot. Quarterback
 * gets one in a single-quarterback league. The flex positions get the rest, because that is
 * what a bench is actually for.
 */
export const DEFAULT_BENCH_ALLOWANCE: Partial<Record<Position, number>> = {
  QB: 1,
  RB: 4,
  WR: 4,
  TE: 1,
  DEF: 0,
};

export interface RosterNeedInput {
  lineup: LineupSettings;
  /** What the franchise already holds, keepers included. */
  counts: PositionCounts;
  /** Live picks this franchise still has, the current one included. */
  picksRemaining: number;
  benchAllowance?: Partial<Record<Position, number>>;
}

const STARTER_SLOT: Record<Position, keyof LineupSettings> = {
  QB: 'qb',
  RB: 'rb',
  WR: 'wr',
  TE: 'te',
  DEF: 'def',
};

export function emptyCounts(): PositionCounts {
  return { QB: 0, RB: 0, WR: 0, TE: 0, DEF: 0 };
}

export function isFlexEligible(position: Position): boolean {
  return FLEX_ELIGIBLE_POSITIONS.includes(position);
}

/**
 * How many of a position a roster will tolerate: starters, flex, and bench.
 *
 * A cap is not a preference, it is the line past which a pick stops making sense at all.
 * Best-available has no concept of a roster, so left alone it drafts a second defence in
 * the fourteenth round because the replacement model still prices defences above the tail
 * of the skill positions -- true as arithmetic, absurd as a roster. Nobody starts two.
 */
export function positionCap(
  position: Position,
  lineup: LineupSettings,
  benchAllowance: Partial<Record<Position, number>> = DEFAULT_BENCH_ALLOWANCE,
): number {
  const starters = lineup[STARTER_SLOT[position]];
  const flex = isFlexEligible(position) ? lineup.flex : 0;
  return starters + flex + (benchAllowance[position] ?? 0);
}

/** Dedicated starter slots this franchise has not filled yet. */
export function unfilledStarters(lineup: LineupSettings, counts: PositionCounts): number {
  return POSITIONS.reduce(
    (total, position) => total + Math.max(0, lineup[STARTER_SLOT[position]] - counts[position]),
    0,
  );
}

/**
 * How badly this franchise needs a player at this position right now.
 *
 * Zero means the roster is full there and the pick should not happen at all. Otherwise the
 * weight multiplies intrinsic value, so ordering is still mostly the board's -- need tilts
 * it rather than replacing it. A manager who abandons the board entirely to fill slots
 * drafts a far worse team than one who mostly takes the best player left.
 *
 * Urgency is the part that makes a short roster behave differently from a long one. A team
 * with two picks left and two empty starting slots cannot afford a flier; a team with seven
 * picks and the same two slots can. That ratio, not the raw slot count, is what separates
 * how the pick-poor and the pick-rich draft in this league -- and the spread here is wide
 * enough to matter, from nine picks to twenty-two.
 */
export function needWeight(position: Position, input: RosterNeedInput): number {
  const allowance = input.benchAllowance ?? DEFAULT_BENCH_ALLOWANCE;
  const held = input.counts[position];

  if (held >= positionCap(position, input.lineup, allowance)) {
    return 0;
  }

  const starters = input.lineup[STARTER_SLOT[position]];
  const starterShortfall = Math.max(0, starters - held);

  // Flex only counts once the dedicated slots at every flex position are covered, so a
  // team missing a starting tight end is not told it also needs a fourth running back.
  const flexShortfall = isFlexEligible(position)
    ? Math.max(0, input.lineup.flex - flexSurplus(input.lineup, input.counts))
    : 0;

  const base = starterShortfall > 0 ? 1 : flexShortfall > 0 ? 0.55 : 0.15;

  // 0 when picks are plentiful against the slots left to fill, 1 when they are not.
  const urgency = clamp01(
    unfilledStarters(input.lineup, input.counts) / Math.max(1, input.picksRemaining),
  );

  // Ranges from a mild tilt when nothing is pressing to a strong one when it is.
  return 0.7 + base * (0.5 + urgency);
}

/** Dedicated starting slots this franchise has not covered yet. */
export function unfilledStarterPositions(
  lineup: LineupSettings,
  counts: PositionCounts,
): Position[] {
  return POSITIONS.filter((position) => counts[position] < lineup[STARTER_SLOT[position]]);
}

/**
 * True when the franchise has no picks to spare on anything but a starting slot.
 *
 * Below this line weighting is not enough. A tilt can only ever be outvoted by a large
 * enough value gap, and late in a draft that gap is routine -- a backup quarterback really
 * does score more points than the last startable tight end. A manager with two picks left
 * and three empty starting slots does not make that trade anyway, because points from a
 * bench player are worth nothing. So this stops being a preference and becomes a rule.
 *
 * It matters most for the teams that traded picks away: one roster in this league arrives
 * with nine picks against seven starting slots and is under this line from the first round.
 */
export function mustPrioritiseStarters(input: RosterNeedInput): boolean {
  return (
    input.picksRemaining > 0 && unfilledStarters(input.lineup, input.counts) >= input.picksRemaining
  );
}

/** Flex-eligible players held beyond their own dedicated starting slots. */
function flexSurplus(lineup: LineupSettings, counts: PositionCounts): number {
  return FLEX_ELIGIBLE_POSITIONS.reduce(
    (total, position) => total + Math.max(0, counts[position] - lineup[STARTER_SLOT[position]]),
    0,
  );
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}
