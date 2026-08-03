import {
  calculateOverallPick,
  createDraftOrderStrategy,
  type Draft,
  type DraftOrderConfig,
  type DraftPickAsset,
  type DraftPickAssetId,
  type Franchise,
  type FranchiseId,
  type KeeperRight,
  type KeeperRightId,
  type League,
  type LeagueId,
  type LeagueStateSnapshot,
  type Player,
  type PlayerId,
  type PlayerSeason,
  type Position,
  type Roster,
  type Season,
  type SeasonId,
} from '@keeper/domain';
import type { SleeperDraftPickLike } from '@keeper/draft-tracker';
import { resolveKeeperCombination, resolveNominalKeeperCostRound } from '@keeper/keeper-optimizer';
import {
  buildDeclarationScenarios,
  createSnapshotProjectionSource,
  type PickValueCurve,
} from '@keeper/valuation';

export interface MockDraftStage {
  label: string;
  picks: SleeperDraftPickLike[];
}

export interface MockKeeperResolutionRow {
  franchiseName: string;
  playerName: string;
  priorRound: number | null;
  nominalRound: number;
  resolvedOverallPick: number;
  resolvedRound: number;
}

export interface MockDraftRehearsal {
  snapshot: LeagueStateSnapshot;
  players: Player[];
  playersBySleeperId: ReadonlyMap<string, string>;
  stages: MockDraftStage[];
  pickValueCurve: PickValueCurve;
  keeperResolutionRows: MockKeeperResolutionRow[];
}

interface KeeperSpec {
  franchiseIndex: number;
  playerId: string;
  sourceType: KeeperRight['sourceType'];
  previousRound?: number;
}

interface PositionPoolConfig {
  count: number;
  high: number;
  step: number;
  floor: number;
}

const TEAM_COUNT = 12;
const DRAFT_ROUNDS = 15;
const UNDRAFTED_KEEPER_ROUND = 10;
const SEASON_ID = 'season-mock-draft-2026' as SeasonId;
const LEAGUE_ID = 'league-mock-draft' as LeagueId;
const DRAFT_ID = 'draft-mock-draft-2026';

const ORDER_CONFIG: DraftOrderConfig = {
  orderMethod: 'snake',
  teamCount: TEAM_COUNT,
  rounds: DRAFT_ROUNDS,
  thirdRoundReversal: false,
};

const LINEUP = {
  qb: 1,
  rb: 2,
  wr: 2,
  te: 1,
  flex: 2,
  def: 1,
  bench: 6,
  ir: 2,
};

const POSITION_POOLS: Record<Position, PositionPoolConfig> = {
  QB: { count: 36, high: 425, step: 5.1, floor: 205 },
  RB: { count: 92, high: 305, step: 2.05, floor: 78 },
  WR: { count: 104, high: 295, step: 1.9, floor: 74 },
  TE: { count: 42, high: 262, step: 3.2, floor: 70 },
  DEF: { count: 40, high: 166, step: 2.55, floor: 54 },
};

const FIRST_NAMES = [
  'Avery',
  'Blake',
  'Cameron',
  'Drew',
  'Elliot',
  'Finley',
  'Gray',
  'Hayden',
  'Jordan',
  'Kai',
  'Logan',
  'Morgan',
  'Nico',
  'Owen',
  'Parker',
  'Quinn',
  'Reese',
  'Sawyer',
  'Tate',
  'Vale',
  'Wes',
  'Zion',
  'Arden',
  'Baylor',
  'Casey',
  'Devon',
  'Emery',
  'Flynn',
  'Harper',
  'Jules',
];

const LAST_NAMES = [
  'Adler',
  'Banks',
  'Cross',
  'Dawson',
  'Ellis',
  'Foster',
  'Grant',
  'Hayes',
  'Irving',
  'James',
  'Keller',
  'Lane',
  'Monroe',
  'Nash',
  'Ortiz',
  'Pierce',
  'Reid',
  'Stone',
  'Turner',
  'Vaughn',
  'Walker',
  'Young',
  'Bennett',
  'Cole',
  'Fields',
  'Hale',
  'Mason',
  'Price',
  'Rhodes',
  'West',
];

