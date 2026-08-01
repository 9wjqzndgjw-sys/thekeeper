import type { Franchise, FranchiseId, LeagueId } from '@keeper/domain';
import type { NormalizedSleeperRoster, NormalizedSleeperUser } from './index.js';

export type FranchiseMappingDiagnosticCode =
  | 'roster_without_owner'
  | 'duplicate_owner_rosters'
  | 'owner_not_in_league_users'
  | 'unknown_override_roster'
  | 'invalid_override'
  | 'duplicate_override';

export interface FranchiseMappingDiagnostic {
  level: 'warning' | 'error';
  code: FranchiseMappingDiagnosticCode;
  message: string;
  rosterId?: number;
  sleeperUserId?: string;
}

export interface FranchiseIdentityOverride {
  rosterId: number;
  franchiseId: FranchiseId;
  reason: string;
  overriddenBy: string;
  overriddenAt: string;
}

export interface AppliedFranchiseIdentityOverride extends FranchiseIdentityOverride {
  priorFranchiseId: FranchiseId | null;
}

export type FranchiseIdentitySource = 'owner' | 'roster_fallback' | 'manual_override';

export interface MappedFranchise {
  franchiseId: FranchiseId;
  rosterId: number;
  ownerSleeperUserId: string | null;
  displayName: string;
  /** `roster_fallback` identities are season-local and will not survive a roster-id change. */
  source: FranchiseIdentitySource;
}

export interface BuildFranchiseMapInput {
  leagueId: LeagueId;
  rosters: readonly NormalizedSleeperRoster[];
  users?: readonly NormalizedSleeperUser[];
  overrides?: readonly FranchiseIdentityOverride[];
}

export interface FranchiseMap {
  franchises: Franchise[];
  mapped: MappedFranchise[];
  rosterIdToFranchiseId: Record<number, FranchiseId>;
  sleeperUserIdToFranchiseId: Record<string, FranchiseId>;
  appliedOverrides: AppliedFranchiseIdentityOverride[];
  diagnostics: FranchiseMappingDiagnostic[];
}

/**
 * Derives a stable franchise identity for each Sleeper roster in a season.
 *
 * Identity is keyed on the owning Sleeper user rather than the roster id, because
 * roster ids are only stable within one season while the same manager keeps a user id
 * across seasons. The domain requires franchise identity to survive a change of user
 * too, which no heuristic can infer, so a roster that changes hands but should keep its
 * history is handled by a manual override. Rosters with no owner fall back to a
 * season-local identity and are reported, since that identity will not survive.
 */
export function buildFranchiseMap(input: BuildFranchiseMapInput): FranchiseMap {
  const diagnostics: FranchiseMappingDiagnostic[] = [];
  const overridesByRosterId = collectOverrides(input.overrides ?? [], diagnostics);
  const knownUserIds = new Set((input.users ?? []).map((user) => user.sleeperUserId));
  const displayNameByUserId = new Map(
    (input.users ?? []).map((user) => [
      user.sleeperUserId,
      user.displayName ?? user.username ?? user.sleeperUserId,
    ]),
  );

  const rostersByOwner = new Map<string, number[]>();
  for (const roster of input.rosters) {
    if (roster.ownerSleeperUserId === null) {
      continue;
    }
    const owned = rostersByOwner.get(roster.ownerSleeperUserId) ?? [];
    owned.push(roster.rosterId);
    rostersByOwner.set(roster.ownerSleeperUserId, owned);
  }

  const mapped: MappedFranchise[] = [];
  const appliedOverrides: AppliedFranchiseIdentityOverride[] = [];

  for (const roster of [...input.rosters].sort((a, b) => a.rosterId - b.rosterId)) {
    const inferred = inferFranchiseIdentity(roster, rostersByOwner, diagnostics);
    const override = overridesByRosterId.get(roster.rosterId);

    if (
      roster.ownerSleeperUserId !== null &&
      input.users !== undefined &&
      !knownUserIds.has(roster.ownerSleeperUserId)
    ) {
      diagnostics.push({
        level: 'warning',
        code: 'owner_not_in_league_users',
        rosterId: roster.rosterId,
        sleeperUserId: roster.ownerSleeperUserId,
        message: `Roster ${roster.rosterId} is owned by user ${roster.ownerSleeperUserId}, who is not in the league user list.`,
      });
    }

    if (override) {
      appliedOverrides.push({ ...override, priorFranchiseId: inferred.franchiseId });
    }

    mapped.push({
      franchiseId: override?.franchiseId ?? inferred.franchiseId,
      rosterId: roster.rosterId,
      ownerSleeperUserId: roster.ownerSleeperUserId,
      displayName:
        (roster.ownerSleeperUserId === null
          ? null
          : (displayNameByUserId.get(roster.ownerSleeperUserId) ?? null)) ??
        `Roster ${roster.rosterId}`,
      source: override ? 'manual_override' : inferred.source,
    });
  }

  for (const override of overridesByRosterId.values()) {
    if (!input.rosters.some((roster) => roster.rosterId === override.rosterId)) {
      diagnostics.push({
        level: 'error',
        code: 'unknown_override_roster',
        rosterId: override.rosterId,
        message: `Franchise override targets roster ${override.rosterId}, which is not in this season's rosters.`,
      });
    }
  }

  return {
    franchises: buildFranchises(input.leagueId, mapped),
    mapped,
    rosterIdToFranchiseId: Object.fromEntries(
      mapped.map((entry) => [entry.rosterId, entry.franchiseId]),
    ),
    sleeperUserIdToFranchiseId: Object.fromEntries(
      mapped
        .filter((entry) => entry.ownerSleeperUserId !== null)
        .map((entry) => [entry.ownerSleeperUserId!, entry.franchiseId]),
    ),
    appliedOverrides,
    diagnostics,
  };
}

