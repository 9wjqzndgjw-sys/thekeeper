import type { PlayerId, SeasonId } from './ids.js';

export type Position = 'QB' | 'RB' | 'WR' | 'TE' | 'DEF';

export interface Player {
  id: PlayerId;
  fullName: string;
  position: Position;
  sleeperPlayerId: string | null;
}

export interface PlayerSeason {
  playerId: PlayerId;
  seasonId: SeasonId;
  nflTeam: string | null;
  age: number | null;
  role: string | null;
  injuryStatus: string | null;
  projectedPoints: number | null;
  actualPoints: number | null;
}