const KEEPER_SPECS: KeeperSpec[] = [
  { franchiseIndex: 0, playerId: playerId('QB', 1), sourceType: 'kept', previousRound: 1 },
  { franchiseIndex: 0, playerId: playerId('RB', 1), sourceType: 'drafted', previousRound: 2 },
  { franchiseIndex: 0, playerId: playerId('WR', 18), sourceType: 'drafted', previousRound: 8 },
  { franchiseIndex: 1, playerId: playerId('WR', 1), sourceType: 'drafted', previousRound: 2 },
  { franchiseIndex: 1, playerId: playerId('RB', 14), sourceType: 'drafted', previousRound: 5 },
  { franchiseIndex: 1, playerId: playerId('TE', 6), sourceType: 'undrafted_free_agent' },
  { franchiseIndex: 2, playerId: playerId('RB', 2), sourceType: 'kept', previousRound: 1 },
  { franchiseIndex: 2, playerId: playerId('QB', 7), sourceType: 'drafted', previousRound: 9 },
  { franchiseIndex: 2, playerId: playerId('WR', 22), sourceType: 'drafted', previousRound: 10 },
  { franchiseIndex: 3, playerId: playerId('TE', 1), sourceType: 'drafted', previousRound: 2 },
  { franchiseIndex: 3, playerId: playerId('RB', 15), sourceType: 'drafted', previousRound: 6 },
  { franchiseIndex: 3, playerId: playerId('WR', 23), sourceType: 'undrafted_free_agent' },
  { franchiseIndex: 4, playerId: playerId('WR', 2), sourceType: 'kept', previousRound: 1 },
  { franchiseIndex: 4, playerId: playerId('RB', 16), sourceType: 'drafted', previousRound: 7 },
  { franchiseIndex: 4, playerId: playerId('QB', 8), sourceType: 'drafted', previousRound: 10 },
  { franchiseIndex: 5, playerId: playerId('RB', 3), sourceType: 'drafted', previousRound: 2 },
  { franchiseIndex: 5, playerId: playerId('TE', 7), sourceType: 'drafted', previousRound: 8 },
  { franchiseIndex: 5, playerId: playerId('WR', 24), sourceType: 'drafted', previousRound: 12 },
  { franchiseIndex: 6, playerId: playerId('WR', 15), sourceType: 'drafted', previousRound: 6 },
  { franchiseIndex: 6, playerId: playerId('RB', 17), sourceType: 'drafted', previousRound: 8 },
  { franchiseIndex: 6, playerId: playerId('QB', 9), sourceType: 'undrafted_free_agent' },
  { franchiseIndex: 7, playerId: playerId('QB', 2), sourceType: 'drafted', previousRound: 2 },
  { franchiseIndex: 7, playerId: playerId('RB', 18), sourceType: 'drafted', previousRound: 5 },
  { franchiseIndex: 7, playerId: playerId('TE', 8), sourceType: 'drafted', previousRound: 9 },
  { franchiseIndex: 8, playerId: playerId('RB', 4), sourceType: 'kept', previousRound: 1 },
  { franchiseIndex: 8, playerId: playerId('WR', 25), sourceType: 'drafted', previousRound: 7 },
  { franchiseIndex: 8, playerId: playerId('DEF', 2), sourceType: 'drafted', previousRound: 13 },
  { franchiseIndex: 9, playerId: playerId('WR', 3), sourceType: 'drafted', previousRound: 2 },
  { franchiseIndex: 9, playerId: playerId('TE', 9), sourceType: 'drafted', previousRound: 6 },
  { franchiseIndex: 9, playerId: playerId('RB', 19), sourceType: 'undrafted_free_agent' },
  { franchiseIndex: 10, playerId: playerId('TE', 2), sourceType: 'kept', previousRound: 1 },
  { franchiseIndex: 10, playerId: playerId('WR', 26), sourceType: 'drafted', previousRound: 9 },
  { franchiseIndex: 10, playerId: playerId('RB', 20), sourceType: 'drafted', previousRound: 12 },
  { franchiseIndex: 11, playerId: playerId('QB', 3), sourceType: 'drafted', previousRound: 2 },
  { franchiseIndex: 11, playerId: playerId('RB', 21), sourceType: 'drafted', previousRound: 8 },
  { franchiseIndex: 11, playerId: playerId('DEF', 3), sourceType: 'undrafted_free_agent' },
];

