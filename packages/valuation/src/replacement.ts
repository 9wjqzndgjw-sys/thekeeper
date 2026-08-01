import type { LineupSettings, Position } from '@keeper/domain';

// Standard flex eligibility for this league's FLEX slot (RB/WR/TE); QB and DEF start
// only in their dedicated slots, so they have no flex pool to share.
export const FLEX_ELIGIBLE_POSITIONS: readonly Position[] = ['RB', 'WR', 'TE'];

export interface ReplacementCandidate {
  position: Position;
  projectedPoints: number;
}

export interface ComputeReplacementLevelsInput {
  candidates: ReplacementCandidate[];
  lineup: LineupSettings;
  teamCount: number;
}

export type ReplacementLevels = Partial<Record<Position, number>>;

const DIRECT_STARTER_COUNT_BY_POSITION: Record<Position, keyof LineupSettings> = {
  QB: 'qb',
  RB: 'rb',
  WR: 'wr',
  TE: 'te',
  DEF: 'def',
};

interface BenchPoolEntry {
  source: 'QB' | 'DEF' | 'FLEX';
  points: number;
}

/**
 * Replacement level is the best player NOT rostered by any team, not just the best
 * non-starter: every bench spot a league fills removes one more player from the
 * freely available pool. Bench spots aren't position-locked, so leftover players
 * from every position (after direct starters and flex) are pooled together and
 * ranked by points -- letting the data decide which positions actually absorb
 * bench depth, rather than assuming an even split across positions.
 *
 * Timing (pre- vs. post-keeper, "up to 36" rostered keepers) is NOT modeled here:
 * callers must pass the right candidate pool for their mode (e.g. excluding
 * declared keepers post-deadline). Probability-weighted pre-keeper replacement is
 * deferred to a later market-analysis phase.
 */
export function computeReplacementLevels(input: ComputeReplacementLevelsInput): ReplacementLevels {
  const { candidates, lineup, teamCount } = input;
  const byPosition = groupByPosition(candidates);

  const sortedPointsByPosition = new Map<Position, number[]>(
    (Object.keys(DIRECT_STARTER_COUNT_BY_POSITION) as Position[]).map((position) => [
      position,
      (byPosition.get(position) ?? [])
        .map((candidate) => candidate.projectedPoints)
        .sort((a, b) => b - a),
    ]),
  );

  const qbLeftover = sortedPointsByPosition.get('QB')!.slice(lineup.qb * teamCount);
  const defLeftover = sortedPointsByPosition.get('DEF')!.slice(lineup.def * teamCount);

  const flexOverflow = FLEX_ELIGIBLE_POSITIONS.flatMap((position) =>
    sortedPointsByPosition
      .get(position)!
      .slice(lineup[DIRECT_STARTER_COUNT_BY_POSITION[position]] * teamCount),
  ).sort((a, b) => b - a);
  const flexLeftover = flexOverflow.slice(lineup.flex * teamCount);

  const benchPool: BenchPoolEntry[] = [
    ...qbLeftover.map((points): BenchPoolEntry => ({ source: 'QB', points })),
    ...defLeftover.map((points): BenchPoolEntry => ({ source: 'DEF', points })),
    ...flexLeftover.map((points): BenchPoolEntry => ({ source: 'FLEX', points })),
  ].sort((a, b) => b.points - a.points);

  const benchCount = lineup.bench * teamCount;
  const rosteredAsBench = benchPool.slice(0, benchCount);
  const consumedFromQB = rosteredAsBench.filter((entry) => entry.source === 'QB').length;
  const consumedFromDEF = rosteredAsBench.filter((entry) => entry.source === 'DEF').length;
  const consumedFromFlex = rosteredAsBench.filter((entry) => entry.source === 'FLEX').length;

  const flexReplacementLevel = flexLeftover[consumedFromFlex] ?? 0;
  const replacementLevels: ReplacementLevels = {
    QB: qbLeftover[consumedFromQB] ?? 0,
    DEF: defLeftover[consumedFromDEF] ?? 0,
  };
  for (const position of FLEX_ELIGIBLE_POSITIONS) {
    replacementLevels[position] = flexReplacementLevel;
  }

  return replacementLevels;
}

function groupByPosition(
  candidates: ReplacementCandidate[],
): Map<Position, ReplacementCandidate[]> {
  const byPosition = new Map<Position, ReplacementCandidate[]>();

  for (const candidate of candidates) {
    const group = byPosition.get(candidate.position);
    if (group) {
      group.push(candidate);
    } else {
      byPosition.set(candidate.position, [candidate]);
    }
  }

  return byPosition;
}
