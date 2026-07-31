import type { FranchiseId, LeagueId, PlayerId, SeasonId } from './ids.js';

export interface Franchise {
  id: FranchiseId;
  leagueId: LeagueId;
  displayName: string;
}

export type PlayoffResult =
  'champion' | 'runner_up' | 'toilet_bowl_winner' | 'toilet_bowl_loser' | 'eliminated' | 'none';

export interface Roster {
  seasonId: SeasonId;
  franchiseId: FranchiseId;
  playerIds: PlayerId[];
  reservePlayerIds: PlayerId[];
  wins: number;
  losses: number;
  ties: number;
  playoffResult: PlayoffResult;
}
