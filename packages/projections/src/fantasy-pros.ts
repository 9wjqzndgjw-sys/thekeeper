import type { Player, PlayerId, PlayerSeason, Position, SeasonId } from '@keeper/domain';
import {
  describeUnscorableRules,
  scoreStatLine,
  type SleeperScoringSettings,
  type StatLine,
} from '@keeper/valuation';
import { parseCsv, parseNumericCell } from './csv.js';

export type ProjectionDiagnosticCode =
  | 'unknown_position'
  | 'duplicate_player'
  | 'unscorable_league_rules'
  | 'missing_stat_columns'
  | 'unexpected_header';

export interface ProjectionDiagnostic {
  level: 'warning' | 'error';
  code: ProjectionDiagnosticCode;
  message: string;
  playerName?: string;
}

export interface LoadedProjections {
  players: Player[];
  playerSeasons: PlayerSeason[];
  /** ADP by player id, for building the pick-value curve. Absent where the source had none. */
  averageDraftPositionByPlayerId: Map<PlayerId, number>;
  diagnostics: ProjectionDiagnostic[];
  /** League scoring rules no season-total projection can supply, stated rather than hidden. */
  unscorableLeagueRules: string[];
}

export interface LoadProjectionsInput {
  /** Skill-position export: RK, Name, POS, Team, Bye, POS, ADP, FPTS, G, FPTS/G, TIER, then stats. */
  skillPositionCsv: string;
  /** Defense export: same prefix, then SACK, INT, FR, DTD, STD. */
  defenseCsv?: string;
  scoring: SleeperScoringSettings;
  seasonId: SeasonId;
}

const SKILL_COLUMNS = {
  name: 1,
  position: 2,
  team: 3,
  adp: 6,
  passYards: 13,
  passTouchdowns: 14,
  interceptions: 15,
  rushYards: 17,
  rushTouchdowns: 18,
  receptions: 20,
  receivingYards: 21,
  receivingTouchdowns: 22,
} as const;

const DEFENSE_COLUMNS = {
  name: 1,
  team: 3,
  sacks: 11,
  defenseInterceptions: 12,
  fumbleRecoveries: 13,
  defenseTouchdowns: 14,
  specialTeamsTouchdowns: 15,
} as const;

const SUPPORTED_POSITIONS = new Set<Position>(['QB', 'RB', 'WR', 'TE', 'DEF']);

/**
 * Loads exported projections and rescores every player under the league's own rules.
 *
 * The source's own FPTS column is deliberately ignored. It is computed for whatever
 * scoring that source publishes, which for this league differs enough to reorder the
 * board: six-point passing touchdowns and a half-PPR base move quarterbacks up and
 * receivers down by tens of points. Only the component stats are read.
 */
