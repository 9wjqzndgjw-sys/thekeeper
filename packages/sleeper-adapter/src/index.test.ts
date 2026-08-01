import { describe, expect, it } from 'vitest';
import {
  createSleeperAdapter,
  DEFAULT_SLEEPER_ADAPTER_CONFIG,
  SleeperHttpError,
  SleeperValidationError,
  type SleeperFetch,
  type SleeperRawSnapshot,
} from './index.js';

describe('sleeper-adapter config', () => {
  it('exposes a default config within Sleeper rate guidance', () => {
    expect(DEFAULT_SLEEPER_ADAPTER_CONFIG.requestsPerMinuteLimit).toBeLessThanOrEqual(1000);
  });

  it('rejects a rate limit above the documented guidance', () => {
    expect(() => createSleeperAdapter({ requestsPerMinuteLimit: 1001 })).toThrow(/1000/);
  });
});

describe('SleeperAdapter fetching and validation', () => {
  it('fetches, validates, normalizes, captures snapshots, and reports unknown fields', async () => {
    const snapshots: SleeperRawSnapshot[] = [];
    const adapter = createSleeperAdapter({
      fetch: createMockFetch([
        jsonResponse({
          total_rosters: 12,
          status: 'pre_draft',
          settings: { playoff_teams: 6 },
          scoring_settings: { pass_td: 6 },
          roster_positions: ['QB', 'RB', 'WR', 'TE', 'FLEX', 'DEF', 'BN'],
          previous_league_id: 'previous-league',
          name: 'Keeper Test League',
          league_id: 'league-1',
          draft_id: 'draft-1',
          avatar: null,
          season: '2026',
          brand_new_field: 'ignored',
        }),
      ]),
      now: () => Date.parse('2026-07-31T00:00:00.000Z'),
      snapshotSink: (snapshot) => {
        snapshots.push(snapshot);
      },
    });

    const result = await adapter.getLeague('league-1');

    expect(result.data).toEqual({
      sleeperLeagueId: 'league-1',
      name: 'Keeper Test League',
      season: '2026',
      previousSleeperLeagueId: 'previous-league',
      draftId: 'draft-1',
      status: 'pre_draft',
      totalRosters: 12,
      rosterPositions: ['QB', 'RB', 'WR', 'TE', 'FLEX', 'DEF', 'BN'],
      settings: { playoff_teams: 6 },
      scoringSettings: { pass_td: 6 },
      avatar: null,
    });
    expect(result.snapshot.fetchedAt).toBe('2026-07-31T00:00:00.000Z');
    expect(snapshots).toHaveLength(1);
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        level: 'warning',
        endpoint: 'league',
        path: 'brand_new_field',
      }),
    );
  });

  it('throws a validation error when a required field is missing', async () => {
    const adapter = createSleeperAdapter({
      fetch: createMockFetch([
        jsonResponse({
          status: 'pre_draft',
          settings: {},
          scoring_settings: {},
          roster_positions: [],
          name: 'Broken League',
          league_id: 'league-1',
          season: '2026',
        }),
      ]),
    });

    await expect(adapter.getLeague('league-1')).rejects.toBeInstanceOf(SleeperValidationError);
  });

  it('retries transient HTTP failures before returning normalized data', async () => {
    const sleeps: number[] = [];
    const adapter = createSleeperAdapter({
      fetch: createMockFetch([
        jsonResponse({ message: 'busy' }, { ok: false, status: 500, statusText: 'Server Error' }),
        jsonResponse({
          user_id: 'user-1',
          username: 'manager',
          display_name: 'Manager',
          avatar: null,
          metadata: { team_name: 'Sunday Value' },
          is_owner: true,
        }),
      ]),
      retryCount: 1,
      retryBaseDelayMs: 5,
      sleep: (ms) => {
        sleeps.push(ms);
        return Promise.resolve();
      },
    });

    const result = await adapter.getUser('manager');

    expect(result.data).toEqual({
      sleeperUserId: 'user-1',
      username: 'manager',
      displayName: 'Manager',
      avatar: null,
      metadata: { team_name: 'Sunday Value' },
      isCommissioner: true,
    });
    expect(sleeps).toContain(5);
  });

  it('surfaces non-retryable HTTP failures', async () => {
    const adapter = createSleeperAdapter({
      fetch: createMockFetch([jsonResponse({ message: 'missing' }, { ok: false, status: 404 })]),
      retryCount: 2,
    });

    await expect(adapter.getLeague('missing')).rejects.toBeInstanceOf(SleeperHttpError);
  });
});

