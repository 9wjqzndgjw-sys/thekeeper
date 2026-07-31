import type { DraftId, LeagueId, SeasonId } from './ids.js';

export type SeasonStatus = 'pre_draft' | 'drafting' | 'in_season' | 'complete';

export interface Season {
  id: SeasonId;
  leagueId: LeagueId;
  year: number;
  sleeperLeagueId: string;
  previousSleeperLeagueId: string | null;
  status: SeasonStatus;
  draftId: DraftId | null;
  keeperDeadline: string;
  draftTime: string;
}
