import type { FranchiseId, KeeperRight, KeeperRightId, PlayerId, SeasonId } from '@keeper/domain';
import type { NormalizedSleeperDraftPick, NormalizedSleeperRoster } from './index.js';

export type KeeperReconstructionCode =
  | 'no_prior_draft_record'
  | 'cost_held_at_ceiling'
  | 'unmapped_roster'
  | 'declared_keeper_not_on_roster';

export interface KeeperReconstructionDiagnostic {
  level: 'warning' | 'error';
  code: KeeperReconstructionCode;
  sleeperPlayerId: string;
  message: string;
}

export interface ReconstructKeeperRightsInput {
  seasonId: SeasonId;
  rosters: readonly NormalizedSleeperRoster[];
  rosterIdToFranchiseId: Readonly<Record<number, FranchiseId>>;
  /** Selections from the previous season's completed draft. */
  priorSeasonSelections: readonly NormalizedSleeperDraftPick[];
  /** Rounds a keeper cost advances each season. */
  costAdvancePerSeason?: number;
  /** Round assigned to a player with no prior draft record, per the league's undrafted rule. */
  undraftedKeeperRound: number;
  /** Cheapest round a cost can reach. This league holds at the first round. */
  minimumKeeperRound?: number;
  playerNameBySleeperId?: Readonly<Record<string, string>>;
}

export interface ReconstructKeeperRightsResult {
  /**
   * Every player who *could* be kept, priced. One per rostered player, not one per
   * declaration.
   */
  keeperRights: KeeperRight[];
  /**
   * Sleeper player ids their manager has actually declared. A declaration is a different
   * thing from a right, and the schema keeps them in different tables for that reason:
   * rights say what is possible, decisions say what was chosen.
   */
  declaredSleeperPlayerIds: string[];
  /** Declared keepers whose cost could not be resolved, so nothing is silently priced wrong. */
  unresolved: {
    sleeperPlayerId: string;
    franchiseId: FranchiseId | null;
    priorRound: number | null;
    reason: KeeperReconstructionCode;
  }[];
  diagnostics: KeeperReconstructionDiagnostic[];
}

/**
 * Prices every player on every roster as a keeper the team could hold.
 *
 * Enumerating the whole roster rather than only `roster.keepers` is what makes the engine
 * able to answer "what should this team keep?" instead of merely "was this declaration any
 * good?". With three declared keepers there are eight possible sets; with sixteen rostered
 * players there are several hundred, and the best one is frequently not the declared one.
 *
 * Sleeper stores the declaration but not what it costs, so the cost is reconstructed from
 * the previous season's draft: the round a player went in then, advanced by the league's
 * escalation. A player with no prior draft record was picked up in-season and takes the
 * league's undrafted-keeper round.
 *
 * A cost that reaches the league's cheapest round holds there instead of advancing off the
 * board. Keeping two such players is still constrained, but by pick inventory rather than
 * by cost: each consumes a first-round pick and nothing is earlier to displace into, so the
 * second is only legal for a team holding a second first-rounder. That falls out of pick
 * resolution, so nothing special is needed here beyond noting the hold.
 */
