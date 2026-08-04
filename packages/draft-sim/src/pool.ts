import {
  calculateOverallPick,
  type DraftPickAsset,
  type FranchiseId,
  type KeeperRight,
  type KeeperRightId,
  type LeagueStateSnapshot,
  type LineupSettings,
  type Player,
  type PlayerId,
  type Position,
} from '@keeper/domain';
import { resolveKeeperCombination } from '@keeper/keeper-optimizer';
import {
  computeIntrinsicValue,
  computeReplacementLevels,
  type ReplacementCandidate,
  type ReplacementLevels,
} from '@keeper/valuation';

/** A player who can still be drafted, priced against the pool he is actually in. */
export interface DraftPoolPlayer {
  playerId: PlayerId;
  sleeperPlayerId: string | null;
  fullName: string;
  position: Position;
  projectedPoints: number;
  intrinsicValue: number;
  /** Where the market takes him, or null where the source ranked nobody. */
  averageDraftPosition: number | null;
}

/**
 * One overall pick, and who makes it.
 *
 * Ownership comes from the pick inventory rather than from snake arithmetic. The two agree
 * only in a league where nothing has been traded; here 51 of 180 picks have changed hands,
 * so deriving the owner from the slot would hand a quarter of the draft to the wrong team.
 */
export interface DraftSlotOwnership {
  overallPick: number;
  round: number;
  slot: number;
  franchiseId: FranchiseId;
  /** The keeper this pick is spent on, or null when it is a live selection. */
  consumedByKeeperRightId: KeeperRightId | null;
  /** The player that keeper is, so the pick can be shown without a second lookup. */
  consumedByPlayerId: PlayerId | null;
}

/**
 * How a franchise arrives at the draft.
 *
 * `rosterGap` is roster spots minus picks owned, and it is the number that matters: a
 * keeper consumes a pick without taking anyone off the board, so a team finishes with
 * exactly as many players as it has picks. A positive gap ends the draft short, a negative
 * one ends it over the limit.
 */
export interface FranchisePickPosture {
  franchiseId: FranchiseId;
  displayName: string;
  picksOwned: number;
  keeperPicks: number;
  liveSelections: number;
  rosterSpots: number;
  rosterGap: number;
}

export interface DraftPoolReadiness {
  /** False when something would make a rehearsal teach the wrong draft. */
  ok: boolean;
  blockers: string[];
  warnings: string[];
}

export interface DraftPool {
  /** Draftable players, keepers already removed, best first. */
  players: DraftPoolPlayer[];
  keptPlayerIds: Set<string>;
  /**
   * The kept players themselves, priced the same way.
   *
   * Carried rather than left to the caller because a keeper still occupies a pick and has
   * to be shown on the board. Looking him up in `players` cannot work -- that is the pool
   * he has been removed from -- and falling back to an id and a guessed position puts
   * fiction on the very board this exists to keep honest.
   */
  keptPlayers: DraftPoolPlayer[];
  /** Every overall pick in order, keeper-consumed ones included and marked. */
  order: DraftSlotOwnership[];
  postures: FranchisePickPosture[];
  /** Recomputed against the post-keeper pool, since that is the pool being drafted from. */
  replacementLevels: ReplacementLevels;
  /** Carried so anything modelling a roster reads the league's own slots, not a guess. */
  lineup: LineupSettings;
  readiness: DraftPoolReadiness;
}

export interface BuildDraftPoolInput {
  snapshot: LeagueStateSnapshot;
  players: readonly Player[];
  /** Players a franchise has actually declared. Rights alone would empty the board. */
  declaredPlayerIds: ReadonlySet<string>;
}

/**
 * Assembles the real league into the shape a draft runs on.
 *
 * Everything here is derived, never invented. Where something cannot be derived it becomes
 * a blocker rather than a default, because the failure mode of a rehearsal is silent: a
 * pool missing forty players or an order attributing picks to the wrong manager still
 * produces a plausible-looking draft, and the practice is worse than none.
 */
