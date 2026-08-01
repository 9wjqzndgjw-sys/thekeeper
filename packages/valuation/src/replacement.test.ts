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

  it('deepens the pool with bench spots, pulled cross-position by points', () => {
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
