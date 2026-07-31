import type {
  Draft,
  DraftId,
  DraftPickAsset,
  DraftPickAssetId,
  Franchise,
  FranchiseId,
  KeeperRight,
  KeeperRightId,
  League,
  LeagueId,
  LeagueStateSnapshot,
  Player,
  PlayerId,
  PlayerSeason,
  Roster,
  Season,
  SeasonId,
} from '@keeper/domain';

const TEAM_COUNT = 12;
const DRAFT_ROUNDS = 15;

function overallPick(round: number, slot: number, teamCount: number): number {
  const isOddRound = round % 2 === 1;
  const positionInRound = isOddRound ? slot : teamCount + 1 - slot;
  return (round - 1) * teamCount + positionInRound;
}

export const leagueId = 'league-synthetic' as LeagueId;
export const seasonId = 'season-synthetic-2026' as SeasonId;
export const draftId = 'draft-synthetic-2026' as DraftId;

export const franchises: Franchise[] = Array.from({ length: TEAM_COUNT }, (_, i) => ({
  id: `franchise-${String(i + 1).padStart(2, '0')}` as FranchiseId,
  leagueId,
  displayName: `Team ${i + 1}`,
}));

export const userFranchiseId = franchises[0]!.id;

export const league: League = {
  id: leagueId,
  name: 'Synthetic Keeper League',
  rulesVersion: '2026.1',
  rules: {
    teamCount: TEAM_COUNT,
    draftRounds: DRAFT_ROUNDS,
    thirdRoundReversal: false,
    maxKeepers: 3,
    keeperDurationIndefinite: true,
    keeperCostAdvancePerSeason: 1,
    undraftedKeeperRound: 10,
    keeperRightsTradeable: false,
    tradesProcessImmediately: true,
    keeperDeadlineDaysBeforeDraft: 7,
    keeperDeclarationsPublicPreDraft: true,
    draftOrderMethod: 'dynamic',
    toiletBowlAwardPick: { round: 1, slot: 1 },
    futurePicksTradeable: true,
  },
  scoring: {
    passingYardsPerPoint: 25,
    passingTouchdownPoints: 6,
    interceptionPoints: -2,
    rushingReceivingYardsPerPoint: 10,
    rushingReceivingTouchdownPoints: 6,
    receptionPointsByPosition: { rb: 0.5, wr: 0.5, te: 1.0 },
    returnYardsCounted: true,
    defenseScoringRules: {},
  },
  lineup: {
    qb: 1,
    rb: 2,
    wr: 2,
    te: 1,
    flex: 2,
    def: 1,
    bench: 6,
    ir: 2,
  },
};

export const season: Season = {
  id: seasonId,
  leagueId,
  year: 2026,
  sleeperLeagueId: 'sleeper-league-synthetic-2026',
  previousSleeperLeagueId: null,
  status: 'pre_draft',
  draftId,
  keeperDeadline: '2026-08-23T00:00:00.000Z',
  draftTime: '2026-08-30T00:00:00.000Z',
};

export const draft: Draft = {
  id: draftId,
  seasonId,
  sleeperDraftId: 'sleeper-draft-synthetic-2026',
  rounds: DRAFT_ROUNDS,
  teamCount: TEAM_COUNT,
  orderMethod: 'snake',
  thirdRoundReversal: false,
  status: 'pre_draft',
};

export const draftPickAssets: DraftPickAsset[] = franchises.flatMap((franchise, index) => {
  const slot = index + 1;
  return Array.from({ length: DRAFT_ROUNDS }, (_, roundIndex) => {
    const round = roundIndex + 1;
    const asset: DraftPickAsset = {
      id: `pick-${season.year}-r${round}-${franchise.id}` as DraftPickAssetId,
      seasonId,
      round,
      originalFranchiseId: franchise.id,
      currentFranchiseId: franchise.id,
      slot,
      overallPick: overallPick(round, slot, TEAM_COUNT),
      ownershipConfidence: 'confirmed',
    };
    return asset;
  });
});

export const players: Player[] = [
  { id: 'player-a' as PlayerId, fullName: 'Player A', position: 'QB', sleeperPlayerId: null },
  { id: 'player-b' as PlayerId, fullName: 'Player B', position: 'WR', sleeperPlayerId: null },
  { id: 'player-c' as PlayerId, fullName: 'Player C', position: 'TE', sleeperPlayerId: null },
];

export const playerSeasons: PlayerSeason[] = [
  {
    playerId: 'player-a' as PlayerId,
    seasonId,
    nflTeam: 'SYN',
    age: 26,
    role: 'starter',
    injuryStatus: null,
    projectedPoints: 320,
    actualPoints: null,
  },
  {
    playerId: 'player-b' as PlayerId,
    seasonId,
    nflTeam: 'SYN',
    age: 24,
    role: 'starter',
    injuryStatus: null,
    projectedPoints: 210,
    actualPoints: null,
  },
  {
    playerId: 'player-c' as PlayerId,
    seasonId,
    nflTeam: 'SYN',
    age: 27,
    role: 'starter',
    injuryStatus: null,
    projectedPoints: 150,
    actualPoints: null,
  },
];

export const keeperRights: KeeperRight[] = [
  {
    id: 'keeper-right-a' as KeeperRightId,
    seasonId,
    playerId: 'player-a' as PlayerId,
    franchiseId: userFranchiseId,
    sourceType: 'kept',
    nominalRound: 4,
    effectiveOverallPick: null,
    confidence: 'confirmed',
    manualOverrideReason: null,
  },
  {
    id: 'keeper-right-b' as KeeperRightId,
    seasonId,
    playerId: 'player-b' as PlayerId,
    franchiseId: userFranchiseId,
    sourceType: 'undrafted_free_agent',
    nominalRound: 10,
    effectiveOverallPick: null,
    confidence: 'confirmed',
    manualOverrideReason: null,
  },
  {
    id: 'keeper-right-c' as KeeperRightId,
    seasonId,
    playerId: 'player-c' as PlayerId,
    franchiseId: franchises[1]!.id,
    sourceType: 'drafted',
    nominalRound: 7,
    effectiveOverallPick: null,
    confidence: 'confirmed',
    manualOverrideReason: null,
  },
];

export const rosters: Roster[] = franchises.map((franchise) => ({
  seasonId,
  franchiseId: franchise.id,
  playerIds: keeperRights
    .filter((right) => right.franchiseId === franchise.id)
    .map((right) => right.playerId),
  reservePlayerIds: [],
  wins: 0,
  losses: 0,
  ties: 0,
  playoffResult: 'none',
}));

export function createSyntheticLeagueSnapshot(): LeagueStateSnapshot {
  return {
    league,
    season,
    franchises,
    rosters,
    keeperRights,
    pickInventory: draftPickAssets,
    draft,
    draftSelections: [],
    playerSeasons,
    userFranchiseId,
    evaluatedAt: '2026-07-30T00:00:00.000Z',
    assumptions: {},
  };
}