export function createMockDraftRehearsal(): MockDraftRehearsal {
  const franchises = createFranchises();
  const players = createPlayers();
  const playerSeasons = createPlayerSeasons(players);
  const pickInventory = createPickInventory(franchises);
  const keeperRights = createKeeperRights(franchises);
  const keeperSelections = createKeeperSelections(franchises, keeperRights, pickInventory);
  const snapshot = createSnapshot({ franchises, keeperRights, pickInventory, playerSeasons });
  const pickValueCurve = createLivePickValueCurve(snapshot, players, keeperSelections);
  const liveSelections = createLiveSelections({
    players,
    playerSeasons,
    pickInventory,
    keeperSelections,
    snapshot,
  });

  return {
    snapshot,
    players,
    playersBySleeperId: new Map(
      players.flatMap((player) =>
        player.sleeperPlayerId === null ? [] : [[player.sleeperPlayerId, player.fullName]],
      ),
    ),
    stages: createStages(keeperSelections, liveSelections, snapshot.userFranchiseId, pickInventory),
    pickValueCurve,
    keeperResolutionRows: createKeeperResolutionRows(
      franchises,
      keeperRights,
      pickInventory,
      players,
    ),
  };
}

function createFranchises(): Franchise[] {
  return Array.from({ length: TEAM_COUNT }, (_, index) => ({
    id: franchiseId(index),
    leagueId: LEAGUE_ID,
    displayName: `Mock Team ${index + 1}`,
  }));
}

function createPlayers(): Player[] {
  return (Object.entries(POSITION_POOLS) as [Position, PositionPoolConfig][]).flatMap(
    ([position, config], positionIndex) =>
      Array.from({ length: config.count }, (_, index) => ({
        id: playerId(position, index + 1) as PlayerId,
        fullName: playerName(position, index, positionIndex),
        position,
        sleeperPlayerId: sleeperPlayerId(position, index + 1),
      })),
  );
}

function createPlayerSeasons(players: readonly Player[]): PlayerSeason[] {
  return players.map((player) => ({
    playerId: player.id,
    seasonId: SEASON_ID,
    nflTeam: 'MOCK',
    age: null,
    role: 'starter',
    injuryStatus: null,
    projectedPoints: projectPlayer(player),
    actualPoints: null,
  }));
}

function createPickInventory(franchises: readonly Franchise[]): DraftPickAsset[] {
  return franchises.flatMap((franchise, index) => {
    const slot = index + 1;
    return Array.from({ length: DRAFT_ROUNDS }, (_, roundIndex) => {
      const round = roundIndex + 1;
      return {
        id: `mock-pick:r${round}:slot${slot}` as DraftPickAssetId,
        seasonId: SEASON_ID,
        round,
        originalFranchiseId: franchise.id,
        currentFranchiseId: currentOwnerForPick(franchises, round, slot),
        slot,
        overallPick: calculateOverallPick(ORDER_CONFIG, round, slot),
        ownershipConfidence: 'confirmed',
      };
    });
  });
}

function currentOwnerForPick(
  franchises: readonly Franchise[],
  round: number,
  originalSlot: number,
): FranchiseId {
  const user = franchises[0]!.id;
  const teamSeven = franchises[6]!.id;

  // The user owns a second first-round pick, which lets the mock show two first-round
  // eligible keepers consuming two distinct firsts. Team seven gets a later pick back.
  if (round === 1 && originalSlot === 7) {
    return user;
  }
  if (round === 5 && originalSlot === 1) {
    return teamSeven;
  }

  return franchises[originalSlot - 1]!.id;
}

function createKeeperRights(franchises: readonly Franchise[]): KeeperRight[] {
  assertUniqueKeeperPlayers();

  return KEEPER_SPECS.map((spec) => {
    const nominalRound = resolveNominalKeeperCostRound({
      sourceType: spec.sourceType,
      previousRound: spec.previousRound,
      undraftedKeeperRound: UNDRAFTED_KEEPER_ROUND,
    });

    return {
      id: `mock-keeper:${spec.franchiseIndex + 1}:${spec.playerId}` as KeeperRightId,
      seasonId: SEASON_ID,
      playerId: spec.playerId as PlayerId,
      franchiseId: franchises[spec.franchiseIndex]!.id,
      sourceType: spec.sourceType,
      nominalRound,
      priorSeasonRound: spec.previousRound ?? null,
      effectiveOverallPick: null,
      confidence: 'confirmed',
      manualOverrideReason: null,
    };
  });
}

