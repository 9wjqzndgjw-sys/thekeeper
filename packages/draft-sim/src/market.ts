import type { FranchiseId, Position } from '@keeper/domain';
import { POSITIONS } from './roster-need.js';

/** One past selection, reduced to what the market model actually reads. */
export interface HistoricalSelection {
  seasonYear: number;
  round: number;
  franchiseId: string | null;
  position: Position;
  isKeeper: boolean;
}

export interface ManagerTendency {
  franchiseId: FranchiseId;
  /**
   * Per position, how much more or less this manager takes it than the league does.
   * 1 is league-average. Shrunk toward 1 in proportion to how little was observed.
   */
  positionBias: Record<Position, number>;
  picksObserved: number;
}

export interface DraftMarket {
  /** Per round, how much earlier or later than usual a position goes in this league. */
  roundBias: Map<number, Record<Position, number>>;
  managerTendencies: Map<FranchiseId, ManagerTendency>;
  seasonsObserved: number[];
  picksObserved: number;
  notes: string[];
}

export interface BuildDraftMarketInput {
  selections: readonly HistoricalSelection[];
  /** Rounds the coming draft has, so every round gets an entry even if history is thin. */
  rounds: number;
  /**
   * Positional shares per round that value and roster need alone already produce.
   *
   * Without this the model double-counts. A past draft is not a record of preference; it is
   * a record of preference *and* value, and the value half is already in the projections.
   * Measured against raw share, round one came out at sixty-seven per cent running backs in
   * the history, the value model produced seventy-six on its own, and multiplying the two
   * gave a hundred -- a first round with nothing but running backs in it, which is not what
   * this league does.
   *
   * Measured against what value alone predicts, what is left is the part the projections do
   * not explain, which is the only part worth learning. Omit to fall back to raw share.
   */
  valueBaseline?: ReadonlyMap<number, Record<Position, number>>;
  /**
   * Additive smoothing. Stops a position that never happened to go in a round from being
   * ruled out entirely: sixteen defences went in the fifteenth round across five seasons
   * and none in the first, but "never in round one" is a strong claim to make from
   * forty-three observations.
   */
  smoothing?: number;
  /** Picks at which a manager's own tendency is trusted at full strength. */
  managerConfidencePicks?: number;
  /**
   * Rounds grouped together before any share is measured.
   *
   * Per round this corpus is too thin to carry a multiplier: eight hundred and forty picks
   * over fifteen rounds and five positions leaves roughly eleven observations a cell, and
   * a bias built on eleven observations compounds against roster need and flips orderings
   * that the projections had right. Grouped five rounds at a time each cell holds nearer
   * forty, which is enough to say defences go late and not enough to say they go in the
   * twelfth specifically -- which is all the history actually knows.
   */
  roundsPerBucket?: number;
}

const DEFAULTS = {
  smoothing: 1,
  managerConfidencePicks: 60,
  roundsPerBucket: 5,
} as const;

/**
 * How this league drafts, learned from its own past drafts.
 *
 * Projections say what a player is worth; they say nothing about when the room will take
 * him. Bots driven by value alone reach for exactly the players the board already ranks
 * highest, so nothing surprising ever happens and the rehearsal only confirms what you
 * already believed. This is the other half: a positional clock, measured rather than
 * assumed.
 *
 * Bias is relative to the position's own overall frequency, not to a raw share. That
 * distinction matters -- running backs are the most-drafted position in every round, so a
 * raw share would say "take a running back" everywhere and add nothing. What is useful is
 * that they go *unusually* early here and defences go *unusually* late.
 *
 * Per-player draft position is deliberately not modelled. A rookie has no history, and a
 * veteran's price moves with a season of football, so per-player numbers from 2021 would be
 * confident nonsense about 2026. Positional timing is the part that survives the years.
 */
