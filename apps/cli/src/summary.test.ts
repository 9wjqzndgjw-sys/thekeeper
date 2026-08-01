import { createSyntheticLeagueSnapshot, players } from '@keeper/test-fixtures';
import { describe, expect, it } from 'vitest';
import { buildLeagueSummary } from './summary.js';

describe('buildLeagueSummary', () => {
  it('summarizes the synthetic league and the user franchise keepers', () => {
    const lines = buildLeagueSummary(createSyntheticLeagueSnapshot());
    expect(lines[0]).toContain('Synthetic Keeper League');
    expect(lines.some((line) => line.includes('player-a'))).toBe(true);
  });

  it('prints markdown keeper optimization tables when players are provided', () => {
    const lines = buildLeagueSummary(createSyntheticLeagueSnapshot(), { players });

    expect(lines).toContain('## Best Keeper Views');
    expect(lines).toContain('| Mode | Score | Keepers |');
    expect(lines.some((line) => line.includes('Player A'))).toBe(true);
    expect(lines.some((line) => line.includes('round 4 -> 4.01, overall 48'))).toBe(true);
    expect(lines).not.toContain(
      'IV/KSV/TCV scoring and keeper boards arrive in later implementation phases.',
    );
  });
});
