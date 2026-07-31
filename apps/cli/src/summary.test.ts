import { createSyntheticLeagueSnapshot } from '@keeper/test-fixtures';
import { describe, expect, it } from 'vitest';
import { buildLeagueSummary } from './summary.js';

describe('buildLeagueSummary', () => {
  it('summarizes the synthetic league and the user franchise keepers', () => {
    const lines = buildLeagueSummary(createSyntheticLeagueSnapshot());
    expect(lines[0]).toContain('Synthetic Keeper League');
    expect(lines.some((line) => line.includes('player-a'))).toBe(true);
  });
});
