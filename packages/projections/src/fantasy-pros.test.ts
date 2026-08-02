import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { SeasonId } from '@keeper/domain';
import { loadProjections } from './fantasy-pros.js';

const seasonId = 'season-2026' as SeasonId;

const leagueScoring = {
  pass_yd: 0.04,
  pass_td: 6,
  pass_int: -2,
  rush_yd: 0.1,
  rush_td: 6,
  rec: 0.5,
  bonus_rec_te: 0.5,
  rec_yd: 0.1,
  rec_td: 6,
  sack: 1,
  int: 2,
  fum_rec: 1,
  def_td: 6,
  st_td: 6,
  yds_allow_300_349: 3,
  pts_allow_0: 7,
};

const SKILL_HEADER =
  '"RK","Name","POS","Team","Bye","POS","ADP","FPTS","G","FPTS/G","TIER","ATT","CMP","YDS","TD","INT","ATT","YDS","TD","TGT","REC","YDS","TD","UP","DOWN","MOVE","TARGET","WIN"';
const DEF_HEADER =
  '"RK","Name","POS","Team","Bye","POS","ADP","FPTS","G","FPTS/G","TIER","SACK","INT","FR","DTD","STD","UP","DOWN","MOVE","TARGET","WIN"';

describe('loadProjections', () => {
  it('rescores a passer under league rules instead of trusting the source total', () => {
    const csv = [
      SKILL_HEADER,
      // Josh Allen. The file's own FPTS of 335.9 assumes four-point passing TDs.
      '"3","Josh Allen","QB","BUF","7","QB1","28.2","335.9","15","22.39","1","466","311","3585","24.6","11","106.1","522.8","9.2","-","-","-","-","-","-","-","-","-"',
    ].join('\n');

    const loaded = loadProjections({ skillPositionCsv: csv, scoring: leagueScoring, seasonId });

    expect(loaded.players).toHaveLength(1);
    expect(loaded.playerSeasons[0]!.projectedPoints).toBeCloseTo(376.48);
    expect(loaded.playerSeasons[0]!.projectedPoints).not.toBeCloseTo(335.9);
  });

  it('applies the tight-end bonus a half-PPR source does not', () => {
    const csv = [
      SKILL_HEADER,
      '"20","Brock Bowers","TE","LV","9","TE1","25.0","257.3","17","15.1","1","0","0","0","0","0","0","0","0","110.0","85.6","1050.0","6.0","-","-","-","-","-"',
    ].join('\n');

    const loaded = loadProjections({ skillPositionCsv: csv, scoring: leagueScoring, seasonId });

    // 85.6 catches at 0.5 + 0.5, 1050 yards, 6 scores.
    expect(loaded.playerSeasons[0]!.projectedPoints).toBeCloseTo(85.6 + 105 + 36);
  });

  it('loads defenses from the separate export', () => {
    const loaded = loadProjections({
      skillPositionCsv: SKILL_HEADER,
      defenseCsv: [
        DEF_HEADER,
        '"1","Houston Texans","DST","HST","8","-","-","103.0","17","6.06","1","45.0","14.4","8.9","1.9","0.0","-","-","-","-","-"',
      ].join('\n'),
      scoring: leagueScoring,
      seasonId,
    });

    expect(loaded.players[0]).toMatchObject({ fullName: 'Houston Texans', position: 'DEF' });
    expect(loaded.playerSeasons[0]!.projectedPoints).toBeCloseTo(94.1);
  });

  it('states the league rules season totals can never supply', () => {
    const loaded = loadProjections({
      skillPositionCsv: SKILL_HEADER,
      scoring: leagueScoring,
      seasonId,
    });

    expect(loaded.unscorableLeagueRules).toEqual(['pts_allow_0', 'yds_allow_300_349']);
    expect(loaded.diagnostics).toContainEqual(
      expect.objectContaining({ code: 'unscorable_league_rules' }),
    );
    expect(loaded.diagnostics.find((d) => d.code === 'unscorable_league_rules')!.message).toMatch(
      /takeaway-weighted proxy/,
    );
  });

  it('captures ADP for the pick-value curve', () => {
    const csv = [
      SKILL_HEADER,
      '"1","Jahmyr Gibbs","RB","DET","6","RB1","1.6","347.6","15","23.17","1","0","0","0","0","0","272.0","1352.9","13.5","78.8","65.4","478.9","3.2","-","-","-","-","-"',
    ].join('\n');

    const loaded = loadProjections({ skillPositionCsv: csv, scoring: leagueScoring, seasonId });

    expect([...loaded.averageDraftPositionByPlayerId.values()]).toEqual([1.6]);
  });

  it('produces stable ids across reimports', () => {
    const csv = [
      SKILL_HEADER,
      '"1","Ja\'Marr Chase","WR","CIN","10","WR1","3.1","285.1","17","16.8","1","0","0","0","0","0","5","20","0","145","101","1400","9","-","-","-","-","-"',
    ].join('\n');

    const first = loadProjections({ skillPositionCsv: csv, scoring: leagueScoring, seasonId });
    const second = loadProjections({ skillPositionCsv: csv, scoring: leagueScoring, seasonId });

    expect(first.players[0]!.id).toBe(second.players[0]!.id);
    expect(first.players[0]!.id).toBe('proj:WR:jamarr-chase');
  });

  it('skips an unsupported position and says which', () => {
    const csv = [
      SKILL_HEADER,
      '"1","Some Kicker","K","KC","6","K1","150","120","17","7.1","1","0","0","0","0","0","0","0","0","-","-","-","-","-","-","-","-","-"',
    ].join('\n');

    const loaded = loadProjections({ skillPositionCsv: csv, scoring: leagueScoring, seasonId });

    expect(loaded.players).toEqual([]);
    expect(loaded.diagnostics).toContainEqual(
      expect.objectContaining({ code: 'unknown_position', playerName: 'Some Kicker' }),
    );
  });
});

describe('the real exported files', () => {
  const skillPath =
    'C:/Users/RENAME/Downloads/2026 NFL Fantasy Football Season Rankings  Projections  Fantasy Points (1).csv';
  const defensePath = 'C:/Users/RENAME/Downloads/2026_defproj.csv';

  const available = (() => {
    try {
      readFileSync(skillPath, 'utf8');
      readFileSync(defensePath, 'utf8');
      return true;
    } catch {
      return false;
    }
  })();

  // Skipped anywhere the exports are not present, so CI stays green without them.
  it.skipIf(!available)('loads every skill player and defense', () => {
    const loaded = loadProjections({
      skillPositionCsv: readFileSync(skillPath, 'utf8'),
      defenseCsv: readFileSync(defensePath, 'utf8'),
      scoring: leagueScoring,
      seasonId,
    });

    expect(loaded.players.length).toBeGreaterThan(500);
    const positions = new Set(loaded.players.map((player) => player.position));
    expect([...positions].sort()).toEqual(['DEF', 'QB', 'RB', 'TE', 'WR']);
    expect(loaded.players.filter((p) => p.position === 'DEF')).toHaveLength(32);

    // Every player must carry a real projection, or the boards will silently rank on zeros.
    expect(loaded.playerSeasons.every((season) => (season.projectedPoints ?? 0) > 0)).toBe(true);
  });
});
