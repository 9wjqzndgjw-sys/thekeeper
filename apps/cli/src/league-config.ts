import { readFileSync } from 'node:fs';
import { dirname, join, parse } from 'node:path';
import type { LineupSettings } from '@keeper/domain';
import type { SleeperScoringSettings } from '@keeper/valuation';

/**
 * Reads `.env.local` into `process.env` without taking a dependency. A value already set
 * in the environment always wins, so an explicit shell variable is never overwritten.
 *
 * Searches upward from the working directory, because `npm run -w <workspace>` runs with
 * the cwd set to that workspace while the file lives at the repository root.
 */
function loadLocalEnv(): void {
  let contents: string;
  let directory = process.cwd();
  const { root } = parse(directory);

  for (;;) {
    try {
      contents = readFileSync(join(directory, '.env.local'), 'utf8');
      break;
    } catch {
      if (directory === root) {
        return;
      }
      directory = dirname(directory);
    }
  }

  for (const rawLine of contents.split('\n')) {
    const line = rawLine.trim();
    if (line.length === 0 || line.startsWith('#')) {
      continue;
    }

    const separator = line.indexOf('=');
    if (separator === -1) {
      continue;
    }

    const key = line.slice(0, separator).trim();
    const value = line
      .slice(separator + 1)
      .trim()
      .replace(/^['"]|['"]$/g, '');
    if (key.length > 0 && process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

/**
 * Which league to read. Kept out of the tree because this repository is public and a
 * league id identifies a real group of people, even though it is not itself a secret.
 *
 * Set `SLEEPER_LEAGUE_ID` in `.env.local`, or pass an id as the first argument to any
 * command that accepts one.
 */
export function resolveSleeperLeagueId(explicitLeagueId?: string): string {
  loadLocalEnv();

  const leagueId = explicitLeagueId ?? process.env.SLEEPER_LEAGUE_ID;
  if (!leagueId) {
    throw new Error(
      'No league id. Set SLEEPER_LEAGUE_ID in .env.local, or pass one as the first argument.',
    );
  }
  if (!/^[0-9]+$/.test(leagueId)) {
    throw new Error(`Sleeper league ids are numeric; received '${leagueId}'.`);
  }
  return leagueId;
}

/**
 * League settings captured from the Sleeper API. Checked in so a board can be produced
 * offline; replace with a live `importSeasonDraftState` call once the import is wired,
 * and until then treat this as a snapshot that can drift.
 */
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