export function reconstructKeeperRights(
  input: ReconstructKeeperRightsInput,
): ReconstructKeeperRightsResult {
  const advance = input.costAdvancePerSeason ?? 1;
  const minimumRound = input.minimumKeeperRound ?? 1;
  const keeperRights: KeeperRight[] = [];
  const declaredSleeperPlayerIds: string[] = [];
  const unresolved: ReconstructKeeperRightsResult['unresolved'] = [];
  const diagnostics: KeeperReconstructionDiagnostic[] = [];

  const priorRoundByPlayer = new Map<string, number>();
  for (const selection of input.priorSeasonSelections) {
    if (selection.sleeperPlayerId !== null) {
      priorRoundByPlayer.set(selection.sleeperPlayerId, selection.round);
    }
  }

  const describe = (sleeperPlayerId: string): string =>
    input.playerNameBySleeperId?.[sleeperPlayerId] ?? `player ${sleeperPlayerId}`;

  let undraftedCount = 0;

  for (const roster of input.rosters) {
    const franchiseId = input.rosterIdToFranchiseId[roster.rosterId] ?? null;
    const declaredOnThisRoster = new Set(roster.keeperSleeperPlayerIds);

    if (franchiseId === null) {
      // Without a franchise there is nowhere to attach a right, and a declaration on an
      // unmapped roster is a real problem rather than a quiet skip.
      for (const sleeperPlayerId of roster.keeperSleeperPlayerIds) {
        unresolved.push({
          sleeperPlayerId,
          franchiseId: null,
          priorRound: null,
          reason: 'unmapped_roster',
        });
        diagnostics.push({
          level: 'error',
          code: 'unmapped_roster',
          sleeperPlayerId,
          message: `Roster ${roster.rosterId} declared ${describe(sleeperPlayerId)} as a keeper but is not mapped to a franchise.`,
        });
      }
      continue;
    }

    for (const sleeperPlayerId of declaredOnThisRoster) {
      if (!roster.playerSleeperIds.includes(sleeperPlayerId)) {
        diagnostics.push({
          level: 'warning',
          code: 'declared_keeper_not_on_roster',
          sleeperPlayerId,
          message: `${describe(sleeperPlayerId)} is declared a keeper by roster ${roster.rosterId} but is not on that roster.`,
        });
      }
    }

    // A declared player who has somehow left the roster is still priced, so the declaration
    // is not silently dropped; the diagnostic above is what flags the inconsistency.
    const eligible = new Set([...roster.playerSleeperIds, ...declaredOnThisRoster]);

    for (const sleeperPlayerId of eligible) {
      if (declaredOnThisRoster.has(sleeperPlayerId)) {
        declaredSleeperPlayerIds.push(sleeperPlayerId);
      }

      const priorRound = priorRoundByPlayer.get(sleeperPlayerId) ?? null;

      if (priorRound === null) {
        undraftedCount += 1;
        keeperRights.push(
          buildRight(input.seasonId, sleeperPlayerId, franchiseId, {
            nominalRound: input.undraftedKeeperRound,
            priorSeasonRound: null,
            sourceType: 'undrafted_free_agent',
          }),
        );
        continue;
      }

      if (priorRound - advance < minimumRound && declaredOnThisRoster.has(sleeperPlayerId)) {
        // Reported only for declared players: every round-one pick on every roster is at the
        // ceiling, and a hundred such notes would bury the ones that describe a real choice.
        diagnostics.push({
          level: 'warning',
          code: 'cost_held_at_ceiling',
          sleeperPlayerId,
          message: `${describe(sleeperPlayerId)} cost round ${priorRound} last season and holds at round ${minimumRound} rather than advancing further. Keeping a second such player requires a second round-${minimumRound} pick.`,
        });
      }

      keeperRights.push(
        buildRight(input.seasonId, sleeperPlayerId, franchiseId, {
          nominalRound: Math.max(minimumRound, priorRound - advance),
          priorSeasonRound: priorRound,
          sourceType: 'drafted',
        }),
      );
    }
  }

  if (undraftedCount > 0) {
    // Aggregated: this is the ordinary case for anyone added from waivers, and naming each
    // one individually would drown the diagnostics that describe something unexpected.
    diagnostics.push({
      level: 'warning',
      code: 'no_prior_draft_record',
      sleeperPlayerId: '',
      message: `${undraftedCount} rostered player(s) have no prior-season draft record, so the undrafted keeper round ${input.undraftedKeeperRound} was applied to each.`,
    });
  }

  return { keeperRights, declaredSleeperPlayerIds, unresolved, diagnostics };
}

function buildRight(
  seasonId: SeasonId,
  sleeperPlayerId: string,
  franchiseId: FranchiseId,
  cost: {
    nominalRound: number;
    priorSeasonRound: number | null;
    sourceType: KeeperRight['sourceType'];
  },
): KeeperRight {
  return {
    id: `keeper:${seasonId}:${franchiseId}:${sleeperPlayerId}` as KeeperRightId,
    seasonId,
    playerId: sleeperPlayerId as PlayerId,
    franchiseId,
    sourceType: cost.sourceType,
    nominalRound: cost.nominalRound,
    priorSeasonRound: cost.priorSeasonRound,
    effectiveOverallPick: null,
    confidence: 'inferred',
    manualOverrideReason: null,
  };
}
