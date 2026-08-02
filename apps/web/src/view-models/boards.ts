import type { FranchiseId, KeeperRight, LineupSettings, Player, SeasonId } from '@keeper/domain';
import {
  computeLiveDraftBoard,
  type LiveDraftBoard,
  type TrackedSelection,
} from '@keeper/draft-tracker';
import type { PickValueCurve, ProjectionSource } from '@keeper/valuation';

export type BoardMode = 'pre_keeper' | 'as_declared' | 'expected' | 'live';

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
  /** What a pick buys with nobody held back. */
  pickValueCurveIgnoringDeclarations: PickValueCurve;
  /** What a pick buys once the declared keepers are held. */
  pickValueCurveAssumingDeclarations: PickValueCurve;
  /** What a pick buys once every franchise holds its best set. */
  pickValueCurveAssumingExpected: PickValueCurve;
  lineup: LineupSettings;
  teamCount: number;
  /**
   * The keepers managers have actually declared. Fact, as far as it goes -- but a manager
   * can still change a declaration before the deadline, and some have declared nothing.
   */
  declaredKeeperRights: readonly KeeperRight[];
  /**
   * The keepers each franchise would hold if it played its roster optimally: at most
   * `maxKeepers` per team.
   *
   * Deliberately not "every keeper right". A right exists for every rostered player, so
   * passing rights here empties all twelve rosters and leaves a board of free agents.
   */
  expectedKeeperRights: readonly KeeperRight[];
  /** Canonical selections from the tracker. Drives the live pool. */
  selections: readonly TrackedSelection[];
  userNextOverallPick?: number;
  limit?: number;
}

/**
 * Builds the boards from one calculation path, varying only which players are already off
 * the pool. Keeping them on one function is what makes them comparable: any difference
 * between the boards is a difference in the pool, not in the maths.
 *
 * The middle two are the ones to read together. `as_declared` takes the league at its word;
 * `expected` assumes everyone keeps their best set. Where they disagree is where somebody is
 * leaving value on the table, and a player on one but not the other is exactly the player
 * who might or might not reach the draft.
 *
 * Each board is priced against the pool it is built from. Valuing one with another's curve
 * would rank a player against everybody while costing his pick as though the best were
 * already gone.
 */
export function buildBoards(input: BuildBoardsInput): BoardViewModel[] {
  const shared = {
    players: input.players,
    seasonId: input.seasonId,
    franchiseId: input.franchiseId,
    projectionSource: input.projectionSource,
    lineup: input.lineup,
    teamCount: input.teamCount,
    userNextOverallPick: input.userNextOverallPick,
    limit: input.limit,
  };

  const asSelections = (rights: readonly KeeperRight[]) =>
    rights.map((right) => keeperAsSelection(right, input.seasonId));

  return [
    {
      mode: 'pre_keeper',
      title: 'Pre-keeper board',
      poolDescription: 'Every player, before any keeper is removed from the pool.',
      board: computeLiveDraftBoard({
        ...shared,
        pickValueCurve: input.pickValueCurveIgnoringDeclarations,
        selections: [],
      }),
      caveats: [
        'Keeper entry probabilities are not modelled yet, so this board weights every player as if he will be available.',
      ],
    },
    {
      mode: 'as_declared',
      title: 'As declared',
      poolDescription: `Pool with the ${input.declaredKeeperRights.length} keeper(s) managers have actually declared removed.`,
      board: computeLiveDraftBoard({
        ...shared,
        pickValueCurve: input.pickValueCurveAssumingDeclarations,
        selections: asSelections(input.declaredKeeperRights),
      }),
      caveats:
        input.declaredKeeperRights.length === 0
          ? ['Nobody has declared a keeper yet, so this matches the pre-keeper board.']
          : ['Declarations can still change before the deadline.'],
    },
    {
      mode: 'expected',
      title: 'If everyone keeps optimally',
      poolDescription: `Pool with the ${input.expectedKeeperRights.length} keeper(s) each franchise would hold if it played its roster best.`,
      board: computeLiveDraftBoard({
        ...shared,
        pickValueCurve: input.pickValueCurveAssumingExpected,
        selections: asSelections(input.expectedKeeperRights),
      }),
      caveats: [
        'A forecast, not a record: this assumes every manager keeps their strongest legal set.',
      ],
    },
    {
      mode: 'live',
      title: 'Live board',
      poolDescription: `Pool with ${input.expectedKeeperRights.length} keeper(s) and ${input.selections.length} recorded pick(s) removed.`,
      // Keepers are subtracted here as well as the recorded picks. A kept player never
      // enters the draft, so a live board built from selections alone shows him as the best
      // thing available -- and before the first pick is made that is the entire pool,
      // topped by whichever keeper is the best player in the league.
      board: computeLiveDraftBoard({
        ...shared,
        pickValueCurve: input.pickValueCurveAssumingExpected,
        selections: [...asSelections(input.expectedKeeperRights), ...input.selections],
      }),
      caveats:
        input.selections.length === 0
          ? ['No picks have been recorded yet, so this is the expected post-keeper pool.']
          : [],
    },
  ];
}

/**
 * Presents a keeper as a selection so the board can subtract it. Keepers consume a real
 * pick, but the overall pick is negative here purely as an out-of-band marker: it must
 * never collide with a live selection's overall pick.
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
