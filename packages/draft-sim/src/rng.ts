/**
 * A small seeded generator, so a rehearsal can be replayed exactly.
 *
 * Determinism is not a nicety here. A draft is a chain of dependent decisions, and the only
 * way to answer "why did that team take him" is to run the same draft again and change one
 * thing. `Math.random` makes every run unrepeatable and every such question unanswerable,
 * so nothing in this package is allowed to call it.
 *
 * mulberry32: 32-bit state, fast, and good enough for choosing between football players.
 */
export type Rng = () => number;

export function createRng(seed: number): Rng {
  if (!Number.isFinite(seed)) {
    throw new Error(`seed must be a finite number; received ${seed}.`);
  }

  let state = Math.trunc(seed) >>> 0;
  return function next(): number {
    state = (state + 0x6d2b79f5) >>> 0;
    let drawn = state;
    drawn = Math.imul(drawn ^ (drawn >>> 15), drawn | 1);
    drawn ^= drawn + Math.imul(drawn ^ (drawn >>> 7), drawn | 61);
    return ((drawn ^ (drawn >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Picks an index from `weights` in proportion to them.
 *
 * Weights are assumed non-negative and are not required to sum to one. An all-zero set
 * falls back to the first entry rather than throwing, because the caller has already
 * decided these are the candidates worth considering.
 */
export function sampleWeightedIndex(weights: readonly number[], rng: Rng): number {
  const total = weights.reduce((sum, weight) => sum + Math.max(0, weight), 0);
  if (total <= 0) {
    return 0;
  }

  let remaining = rng() * total;
  for (let index = 0; index < weights.length; index += 1) {
    remaining -= Math.max(0, weights[index]!);
    if (remaining <= 0) {
      return index;
    }
  }
  return weights.length - 1;
}
