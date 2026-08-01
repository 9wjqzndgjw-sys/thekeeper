import type {
  FranchiseId,
  LineupSettings,
  Player,
  PlayerId,
  Position,
  SeasonId,
} from '@keeper/domain';
import {
  computeIntrinsicValue,
  computeKeeperSurplusValue,
  computeReplacementLevels,
  type PickValueCurve,
  type ProjectionSource,
  type ReplacementCandidate,
  type ReplacementLevels,
} from '@keeper/valuation';
import type { TrackedSelection } from './reconcile.js';

export interface LiveDraftBoardRow {
  rank: number;
  tier: number;
  playerId: PlayerId;
  sleeperPlayerId: string | null;
  fullName: string;
  position: Position;
  projectedPoints: number;
  intrinsicValue: number;
  /** Surplus if taken at `userNextOverallPick`; null when no pick was supplied. */
  valueAtUserNextPick: number | null;
}

export interface LiveDraftBoard {
  rows: LiveDraftBoardRow[];
  /** Recomputed from the remaining pool, so it moves as players come off the board. */
  replacementLevels: ReplacementLevels;
  draftedPlayerCount: number;
  availablePlayerCount: number;
  availableCountByPosition: Partial<Record<Position, number>>;
  unmatchedDraftedPlayerIds: string[];
}

export interface ComputeLiveDraftBoardInput {
  selections: readonly TrackedSelection[];
  players: readonly Player[];
  seasonId: SeasonId;
  franchiseId: FranchiseId;
  projectionSource: ProjectionSource;
  pickValueCurve: PickValueCurve;
  lineup: LineupSettings;
  teamCount: number;
  userNextOverallPick?: number;
  /** A new tier starts when the drop to the next player exceeds this share of the current value. */
  tierGapRatio?: number;
  limit?: number;
}

const DEFAULT_TIER_GAP_RATIO = 0.1;

/**
 * Projects the tracker's canonical selections into a ranked board of who is still
 * available and what each remaining player is worth right now.
 *
 * Replacement level is recomputed from the surviving pool on every call rather than fixed
 * up front, because that is what actually changes during a draft: as the pool thins, the
 * best freely available player at a position gets worse, and everyone above them gains
 * value. The function is pure, so the caller can run it on each tracker event and treat
 * the result as an immutable snapshot.
 */
export function computeLiveDraftBoard(input: ComputeLiveDraftBoardInput): LiveDraftBoard {
  const draftedPlayerIds = new Set(
    input.selections
      .map((selection) => selection.playerId)
      .filter((playerId): playerId is string => playerId !== null),
  );

  // Selections normally carry a Sleeper player id, but a mock draft, a replayed fixture,
  // or a hand-entered pick may reference the domain id instead. Matching on either keeps
  // those sources usable rather than silently leaving drafted players on the board.
  const isDrafted = (player: Player): boolean =>
    (player.sleeperPlayerId !== null && draftedPlayerIds.has(player.sleeperPlayerId)) ||
    draftedPlayerIds.has(player.id);

  const availablePlayers = input.players.filter((player) => !isDrafted(player));

  const matchedPlayerIds = new Set<string>();
  for (const player of input.players) {
    if (player.sleeperPlayerId !== null && draftedPlayerIds.has(player.sleeperPlayerId)) {
      matchedPlayerIds.add(player.sleeperPlayerId);
    }
    if (draftedPlayerIds.has(player.id)) {
      matchedPlayerIds.add(player.id);
    }
  }

  const projectedByPlayer = new Map<PlayerId, number>();
  const replacementCandidates: ReplacementCandidate[] = [];
  for (const player of availablePlayers) {
    const projectedPoints = input.projectionSource.getProjectedPoints(player.id, input.seasonId);
    if (projectedPoints === null) {
      continue;
    }
    projectedByPlayer.set(player.id, projectedPoints);
    replacementCandidates.push({ position: player.position, projectedPoints });
  }

  const replacementLevels = computeReplacementLevels({
    candidates: replacementCandidates,
    lineup: input.lineup,
    teamCount: input.teamCount,
  });

  const scored = availablePlayers
    .flatMap((player) => {
      const projectedPoints = projectedByPlayer.get(player.id);
      if (projectedPoints === undefined) {
        return [];
      }

      const intrinsic = computeIntrinsicValue({
        projectedPoints,
        replacementLevel: replacementLevels[player.position] ?? 0,
      });

      return [
        {
          player,
          projectedPoints,
          intrinsicValue: intrinsic.intrinsicValue,
          valueAtUserNextPick:
            input.userNextOverallPick === undefined
              ? null
              : computeKeeperSurplusValue({
                  intrinsicValue: intrinsic.intrinsicValue,
                  pickValueCurve: input.pickValueCurve,
                  exactOverallPick: input.userNextOverallPick,
                }).keeperSurplusValue,
        },
      ];
    })
    // Name breaks ties so an equal-value pair keeps a stable order between recomputes.
    .sort(
      (left, right) =>
        right.intrinsicValue - left.intrinsicValue ||
        left.player.fullName.localeCompare(right.player.fullName),
    );

  const rows = assignTiers(scored, input.tierGapRatio ?? DEFAULT_TIER_GAP_RATIO);

  return {
    rows: input.limit === undefined ? rows : rows.slice(0, input.limit),
    replacementLevels,
    draftedPlayerCount: draftedPlayerIds.size,
    availablePlayerCount: availablePlayers.length,
    availableCountByPosition: countByPosition(availablePlayers),
    unmatchedDraftedPlayerIds: [...draftedPlayerIds]
      .filter((playerId) => !matchedPlayerIds.has(playerId))
      .sort(),
  };
}

function assignTiers(
  scored: readonly {
    player: Player;
    projectedPoints: number;
    intrinsicValue: number;
    valueAtUserNextPick: number | null;
  }[],
  tierGapRatio: number,
): LiveDraftBoardRow[] {
  let tier = 1;

  return scored.map((entry, index) => {
    const previous = scored[index - 1];
    if (previous) {
      const drop = previous.intrinsicValue - entry.intrinsicValue;
      // Compare against the player above so a cliff anywhere in the list starts a tier,
      // not just a cliff near the top.
      if (drop > Math.abs(previous.intrinsicValue) * tierGapRatio && drop > 0) {
        tier += 1;
      }
    }

    return {
      rank: index + 1,
      tier,
      playerId: entry.player.id,
      sleeperPlayerId: entry.player.sleeperPlayerId,
      fullName: entry.player.fullName,
      position: entry.player.position,
      projectedPoints: entry.projectedPoints,
      intrinsicValue: entry.intrinsicValue,
      valueAtUserNextPick: entry.valueAtUserNextPick,
    };
  });
}

function countByPosition(players: readonly Player[]): Partial<Record<Position, number>> {
  const counts: Partial<Record<Position, number>> = {};
  for (const player of players) {
    counts[player.position] = (counts[player.position] ?? 0) + 1;
  }
  return counts;
}