export function loadProjections(input: LoadProjectionsInput): LoadedProjections {
  const diagnostics: ProjectionDiagnostic[] = [];
  const players: Player[] = [];
  const playerSeasons: PlayerSeason[] = [];
  const averageDraftPositionByPlayerId = new Map<PlayerId, number>();
  const seenPlayerIds = new Set<string>();

  const record = (
    name: string,
    position: Position,
    team: string,
    stats: StatLine,
    adp: number | null,
  ): void => {
    const playerId = toPlayerId(name, position);
    if (seenPlayerIds.has(playerId)) {
      diagnostics.push({
        level: 'warning',
        code: 'duplicate_player',
        playerName: name,
        message: `${name} (${position}) appears more than once; the first row was kept.`,
      });
      return;
    }
    seenPlayerIds.add(playerId);

    const scored = scoreStatLine(stats, input.scoring, position);
    // NFL team belongs to the season record, not the stable player identity.
    players.push({
      id: playerId as PlayerId,
      fullName: name,
      position,
      sleeperPlayerId: null,
    });
    playerSeasons.push({
      playerId: playerId as PlayerId,
      seasonId: input.seasonId,
      nflTeam: team,
      age: null,
      role: null,
      injuryStatus: null,
      projectedPoints: scored.points,
      actualPoints: null,
    });
    if (adp !== null) {
      averageDraftPositionByPlayerId.set(playerId as PlayerId, adp);
    }
  };

  for (const row of dataRows(parseCsv(input.skillPositionCsv))) {
    const name = row[SKILL_COLUMNS.name]?.trim();
    const rawPosition = row[SKILL_COLUMNS.position]?.trim().toUpperCase();
    if (!name || !rawPosition) {
      continue;
    }
    const position = normalizePosition(rawPosition);
    if (position === null) {
      diagnostics.push({
        level: 'warning',
        code: 'unknown_position',
        playerName: name,
        message: `${name} has unsupported position '${rawPosition}' and was skipped.`,
      });
      continue;
    }

    const adp = parseNumericCell(row[SKILL_COLUMNS.adp]);
    record(
      name,
      position,
      row[SKILL_COLUMNS.team]?.trim() ?? '',
      {
        passYards: parseNumericCell(row[SKILL_COLUMNS.passYards]),
        passTouchdowns: parseNumericCell(row[SKILL_COLUMNS.passTouchdowns]),
        interceptions: parseNumericCell(row[SKILL_COLUMNS.interceptions]),
        rushYards: parseNumericCell(row[SKILL_COLUMNS.rushYards]),
        rushTouchdowns: parseNumericCell(row[SKILL_COLUMNS.rushTouchdowns]),
        receptions: parseNumericCell(row[SKILL_COLUMNS.receptions]),
        receivingYards: parseNumericCell(row[SKILL_COLUMNS.receivingYards]),
        receivingTouchdowns: parseNumericCell(row[SKILL_COLUMNS.receivingTouchdowns]),
      },
      adp > 0 ? adp : null,
    );
  }

  if (input.defenseCsv !== undefined) {
    for (const row of dataRows(parseCsv(input.defenseCsv))) {
      const name = row[DEFENSE_COLUMNS.name]?.trim();
      if (!name) {
        continue;
      }
      record(
        name,
        'DEF',
        row[DEFENSE_COLUMNS.team]?.trim() ?? '',
        {
          sacks: parseNumericCell(row[DEFENSE_COLUMNS.sacks]),
          defenseInterceptions: parseNumericCell(row[DEFENSE_COLUMNS.defenseInterceptions]),
          fumbleRecoveries: parseNumericCell(row[DEFENSE_COLUMNS.fumbleRecoveries]),
          defenseTouchdowns: parseNumericCell(row[DEFENSE_COLUMNS.defenseTouchdowns]),
          specialTeamsTouchdowns: parseNumericCell(row[DEFENSE_COLUMNS.specialTeamsTouchdowns]),
        },
        null,
      );
    }
  }

  const unscorableLeagueRules = describeUnscorableRules(input.scoring);
  if (unscorableLeagueRules.length > 0) {
    diagnostics.push({
      level: 'warning',
      code: 'unscorable_league_rules',
      message: `This league scores ${unscorableLeagueRules.length} rule(s) that depend on weekly game state and cannot come from season totals (${unscorableLeagueRules.join(', ')}). Defence totals in particular are understated, so treat their ordering as a takeaway-weighted proxy.`,
    });
  }

  return {
    players,
    playerSeasons,
    averageDraftPositionByPlayerId,
    diagnostics,
    unscorableLeagueRules,
  };
}

/** Drops the header row, identified by its literal first cell rather than by position. */
function dataRows(rows: readonly string[][]): string[][] {
  const [header, ...rest] = rows;
  if (header === undefined) {
    return [];
  }
  return header[0]?.trim().toUpperCase() === 'RK' ? rest : [...rows];
}

function normalizePosition(raw: string): Position | null {
  const position = raw === 'DST' || raw === 'D/ST' ? 'DEF' : raw;
  return SUPPORTED_POSITIONS.has(position as Position) ? (position as Position) : null;
}

/**
 * Stable id from name and position. Sleeper ids are not in these exports, so matching to
 * a roster happens later by name; keeping the id derived means re-importing the same file
 * produces the same ids.
 */
function toPlayerId(name: string, position: Position): string {
  const slug = name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    // Punctuation inside a name is dropped rather than split on, so Ja'Marr and D.J.
    // slug to jamarr and dj. Splitting would produce ja-marr, which then fails to match
    // the same player from any other source.
    .replace(/['’.]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  return `proj:${position}:${slug}`;
}