export function buildDraftMarket(input: BuildDraftMarketInput): DraftMarket {
  const smoothing = input.smoothing ?? DEFAULTS.smoothing;
  const confidencePicks = input.managerConfidencePicks ?? DEFAULTS.managerConfidencePicks;
  const roundsPerBucket = Math.max(1, input.roundsPerBucket ?? DEFAULTS.roundsPerBucket);
  const bucketOf = (round: number): number => Math.floor((round - 1) / roundsPerBucket);
  const notes: string[] = [];

  // Keepers are excluded throughout. A keeper is not a market decision -- it was made at a
  // cost set years earlier -- so counting one as a pick at that round would say the league
  // drafts tight ends in the second when what happened was somebody kept one.
  const live = input.selections.filter((selection) => !selection.isKeeper);
  const seasonsObserved = [...new Set(live.map((selection) => selection.seasonYear))].sort();

  if (live.length === 0) {
    notes.push('No past drafts are stored, so the market model is neutral and changes nothing.');
    return {
      roundBias: neutralBias(input.rounds),
      managerTendencies: new Map(),
      seasonsObserved,
      picksObserved: 0,
      notes,
    };
  }

  const overall = countByPosition(live);
  const overallShare = toShare(overall, smoothing);

  if (!input.valueBaseline) {
    notes.push(
      'No value baseline was supplied, so bias is measured against overall frequency and ' +
        'partly re-states what the projections already say.',
    );
  }

  // Measured per bucket, then handed back per round so callers need not know about buckets.
  const bucketCount = Math.ceil(input.rounds / roundsPerBucket);
  const bucketBias: Record<Position, number>[] = [];
  for (let bucket = 0; bucket < bucketCount; bucket += 1) {
    const inBucket = live.filter((selection) => bucketOf(selection.round) === bucket);
    const share = toShare(countByPosition(inBucket), smoothing);

    const baselineRounds: Record<Position, number>[] = [];
    for (let round = 1; round <= input.rounds; round += 1) {
      const baseline = input.valueBaseline?.get(round);
      if (baseline && bucketOf(round) === bucket) {
        baselineRounds.push(baseline);
      }
    }

    // Against what value alone does over the same stretch where that is known, and against
    // the position's overall frequency otherwise.
    const against =
      baselineRounds.length > 0
        ? smoothShare(averageShare(baselineRounds), smoothing)
        : overallShare;
    bucketBias.push(ratio(share, against));

    if (inBucket.length === 0) {
      notes.push(
        `No past selection falls in rounds ${bucket * roundsPerBucket + 1}-${Math.min(
          (bucket + 1) * roundsPerBucket,
          input.rounds,
        )}; that stretch is treated as neutral.`,
      );
    }
  }

  const roundBias = new Map<number, Record<Position, number>>();
  for (let round = 1; round <= input.rounds; round += 1) {
    roundBias.set(round, bucketBias[bucketOf(round)] ?? { QB: 1, RB: 1, WR: 1, TE: 1, DEF: 1 });
  }

  const managerTendencies = new Map<FranchiseId, ManagerTendency>();
  const byFranchise = new Map<string, HistoricalSelection[]>();
  for (const selection of live) {
    if (selection.franchiseId === null) {
      continue;
    }
    byFranchise.set(selection.franchiseId, [
      ...(byFranchise.get(selection.franchiseId) ?? []),
      selection,
    ]);
  }

  for (const [franchiseId, picks] of byFranchise) {
    const share = toShare(countByPosition(picks), smoothing);
    const raw = ratio(share, overallShare);
    // Sixty-odd picks per manager over five seasons is enough to hint at a habit and not
    // enough to prove one, so a thin record is pulled back toward league-average rather
    // than believed. Nothing here is a claim about intent.
    const confidence = Math.min(1, picks.length / confidencePicks);

    managerTendencies.set(franchiseId as FranchiseId, {
      franchiseId: franchiseId as FranchiseId,
      positionBias: shrinkToward(raw, 1, confidence),
      picksObserved: picks.length,
    });
  }

  const teamSizes = new Set(
    seasonsObserved.map((year) => live.filter((selection) => selection.seasonYear === year).length),
  );
  if (teamSizes.size > 1) {
    notes.push(
      'Past seasons differ in size, so shares rather than counts are used throughout and a ' +
        'smaller season carries proportionally less weight than its pick count suggests.',
    );
  }

  return { roundBias, managerTendencies, seasonsObserved, picksObserved: live.length, notes };
}

/**
 * Positional shares per round, for use as a value baseline.
 *
 * Run a draft with the market switched off and hand the result back here: what comes out is
 * what value and roster need produce on their own, which is exactly what the learned bias
 * needs to be measured against. Keepers are excluded, as everywhere else.
 */
