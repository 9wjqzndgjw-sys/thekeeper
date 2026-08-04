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
  /**
   * Where the market takes this player, from the projection source.
   *
   * Null where the source gave none -- defences carry no ADP, and neither does anyone the
   * source did not rank. Absent is reported as absent, because a guessed draft position
   * reads exactly like a measured one.
   */
  averageDraftPosition: number | null;
}