describe('SleeperAdapter endpoint mappers', () => {
  it('normalizes rosters with nullable player arrays and record settings', async () => {
    const adapter = createSleeperAdapter({
      fetch: createMockFetch([
        jsonResponse([
          {
            roster_id: 1,
            league_id: 'league-1',
            owner_id: 'user-1',
            players: ['1042', 'CAR'],
            starters: null,
            reserve: ['1042'],
            settings: { wins: 7, losses: 6, ties: 1 },
          },
        ]),
      ]),
    });

    const result = await adapter.getLeagueRosters('league-1');

    expect(result.data).toEqual([
      {
        sleeperLeagueId: 'league-1',
        rosterId: 1,
        ownerSleeperUserId: 'user-1',
        playerSleeperIds: ['1042', 'CAR'],
        starterSleeperIds: [],
        reserveSleeperIds: ['1042'],
        wins: 7,
        losses: 6,
        ties: 1,
        settings: { wins: 7, losses: 6, ties: 1 },
      },
    ]);
  });

  it('normalizes draft metadata and draft picks', async () => {
    const adapter = createSleeperAdapter({
      fetch: createMockFetch([
        jsonResponse({
          draft_id: 'draft-1',
          league_id: 'league-1',
          type: 'snake',
          status: 'drafting',
          season: '2026',
          start_time: 1780000000000,
          settings: { teams: 12, rounds: 15 },
          draft_order: { 'user-1': 1 },
          slot_to_roster_id: { '1': 7 },
          metadata: { name: 'Main Draft' },
        }),
        jsonResponse([
          {
            draft_id: 'draft-1',
            pick_no: 41,
            round: 4,
            draft_slot: 8,
            roster_id: '1',
            player_id: 'player-1',
            picked_by: 'user-1',
            is_keeper: true,
            metadata: { first_name: 'Jayden', last_name: 'Daniels' },
          },
        ]),
      ]),
    });

    await expect(adapter.getDraft('draft-1')).resolves.toMatchObject({
      data: {
        sleeperDraftId: 'draft-1',
        sleeperLeagueId: 'league-1',
        type: 'snake',
        status: 'drafting',
        rounds: 15,
        teamCount: 12,
        slotToRosterId: { 1: 7 },
      },
    });
    await expect(adapter.getDraftPicks('draft-1')).resolves.toMatchObject({
      data: [
        {
          sleeperDraftId: 'draft-1',
          pickNo: 41,
          round: 4,
          draftSlot: 8,
          rosterId: 1,
          sleeperPlayerId: 'player-1',
          isKeeper: true,
        },
      ],
    });
  });

  it('normalizes empty traded-pick responses', async () => {
    const adapter = createSleeperAdapter({
      fetch: createMockFetch([jsonResponse([]), jsonResponse([])]),
    });

    await expect(adapter.getLeagueTradedPicks('league-1')).resolves.toMatchObject({ data: [] });
    await expect(adapter.getDraftTradedPicks('draft-1')).resolves.toMatchObject({ data: [] });
  });

  it('normalizes transaction draft-pick movement', async () => {
    const adapter = createSleeperAdapter({
      fetch: createMockFetch([
        jsonResponse([
          {
            transaction_id: 'txn-1',
            type: 'trade',
            status: 'complete',
            roster_ids: [1, 2],
            adds: null,
            drops: null,
            draft_picks: [
              {
                season: '2027',
                round: 5,
                roster_id: 1,
                previous_owner_id: 1,
                owner_id: 2,
              },
            ],
            created: 1700000000000,
            status_updated: 1700000001000,
          },
        ]),
      ]),
    });

    const result = await adapter.getLeagueTransactions('league-1', 1);

    expect(result.data[0]).toEqual({
      sleeperTransactionId: 'txn-1',
      type: 'trade',
      status: 'complete',
      rosterIds: [1, 2],
      adds: {},
      drops: {},
      draftPicks: [
        {
          season: '2027',
          round: 5,
          originalRosterId: 1,
          previousOwnerRosterId: 1,
          currentOwnerRosterId: 2,
        },
      ],
      createdAt: 1700000000000,
      statusUpdatedAt: 1700000001000,
    });
  });

  it('normalizes player catalog records into domain players and skips unsupported positions', async () => {
    const adapter = createSleeperAdapter({
      fetch: createMockFetch([
        jsonResponse({
          '3086': {
            player_id: '3086',
            first_name: 'Tom',
            last_name: 'Brady',
            full_name: null,
            position: 'QB',
          },
          '9999': {
            player_id: '9999',
            first_name: 'Kicker',
            last_name: 'Person',
            position: 'K',
          },
        }),
      ]),
    });

    const result = await adapter.getPlayers('nfl', { position: 'QB', active: true });

    expect(result.snapshot.url).toContain('/players/nfl?position=QB&active=true');
    expect(result.data.players).toEqual([
      {
        id: 'sleeper-player-3086',
        sleeperPlayerId: '3086',
        fullName: 'Tom Brady',
        position: 'QB',
      },
    ]);
    expect(result.data.skippedSleeperPlayerIds).toEqual(['9999']);
  });
});

describe('SleeperAdapter rate limiting', () => {
  it('waits between requests according to the configured rate limit', async () => {
    let now = 1_000;
    const sleeps: number[] = [];
    const adapter = createSleeperAdapter({
      requestsPerMinuteLimit: 60,
      fetch: createMockFetch([
        jsonResponse({ user_id: 'user-1' }),
        jsonResponse({ user_id: 'user-2' }),
      ]),
      now: () => now,
      sleep: (ms) => {
        sleeps.push(ms);
        now += ms;
        return Promise.resolve();
      },
    });

    await adapter.getUser('user-1');
    await adapter.getUser('user-2');

    expect(sleeps).toEqual([1000]);
  });
});

interface ResponseOptions {
  ok?: boolean;
  status?: number;
  statusText?: string;
}

function jsonResponse(body: unknown, options: ResponseOptions = {}) {
  return {
    ok: options.ok ?? true,
    status: options.status ?? 200,
    statusText: options.statusText ?? 'OK',
    json: async () => body,
  };
}

function createMockFetch(responses: ReturnType<typeof jsonResponse>[]): SleeperFetch {
  let index = 0;
  return async () => {
    const response = responses[index];
    index += 1;
    if (!response) {
      throw new Error('No mock response queued.');
    }
    return response;
  };
}
