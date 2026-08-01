import { describe, expect, it } from 'vitest';
import type { LeagueId, SeasonId } from '@keeper/domain';
import {
  createSleeperAdapter,
  createSleeperFixtureFetch,
  SLEEPER_MAPPER_VERSION,
  type SleeperEndpoint,
  type SleeperRawSnapshot,
} from './index.js';
import { importSeasonDraftState } from './import-season.js';

const leagueId = 'league-keeper' as LeagueId;
const seasonId = 'season-2026' as SeasonId;
const sleeperLeagueId = 'league-1';
const sleeperDraftId = 'draft-1';

describe('importSeasonDraftState', () => {
  it('imports a season end to end, from raw payloads to owned pick assets', async () => {
    const result = await importSeasonDraftState(createInput());

    // Two teams, two rounds, snaking back: 1.01, 1.02, then 2.02, 2.01.
    expect(result.pickInventory.map((pick) => pick.overallPick)).toEqual([1, 2, 3, 4]);
    expect(result.orderConfig).toEqual({
      teamCount: 2,
      rounds: 2,
      orderMethod: 'snake',
      thirdRoundReversal: false,
    });

    expect(result.franchises.map((franchise) => franchise.displayName).sort()).toEqual([
      'Alex',
      'Blair',
    ]);
    // Franchise identity is keyed on the owning user, not the roster id.
    expect(result.franchiseMap.rosterIdToFranchiseId[1]).toBe('franchise:user-a');
    expect(result.franchiseMap.rosterIdToFranchiseId[2]).toBe('franchise:user-b');
  });

  it("carries a traded pick through to the acquiring franchise's inventory", async () => {
    const result = await importSeasonDraftState(createInput());

    // Roster 1 traded its round-2 pick to roster 2; that pick is 2.01, overall 4.
    const tradedPick = result.pickInventory.find((pick) => pick.overallPick === 4);
    expect(tradedPick).toMatchObject({
      round: 2,
      slot: 1,
      originalFranchiseId: 'franchise:user-a',
      currentFranchiseId: 'franchise:user-b',
      ownershipConfidence: 'confirmed',
    });

    const ownedByBlair = result.pickInventory.filter(
      (pick) => pick.currentFranchiseId === 'franchise:user-b',
    );
    expect(ownedByBlair.map((pick) => pick.overallPick)).toEqual([2, 3, 4]);
  });

  it('flattens diagnostics from every stage into one labelled list', async () => {
    const result = await importSeasonDraftState(
      createInput({
        // An unknown field on the league payload, and a roster with no owner.
        leagueRaw: { ...leagueRaw(), brand_new_field: 'ignored' },
        rostersRaw: [
          { roster_id: 1, league_id: sleeperLeagueId, owner_id: 'user-a' },
          { roster_id: 2, league_id: sleeperLeagueId, owner_id: null },
        ],
      }),
    );

    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({ stage: 'adapter', code: 'league_unknown_field' }),
    );
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({ stage: 'franchise_mapping', code: 'roster_without_owner' }),
    );
    expect(result.franchiseMap.rosterIdToFranchiseId[2]).toBe('franchise:roster-2');
  });

  it('reports a missing draft instead of throwing, and returns the franchises it did resolve', async () => {
    const result = await importSeasonDraftState(createInput({ draftsRaw: [] }));

    expect(result.pickInventory).toEqual([]);
    expect(result.ownership).toBeNull();
    expect(result.orderConfig).toBeNull();
    expect(result.franchises).toHaveLength(2);
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({ stage: 'import', code: 'draft_not_found', level: 'error' }),
    );
  });

  it('reports an indeterminate draft shape rather than guessing a round count', async () => {
    const result = await importSeasonDraftState(
      createInput({ draftsRaw: [{ ...draftRaw(), settings: { teams: 2 } }] }),
    );

    expect(result.pickInventory).toEqual([]);
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({ stage: 'import', code: 'indeterminate_draft_shape' }),
    );
  });

  it('lets a caller pin the draft shape Sleeper does not report', async () => {
    const result = await importSeasonDraftState(
      createInput({ orderConfig: { rounds: 1, thirdRoundReversal: true } }),
    );

    expect(result.orderConfig).toMatchObject({ rounds: 1, thirdRoundReversal: true });
    expect(result.pickInventory.map((pick) => pick.overallPick)).toEqual([1, 2]);
  });

  it('captures a raw snapshot for every endpoint it read', async () => {
    const result = await importSeasonDraftState(createInput());

    expect(result.snapshots.map((snapshot) => snapshot.endpoint)).toEqual([
      'league',
      'league_rosters',
      'league_users',
      'league_drafts',
      'draft_picks',
      'league_traded_picks',
    ]);
    expect(
      result.snapshots.every((snapshot) => snapshot.mapperVersion === SLEEPER_MAPPER_VERSION),
    ).toBe(true);
  });
});

