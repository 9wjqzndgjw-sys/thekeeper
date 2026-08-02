import type { Position } from '@keeper/domain';

/**
 * Sleeper's raw scoring settings, keyed exactly as the API returns them (`pass_yd`,
 * `bonus_rec_te`, ...). Kept in the source shape rather than remapped: the payload holds
 * roughly fifty keys including full defensive ladders, and any hand-written subset would
 * silently drop whatever it failed to anticipate.
 */
export type SleeperScoringSettings = Readonly<Record<string, number>>;

export interface StatLine {
  passYards?: number;
  passTouchdowns?: number;
  interceptions?: number;
  rushYards?: number;
  rushTouchdowns?: number;
  receptions?: number;
  receivingYards?: number;
  receivingTouchdowns?: number;
  fumblesLost?: number;
  kickReturnYards?: number;
  puntReturnYards?: number;
  sacks?: number;
  defenseInterceptions?: number;
  fumbleRecoveries?: number;
  defenseTouchdowns?: number;
  specialTeamsTouchdowns?: number;
  safeties?: number;
  forcedFumbles?: number;
  blockedKicks?: number;
}

const STAT_TO_SCORING_KEY: Readonly<Record<keyof StatLine, string>> = {
  passYards: 'pass_yd',
  passTouchdowns: 'pass_td',
  interceptions: 'pass_int',
  rushYards: 'rush_yd',
  rushTouchdowns: 'rush_td',
  receptions: 'rec',
  receivingYards: 'rec_yd',
  receivingTouchdowns: 'rec_td',
  fumblesLost: 'fum_lost',
  kickReturnYards: 'kr_yd',
  puntReturnYards: 'pr_yd',
  sacks: 'sack',
  defenseInterceptions: 'int',
  fumbleRecoveries: 'fum_rec',
  defenseTouchdowns: 'def_td',
  specialTeamsTouchdowns: 'st_td',
  safeties: 'safe',
  forcedFumbles: 'ff',
  blockedKicks: 'blk_kick',
};

/** Per-reception bonuses layered on top of `rec`, which is how Sleeper expresses TE premium. */
const RECEPTION_BONUS_KEY_BY_POSITION: Partial<Record<Position, string>> = {
  RB: 'bonus_rec_rb',
  WR: 'bonus_rec_wr',
  TE: 'bonus_rec_te',
};

export interface ScoreStatLineResult {
  points: number;
  /** Points contributed per scoring key, so any total can be traced back to its parts. */
  breakdown: Record<string, number>;
  /** Scoring keys that had a non-zero rate but no stat to apply it to. */
  unusedScoringKeys: string[];
}

/**
 * Converts a projected stat line into points under a league's own scoring.
 *
 * A reception bonus is added to the base `rec` rate rather than replacing it, because
 * that is what Sleeper means by `bonus_rec_te`: a tight end in a league with
 * `rec: 0.5, bonus_rec_te: 0.5` scores a full point per catch while everyone else scores
 * half. Getting that backwards is the single easiest way to misprice a position.
 *
 * `unusedScoringKeys` reports every rule the league scores but this stat line cannot
 * feed, so a projection source missing (say) the yards-allowed ladder shows up as a
 * stated gap instead of a quietly low total.
 */
export function scoreStatLine(
  stats: StatLine,
  scoring: SleeperScoringSettings,
  position: Position,
): ScoreStatLineResult {
  const breakdown: Record<string, number> = {};
  const appliedKeys = new Set<string>();

  for (const [statField, scoringKey] of Object.entries(STAT_TO_SCORING_KEY) as [
    keyof StatLine,
    string,
  ][]) {
    const amount = stats[statField];
    if (amount === undefined || amount === 0) {
      continue;
    }
    const rate = scoring[scoringKey];
    if (rate === undefined) {
      continue;
    }
    breakdown[scoringKey] = (breakdown[scoringKey] ?? 0) + amount * rate;
    appliedKeys.add(scoringKey);
  }

  const bonusKey = RECEPTION_BONUS_KEY_BY_POSITION[position];
  const bonusRate = bonusKey === undefined ? undefined : scoring[bonusKey];
  if (bonusKey !== undefined && bonusRate !== undefined && stats.receptions) {
    breakdown[bonusKey] = stats.receptions * bonusRate;
    appliedKeys.add(bonusKey);
  }

  return {
    points: Object.values(breakdown).reduce((total, value) => total + value, 0),
    breakdown,
    unusedScoringKeys: Object.entries(scoring)
      .filter(([key, rate]) => rate !== 0 && !appliedKeys.has(key))
      .map(([key]) => key)
      .sort(),
  };
}

/**
 * Scoring rules this engine can never apply, whatever the projection source, because they
 * depend on weekly game state rather than season totals. Reported so a league whose
 * scoring leans on them knows the totals are structurally incomplete.
 */
export const GAME_STATE_SCORING_PREFIXES = ['pts_allow', 'yds_allow'] as const;

export function describeUnscorableRules(scoring: SleeperScoringSettings): string[] {
  return Object.entries(scoring)
    .filter(
      ([key, rate]) =>
        rate !== 0 && GAME_STATE_SCORING_PREFIXES.some((prefix) => key.startsWith(prefix)),
    )
    .map(([key]) => key)
    .sort();
}