export function buildDraftPool(input: BuildDraftPoolInput): DraftPool {
  const { snapshot } = input;
  const blockers: string[] = [];
  const warnings: string[] = [];

  const projectedByPlayerId = new Map(
    snapshot.playerSeasons.map((season) => [String(season.playerId), season.projectedPoints ?? 0]),
  );
  const adpByPlayerId = new Map(
    snapshot.playerSeasons.map((season) => [
      String(season.playerId),
      season.averageDraftPosition ?? null,
    ]),
  );

  const declaredRights = snapshot.keeperRights.filter((right) =>
    input.declaredPlayerIds.has(String(right.playerId)),
  );
  const { keeperPicks, keeperBlockers } = resolveKeeperPicks(snapshot, declaredRights);
  blockers.push(...keeperBlockers);

  const keptPlayerIds = new Set(keeperPicks.map((pick) => String(pick.playerId)));
  const order = buildOrder(snapshot, keeperPicks, blockers);

  // Kept players are held out of the available pool but handed to the replacement
  // calculation as rostered: they occupy a roster spot whatever happens, so counting only
  // the survivors would shrink supply while league demand stayed fixed and walk replacement
  // level down for everyone.
  const available: ReplacementCandidate[] = [];
  const rostered: ReplacementCandidate[] = [];
  for (const player of input.players) {
    const projectedPoints = projectedByPlayerId.get(String(player.id));
    if (projectedPoints === undefined) {
      continue;
    }
    (keptPlayerIds.has(String(player.id)) ? rostered : available).push({
      position: player.position,
      projectedPoints,
    });
  }

  const replacementLevels = computeReplacementLevels({
    candidates: available,
    rosteredCandidates: rostered,
    lineup: snapshot.league.lineup,
    teamCount: snapshot.league.rules.teamCount,
  });

  const priced = input.players.flatMap((player) => {
    const projectedPoints = projectedByPlayerId.get(String(player.id));
    if (projectedPoints === undefined) {
      return [];
    }
    return [
      {
        playerId: player.id,
        sleeperPlayerId: player.sleeperPlayerId,
        fullName: player.fullName,
        position: player.position,
        projectedPoints,
        intrinsicValue: computeIntrinsicValue({
          projectedPoints,
          replacementLevel: replacementLevels[player.position] ?? 0,
        }).intrinsicValue,
        averageDraftPosition: adpByPlayerId.get(String(player.id)) ?? null,
      },
    ];
  });

  // Name breaks ties so an equal-value pair keeps a stable order between builds.
  const byValue = (left: DraftPoolPlayer, right: DraftPoolPlayer): number =>
    right.intrinsicValue - left.intrinsicValue || left.fullName.localeCompare(right.fullName);

  const players = priced
    .filter((player) => !keptPlayerIds.has(String(player.playerId)))
    .sort(byValue);
  const keptPlayers = priced
    .filter((player) => keptPlayerIds.has(String(player.playerId)))
    .sort(byValue);

  const postures = buildPostures(snapshot, order);

  if (players.length === 0) {
    blockers.push(
      'No player in the pool has a projection. Run "npm run project -w @keeper/cli" before rehearsing.',
    );
  }

  const liveSelections = order.filter((slot) => slot.consumedByKeeperRightId === null).length;
  if (players.length < liveSelections) {
    blockers.push(
      `The pool holds ${players.length} players but the draft makes ${liveSelections} live selections. ` +
        'The board would run out before the draft ends.',
    );
  }

  warnings.push(...collectWarnings(snapshot, input, postures, projectedByPlayerId));

  return {
    players,
    keptPlayerIds,
    keptPlayers,
    order,
    postures,
    replacementLevels,
    lineup: snapshot.league.lineup,
    readiness: { ok: blockers.length === 0, blockers, warnings },
  };
}

/**
 * The exact picks each franchise's declared keepers consume.
 *
 * Resolution is per franchise because displacement is: a keeper whose nominal round is
 * already spent falls to the next earlier pick *that manager* still owns, which depends on
 * their inventory and nobody else's.
 */
function resolveKeeperPicks(
  snapshot: LeagueStateSnapshot,
  declaredRights: readonly KeeperRight[],
): {
  keeperPicks: ReturnType<typeof resolveKeeperCombination>['resolvedPicks'];
  keeperBlockers: string[];
} {
  const keeperPicks: ReturnType<typeof resolveKeeperCombination>['resolvedPicks'] = [];
  const keeperBlockers: string[] = [];

  for (const franchise of snapshot.franchises) {
    const rights = declaredRights.filter((right) => right.franchiseId === franchise.id);
    if (rights.length === 0) {
      continue;
    }

    const resolution = resolveKeeperCombination([...rights], [...snapshot.pickInventory], {
      franchiseId: franchise.id,
      maxKeepers: snapshot.league.rules.maxKeepers,
    });

    if (!resolution.legal) {
      keeperBlockers.push(
        `${franchise.displayName}'s declared keepers cannot be resolved: ${resolution.invalidReason}`,
      );
      continue;
    }
    keeperPicks.push(...resolution.resolvedPicks);
  }

  return { keeperPicks, keeperBlockers };
}

