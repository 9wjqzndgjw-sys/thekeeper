import type { LineupSettings } from '@keeper/domain';
import type { SleeperScoringSettings } from '@keeper/valuation';

/**
 * Captured from GET /league/1312062245152256000 on 2026-08-02.
 *
 * Checked in so the board can be produced offline. It should be replaced by a live
 * `importSeasonDraftState` call once the import is wired; until then, treat this as a
 * snapshot that can drift from the league.
 */
export const SLEEPER_LEAGUE_ID = '1312062245152256000';

export const LEAGUE_SCORING: SleeperScoringSettings = {
  pass_yd: 0.04,
  pass_td: 6,
  pass_int: -2,
  pass_2pt: 2,
  rush_yd: 0.1,
  rush_td: 6,
  rush_2pt: 2,
  rec: 0.5,
  bonus_rec_te: 0.5,
  rec_yd: 0.1,
  rec_td: 6,
  rec_2pt: 2,
  fum: -1,
  fum_lost: -1,
  fum_rec: 1,
  fum_rec_td: 6,
  kr_yd: 0.04,
  pr_yd: 0.1,
  sack: 1,
  int: 2,
  ff: 1,
  safe: 2,
  blk_kick: 3,
  def_td: 6,
  st_td: 6,
  def_st_td: 6,
  st_ff: 1,
  st_fum_rec: 1,
  def_st_ff: 1,
  def_st_fum_rec: 1,
  def_2pt: 2,
  def_4_and_stop: 1,
  pts_allow_0: 7,
  yds_allow_0_100: 10,
  yds_allow_100_199: 8,
  yds_allow_200_299: 6,
  yds_allow_300_349: 3,
  yds_allow_350_399: 0,
  yds_allow_400_449: -2,
  yds_allow_450_499: -3,
  yds_allow_500_549: -5,
  yds_allow_550p: -7,
};

/** roster_positions: QB, RB, RB, WR, WR, TE, FLEX, FLEX, DEF, plus six bench and two IR. */
export const LEAGUE_LINEUP: LineupSettings = {
  qb: 1,
  rb: 2,
  wr: 2,
  te: 1,
  flex: 2,
  def: 1,
  bench: 6,
  ir: 2,
};

export const LEAGUE_TEAM_COUNT = 12;
export const LEAGUE_DRAFT_ROUNDS = 15;