function createKeeperSelections(
  franchises: readonly Franchise[],
  keeperRights: readonly KeeperRight[],
  pickInventory: readonly DraftPickAsset[],
): SleeperDraftPickLike[] {
  return franchises
    .flatMap((franchise, index) => {
      const rights = keeperRights.filter((right) => right.franchiseId === franchise.id);
      const resolution = resolveKeeperCombination(rights, [...pickInventory], {
        franchiseId: franchise.id,
        maxKeepers: 3,
      });
      if (!resolution.legal) {
        throw new Error(
          `Mock keeper setup for ${franchise.displayName} is illegal: ${resolution.invalidReason}`,
        );
      }

      return resolution.resolvedPicks.map((pick) => ({
        pickNo: pick.resolvedOverallPick,
        round: pick.resolvedRound,
        draftSlot: pick.resolvedSlot,
        rosterId: index + 1,
        sleeperPlayerId: sleeperPlayerIdFromPlayerId(String(pick.playerId)),
        isKeeper: true,
      }));
    })
    .sort((left, right) => left.pickNo - right.pickNo);
}

function createSnapshot(input: {
  franchises: Franchise[];
  keeperRights: KeeperRight[];
  pickInventory: DraftPickAsset[];
  playerSeasons: PlayerSeason[];
}): LeagueStateSnapshot {
  const league: League = {
    id: LEAGUE_ID,
    name: 'Mock Draft Rehearsal League',
    rulesVersion: '2026.mock',
    rules: {
      teamCount: TEAM_COUNT,
      draftRounds: DRAFT_ROUNDS,
      thirdRoundReversal: false,
      maxKeepers: 3,
      keeperDurationIndefinite: true,
      keeperCostAdvancePerSeason: 1,
      undraftedKeeperRound: UNDRAFTED_KEEPER_ROUND,
      keeperRightsTradeable: false,
      tradesProcessImmediately: true,
      keeperDeadlineDaysBeforeDraft: 7,
      keeperDeclarationsPublicPreDraft: true,
      draftOrderMethod: 'manual',
      toiletBowlAwardPick: { round: 1, slot: 1 },
      futurePicksTradeable: true,
    },
    scoring: {
      passingYardsPerPoint: 25,
      passingTouchdownPoints: 6,
      interceptionPoints: -2,
      rushingReceivingYardsPerPoint: 10,
      rushingReceivingTouchdownPoints: 6,
      receptionPointsByPosition: { rb: 0.5, wr: 0.5, te: 1 },
      returnYardsCounted: true,
      defenseScoringRules: {},
    },
    lineup: LINEUP,
  };
  const season: Season = {
    id: SEASON_ID,
    leagueId: LEAGUE_ID,
    year: 2026,
    sleeperLeagueId: 'mock-draft-rehearsal-2026',
    previousSleeperLeagueId: 'mock-draft-rehearsal-2025',
    status: 'drafting',
    draftId: DRAFT_ID as Draft['id'],
    keeperDeadline: '2026-08-23T00:00:00.000Z',
    draftTime: '2026-08-30T00:00:00.000Z',
  };
  const draft: Draft = {
    id: DRAFT_ID as Draft['id'],
    seasonId: SEASON_ID,
    sleeperDraftId: DRAFT_ID,
    rounds: DRAFT_ROUNDS,
    teamCount: TEAM_COUNT,
    orderMethod: 'snake',
    thirdRoundReversal: false,
    status: 'drafting',
  };
  const rosters: Roster[] = input.franchises.map((franchise) => ({
    seasonId: SEASON_ID,
    franchiseId: franchise.id,
    playerIds: input.keeperRights
      .filter((right) => right.franchiseId === franchise.id)
      .map((right) => right.playerId),
    reservePlayerIds: [],
    wins: 0,
    losses: 0,
    ties: 0,
    playoffResult: 'none',
  }));

  return {
    league,
    season,
    franchises: input.franchises,
    rosters,
    keeperRights: input.keeperRights,
    pickInventory: input.pickInventory,
    draft,
    draftSelections: [],
    playerSeasons: input.playerSeasons,
    userFranchiseId: input.franchises[0]!.id,
    evaluatedAt: '2026-08-30T17:30:00.000Z',
    assumptions: {
      mockDraft: true,
      keeperCostPolicy:
        'Round 1 and round 2 prior costs both resolve to round 1; later costs advance by one; undrafted players cost round 10.',
    },
  };
}

function createLivePickValueCurve(
  snapshot: LeagueStateSnapshot,
  players: readonly Player[],
  keeperSelections: readonly SleeperDraftPickLike[],
): PickValueCurve {
  const projectionSource = createSnapshotProjectionSource(snapshot, 'mock-draft-rehearsal');
  const declaredPlayerIds = new Set(keeperSelections.map((selection) => selection.sleeperPlayerId));
  const scenarios = buildDeclarationScenarios({
    candidates: players.map((player) => ({
      position: player.position,
      projectedPoints: projectionSource.getProjectedPoints(player.id, snapshot.season.id) ?? 0,
      declared: declaredPlayerIds.has(player.sleeperPlayerId),
    })),
    lineup: snapshot.league.lineup,
    teamCount: snapshot.league.rules.teamCount,
    declaredKeeperOverallPicks: keeperSelections.map((selection) => selection.pickNo),
  });

  return scenarios.assumingDeclarations;
}