/** Every overall pick in order, owner taken from the inventory and keepers marked. */
function buildOrder(
  snapshot: LeagueStateSnapshot,
  keeperPicks: readonly {
    keeperRightId: KeeperRightId;
    playerId: PlayerId;
    resolvedOverallPick: number;
  }[],
  blockers: string[],
): DraftSlotOwnership[] {
  const keeperByOverallPick = new Map(
    keeperPicks.map((pick) => [
      pick.resolvedOverallPick,
      { keeperRightId: pick.keeperRightId, playerId: pick.playerId },
    ]),
  );
  const expected = snapshot.league.rules.teamCount * snapshot.league.rules.draftRounds;

  const unplaced = snapshot.pickInventory.filter(
    (pick) => pick.overallPick === null || pick.slot === null,
  );
  if (unplaced.length > 0) {
    blockers.push(
      `${unplaced.length} pick(s) have no draft slot yet, so there is no order to rehearse. ` +
        'The draft order has to be set in Sleeper first.',
    );
  }

  const order = snapshot.pickInventory
    .flatMap((pick: DraftPickAsset) =>
      pick.overallPick === null || pick.slot === null
        ? []
        : [
            {
              overallPick: pick.overallPick,
              round: pick.round,
              slot: pick.slot,
              franchiseId: pick.currentFranchiseId,
              consumedByKeeperRightId:
                keeperByOverallPick.get(pick.overallPick)?.keeperRightId ?? null,
              consumedByPlayerId: keeperByOverallPick.get(pick.overallPick)?.playerId ?? null,
            },
          ],
    )
    .sort((left, right) => left.overallPick - right.overallPick);

  if (unplaced.length === 0 && order.length !== expected) {
    blockers.push(
      `The pick inventory holds ${order.length} picks but ${snapshot.league.rules.teamCount} teams ` +
        `over ${snapshot.league.rules.draftRounds} rounds needs ${expected}. Re-run the import.`,
    );
  }

  // A keeper resolved onto a pick nobody owns would silently vanish from the draft.
  const placed = new Set(order.map((slot) => slot.overallPick));
  for (const pick of keeperPicks) {
    if (!placed.has(pick.resolvedOverallPick)) {
      blockers.push(
        `A keeper resolved onto overall pick ${pick.resolvedOverallPick}, which is not in the inventory.`,
      );
    }
  }

  return order;
}

function buildPostures(
  snapshot: LeagueStateSnapshot,
  order: readonly DraftSlotOwnership[],
): FranchisePickPosture[] {
  // Roster spots are the starting lineup plus the bench. Injured reserve is deliberately
  // excluded: it holds players who cannot be started, so counting it would inflate how many
  // draftable bodies a team needs.
  const lineup = snapshot.league.lineup;
  const rosterSpots =
    lineup.qb + lineup.rb + lineup.wr + lineup.te + lineup.flex + lineup.def + lineup.bench;

  return snapshot.franchises
    .map((franchise) => {
      const owned = order.filter((slot) => slot.franchiseId === franchise.id);
      const keeperPicks = owned.filter((slot) => slot.consumedByKeeperRightId !== null).length;

      return {
        franchiseId: franchise.id,
        displayName: franchise.displayName,
        picksOwned: owned.length,
        keeperPicks,
        liveSelections: owned.length - keeperPicks,
        rosterSpots,
        rosterGap: rosterSpots - owned.length,
      };
    })
    .sort((left, right) => left.picksOwned - right.picksOwned);
}

function collectWarnings(
  snapshot: LeagueStateSnapshot,
  input: BuildDraftPoolInput,
  postures: readonly FranchisePickPosture[],
  projectedByPlayerId: ReadonlyMap<string, number>,
): string[] {
  const warnings: string[] = [];

  const unconfirmed = snapshot.pickInventory.filter(
    (pick) => pick.ownershipConfidence !== 'confirmed',
  );
  if (unconfirmed.length > 0) {
    warnings.push(
      `${unconfirmed.length} of ${snapshot.pickInventory.length} picks have inferred or disputed ` +
        'ownership. The order is a best reconstruction, not a confirmed one.',
    );
  }

  const unprojectedKeepers = snapshot.keeperRights.filter(
    (right) => !projectedByPlayerId.has(String(right.playerId)),
  ).length;
  if (unprojectedKeepers > 0) {
    warnings.push(
      `${unprojectedKeepers} rostered player(s) have no projection and cannot be valued or drafted.`,
    );
  }

  if (input.declaredPlayerIds.size === 0) {
    warnings.push(
      'No keeper has been declared, so the whole pool is available and no pick is consumed. ' +
        'The rehearsal will not resemble the real draft until declarations are in.',
    );
  }

  const short = postures.filter((posture) => posture.rosterGap > 0);
  const over = postures.filter((posture) => posture.rosterGap < 0);
  if (short.length > 0 || over.length > 0) {
    warnings.push(
      `${short.length} team(s) finish short of a full roster and ${over.length} finish over it. ` +
        'Pick count and roster need are not the same number for this league.',
    );
  }

  return warnings;
}

/** Snake position of a pick, for callers that need it without the inventory. */
export function overallPickFor(snapshot: LeagueStateSnapshot, round: number, slot: number): number {
  return calculateOverallPick(
    {
      orderMethod: 'snake',
      teamCount: snapshot.league.rules.teamCount,
      rounds: snapshot.league.rules.draftRounds,
      thirdRoundReversal: snapshot.league.rules.thirdRoundReversal,
    },
    round,
    slot,
  );
}
