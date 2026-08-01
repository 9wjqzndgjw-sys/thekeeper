import type { FranchiseId, KeeperRight, LineupSettings, Player, SeasonId } from '@keeper/domain';
import {
  computeLiveDraftBoard,
  type LiveDraftBoard,
  type TrackedSelection,
} from '@keeper/draft-tracker';
import type { PickValueCurve, ProjectionSource } from '@keeper/valuation';

export type BoardMode = 'pre_keeper' | 'post_keeper' | 'live';

export interface BoardViewModel {
  mode: BoardMode;
  title: string;
  /** What the pool this board was built from actually reflects, in plain words. */
  poolDescription: string;
  board: LiveDraftBoard;
  caveats: string[];
}

export interface BuildBoardsInput {
  players: readonly Player[];
  seasonId: SeasonId;
  franchiseId: FranchiseId;
  projectionSource: ProjectionSource;
  pickValueCurve: PickValueCurve;
  lineup: LineupSettings;
  teamCount: number;
  /** Keeper rights already declared league-wide. Drives the post-keeper pool. */
  declaredKeeperRights: readonly KeeperRight[];
  /** Canonical selections from the tracker. Drives the live pool. */
  selections: readonly TrackedSelection[];
  userNextOverallPick?: number;
  limit?: number;
}

/**
 * Builds all three boards from one calculation path, varying only which players are
 * already off the pool. Keeping them on one function is what makes them comparable: any
 * difference between the boards is a difference in the pool, not in the maths.
 */
export function buildBoards(input: BuildBoardsInput): BoardViewModel[] {
  const shared = {
    players: input.players,
    seasonId: input.seasonId,
    franchiseId: input.franchiseId,
    projectionSource: input.projectionSource,
    pickValueCurve: input.pickValueCurve,
    lineup: input.lineup,
    teamCount: input.teamCount,
    userNextOverallPick: input.userNextOverallPick,
    limit: input.limit,
  };

  const keeperSelections = input.declaredKeeperRights.map((right) =>
    keeperAsSelection(right, input.seasonId),
  );

  return [
    {
      mode: 'pre_keeper',
      title: 'Pre-keeper board',
      poolDescription: 'Every player, before any keeper is removed from the pool.',
      board: computeLiveDraftBoard({ ...shared, selections: [] }),
      caveats: [
        'Keeper entry probabilities are not modelled yet, so this board weights every player as if he will be available.',
      ],
    },
    {
      mode: 'post_keeper',
      title: 'Post-keeper board',
      poolDescription: `Pool with ${input.declaredKeeperRights.length} declared keeper(s) removed.`,
      board: computeLiveDraftBoard({ ...shared, selections: keeperSelections }),
      caveats:
        input.declaredKeeperRights.length === 0
          ? ['No keepers are declared yet, so this matches the pre-keeper board.']
          : [],
    },
    {
      mode: 'live',
      title: 'Live board',
      poolDescription: `Pool with ${input.selections.length} recorded pick(s) removed.`,
      board: computeLiveDraftBoard({ ...shared, selections: input.selections }),
      caveats: [],
    },
  ];
}

/**
 * Presents a declared keeper as a selection so the board can subtract it. Keepers consume
 * a real pick, but the overall pick is negative here purely as an out-of-band marker: it
 * must never collide with a live selection's overall pick.
 */
function keeperAsSelection(right: KeeperRight, seasonId: SeasonId): TrackedSelection {
  return {
    draftId: `declared-keepers:${seasonId}`,
    overallPick: -1 * (right.nominalRound * 1_000 + hashToSmallInt(String(right.id))),
    round: right.nominalRound,
    slot: null,
    rosterId: null,
    playerId: String(right.playerId),
    isKeeper: true,
    source: 'api',
    recordedAt: new Date(0).toISOString(),
  };
}

function hashToSmallInt(value: string): number {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) % 997;
  }
  return hash;
}
