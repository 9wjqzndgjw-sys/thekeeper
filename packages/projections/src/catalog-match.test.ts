import { describe, expect, it } from 'vitest';
import {
  matchProjectionsToCatalog,
  normalizeProjectionName,
  type CatalogPlayerLike,
  type ProjectedPlayerLike,
} from './catalog-match.js';

const catalog: CatalogPlayerLike[] = [
  { fullName: 'Kenneth Walker', position: 'RB', sleeperPlayerId: 'sleeper-walker' },
  { fullName: "Ja'Marr Chase", position: 'WR', sleeperPlayerId: 'sleeper-chase' },
  { fullName: 'Michael Pittman Jr.', position: 'WR', sleeperPlayerId: 'sleeper-pittman' },
  { fullName: 'No Sleeper Id', position: 'TE', sleeperPlayerId: null },
];

describe('normalizeProjectionName', () => {
  it('collapses case, punctuation and accents', () => {
    expect(normalizeProjectionName("Ja'Marr Chase")).toBe(normalizeProjectionName('JaMarr chase'));
    expect(normalizeProjectionName('Amon-Ra St. Brown')).toBe('amonrastbrown');
  });

  it('drops a generational suffix so the two spellings agree', () => {
    expect(normalizeProjectionName('Kenneth Walker III')).toBe(
      normalizeProjectionName('Kenneth Walker'),
    );
    expect(normalizeProjectionName('Michael Pittman Jr.')).toBe(
      normalizeProjectionName('Michael Pittman'),
    );
  });
});

describe('matchProjectionsToCatalog', () => {
  it('matches across a suffix mismatch between the two sources', () => {
    const result = matchProjectionsToCatalog({
      catalog,
      projections: [
        { fullName: 'Kenneth Walker III', position: 'RB', projectedPoints: 210 },
        { fullName: 'Michael Pittman', position: 'WR', projectedPoints: 150 },
      ],
    });

    expect(result.pointsBySleeperId.get('sleeper-walker')).toBe(210);
    expect(result.pointsBySleeperId.get('sleeper-pittman')).toBe(150);
    expect(result.unmatchedProjectionNames).toEqual([]);
  });

  it('takes position from the catalog, not the projection export', () => {
    const result = matchProjectionsToCatalog({
      catalog,
      projections: [{ fullName: "Ja'Marr Chase", position: 'WR', projectedPoints: 260 }],
    });

    expect(result.positionBySleeperId.get('sleeper-chase')).toBe('WR');
    expect(result.nameBySleeperId.get('sleeper-chase')).toBe("Ja'Marr Chase");
  });

  it('will not match a name at the wrong position', () => {
    // Same name, different position: a real hazard once defences and skill players share a
    // pool. Matching him anyway would price a receiver against running back replacement.
    const result = matchProjectionsToCatalog({
      catalog,
      projections: [{ fullName: 'Kenneth Walker', position: 'WR', projectedPoints: 210 }],
    });

    expect(result.pointsBySleeperId.size).toBe(0);
    expect(result.unmatchedProjectionNames).toEqual(['Kenneth Walker']);
  });

  it('reports projections the catalog does not know rather than dropping them silently', () => {
    const projections: ProjectedPlayerLike[] = [
      { fullName: 'Undrafted Rookie', position: 'RB', projectedPoints: 40 },
      { fullName: "Ja'Marr Chase", position: 'WR', projectedPoints: 260 },
    ];
    const result = matchProjectionsToCatalog({ catalog, projections });

    expect(result.unmatchedProjectionNames).toEqual(['Undrafted Rookie']);
    expect(result.pointsBySleeperId.size).toBe(1);
  });

  it('skips catalog entries that carry no Sleeper id', () => {
    const result = matchProjectionsToCatalog({
      catalog,
      projections: [{ fullName: 'No Sleeper Id', position: 'TE', projectedPoints: 90 }],
    });

    expect(result.pointsBySleeperId.size).toBe(0);
    expect(result.unmatchedProjectionNames).toEqual(['No Sleeper Id']);
  });
});