interface FixtureOverrides {
  leagueRaw?: unknown;
  rostersRaw?: unknown;
  draftsRaw?: unknown;
  orderConfig?: Parameters<typeof importSeasonDraftState>[0]['orderConfig'];
}

function createInput(overrides: FixtureOverrides = {}) {
  const fixtures: SleeperRawSnapshot[] = [
    snapshot('league', `/league/${sleeperLeagueId}`, overrides.leagueRaw ?? leagueRaw()),
    snapshot(
      'league_rosters',
      `/league/${sleeperLeagueId}/rosters`,
      overrides.rostersRaw ?? [
        { roster_id: 1, league_id: sleeperLeagueId, owner_id: 'user-a' },
        { roster_id: 2, league_id: sleeperLeagueId, owner_id: 'user-b' },
      ],
    ),
    snapshot('league_users', `/league/${sleeperLeagueId}/users`, [
      { user_id: 'user-a', display_name: 'Alex' },
      { user_id: 'user-b', display_name: 'Blair' },
    ]),
    snapshot(
      'league_drafts',
      `/league/${sleeperLeagueId}/drafts`,
      overrides.draftsRaw ?? [draftRaw()],
    ),
    snapshot('draft_picks', `/draft/${sleeperDraftId}/picks`, [
      {
        draft_id: sleeperDraftId,
        pick_no: 1,
        round: 1,
        draft_slot: 1,
        roster_id: 1,
        player_id: 'player-1',
      },
    ]),
    snapshot('league_traded_picks', `/league/${sleeperLeagueId}/traded_picks`, [
      { season: '2026', round: 2, roster_id: 1, previous_owner_id: 1, owner_id: 2 },
    ]),
  ];

  return {
    adapter: createSleeperAdapter({
      cacheTtlMs: 0,
      fetch: createSleeperFixtureFetch(fixtures),
      now: () => Date.parse('2026-08-01T00:00:00.000Z'),
      // The rate limiter is exercised by its own tests; real timers here would add a
      // per-request wait to every import assertion.
      sleep: () => Promise.resolve(),
    }),
    leagueId,
    seasonId,
    sleeperLeagueId,
    orderConfig: overrides.orderConfig,
  };
}

function snapshot(endpoint: SleeperEndpoint, path: string, raw: unknown): SleeperRawSnapshot {
  return {
    mapperVersion: SLEEPER_MAPPER_VERSION,
    endpoint,
    url: `https://api.sleeper.app/v1${path}`,
    fetchedAt: '2026-08-01T00:00:00.000Z',
    raw,
  };
}

function leagueRaw() {
  return {
    total_rosters: 2,
    status: 'pre_draft',
    settings: {},
    scoring_settings: {},
    roster_positions: ['QB', 'RB', 'WR'],
    name: 'Keeper League',
    league_id: sleeperLeagueId,
    draft_id: sleeperDraftId,
    season: '2026',
  };
}

function draftRaw() {
  return {
    draft_id: sleeperDraftId,
    league_id: sleeperLeagueId,
    type: 'snake',
    status: 'pre_draft',
    season: '2026',
    start_time: 1780000000000,
    settings: { teams: 2, rounds: 2 },
    draft_order: { 'user-a': 1, 'user-b': 2 },
    slot_to_roster_id: { '1': 1, '2': 2 },
  };
}
