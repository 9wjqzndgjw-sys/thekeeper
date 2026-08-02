import type { FranchiseId, KeeperRight, KeeperRightId, PlayerId, SeasonId } from '@keeper/domain';
import type { NormalizedSleeperDraftPick, NormalizedSleeperRoster } from './index.js';

export type KeeperReconstructionCode =
  | 'no_prior_draft_record'
  | 'cost_would_pass_round_one'
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
  playerNameBySleeperId?: Readonly<Record<string, string>>;
}

export interface ReconstructKeeperRightsResult {
  keeperRights: KeeperRight[];
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
 * Turns Sleeper's declared keepers into priced keeper rights.
 *
 * Sleeper stores the declaration (`roster.keepers`) but not what it costs, so the cost is
 * reconstructed from the previous season's draft: the round a player went in then,
 * advanced by the league's escalation. A player with no prior draft record was picked up
 * in-season and takes the league's undrafted-keeper round.
 *
 * A first-round keeper has no earlier round to advance into. Rather than invent a rule --
 * cap at one, forbid it, or something else -- that player is left unresolved and
 * reported, because which of those the league intends is a commissioner question.
 */
export function reconstructKeeperRights(
  input: ReconstructKeeperRightsInput,
): ReconstructKeeperRightsResult {
  const advance = input.costAdvancePerSeason ?? 1;
  const keeperRights: KeeperRight[] = [];
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

  for (const roster of input.rosters) {
    const franchiseId = input.rosterIdToFranchiseId[roster.rosterId] ?? null;

    for (const sleeperPlayerId of roster.keeperSleeperPlayerIds) {
      if (franchiseId === null) {
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
        continue;
      }

      if (!roster.playerSleeperIds.includes(sleeperPlayerId)) {
        diagnostics.push({
          level: 'warning',
          code: 'declared_keeper_not_on_roster',
          sleeperPlayerId,
          message: `${describe(sleeperPlayerId)} is declared a keeper by roster ${roster.rosterId} but is not on that roster.`,
        });
      }

      const priorRound = priorRoundByPlayer.get(sleeperPlayerId) ?? null;

      if (priorRound === null) {
        // Never drafted, so acquired in-season: the league's undrafted keeper round applies.
        keeperRights.push(
          buildRight(
            input.seasonId,
            sleeperPlayerId,
            franchiseId,
            input.undraftedKeeperRound,
            'undrafted_free_agent',
          ),
        );
        diagnostics.push({
          level: 'warning',
          code: 'no_prior_draft_record',
          sleeperPlayerId,
          message: `${describe(sleeperPlayerId)} has no prior-season draft record, so the undrafted keeper round ${input.undraftedKeeperRound} was applied.`,
        });
        continue;
      }

      const nominalRound = priorRound - advance;
      if (nominalRound < 1) {
        unresolved.push({
          sleeperPlayerId,
          franchiseId,
          priorRound,
          reason: 'cost_would_pass_round_one',
        });
        diagnostics.push({
          level: 'error',
          code: 'cost_would_pass_round_one',
          sleeperPlayerId,
          message: `${describe(sleeperPlayerId)} cost round ${priorRound} last season, so advancing ${advance} round(s) would pass round one. The league's rule for this case is not recorded, so no cost was assigned.`,
        });
        continue;
      }

      keeperRights.push(
        buildRight(input.seasonId, sleeperPlayerId, franchiseId, nominalRound, 'kept'),
      );
    }
  }

  return { keeperRights, unresolved, diagnostics };
}

function buildRight(
  seasonId: SeasonId,
  sleeperPlayerId: string,
  franchiseId: FranchiseId,
  nominalRound: number,
  sourceType: KeeperRight['sourceType'],
): KeeperRight {
  return {
    id: `keeper:${seasonId}:${franchiseId}:${sleeperPlayerId}` as KeeperRightId,
    seasonId,
    playerId: sleeperPlayerId as PlayerId,
    franchiseId,
    sourceType,
    nominalRound,
    effectiveOverallPick: null,
    confidence: 'inferred',
    manualOverrideReason: null,
  };
}
