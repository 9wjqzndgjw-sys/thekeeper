import type { Draft, DraftPickAsset, DraftSelection } from './draft.js';
import type { Franchise, Roster } from './franchise.js';
import type { FranchiseId } from './ids.js';
import type { KeeperRight } from './keeper.js';
import type { League } from './league.js';
import type { PlayerSeason } from './player.js';
import type { Season } from './season.js';

export interface LeagueStateSnapshot {
  league: League;
  season: Season;
  franchises: Franchise[];
  rosters: Roster[];
  keeperRights: KeeperRight[];
  pickInventory: DraftPickAsset[];
  draft: Draft | null;
  draftSelections: DraftSelection[];
  playerSeasons: PlayerSeason[];
  userFranchiseId: FranchiseId;
  evaluatedAt: string;
  assumptions: Record<string, unknown>;
}
