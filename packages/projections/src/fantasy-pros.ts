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

interface SkillColumns {
  name: number;
  position: number;
  team: number;
  adp: number;
  passYards: number;
  passTouchdowns: number;
  interceptions: number;
  rushYards: number;
  rushTouchdowns: number;
  receptions: number;
  receivingYards: number;
  receivingTouchdowns: number;
}

interface DefenseColumns {
  name: number;
  team: number;
  sacks: number;
  defenseInterceptions: number;
  fumbleRecoveries: number;
  defenseTouchdowns: number;
  specialTeamsTouchdowns: number;
}

/**
 * The passing block, which is what anchors every stat column in a skill export.
 *
 * Column names in these files are not unique -- ATT, YDS and TD each appear three times,
 * once per phase -- so a stat cannot be found by name alone. The passing group is the only
 * unambiguous sequence, and rushing and receiving follow it in a fixed order, so locating
 * it locates everything.
 */
const PASSING_SEQUENCE = ['ATT', 'CMP', 'YDS', 'TD', 'INT'] as const;
const RUSHING_SEQUENCE = ['ATT', 'YDS', 'TD'] as const;
const RECEIVING_SEQUENCE = ['TGT', 'REC', 'YDS', 'TD'] as const;

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

  const skillRows = parseCsv(input.skillPositionCsv);
  const skillColumns = resolveSkillColumns(skillRows[0] ?? [], diagnostics);

  // Nothing is read when the header could not be resolved: a diagnostic already says why,
  // and guessing at the layout is how wrong stats get reported as confident totals.
  for (const row of skillColumns === null ? [] : dataRows(skillRows)) {
    if (skillColumns === null) {
      continue;
    }
    const name = row[skillColumns.name]?.trim();
    const rawPosition = row[skillColumns.position]?.trim().toUpperCase();
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

    const adp = parseNumericCell(row[skillColumns.adp]);
    record(
      name,
      position,
      row[skillColumns.team]?.trim() ?? '',
      {
        passYards: parseNumericCell(row[skillColumns.passYards]),
        passTouchdowns: parseNumericCell(row[skillColumns.passTouchdowns]),
        interceptions: parseNumericCell(row[skillColumns.interceptions]),
        rushYards: parseNumericCell(row[skillColumns.rushYards]),
        rushTouchdowns: parseNumericCell(row[skillColumns.rushTouchdowns]),
        receptions: parseNumericCell(row[skillColumns.receptions]),
        receivingYards: parseNumericCell(row[skillColumns.receivingYards]),
        receivingTouchdowns: parseNumericCell(row[skillColumns.receivingTouchdowns]),
      },
      adp > 0 ? adp : null,
    );
  }

  if (input.defenseCsv !== undefined) {
    const defenseRows = parseCsv(input.defenseCsv);
    const defenseColumns = resolveDefenseColumns(defenseRows[0] ?? [], diagnostics);

    for (const row of defenseColumns === null ? [] : dataRows(defenseRows)) {
      if (defenseColumns === null) {
        continue;
      }
      const name = row[defenseColumns.name]?.trim();
      if (!name) {
        continue;
      }
      record(
        name,
        'DEF',
        row[defenseColumns.team]?.trim() ?? '',
        {
          sacks: parseNumericCell(row[defenseColumns.sacks]),
          defenseInterceptions: parseNumericCell(row[defenseColumns.defenseInterceptions]),
          fumbleRecoveries: parseNumericCell(row[defenseColumns.fumbleRecoveries]),
          defenseTouchdowns: parseNumericCell(row[defenseColumns.defenseTouchdowns]),
          specialTeamsTouchdowns: parseNumericCell(row[defenseColumns.specialTeamsTouchdowns]),
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

/** Case-insensitive header lookup. Returns -1 when the column is absent. */
function headerIndex(header: readonly string[], name: string): number {
  return header.findIndex((column) => column?.trim().toUpperCase() === name);
}

/** Where a run of consecutive column names begins, or -1. */
function sequenceIndex(header: readonly string[], sequence: readonly string[]): number {
  for (let start = 0; start + sequence.length <= header.length; start += 1) {
    if (sequence.every((name, offset) => header[start + offset]?.trim().toUpperCase() === name)) {
      return start;
    }
  }
  return -1;
}

function matchesAt(header: readonly string[], at: number, sequence: readonly string[]): boolean {
  return sequence.every((name, offset) => header[at + offset]?.trim().toUpperCase() === name);
}

/**
 * Resolves the skill export's columns from its header rather than trusting their positions.
 *
 * Fixed indices read the right cells only for the exact layout they were written against. A
 * source that adds a column, or an export taken with different options, shifts every stat by
 * one and the engine reports confident totals for the wrong fields -- a failure with no
 * symptom, because the numbers still look like plausible projections.
 */
function resolveSkillColumns(
  header: readonly string[],
  diagnostics: ProjectionDiagnostic[],
): SkillColumns | null {
  const name = headerIndex(header, 'NAME');
  const position = headerIndex(header, 'POS');
  const team = headerIndex(header, 'TEAM');

  if (name === -1 || position === -1 || team === -1) {
    diagnostics.push({
      level: 'error',
      code: 'unexpected_header',
      message:
        'The skill projection export has no Name, POS and Team columns, so no player could ' +
        `be identified. Header was: ${header.join(', ')}`,
    });
    return null;
  }

  const passing = sequenceIndex(header, PASSING_SEQUENCE);
  const rushing = passing + PASSING_SEQUENCE.length;
  const receiving = rushing + RUSHING_SEQUENCE.length;

  if (
    passing === -1 ||
    !matchesAt(header, rushing, RUSHING_SEQUENCE) ||
    !matchesAt(header, receiving, RECEIVING_SEQUENCE)
  ) {
    diagnostics.push({
      level: 'error',
      code: 'missing_stat_columns',
      message:
        'The skill projection export does not carry the expected passing, rushing and ' +
        `receiving stat blocks, so nothing could be rescored. Expected ${[
          ...PASSING_SEQUENCE,
          ...RUSHING_SEQUENCE,
          ...RECEIVING_SEQUENCE,
        ].join(', ')} in order; header was: ${header.join(', ')}`,
    });
    return null;
  }

  return {
    name,
    position,
    team,
    adp: headerIndex(header, 'ADP'),
    passYards: passing + 2,
    passTouchdowns: passing + 3,
    interceptions: passing + 4,
    rushYards: rushing + 1,
    rushTouchdowns: rushing + 2,
    receptions: receiving + 1,
    receivingYards: receiving + 2,
    receivingTouchdowns: receiving + 3,
  };
}

/** Defence column names are unique, so these resolve by name directly. */
function resolveDefenseColumns(
  header: readonly string[],
  diagnostics: ProjectionDiagnostic[],
): DefenseColumns | null {
  const name = headerIndex(header, 'NAME');
  const team = headerIndex(header, 'TEAM');

  if (name === -1 || team === -1) {
    diagnostics.push({
      level: 'error',
      code: 'unexpected_header',
      message:
        'The defence projection export has no Name and Team columns, so no defence could be ' +
        `identified. Header was: ${header.join(', ')}`,
    });
    return null;
  }

  const columns: DefenseColumns = {
    name,
    team,
    sacks: headerIndex(header, 'SACK'),
    defenseInterceptions: headerIndex(header, 'INT'),
    fumbleRecoveries: headerIndex(header, 'FR'),
    defenseTouchdowns: headerIndex(header, 'DTD'),
    specialTeamsTouchdowns: headerIndex(header, 'STD'),
  };

  const missing = (
    [
      'sacks',
      'defenseInterceptions',
      'fumbleRecoveries',
      'defenseTouchdowns',
      'specialTeamsTouchdowns',
    ] as const
  ).filter((key) => columns[key] === -1);

  if (missing.length > 0) {
    diagnostics.push({
      level: 'error',
      code: 'missing_stat_columns',
      message:
        `The defence projection export is missing ${missing.length} stat column(s) ` +
        `(${missing.join(', ')}), so defences could not be rescored. Header was: ${header.join(', ')}`,
    });
    return null;
  }

  return columns;
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
