import { describe, expect, it } from 'vitest';
import { describeUnscorableRules, scoreStatLine, type SleeperScoringSettings } from './scoring.js';

// Captured live from the league's scoring_settings.
const leagueScoring: SleeperScoringSettings = {
  pass_yd: 0.04,
  pass_td: 6,
  pass_int: -2,
  rush_yd: 0.1,
  rush_td: 6,
  rec: 0.5,
  bonus_rec_te: 0.5,
  rec_yd: 0.1,
  rec_td: 6,
  fum_lost: -1,
  kr_yd: 0.04,
  pr_yd: 0.1,
  sack: 1,
  int: 2,
  fum_rec: 1,
  def_td: 6,
  st_td: 6,
  safe: 2,
  ff: 1,
  blk_kick: 3,
  pts_allow_0: 7,
  yds_allow_0_100: 10,
  yds_allow_300_349: 3,
  yds_allow_550p: -7,
};

describe('scoreStatLine', () => {
  it('scores a passer at the league rate rather than a standard one', () => {
    // Josh Allen's projection: 3585 pass yds, 24.6 pass TD, 11 INT, 522.8 rush, 9.2 rush TD.
    const result = scoreStatLine(
      {
        passYards: 3585,
        passTouchdowns: 24.6,
        interceptions: 11,
        rushYards: 522.8,
        rushTouchdowns: 9.2,
      },
      leagueScoring,
      'QB',
    );

    expect(result.breakdown.pass_td).toBeCloseTo(147.6); // six-point passing TDs
    expect(result.breakdown.pass_int).toBeCloseTo(-22);
    expect(result.points).toBeCloseTo(376.48);
  });

  it('adds the tight-end bonus on top of the base reception rate', () => {
    const stats = { receptions: 100, receivingYards: 1000, receivingTouchdowns: 5 };
    const tightEnd = scoreStatLine(stats, leagueScoring, 'TE');
    const receiver = scoreStatLine(stats, leagueScoring, 'WR');

    // TE catches are worth 0.5 + 0.5, everyone else's are worth 0.5.
    expect(tightEnd.breakdown.rec).toBeCloseTo(50);
    expect(tightEnd.breakdown.bonus_rec_te).toBeCloseTo(50);
    expect(tightEnd.points - receiver.points).toBeCloseTo(50);
  });

  it('does not give a receiver a tight-end bonus', () => {
    const result = scoreStatLine({ receptions: 100 }, leagueScoring, 'WR');

    expect(result.breakdown.bonus_rec_te).toBeUndefined();
    expect(result.points).toBeCloseTo(50);
  });

  it('scores a defense from its countable stats', () => {
    // Houston's projection: 45 sacks, 14.4 INT, 8.9 fumble recoveries, 1.9 def TD.
    const result = scoreStatLine(
      { sacks: 45, defenseInterceptions: 14.4, fumbleRecoveries: 8.9, defenseTouchdowns: 1.9 },
      leagueScoring,
      'DEF',
    );

    expect(result.points).toBeCloseTo(94.1);
  });

  it('traces every point back to the rule that produced it', () => {
    const result = scoreStatLine({ rushYards: 1000, rushTouchdowns: 10 }, leagueScoring, 'RB');

    expect(result.breakdown).toEqual({ rush_yd: 100, rush_td: 60 });
    expect(Object.values(result.breakdown).reduce((a, b) => a + b, 0)).toBeCloseTo(result.points);
  });

  it('reports the league rules a stat line could not feed', () => {
    const result = scoreStatLine({ rushYards: 1000 }, leagueScoring, 'RB');

    // The yards-allowed ladder is real scoring this projection cannot supply.
    expect(result.unusedScoringKeys).toContain('yds_allow_300_349');
    expect(result.unusedScoringKeys).toContain('pass_td');
    expect(result.unusedScoringKeys).not.toContain('rush_yd');
  });

  it('ignores a stat the league does not score', () => {
    const withoutReturns = { ...leagueScoring };
    delete (withoutReturns as Record<string, number>).kr_yd;

    const result = scoreStatLine({ kickReturnYards: 500 }, withoutReturns, 'WR');

    expect(result.points).toBe(0);
  });

  it('counts return yards when the league scores them', () => {
    const result = scoreStatLine(
      { kickReturnYards: 500, puntReturnYards: 200 },
      leagueScoring,
      'WR',
    );

    expect(result.points).toBeCloseTo(500 * 0.04 + 200 * 0.1);
  });

  it('scores an empty stat line as zero rather than throwing', () => {
    expect(scoreStatLine({}, leagueScoring, 'QB').points).toBe(0);
  });
});

describe('describeUnscorableRules', () => {
  it('names the rules that need weekly game state, whatever the projection source', () => {
    expect(describeUnscorableRules(leagueScoring)).toEqual([
      'pts_allow_0',
      'yds_allow_0_100',
      'yds_allow_300_349',
      'yds_allow_550p',
    ]);
  });

  it('ignores tiers the league has zeroed out', () => {
    expect(describeUnscorableRules({ pts_allow_14_20: 0, rush_yd: 0.1 })).toEqual([]);
  });
});
