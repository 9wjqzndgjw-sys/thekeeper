import type { LineupSettings, Position } from '@keeper/domain';

// Standard flex eligibility for this league's FLEX slot (RB/WR/TE); QB and DEF start
// only in their dedicated slots, so they have no flex pool to share.
export const FLEX_ELIGIBLE_POSITIONS: readonly Position[] = ['RB', 'WR', 'TE'];

export interface ReplacementCandidate {
  position: Position;
  projectedPoints: number;
}

export interface ComputeReplacementLevelsInput {
  /** Players who can still be acquired. Replacement level is read from these. */
  candidates: ReplacementCandidate[];
  /**
   * Players already on a roster -- keepers, or picks already made in a live draft.
   *
   * These have to be passed rather than simply left out, because they consume roster
   * demand as well as supply. Dropping them from `candidates` alone shrinks the pool while
   * the league still demands a full set of rosters, so the cascade digs deeper than it
   * should and replacement level sinks. In this league that is a thirty-two player gap
   * against a hundred and eighty slots, which pushed flex replacement down by roughly a
   * quarter and inflated every value derived from it. During a live draft the error grows
   * with every pick made, which is exactly when the numbers are being trusted most.
   *
   * They are ranked alongside `candidates` for slot assignment, so a kept player takes the
   * slot his value actually earns: an elite back consumes a starting spot, a backup
   * quarterback consumes a bench spot. Replacement is then the best player still
   * available once demand is met.
   */
  rosteredCandidates?: readonly ReplacementCandidate[];
  lineup: LineupSettings;
  teamCount: number;
  /**
   * Most bench spots a single non-flex position may absorb. Defaults to one backup per
   * team per starting slot, which stops a shallow position from being drained: there are
   * only thirty-two defences, and without a cap the bench swallows every one of them and
   * drives defensive replacement to zero, making every defence look like a third-round
   * pick. A behavioural assumption, so it is exposed rather than buried.
   */
  maxBenchSlotsPerPosition?: Partial<Record<Position, number>>;
}

export type ReplacementLevels = Partial<Record<Position, number>>;

const STARTER_SLOT_BY_POSITION: Record<Position, keyof LineupSettings> = {
  QB: 'qb',
  RB: 'rb',
  WR: 'wr',
  TE: 'te',
  DEF: 'def',
};

/**
 * Replacement level is the best player at a position that no team has rostered, so it has
 * to model the whole roster: dedicated starters, flex, and bench.
 *
 * Bench spots are the subtle part. They are not position-locked, so they must be
 * allocated across positions -- but allocating them by raw projected points is wrong,
 * because points do not mean the same thing at every position. In a one-quarterback
 * league the twentieth quarterback still projects more raw points than a useful third
 * running back, so a points-ranked bench fills up with quarterbacks nobody would ever
 * roster and drags quarterback replacement down to a player far below the real waiver
 * line. Bench spots therefore go to the highest value *over positional replacement*,
 * which is the comparison that actually drives a roster decision.
 *
 * That value depends on replacement, and replacement depends on it, so this runs in two
 * passes: a preliminary replacement from starters and flex alone, then a bench allocation
 * measured against it. Two passes are enough for the ordering to settle in practice.
 *
 * Players already rostered belong in `rosteredCandidates`, not omitted -- see that field.
 */
export function computeReplacementLevels(input: ComputeReplacementLevelsInput): ReplacementLevels {
  const { lineup, teamCount } = input;
  const remainingByPosition = groupSortedByPosition(input.candidates, input.rosteredCandidates);

  // Dedicated starters come off first.
  for (const position of positions()) {
    take(remainingByPosition, position, lineup[STARTER_SLOT_BY_POSITION[position]] * teamCount);
  }

  // Then flex, filled by the best remaining flex-eligible players.
  takeAcrossPositions(
    remainingByPosition,
    FLEX_ELIGIBLE_POSITIONS,
    lineup.flex * teamCount,
    (position, points) => points,
  );

  const preliminary = readReplacementLevels(remainingByPosition);

  // Finally bench, ranked by value over the preliminary replacement rather than by points.
  takeAcrossPositions(
    remainingByPosition,
    positions(),
    lineup.bench * teamCount,
    (position, points) => points - (preliminary[position] ?? 0),
    resolveBenchCaps(input),
  );

  return readReplacementLevels(remainingByPosition);
}