function createLiveSelections(input: {
  players: readonly Player[];
  playerSeasons: readonly PlayerSeason[];
  pickInventory: readonly DraftPickAsset[];
  keeperSelections: readonly SleeperDraftPickLike[];
  snapshot: LeagueStateSnapshot;
}): SleeperDraftPickLike[] {
  const strategy = createDraftOrderStrategy(ORDER_CONFIG);
  const consumedOverallPicks = new Set(input.keeperSelections.map((selection) => selection.pickNo));
  const consumedPlayerIds = new Set(
    input.keeperSelections.map((selection) => selection.sleeperPlayerId),
  );
  const projectionByPlayerId = new Map(
    input.playerSeasons.map((season) => [String(season.playerId), season.projectedPoints ?? 0]),
  );
  const projectionSource = createSnapshotProjectionSource(input.snapshot, 'mock-draft-rehearsal');
  const declaredPlayerIds = new Set(
    input.keeperSelections.map((selection) => selection.sleeperPlayerId),
  );
  const scenarios = buildDeclarationScenarios({
    candidates: input.players.map((player) => ({
      position: player.position,
      projectedPoints:
        projectionSource.getProjectedPoints(player.id, input.snapshot.season.id) ?? 0,
      declared: declaredPlayerIds.has(player.sleeperPlayerId),
    })),
    lineup: input.snapshot.league.lineup,
    teamCount: input.snapshot.league.rules.teamCount,
    declaredKeeperOverallPicks: input.keeperSelections.map((selection) => selection.pickNo),
  });
  const remainingPlayers = input.players
    .filter((player) => !consumedPlayerIds.has(player.sleeperPlayerId))
    .map((player) => ({
      player,
      draftScore:
        (projectionByPlayerId.get(String(player.id)) ?? 0) -
        (scenarios.replacementLevels[player.position] ?? 0),
    }));
  const liveSelections: SleeperDraftPickLike[] = [];

  for (const slot of strategy.listSlots()) {
    if (consumedOverallPicks.has(slot.overallPick)) {
      continue;
    }

    const chosen = takeDraftPlayer(remainingPlayers, preferredPositionForPick(slot.overallPick));
    if (!chosen) {
      break;
    }

    liveSelections.push({
      pickNo: slot.overallPick,
      round: slot.round,
      draftSlot: slot.slot,
      rosterId: slot.slot,
      sleeperPlayerId: chosen.player.sleeperPlayerId,
      isKeeper: false,
    });
  }

  return liveSelections;
}

function takeDraftPlayer(
  remainingPlayers: { player: Player; draftScore: number }[],
  preferredPosition: Position | null,
): { player: Player; draftScore: number } | null {
  const sorted = [...remainingPlayers].sort(
    (left, right) =>
      right.draftScore - left.draftScore ||
      left.player.fullName.localeCompare(right.player.fullName),
  );
  const preferred =
    preferredPosition === null
      ? null
      : sorted.find(
          (candidate, index) => candidate.player.position === preferredPosition && index < 36,
        );
  const chosen = preferred ?? sorted[0] ?? null;
  if (!chosen) {
    return null;
  }

  remainingPlayers.splice(
    remainingPlayers.findIndex((candidate) => candidate.player.id === chosen.player.id),
    1,
  );
  return chosen;
}

function preferredPositionForPick(overallPick: number): Position | null {
  if (overallPick >= 25 && overallPick <= 39) {
    return 'RB';
  }
  if (overallPick >= 40 && overallPick <= 55) {
    return 'WR';
  }
  if (overallPick >= 72 && overallPick <= 84) {
    return overallPick % 3 === 0 ? 'TE' : 'QB';
  }
  if (overallPick >= 121 && overallPick <= 132) {
    return 'DEF';
  }
  return null;
}