function inferFranchiseIdentity(
  roster: NormalizedSleeperRoster,
  rostersByOwner: ReadonlyMap<string, readonly number[]>,
  diagnostics: FranchiseMappingDiagnostic[],
): { franchiseId: FranchiseId; source: FranchiseIdentitySource } {
  if (roster.ownerSleeperUserId === null) {
    diagnostics.push({
      level: 'warning',
      code: 'roster_without_owner',
      rosterId: roster.rosterId,
      message: `Roster ${roster.rosterId} has no owner, so its franchise identity is season-local and will not survive a roster-id change.`,
    });
    return {
      franchiseId: `franchise:roster-${roster.rosterId}` as FranchiseId,
      source: 'roster_fallback',
    };
  }

  const owned = rostersByOwner.get(roster.ownerSleeperUserId) ?? [];
  if (owned.length > 1) {
    diagnostics.push({
      level: 'warning',
      code: 'duplicate_owner_rosters',
      rosterId: roster.rosterId,
      sleeperUserId: roster.ownerSleeperUserId,
      message: `User ${roster.ownerSleeperUserId} owns rosters ${[...owned].sort((a, b) => a - b).join(', ')}; each roster falls back to a season-local identity. Use an override to assign stable identities.`,
    });
    return {
      franchiseId: `franchise:roster-${roster.rosterId}` as FranchiseId,
      source: 'roster_fallback',
    };
  }

  return {
    franchiseId: `franchise:${roster.ownerSleeperUserId}` as FranchiseId,
    source: 'owner',
  };
}

function collectOverrides(
  overrides: readonly FranchiseIdentityOverride[],
  diagnostics: FranchiseMappingDiagnostic[],
): Map<number, FranchiseIdentityOverride> {
  const byRosterId = new Map<number, FranchiseIdentityOverride>();

  for (const override of overrides) {
    if (!Number.isInteger(override.rosterId) || !isAuditedOverride(override)) {
      diagnostics.push({
        level: 'error',
        code: 'invalid_override',
        rosterId: override.rosterId,
        message: `Franchise override for roster ${override.rosterId} is missing a reason, author, or valid timestamp and was ignored.`,
      });
      continue;
    }
    if (byRosterId.has(override.rosterId)) {
      diagnostics.push({
        level: 'warning',
        code: 'duplicate_override',
        rosterId: override.rosterId,
        message: `Multiple franchise overrides target roster ${override.rosterId}; the last override wins.`,
      });
    }
    byRosterId.set(override.rosterId, override);
  }

  return byRosterId;
}

function buildFranchises(leagueId: LeagueId, mapped: readonly MappedFranchise[]): Franchise[] {
  const byFranchiseId = new Map<FranchiseId, Franchise>();

  for (const entry of mapped) {
    if (!byFranchiseId.has(entry.franchiseId)) {
      byFranchiseId.set(entry.franchiseId, {
        id: entry.franchiseId,
        leagueId,
        displayName: entry.displayName,
      });
    }
  }

  return [...byFranchiseId.values()];
}

function isAuditedOverride(override: FranchiseIdentityOverride): boolean {
  return (
    override.reason.trim().length > 0 &&
    override.overriddenBy.trim().length > 0 &&
    override.overriddenAt.trim().length > 0 &&
    !Number.isNaN(Date.parse(override.overriddenAt))
  );
}