function positions(): Position[] {
  return Object.keys(STARTER_SLOT_BY_POSITION) as Position[];
}

/**
 * One player in the pool. `available` is false for someone already rostered: they still
 * compete for a roster slot, but cannot themselves be a replacement.
 */
interface PoolEntry {
  points: number;
  available: boolean;
}

function groupSortedByPosition(
  candidates: readonly ReplacementCandidate[],
  rosteredCandidates: readonly ReplacementCandidate[] = [],
): Map<Position, PoolEntry[]> {
  const pool = [
    ...candidates.map((candidate) => ({ candidate, available: true })),
    ...rosteredCandidates.map((candidate) => ({ candidate, available: false })),
  ];

  const byPosition = new Map<Position, PoolEntry[]>();
  for (const position of positions()) {
    byPosition.set(
      position,
      pool
        .filter((entry) => entry.candidate.position === position)
        .map((entry) => ({ points: entry.candidate.projectedPoints, available: entry.available }))
        .sort((left, right) => right.points - left.points),
    );
  }
  return byPosition;
}

function take(remaining: Map<Position, PoolEntry[]>, position: Position, count: number): void {
  if (count <= 0) {
    return;
  }
  remaining.set(position, (remaining.get(position) ?? []).slice(count));
}

/**
 * Flex-eligible positions are uncapped, since a bench genuinely is mostly running backs
 * and receivers. A position that starts one player gets at most one backup per team.
 */
function resolveBenchCaps(input: ComputeReplacementLevelsInput): Partial<Record<Position, number>> {
  const caps: Partial<Record<Position, number>> = {};
  for (const position of positions()) {
    if (FLEX_ELIGIBLE_POSITIONS.includes(position)) {
      continue;
    }
    caps[position] =
      input.maxBenchSlotsPerPosition?.[position] ??
      input.lineup[STARTER_SLOT_BY_POSITION[position]] * input.teamCount;
  }
  return caps;
}

/** Removes `count` players from the given positions, best-first by `rank`. */
function takeAcrossPositions(
  remaining: Map<Position, PoolEntry[]>,
  eligible: readonly Position[],
  count: number,
  rank: (position: Position, points: number) => number,
  caps: Partial<Record<Position, number>> = {},
): void {
  if (count <= 0) {
    return;
  }

  const pool = eligible.flatMap((position) =>
    (remaining.get(position) ?? []).map((entry) => ({ position, points: entry.points })),
  );
  pool.sort((left, right) => rank(right.position, right.points) - rank(left.position, left.points));

  const takenByPosition = new Map<Position, number>();
  let takenTotal = 0;
  for (const entry of pool) {
    if (takenTotal >= count) {
      break;
    }
    const alreadyTaken = takenByPosition.get(entry.position) ?? 0;
    const cap = caps[entry.position];
    if (cap !== undefined && alreadyTaken >= cap) {
      continue;
    }
    takenByPosition.set(entry.position, alreadyTaken + 1);
    takenTotal += 1;
  }

  for (const [position, taken] of takenByPosition) {
    take(remaining, position, taken);
  }
}

/**
 * The best unrostered player at each position. Flex-eligible positions share one level,
 * since any of them can fill the same open roster spot.
 *
 * Only available players are eligible. A rostered player can survive the cascade -- when a
 * team keeps someone worth less than a bench spot, say -- and must not then be reported as
 * the level a draftable player is measured against.
 */
function bestAvailable(remaining: ReadonlyMap<Position, PoolEntry[]>, position: Position): number {
  return remaining.get(position)?.find((entry) => entry.available)?.points ?? 0;
}

function readReplacementLevels(remaining: ReadonlyMap<Position, PoolEntry[]>): ReplacementLevels {
  const levels: ReplacementLevels = {};

  for (const position of positions()) {
    if (!FLEX_ELIGIBLE_POSITIONS.includes(position)) {
      levels[position] = bestAvailable(remaining, position);
    }
  }

  const bestFlexEligible = Math.max(
    0,
    ...FLEX_ELIGIBLE_POSITIONS.map((position) => bestAvailable(remaining, position)),
  );
  for (const position of FLEX_ELIGIBLE_POSITIONS) {
    levels[position] = bestFlexEligible;
  }

  return levels;
}