function createStages(
  keeperSelections: readonly SleeperDraftPickLike[],
  liveSelections: readonly SleeperDraftPickLike[],
  userFranchiseId: FranchiseId,
  pickInventory: readonly DraftPickAsset[],
): MockDraftStage[] {
  const userLiveOverallPick = liveSelections.find((selection) =>
    pickInventory.some(
      (pick) =>
        pick.overallPick === selection.pickNo && pick.currentFranchiseId === userFranchiseId,
    ),
  )?.pickNo;
  const beforeUserPickCount =
    userLiveOverallPick === undefined
      ? 0
      : liveSelections.filter((selection) => selection.pickNo < userLiveOverallPick).length;
  const checkpoints = [
    { label: 'Keepers locked before the room opens', livePickCount: 0 },
    { label: 'Opening run after six live selections', livePickCount: 6 },
    { label: 'Board just before your first live pick', livePickCount: beforeUserPickCount },
    { label: 'Your first live pick has posted', livePickCount: beforeUserPickCount + 1 },
    {
      label: 'After round three settles',
      livePickCount: liveSelections.filter((pick) => pick.pickNo <= 36).length,
    },
    { label: 'Middle rounds with position runs visible', livePickCount: 72 },
    { label: 'Late draft bench churn', livePickCount: 120 },
  ];
  const seenCounts = new Set<number>();

  return checkpoints.flatMap((checkpoint) => {
    const livePickCount = Math.min(Math.max(0, checkpoint.livePickCount), liveSelections.length);
    if (seenCounts.has(livePickCount)) {
      return [];
    }
    seenCounts.add(livePickCount);
    return [
      {
        label: checkpoint.label,
        picks: [...keeperSelections, ...liveSelections.slice(0, livePickCount)].sort(
          (left, right) => left.pickNo - right.pickNo,
        ),
      },
    ];
  });
}

function createKeeperResolutionRows(
  franchises: readonly Franchise[],
  keeperRights: readonly KeeperRight[],
  pickInventory: readonly DraftPickAsset[],
  players: readonly Player[],
): MockKeeperResolutionRow[] {
  const playerById = new Map(players.map((player) => [String(player.id), player]));

  return franchises.flatMap((franchise) => {
    const rights = keeperRights.filter((right) => right.franchiseId === franchise.id);
    const resolution = resolveKeeperCombination(rights, [...pickInventory], {
      franchiseId: franchise.id,
      maxKeepers: 3,
    });
    if (!resolution.legal) {
      throw new Error(
        `Mock keeper setup for ${franchise.displayName} is illegal: ${resolution.invalidReason}`,
      );
    }

    return resolution.resolvedPicks.map((pick) => {
      const right = rights.find((candidate) => candidate.id === pick.keeperRightId)!;
      return {
        franchiseName: franchise.displayName,
        playerName: playerById.get(String(right.playerId))?.fullName ?? String(right.playerId),
        priorRound: right.priorSeasonRound,
        nominalRound: right.nominalRound,
        resolvedOverallPick: pick.resolvedOverallPick,
        resolvedRound: pick.resolvedRound,
      };
    });
  });
}

function projectPlayer(player: Player): number {
  const position = player.position;
  const index = Number.parseInt(String(player.id).split('-').at(-1) ?? '1', 10);
  const config = POSITION_POOLS[position];
  const wave = ((index * 7) % 9) - 4;
  return Math.max(
    config.floor,
    Math.round((config.high - (index - 1) * config.step + wave) * 10) / 10,
  );
}

function playerName(position: Position, index: number, positionIndex: number): string {
  if (position === 'DEF') {
    return `Mock ${LAST_NAMES[index % LAST_NAMES.length]} Defense`;
  }

  const firstName = FIRST_NAMES[(index + positionIndex * 5) % FIRST_NAMES.length]!;
  const lastName = LAST_NAMES[(index * 7 + positionIndex * 3) % LAST_NAMES.length]!;
  return `${firstName} ${lastName}`;
}

function playerId(position: Position, index: number): string {
  return `mock-${position.toLowerCase()}-${String(index).padStart(2, '0')}`;
}

function sleeperPlayerId(position: Position, index: number): string {
  return `sleeper-${playerId(position, index)}`;
}

function sleeperPlayerIdFromPlayerId(id: string): string {
  return `sleeper-${id}`;
}

function franchiseId(index: number): FranchiseId {
  return `mock-franchise-${String(index + 1).padStart(2, '0')}` as FranchiseId;
}

function assertUniqueKeeperPlayers(): void {
  const seen = new Set<string>();
  for (const spec of KEEPER_SPECS) {
    if (seen.has(spec.playerId)) {
      throw new Error(`Mock keeper setup duplicates player ${spec.playerId}.`);
    }
    seen.add(spec.playerId);
  }
}
