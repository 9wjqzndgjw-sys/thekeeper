import { calculateOverallPick } from '@keeper/domain';
import type {
  DraftPickAsset,
  DraftPickAssetId,
  Franchise,
  FranchiseId,
  KeeperRight,
  KeeperRightId,
  LeagueId,
  Player,
  PlayerId,
  PlayerSeason,
  SeasonId,
} from '@keeper/domain';

/**
 * A four-team league where one roster holds six keep-worthy players against a three-keeper
 * limit, and two rivals hold almost nobody. That asymmetry is what makes a pre-deadline
 * market exist at all: the crowded roster must strand value it cannot use, and the empty
 * rosters have slots that value is worth more in.
 */
export const surplusLeagueId = 'league-surplus' as LeagueId;
export const surplusSeasonId = 'season-surplus-2026' as SeasonId;

const TEAM_COUNT = 4;
const DRAFT_ROUNDS = 6;
const SNAKE_CONFIG = {
  orderMethod: 'snake',
  teamCount: TEAM_COUNT,
  rounds: DRAFT_ROUNDS,
  thirdRoundReversal: false,
} as const;

export const surplusFranchises: Franchise[] = [
  { id: 'franchise-hoarder' as FranchiseId, leagueId: surplusLeagueId, displayName: 'The Hoarder' },
  { id: 'franchise-empty-a' as FranchiseId, leagueId: surplusLeagueId, displayName: 'Rebuild A' },
  { id: 'franchise-empty-b' as FranchiseId, leagueId: surplusLeagueId, displayName: 'Rebuild B' },
  { id: 'franchise-balanced' as FranchiseId, leagueId: surplusLeagueId, displayName: 'Balanced' },
];

export const hoarderFranchiseId = surplusFranchises[0]!.id;
export const rebuildAFranchiseId = surplusFranchises[1]!.id;
export const rebuildBFranchiseId = surplusFranchises[2]!.id;
export const balancedFranchiseId = surplusFranchises[3]!.id;

export const surplusPickInventory: DraftPickAsset[] = surplusFranchises.flatMap(
  (franchise, index) => {
    const slot = index + 1;
    return Array.from({ length: DRAFT_ROUNDS }, (_, roundIndex) => {
      const round = roundIndex + 1;
      return {
        id: `surplus-pick-${round}-${slot}` as DraftPickAssetId,
        seasonId: surplusSeasonId,
        round,
        originalFranchiseId: franchise.id,
        currentFranchiseId: franchise.id,
        slot,
        overallPick: calculateOverallPick(SNAKE_CONFIG, round, slot),
        ownershipConfidence: 'confirmed' as const,
      };
    });
  },
);

interface SurplusPlayerSpec {
  id: string;
  fullName: string;
  position: Player['position'];
  projectedPoints: number;
  nominalRound: number;
  franchiseId: FranchiseId;
}

// The hoarder's six are all cheap relative to their production, so every one of them is
// keep-worthy on its own and only three can actually be kept.
const specs: SurplusPlayerSpec[] = [
  elite('hoarder-1', 'Cornerstone QB', 'QB', 420, 6, hoarderFranchiseId),
  elite('hoarder-2', 'Cornerstone RB', 'RB', 330, 6, hoarderFranchiseId),
  elite('hoarder-3', 'Cornerstone WR', 'WR', 320, 5, hoarderFranchiseId),
  elite('hoarder-4', 'Surplus TE', 'TE', 300, 5, hoarderFranchiseId),
  elite('hoarder-5', 'Surplus WR', 'WR', 290, 4, hoarderFranchiseId),
  elite('hoarder-6', 'Surplus RB', 'RB', 280, 4, hoarderFranchiseId),
  elite('balanced-1', 'Balanced QB', 'QB', 300, 5, balancedFranchiseId),
  elite('balanced-2', 'Balanced RB', 'RB', 260, 4, balancedFranchiseId),
  elite('rebuild-a-1', 'Lone Keeper', 'WR', 250, 4, rebuildAFranchiseId),
];

// Freely available depth, so replacement level is a real number rather than zero.
const depthSpecs: SurplusPlayerSpec[] = Array.from({ length: 12 }, (_, index) =>
  elite(
    `depth-${index + 1}`,
    `Depth ${index + 1}`,
    (['QB', 'RB', 'WR', 'TE'] as const)[index % 4]!,
    200 - index * 5,
    6,
    hoarderFranchiseId,
  ),
);

export const surplusPlayers: Player[] = [...specs, ...depthSpecs].map((spec) => ({
  id: spec.id as PlayerId,
  fullName: spec.fullName,
  position: spec.position,
  sleeperPlayerId: null,
}));

export const surplusPlayerSeasons: PlayerSeason[] = [...specs, ...depthSpecs].map((spec) => ({
  playerId: spec.id as PlayerId,
  seasonId: surplusSeasonId,
  nflTeam: 'SYN',
  age: 26,
  role: 'starter',
  injuryStatus: null,
  projectedPoints: spec.projectedPoints,
  actualPoints: null,
}));

export const surplusKeeperRights: KeeperRight[] = specs.map((spec) => ({
  id: `surplus-keeper-${spec.id}` as KeeperRightId,
  seasonId: surplusSeasonId,
  playerId: spec.id as PlayerId,
  franchiseId: spec.franchiseId,
  sourceType: 'kept',
  nominalRound: spec.nominalRound,
  effectiveOverallPick: null,
  confidence: 'confirmed',
  manualOverrideReason: null,
}));

export function createSurplusMarketScenario(): {
  franchises: Franchise[];
  keeperRights: KeeperRight[];
  pickInventory: DraftPickAsset[];
  players: Player[];
  playerSeasons: PlayerSeason[];
  seasonId: SeasonId;
  keeperLimit: number;
} {
  return {
    franchises: surplusFranchises,
    keeperRights: surplusKeeperRights,
    pickInventory: surplusPickInventory,
    players: surplusPlayers,
    playerSeasons: surplusPlayerSeasons,
    seasonId: surplusSeasonId,
    keeperLimit: 3,
  };
}

function elite(
  id: string,
  fullName: string,
  position: Player['position'],
  projectedPoints: number,
  nominalRound: number,
  franchiseId: FranchiseId,
): SurplusPlayerSpec {
  return { id, fullName, position, projectedPoints, nominalRound, franchiseId };
}
