import { describe, expect, it, vi } from 'vitest';
import {
  createSleeperSelectionFetcher,
  toDraftSelectionInput,
  type SleeperDraftPickLike,
} from './selection-source.js';

describe('toDraftSelectionInput', () => {
  it("renames Sleeper's pick fields onto the tracker's shape", () => {
    expect(toDraftSelectionInput(sleeperPick())).toEqual({
      overallPick: 41,
      round: 4,
      slot: 8,
      rosterId: 3,
      playerId: 'sleeper-player-1',
      isKeeper: true,
    });
  });

  it('carries through the nulls Sleeper reports for an unmade pick', () => {
    expect(
      toDraftSelectionInput(
        sleeperPick({ draftSlot: null, rosterId: null, sleeperPlayerId: null }),
      ),
    ).toMatchObject({ slot: null, rosterId: null, playerId: null });
  });
});

describe('createSleeperSelectionFetcher', () => {
  it('fetches a draft and maps every pick', async () => {
    const source = {
      getDraftPicks: vi.fn(async () => ({ data: [sleeperPick(), sleeperPick({ pickNo: 42 })] })),
    };
    const fetchSelections = createSleeperSelectionFetcher(source, 'draft-1');

    const selections = await fetchSelections(new AbortController().signal);

    expect(source.getDraftPicks).toHaveBeenCalledWith('draft-1');
    expect(selections.map((selection) => selection.overallPick)).toEqual([41, 42]);
  });

  it('refuses to start once the signal is already aborted', async () => {
    const source = { getDraftPicks: vi.fn(async () => ({ data: [] })) };
    const controller = new AbortController();
    controller.abort();

    await expect(
      createSleeperSelectionFetcher(source, 'draft-1')(controller.signal),
    ).rejects.toThrow(/aborted before starting/);
    expect(source.getDraftPicks).not.toHaveBeenCalled();
  });

  it('discards a payload that arrives after the signal aborts', async () => {
    const controller = new AbortController();
    const source = {
      getDraftPicks: async () => {
        controller.abort();
        return { data: [sleeperPick()] };
      },
    };

    await expect(
      createSleeperSelectionFetcher(source, 'draft-1')(controller.signal),
    ).rejects.toThrow(/aborted/);
  });

  it('accepts a response shaped like the real adapter without importing it', async () => {
    // Mirrors SleeperAdapterResponse: extra fields must not stop the fetcher from reading it.
    const adapterLike = {
      getDraftPicks: async () => ({
        data: [sleeperPick()],
        snapshot: {
          mapperVersion: '1',
          endpoint: 'draft_picks',
          url: 'x',
          fetchedAt: 'y',
          raw: {},
        },
        diagnostics: [],
        cache: 'miss' as const,
      }),
    };

    const selections = await createSleeperSelectionFetcher(
      adapterLike,
      'draft-1',
    )(new AbortController().signal);

    expect(selections).toHaveLength(1);
  });
});

function sleeperPick(overrides: Partial<SleeperDraftPickLike> = {}): SleeperDraftPickLike {
  return {
    pickNo: 41,
    round: 4,
    draftSlot: 8,
    rosterId: 3,
    sleeperPlayerId: 'sleeper-player-1',
    isKeeper: true,
    ...overrides,
  };
}
