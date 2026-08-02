import { describe, expect, it } from 'vitest';
import type { LineupSettings } from '@keeper/domain';
import { computeReplacementLevels, type ReplacementCandidate } from './replacement.js';

const lineup: LineupSettings = { qb: 1, rb: 1, wr: 1, te: 1, flex: 1, def: 1, bench: 0, ir: 0 };

const candidates: ReplacementCandidate[] = [
  { position: 'QB', projectedPoints: 100 },
  { position: 'QB', projectedPoints: 80 },
  { position: 'QB', projectedPoints: 60 },
  { position: 'RB', projectedPoints: 90 },
  { position: 'RB', projectedPoints: 70 },
  { position: 'RB', projectedPoints: 50 },
  { position: 'RB', projectedPoints: 30 },
  { position: 'WR', projectedPoints: 85 },
  { position: 'WR', projectedPoints: 65 },
  { position: 'WR', projectedPoints: 45 },
  { position: 'WR', projectedPoints: 25 },
  { position: 'TE', projectedPoints: 75 },
  { position: 'TE', projectedPoints: 55 },
  { position: 'DEF', projectedPoints: 40 },
  { position: 'DEF', projectedPoints: 20 },
  { position: 'DEF', projectedPoints: 10 },
];

describe('computeReplacementLevels', () => {
  it('with no bench spots, sets QB/DEF replacement right after their starters', () => {
    const levels = computeReplacementLevels({ candidates, lineup, teamCount: 2 });

    expect(levels.QB).toBe(60);
    expect(levels.DEF).toBe(10);
  });

  it('with no bench spots, pools leftover RB/WR/TE for the shared flex replacement level', () => {
    // Direct-starter overflow (RB: 50,30 / WR: 45,25 / TE: none) pooled and
    // sorted: 50, 45, 30, 25. flexCount = 1 * 2 teams = 2, so replacement is
    // the next entry after the top 2: 30.
    const levels = computeReplacementLevels({ candidates, lineup, teamCount: 2 });

    expect(levels.RB).toBe(30);
    expect(levels.WR).toBe(30);
    expect(levels.TE).toBe(30);
  });

  it('falls back to zero when the pool runs out', () => {
    const levels = computeReplacementLevels({
      candidates: [{ position: 'QB', projectedPoints: 100 }],
      lineup,
      teamCount: 2,
    });

    expect(levels.QB).toBe(0);
  });

  it('deepens the pool with bench spots, pulled cross-position', () => {
    // Leftover after starters+flex, labeled: QB 60, DEF 10, FLEX 30, FLEX 25.
    // Sorted by points: QB 60, FLEX 30, FLEX 25, DEF 10. With bench = 1 * 2
    // teams = 2 bench spots, the top 2 (QB 60 and FLEX 30) get rostered as
    // bench, so they no longer count as "replacement level" for their position.
    const benchLineup: LineupSettings = { ...lineup, bench: 1 };
    const levels = computeReplacementLevels({ candidates, lineup: benchLineup, teamCount: 2 });

    expect(levels.QB).toBe(0); // only leftover QB (60) was absorbed as bench
    expect(levels.DEF).toBe(10); // no DEF was pulled into the bench pool
    expect(levels.RB).toBe(25);
    expect(levels.WR).toBe(25);
    expect(levels.TE).toBe(25);
  });

  it('does not let a deep one-slot position swallow the bench', () => {
    // A realistic single-quarterback league: 12 teams, 6 bench, and far more quarterbacks
    // than anyone would roster. Ranking the bench by raw points would fill it with
    // quarterbacks, because a QB20 still outscores a useful third running back.
    const realisticLineup: LineupSettings = {
      qb: 1,
      rb: 2,
      wr: 2,
      te: 1,
      flex: 2,
      def: 1,
      bench: 6,
      ir: 2,
    };
    const candidates: ReplacementCandidate[] = [
      ...Array.from({ length: 60 }, (_, i) => ({
        position: 'QB' as const,
        projectedPoints: 380 - i * 3,
      })),
      ...Array.from({ length: 140 }, (_, i) => ({
        position: 'RB' as const,
        projectedPoints: 320 - i * 2,
      })),
      ...Array.from({ length: 200 }, (_, i) => ({
        position: 'WR' as const,
        projectedPoints: 300 - i,
      })),
      ...Array.from({ length: 130 }, (_, i) => ({
        position: 'TE' as const,
        projectedPoints: 215 - i,
      })),
    ];

    const levels = computeReplacementLevels({
      candidates,
      lineup: realisticLineup,
      teamCount: 12,
    });

    // Replacement should land near the starter cutoff, not deep in the position.
    // QB13 is 344; a points-ranked bench dragged this down past QB50.
    expect(levels.QB!).toBeGreaterThan(300);
    // The top quarterback must not out-rank the top back once both are measured
    // against their own replacement.
    expect(380 - levels.QB!).toBeLessThan(320 - levels.RB!);
  });

  it('leaves a shallow position with a replacement level above zero', () => {
    // Only 32 defences exist league-wide. Without a per-position bench cap the bench
    // absorbs every one, replacement falls to zero, and every defence looks like an
    // early-round pick.
    const levels = computeReplacementLevels({
      candidates: [
        ...Array.from({ length: 32 }, (_, i) => ({
          position: 'DEF' as const,
          projectedPoints: 100 - i,
        })),
        ...Array.from({ length: 200 }, (_, i) => ({
          position: 'WR' as const,
          projectedPoints: 300 - i,
        })),
      ],
      lineup: { qb: 1, rb: 2, wr: 2, te: 1, flex: 2, def: 1, bench: 6, ir: 2 },
      teamCount: 12,
    });

    expect(levels.DEF!).toBeGreaterThan(0);
    // Best defence projects 100, so its value over replacement stays modest.
    expect(100 - levels.DEF!).toBeLessThan(30);
  });

  it('is unchanged by which players are already rostered', () => {
    // The league's talent pool and its roster demand are both fixed, so it cannot matter
    // whether a given player is available or already held: he occupies the same slot
    // either way. This is the property that makes keepers and completed draft picks safe
    // to account for.
    const baseline = computeReplacementLevels({ candidates, lineup, teamCount: 2 });

    const withHoldings = computeReplacementLevels({
      candidates: candidates.filter(
        (candidate) => candidate.projectedPoints !== 100 && candidate.projectedPoints !== 90,
      ),
      rosteredCandidates: [
        { position: 'QB', projectedPoints: 100 },
        { position: 'RB', projectedPoints: 90 },
      ],
      lineup,
      teamCount: 2,
    });

    expect(withHoldings).toEqual(baseline);
  });

  it('sinks when rostered players are dropped from the pool instead of declared', () => {
    // The failure this guards against. Omitting held players shrinks the supply while the
    // league still demands two full rosters, so the cascade digs a round deeper than it
    // should and replacement falls -- here all the way to zero, which would make every
    // remaining quarterback look like a franchise cornerstone.
    const held: ReplacementCandidate[] = [
      { position: 'QB', projectedPoints: 100 },
      { position: 'QB', projectedPoints: 80 },
    ];
    const stillAvailable = candidates.filter(
      (candidate) => !held.some((entry) => entry.projectedPoints === candidate.projectedPoints),
    );

    const dropped = computeReplacementLevels({
      candidates: stillAvailable,
      lineup,
      teamCount: 2,
    });
    const declared = computeReplacementLevels({
      candidates: stillAvailable,
      rosteredCandidates: held,
      lineup,
      teamCount: 2,
    });

    expect(dropped.QB).toBe(0);
    expect(declared.QB).toBe(60);
  });

  it('never reports a rostered player as the replacement level', () => {
    // A team can hold someone worth less than the roster cutoff, so a rostered player can
    // survive the cascade. He is still unavailable, and pricing draftable players against
    // him would understate every one of them.
    const levels = computeReplacementLevels({
      candidates: candidates.filter((candidate) => candidate.position === 'DEF'),
      rosteredCandidates: [{ position: 'DEF', projectedPoints: 15 }],
      lineup: { ...lineup, qb: 0, rb: 0, wr: 0, te: 0, flex: 0 },
      teamCount: 2,
    });

    // Starters take 40 and 20. What is left is the rostered 15 and the available 10.
    expect(levels.DEF).toBe(10);
  });

  it('produces a strictly lower (or equal) replacement level as bench spots increase', () => {
    const shallow = computeReplacementLevels({ candidates, lineup, teamCount: 2 });
    const deep = computeReplacementLevels({
      candidates,
      lineup: { ...lineup, bench: 3 },
      teamCount: 2,
    });

    expect(deep.QB!).toBeLessThanOrEqual(shallow.QB!);
    expect(deep.RB!).toBeLessThanOrEqual(shallow.RB!);
  });
});
