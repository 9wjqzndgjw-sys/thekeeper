import { describe, expect, it } from 'vitest';
import type { FranchiseId, LeagueId } from '@keeper/domain';
import { buildFranchiseMap } from './franchise-mapping.js';
import type { NormalizedSleeperRoster, NormalizedSleeperUser } from './index.js';

const leagueId = 'league-keeper' as LeagueId;

describe('buildFranchiseMap', () => {
  it('keys franchise identity on the owning user so it survives a roster-id change', () => {
    const season2025 = buildFranchiseMap({
      leagueId,
      rosters: [createRoster({ rosterId: 1, ownerSleeperUserId: 'user-a' })],
      users: [createUser({ sleeperUserId: 'user-a', displayName: 'Alex' })],
    });
    // Same manager, different roster id the following season.
    const season2026 = buildFranchiseMap({
      leagueId,
      rosters: [createRoster({ rosterId: 7, ownerSleeperUserId: 'user-a' })],
      users: [createUser({ sleeperUserId: 'user-a', displayName: 'Alex' })],
    });

    expect(season2025.rosterIdToFranchiseId[1]).toBe(season2026.rosterIdToFranchiseId[7]);
    expect(season2025.mapped[0]).toMatchObject({ source: 'owner', displayName: 'Alex' });
    expect(season2025.diagnostics).toEqual([]);
  });

  it('exposes both roster and user lookups for pick reconstruction', () => {
    const result = buildFranchiseMap({
      leagueId,
      rosters: [
        createRoster({ rosterId: 1, ownerSleeperUserId: 'user-a' }),
        createRoster({ rosterId: 2, ownerSleeperUserId: 'user-b' }),
      ],
      users: [createUser({ sleeperUserId: 'user-a' }), createUser({ sleeperUserId: 'user-b' })],
    });

    expect(result.rosterIdToFranchiseId[2]).toBe(result.sleeperUserIdToFranchiseId['user-b']);
    expect(result.franchises).toHaveLength(2);
  });

  it('falls back to a season-local identity for an unowned roster and says so', () => {
    const result = buildFranchiseMap({
      leagueId,
      rosters: [createRoster({ rosterId: 3, ownerSleeperUserId: null })],
    });

    expect(result.mapped[0]).toMatchObject({ source: 'roster_fallback' });
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({ code: 'roster_without_owner', rosterId: 3 }),
    );
  });

  it('does not collapse two rosters owned by the same user into one franchise', () => {
    const result = buildFranchiseMap({
      leagueId,
      rosters: [
        createRoster({ rosterId: 1, ownerSleeperUserId: 'user-a' }),
        createRoster({ rosterId: 2, ownerSleeperUserId: 'user-a' }),
      ],
      users: [createUser({ sleeperUserId: 'user-a' })],
    });

    expect(result.rosterIdToFranchiseId[1]).not.toBe(result.rosterIdToFranchiseId[2]);
    expect(result.franchises).toHaveLength(2);
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({ code: 'duplicate_owner_rosters' }),
    );
  });

  it('lets an audited override keep franchise identity when a team changes hands', () => {
    const priorFranchiseId = 'franchise:user-a' as FranchiseId;
    const result = buildFranchiseMap({
      leagueId,
      rosters: [createRoster({ rosterId: 1, ownerSleeperUserId: 'user-new' })],
      users: [createUser({ sleeperUserId: 'user-new' })],
      overrides: [
        {
          rosterId: 1,
          franchiseId: priorFranchiseId,
          reason: 'Team changed managers but keeps its history.',
          overriddenBy: 'commissioner',
          overriddenAt: '2026-08-01T00:00:00.000Z',
        },
      ],
    });

    expect(result.rosterIdToFranchiseId[1]).toBe(priorFranchiseId);
    expect(result.sleeperUserIdToFranchiseId['user-new']).toBe(priorFranchiseId);
    expect(result.mapped[0]?.source).toBe('manual_override');
    expect(result.appliedOverrides[0]).toMatchObject({
      priorFranchiseId: 'franchise:user-new',
      franchiseId: priorFranchiseId,
      overriddenBy: 'commissioner',
    });
  });

  it('rejects an unaudited override and reports one that targets a missing roster', () => {
    const result = buildFranchiseMap({
      leagueId,
      rosters: [createRoster({ rosterId: 1, ownerSleeperUserId: 'user-a' })],
      overrides: [
        {
          rosterId: 1,
          franchiseId: 'franchise:x' as FranchiseId,
          reason: '   ',
          overriddenBy: 'commissioner',
          overriddenAt: '2026-08-01T00:00:00.000Z',
        },
        {
          rosterId: 99,
          franchiseId: 'franchise:y' as FranchiseId,
          reason: 'Targets a roster that does not exist.',
          overriddenBy: 'commissioner',
          overriddenAt: '2026-08-01T00:00:00.000Z',
        },
      ],
    });

    expect(result.rosterIdToFranchiseId[1]).toBe('franchise:user-a');
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({ code: 'invalid_override', rosterId: 1 }),
    );
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({ code: 'unknown_override_roster', rosterId: 99 }),
    );
  });

  it('warns when a roster owner is absent from the league user list', () => {
    const result = buildFranchiseMap({
      leagueId,
      rosters: [createRoster({ rosterId: 1, ownerSleeperUserId: 'user-ghost' })],
      users: [createUser({ sleeperUserId: 'user-a' })],
    });

    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({ code: 'owner_not_in_league_users', sleeperUserId: 'user-ghost' }),
    );
  });
});

function createRoster(overrides: Partial<NormalizedSleeperRoster>): NormalizedSleeperRoster {
  return {
    sleeperLeagueId: 'league-1',
    rosterId: 1,
    ownerSleeperUserId: 'user-a',
    playerSleeperIds: [],
    starterSleeperIds: [],
    reserveSleeperIds: [],
    keeperSleeperPlayerIds: [],
    wins: 0,
    losses: 0,
    ties: 0,
    settings: {},
    ...overrides,
  };
}

function createUser(overrides: Partial<NormalizedSleeperUser>): NormalizedSleeperUser {
  return {
    sleeperUserId: 'user-a',
    username: null,
    displayName: null,
    avatar: null,
    metadata: {},
    isCommissioner: null,
    ...overrides,
  };
}
