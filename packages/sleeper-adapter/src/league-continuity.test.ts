import { describe, expect, it, vi } from 'vitest';
import { resolveSleeperLeagueContinuity, type SleeperLeagueLink } from './league-continuity.js';

describe('resolveSleeperLeagueContinuity', () => {
  it('uses the current id when this is the first season', async () => {
    const loadLeague = vi.fn<(id: string) => Promise<SleeperLeagueLink>>();

    await expect(
      resolveSleeperLeagueContinuity({
        current: { sleeperLeagueId: '2024', previousSleeperLeagueId: null },
        loadLeague,
      }),
    ).resolves.toEqual({ rootSleeperLeagueId: '2024', sleeperLeagueIds: ['2024'] });
    expect(loadLeague).not.toHaveBeenCalled();
  });

  it('uses the oldest id for every later season', async () => {
    const links: Record<string, SleeperLeagueLink> = {
      '2025': { sleeperLeagueId: '2025', previousSleeperLeagueId: '2024' },
      '2024': { sleeperLeagueId: '2024', previousSleeperLeagueId: null },
    };

    const result = await resolveSleeperLeagueContinuity({
      current: { sleeperLeagueId: '2026', previousSleeperLeagueId: '2025' },
      loadLeague: async (id) => links[id]!,
    });

    expect(result).toEqual({
      rootSleeperLeagueId: '2024',
      sleeperLeagueIds: ['2026', '2025', '2024'],
    });
  });

  it('rejects a cycle instead of assigning an unstable identity', async () => {
    await expect(
      resolveSleeperLeagueContinuity({
        current: { sleeperLeagueId: '2026', previousSleeperLeagueId: '2025' },
        loadLeague: async () => ({
          sleeperLeagueId: '2025',
          previousSleeperLeagueId: '2026',
        }),
      }),
    ).rejects.toThrow(/cycle/i);
  });

  it('rejects a response for the wrong league', async () => {
    await expect(
      resolveSleeperLeagueContinuity({
        current: { sleeperLeagueId: '2026', previousSleeperLeagueId: '2025' },
        loadLeague: async () => ({ sleeperLeagueId: 'other', previousSleeperLeagueId: null }),
      }),
    ).rejects.toThrow(/response identified itself/i);
  });
});
