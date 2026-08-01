import type {
  FranchiseId,
  PlayerId,
  Position,
  SeasonId,
  ValuationResult,
  ValuationRunId,
} from '@keeper/domain';
import { computeIntrinsicValue, type IntrinsicValueResult } from './intrinsic-value.js';
import {
  computeKeeperSurplusValue,
  type KeeperSurplusValueResult,
} from './keeper-surplus-value.js';
import type { PickValueCurve } from './pick-value-curve.js';
import type { ProjectionSource } from './projections.js';
import type { ReplacementLevels } from './replacement.js';
import { computeTeamContextValue, type TeamContextValueResult } from './team-context-value.js';

export const ENGINE_VERSION = '0.1.0';

export interface ValuatePlayerForFranchiseInput {
  playerId: PlayerId;
  position: Position;
  franchiseId: FranchiseId;
  seasonId: SeasonId;
  evaluatedAt: string;
  projectionSource: ProjectionSource;
  replacementLevels: ReplacementLevels;
  pickValueCurve: PickValueCurve;
  /** The exact resolved overall pick this keeper would consume, or null to value the player without a keeper decision (e.g. free-agent IV only). */
  exactOverallPick: number | null;
  keeperSlotOpportunityCost?: number;
  rosterFit?: number;
  rulesVersion?: string;
  engineVersion?: string;
}

export function valuatePlayerForFranchise(input: ValuatePlayerForFranchiseInput): ValuationResult {
  const projectedPoints = input.projectionSource.getProjectedPoints(input.playerId, input.seasonId);
  if (projectedPoints === null) {
    throw new Error(
      `No projection available for player ${input.playerId} in season ${input.seasonId}.`,
    );
  }

  const replacementLevel = input.replacementLevels[input.position] ?? 0;
  const iv = computeIntrinsicValue({ projectedPoints, replacementLevel });

  const keeperContext =
    input.exactOverallPick === null
      ? null
      : buildKeeperContext(input, iv.intrinsicValue, input.exactOverallPick);

  return {
    id: buildValuationRunId(input),
    franchiseId: input.franchiseId,
    playerId: input.playerId,
    pickAssetId: null,
    components: {
      intrinsicValue: iv.intrinsicValue,
      keeperSurplusValue: keeperContext?.ksv.keeperSurplusValue ?? null,
      teamContextValue: keeperContext?.tcv.teamContextValue ?? null,
      breakdown: {
        ...prefixKeys('iv', iv.breakdown as unknown as Record<string, number>),
        ...(keeperContext
          ? {
              ...prefixKeys(
                'ksv',
                keeperContext.ksv.breakdown as unknown as Record<string, number>,
              ),
              ...prefixKeys(
                'tcv',
                keeperContext.tcv.breakdown as unknown as Record<string, number>,
              ),
            }
          : {}),
      },
    },
    uncertainty: null,
    explanation: buildExplanation(input, iv, keeperContext),
    engineVersion: input.engineVersion ?? ENGINE_VERSION,
    projectionVersion: input.projectionSource.version,
    rulesVersion: input.rulesVersion ?? 'unversioned',
    evaluatedAt: input.evaluatedAt,
  };
}

interface KeeperContext {
  ksv: KeeperSurplusValueResult;
  tcv: TeamContextValueResult;
}

function buildKeeperContext(
  input: ValuatePlayerForFranchiseInput,
  intrinsicValue: number,
  exactOverallPick: number,
): KeeperContext {
  const ksv = computeKeeperSurplusValue({
    intrinsicValue,
    pickValueCurve: input.pickValueCurve,
    exactOverallPick,
    keeperSlotOpportunityCost: input.keeperSlotOpportunityCost,
  });
  const tcv = computeTeamContextValue({
    keeperSurplusValue: ksv.keeperSurplusValue,
    rosterFit: input.rosterFit ?? 0,
  });

  return { ksv, tcv };
}

function buildValuationRunId(input: ValuatePlayerForFranchiseInput): ValuationRunId {
  return `valuation-${input.franchiseId}-${input.playerId}-${input.evaluatedAt}` as ValuationRunId;
}

function prefixKeys(prefix: string, breakdown: Record<string, number>): Record<string, number> {
  return Object.fromEntries(
    Object.entries(breakdown).map(([key, value]) => [`${prefix}.${key}`, value]),
  );
}

function buildExplanation(
  input: ValuatePlayerForFranchiseInput,
  iv: IntrinsicValueResult,
  keeperContext: KeeperContext | null,
): string {
  const lines = [
    `Projected contribution               ${formatSigned(iv.breakdown.pointsAboveReplacement)}`,
  ];

  if (!keeperContext) {
    lines.push('---------------------------------------------------------');
    lines.push(`Intrinsic Value                       ${formatSigned(iv.intrinsicValue)}`);
    return lines.join('\n');
  }

  const { ksv, tcv } = keeperContext;

  lines.push(
    `Exact pick cost (overall ${input.exactOverallPick})       ${formatSigned(-ksv.breakdown.pickOpportunityCost)}`,
  );
  if (ksv.breakdown.keeperSlotOpportunityCost !== 0) {
    lines.push(
      `Keeper slot opportunity cost         ${formatSigned(-ksv.breakdown.keeperSlotOpportunityCost)}`,
    );
  }
  if (tcv.breakdown.rosterFit !== 0) {
    lines.push(`Roster fit                            ${formatSigned(tcv.breakdown.rosterFit)}`);
  }
  lines.push('---------------------------------------------------------');
  lines.push(`Team Context Value                    ${formatSigned(tcv.teamContextValue)}`);

  return lines.join('\n');
}

function formatSigned(value: number): string {
  const rounded = Math.round(value * 100) / 100;
  return rounded >= 0 ? `+${rounded}` : `${rounded}`;
}
