import type { DraftPickAsset, Franchise, FranchiseId } from '@keeper/domain';
import type { TrackedSelection } from '@keeper/draft-tracker';

export interface UpcomingPick {
  overallPick: number;
  round: number;
  franchiseId: FranchiseId | null;
  displayName: string;
  isUser: boolean;
}

export interface PickHorizon {
  /** Lowest owned pick nobody has selected yet, or null once the draft is complete. */
  currentOverallPick: number | null;
  userNextOverallPick: number | null;
  /** How many picks happen before the user is on the clock. 0 means it is their turn. */
  picksUntilUserTurn: number | null;
  /** Everything from the current pick through the user's next pick, inclusive. */
  upcoming: UpcomingPick[];
  madePickCount: number;
  remainingPickCount: number;
}

export interface BuildPickHorizonInput {
  pickInventory: readonly DraftPickAsset[];
  selections: readonly TrackedSelection[];
  franchises: readonly Franchise[];
  userFranchiseId: FranchiseId;
  maxUpcoming?: number;
}

const DEFAULT_MAX_UPCOMING = 24;

/**
 * Works out where the draft stands and who picks between now and the user's turn.
 *
 * Ownership comes from the reconstructed inventory rather than the raw draft order, so a
 * traded pick shows the franchise that actually holds it. Picks with no resolved overall
 * number are skipped: they cannot be placed on the clock.
 */
export function buildPickHorizon(input: BuildPickHorizonInput): PickHorizon {
  const displayNameByFranchiseId = new Map(
    input.franchises.map((franchise) => [franchise.id, franchise.displayName]),
  );
  const madeOverallPicks = new Set(input.selections.map((selection) => selection.overallPick));

  const orderedPicks = input.pickInventory
    .filter((pick): pick is DraftPickAsset & { overallPick: number } => pick.overallPick !== null)
    .sort((left, right) => left.overallPick - right.overallPick);

  const remainingPicks = orderedPicks.filter((pick) => !madeOverallPicks.has(pick.overallPick));
  const currentPick = remainingPicks[0] ?? null;
  const userNextPick =
    remainingPicks.find((pick) => pick.currentFranchiseId === input.userFranchiseId) ?? null;

  const upcomingLimit = input.maxUpcoming ?? DEFAULT_MAX_UPCOMING;
  const throughUserTurn =
    userNextPick === null
      ? remainingPicks
      : remainingPicks.filter((pick) => pick.overallPick <= userNextPick.overallPick);

  return {
    currentOverallPick: currentPick?.overallPick ?? null,
    userNextOverallPick: userNextPick?.overallPick ?? null,
    picksUntilUserTurn:
      userNextPick === null
        ? null
        : remainingPicks.filter((pick) => pick.overallPick < userNextPick.overallPick).length,
    upcoming: throughUserTurn.slice(0, upcomingLimit).map((pick) => ({
      overallPick: pick.overallPick,
      round: pick.round,
      franchiseId: pick.currentFranchiseId,
      displayName:
        displayNameByFranchiseId.get(pick.currentFranchiseId) ?? String(pick.currentFranchiseId),
      isUser: pick.currentFranchiseId === input.userFranchiseId,
    })),
    madePickCount: madeOverallPicks.size,
    remainingPickCount: remainingPicks.length,
  };
}
