import type { LeagueId } from './ids.js';

export interface DraftSlotReference {
  round: number;
  slot: number;
}

export interface LeagueRules {
  teamCount: number;
  draftRounds: number;
  thirdRoundReversal: boolean;
  maxKeepers: number;
  keeperDurationIndefinite: boolean;
  keeperCostAdvancePerSeason: number;
  undraftedKeeperRound: number;
  keeperRightsTradeable: boolean;
  tradesProcessImmediately: boolean;
  keeperDeadlineDaysBeforeDraft: number;
  keeperDeclarationsPublicPreDraft: boolean;
  draftOrderMethod: 'dynamic' | 'standings' | 'manual';
  toiletBowlAwardPick: DraftSlotReference;
  futurePicksTradeable: boolean;
}

export interface ScoringSettings {
  passingYardsPerPoint: number;
  passingTouchdownPoints: number;
  interceptionPoints: number;
  rushingReceivingYardsPerPoint: number;
  rushingReceivingTouchdownPoints: number;
  receptionPointsByPosition: {
    rb: number;
    wr: number;
    te: number;
  };
  returnYardsCounted: boolean;
  defenseScoringRules: Record<string, number>;
}

export type RosterSlot = 'QB' | 'RB' | 'WR' | 'TE' | 'FLEX' | 'DEF' | 'BENCH' | 'IR';

export interface LineupSettings {
  qb: number;
  rb: number;
  wr: number;
  te: number;
  flex: number;
  def: number;
  bench: number;
  ir: number;
}

export interface League {
  id: LeagueId;
  name: string;
  rules: LeagueRules;
  scoring: ScoringSettings;
  lineup: LineupSettings;
  rulesVersion: string;
}