export function positionalSharesByRound(
  selections: readonly { round: number; position: Position; isKeeper: boolean }[],
  rounds: number,
): Map<number, Record<Position, number>> {
  const shares = new Map<number, Record<Position, number>>();

  for (let round = 1; round <= rounds; round += 1) {
    const inRound = selections.filter(
      (selection) => selection.round === round && !selection.isKeeper,
    );
    const counts: Record<Position, number> = { QB: 0, RB: 0, WR: 0, TE: 0, DEF: 0 };
    for (const selection of inRound) {
      counts[selection.position] += 1;
    }
    const total = POSITIONS.reduce((sum, position) => sum + counts[position], 0);
    const share: Record<Position, number> = { QB: 0, RB: 0, WR: 0, TE: 0, DEF: 0 };
    for (const position of POSITIONS) {
      share[position] = total === 0 ? 0 : counts[position] / total;
    }
    shares.set(round, share);
  }

  return shares;
}

/**
 * How much this league's history pushes a position at this point in the draft.
 *
 * Returns 1 when history says nothing, so a caller can multiply unconditionally.
 */
export function marketWeight(
  market: DraftMarket,
  position: Position,
  round: number,
  franchiseId: FranchiseId | null,
  influence: number,
): number {
  if (influence <= 0) {
    return 1;
  }

  const round_ = market.roundBias.get(round)?.[position] ?? 1;
  const manager = franchiseId
    ? (market.managerTendencies.get(franchiseId)?.positionBias[position] ?? 1)
    : 1;

  // Influence is an exponent rather than a coefficient so that turning it down moves the
  // weight toward 1 from either side, instead of dragging an already-small weight further
  // below the value model.
  return Math.pow(round_ * manager, influence);
}

function neutralBias(rounds: number): Map<number, Record<Position, number>> {
  const bias = new Map<number, Record<Position, number>>();
  for (let round = 1; round <= rounds; round += 1) {
    bias.set(round, { QB: 1, RB: 1, WR: 1, TE: 1, DEF: 1 });
  }
  return bias;
}

function countByPosition(selections: readonly HistoricalSelection[]): Record<Position, number> {
  const counts: Record<Position, number> = { QB: 0, RB: 0, WR: 0, TE: 0, DEF: 0 };
  for (const selection of selections) {
    counts[selection.position] += 1;
  }
  return counts;
}

/**
 * Re-smooths a share that arrived as proportions rather than counts.
 *
 * A baseline round with no defences at all would otherwise divide by nothing and hand back
 * an unbounded bias off a single observation.
 */
function smoothShare(share: Record<Position, number>, smoothing: number): Record<Position, number> {
  const scale = 100;
  const counts: Record<Position, number> = { QB: 0, RB: 0, WR: 0, TE: 0, DEF: 0 };
  for (const position of POSITIONS) {
    counts[position] = Math.max(0, share[position]) * scale;
  }
  return toShare(counts, smoothing);
}

/** Mean of several share records, so a bucket is measured over its whole stretch. */
function averageShare(shares: readonly Record<Position, number>[]): Record<Position, number> {
  const out: Record<Position, number> = { QB: 0, RB: 0, WR: 0, TE: 0, DEF: 0 };
  for (const position of POSITIONS) {
    out[position] =
      shares.reduce((sum, share) => sum + share[position], 0) / Math.max(1, shares.length);
  }
  return out;
}

function toShare(counts: Record<Position, number>, smoothing: number): Record<Position, number> {
  const total =
    POSITIONS.reduce((sum, position) => sum + counts[position], 0) + smoothing * POSITIONS.length;
  const share: Record<Position, number> = { QB: 0, RB: 0, WR: 0, TE: 0, DEF: 0 };
  for (const position of POSITIONS) {
    share[position] = (counts[position] + smoothing) / total;
  }
  return share;
}

function ratio(
  numerator: Record<Position, number>,
  denominator: Record<Position, number>,
): Record<Position, number> {
  const out: Record<Position, number> = { QB: 1, RB: 1, WR: 1, TE: 1, DEF: 1 };
  for (const position of POSITIONS) {
    out[position] = denominator[position] > 0 ? numerator[position] / denominator[position] : 1;
  }
  return out;
}

function shrinkToward(
  values: Record<Position, number>,
  target: number,
  confidence: number,
): Record<Position, number> {
  const out: Record<Position, number> = { QB: 1, RB: 1, WR: 1, TE: 1, DEF: 1 };
  for (const position of POSITIONS) {
    out[position] = target + (values[position] - target) * confidence;
  }
  return out;
}
