export interface ComputeRosterFitInput {
  starterSlotsAtPosition: number;
  rosterAboveReplacementCountAtPosition: number;
  positionalNeedWeight?: number;
}

export interface RosterFitResult {
  rosterFit: number;
  openStarterSlots: number;
}

const DEFAULT_POSITIONAL_NEED_WEIGHT = 10;

// Binary "has an open starter slot at this position" bonus rather than a per-slot
// scale: with no market data yet, claiming precision beyond "needs one or doesn't"
// would be false precision (see 02_PRODUCT_SPEC.md non-goals).
export function computeRosterFit(input: ComputeRosterFitInput): RosterFitResult {
  const openStarterSlots = Math.max(
    0,
    input.starterSlotsAtPosition - input.rosterAboveReplacementCountAtPosition,
  );
  const weight = input.positionalNeedWeight ?? DEFAULT_POSITIONAL_NEED_WEIGHT;

  return {
    rosterFit: openStarterSlots > 0 ? weight : 0,
    openStarterSlots,
  };
}

export interface TeamContextValueBreakdown {
  keeperSurplusValue: number;
  rosterFit: number;
  windowAdjustment: number;
  pickInventoryAdjustment: number;
  futureKeeperOptionValue: number;
  draftPoolControlValue: number;
  marketLiquidityAdjustment: number;
  concentrationRisk: number;
  uncertaintyPenalty: number;
}

export interface ComputeTeamContextValueInput {
  keeperSurplusValue: number;
  rosterFit: number;
}

export interface TeamContextValueResult {
  teamContextValue: number;
  breakdown: TeamContextValueBreakdown;
}

export function computeTeamContextValue(
  input: ComputeTeamContextValueInput,
): TeamContextValueResult {
  const breakdown: TeamContextValueBreakdown = {
    keeperSurplusValue: input.keeperSurplusValue,
    rosterFit: input.rosterFit,
    // Not yet implemented: Phase 5+ market analysis, multi-year keeper
    // simulation, and pick-inventory tracking don't exist yet.
    windowAdjustment: 0,
    pickInventoryAdjustment: 0,
    futureKeeperOptionValue: 0,
    draftPoolControlValue: 0,
    marketLiquidityAdjustment: 0,
    concentrationRisk: 0,
    uncertaintyPenalty: 0,
  };

  const teamContextValue =
    breakdown.keeperSurplusValue +
    breakdown.rosterFit +
    breakdown.windowAdjustment +
    breakdown.pickInventoryAdjustment +
    breakdown.futureKeeperOptionValue +
    breakdown.draftPoolControlValue +
    breakdown.marketLiquidityAdjustment -
    breakdown.concentrationRisk -
    breakdown.uncertaintyPenalty;

  return { teamContextValue, breakdown };
}
