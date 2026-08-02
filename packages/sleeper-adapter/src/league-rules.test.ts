import { describe, expect, it } from 'vitest';
import {
  deriveLeagueRules,
  deriveLineupSettings,
  readThirdRoundReversal,
  RECORDED_LEAGUE_POLICY,
} from './league-rules.js';

const base = {
  policy: RECORDED_LEAGUE_POLICY,
  teamCount: 12,
  draftRounds: 15,
};

describe('deriveLeagueRules', () => {
  it('takes the keeper limit from Sleeper when Sleeper states it', () => {
    const result = deriveLeagueRules({
      ...base,
      settings: { max_keepers: 4 },
      thirdRoundReversal: false,
    });

    expect(result.rules.maxKeepers).toBe(4);
    expect(result.assumedFromPolicy).toEqual([]);
  });

  it('reports the keeper limit as an assumption when Sleeper omits it', () => {
    const result = deriveLeagueRules({ ...base, settings: {}, thirdRoundReversal: false });

    expect(result.rules.maxKeepers).toBe(3);
    expect(result.assumedFromPolicy).toEqual(['max_keepers']);
  });

  it('takes third round reversal from the draft, and says so when it was not supplied', () => {
    expect(
      deriveLeagueRules({ ...base, settings: {}, thirdRoundReversal: true }).rules
        .thirdRoundReversal,
    ).toBe(true);

    // Absent is not the same as false. The league payload has no reversal field at all, so
    // reading one from it would resolve to "no reversal" purely by not looking -- and that
    // moves every pick number from round three on.
    const unsupplied = deriveLeagueRules({ ...base, settings: {} });
    expect(unsupplied.rules.thirdRoundReversal).toBe(false);
    expect(unsupplied.assumedFromPolicy).toContain('reversal_round');
  });

  it('ignores a malformed setting rather than coercing it', () => {
    // A string here would become NaN or a surprising truthy value under coercion, and a
    // wrong keeper limit changes which combinations the optimizer will even consider.
    const result = deriveLeagueRules({ ...base, settings: { max_keepers: '4' } });

    expect(result.rules.maxKeepers).toBe(3);
    expect(result.assumedFromPolicy).toContain('max_keepers');
  });

  it('carries recorded policy through untouched', () => {
    const result = deriveLeagueRules({
      ...base,
      settings: { max_keepers: 3 },
      thirdRoundReversal: false,
    });

    expect(result.rules.keeperCostAdvancePerSeason).toBe(1);
    expect(result.rules.undraftedKeeperRound).toBe(10);
    expect(result.rules.keeperDurationIndefinite).toBe(true);
  });
});

describe('readThirdRoundReversal', () => {
  it('reads the draft setting, where Sleeper actually keeps it', () => {
    expect(readThirdRoundReversal({ reversal_round: 3 })).toBe(true);
    expect(readThirdRoundReversal({ reversal_round: 0 })).toBe(false);
  });

  it('returns unknown for a reversal round the order maths does not model', () => {
    // A league reversing round four is a real configuration this engine cannot price, so it
    // is reported as unknown rather than flattened to "no reversal".
    expect(readThirdRoundReversal({ reversal_round: 4 })).toBeUndefined();
    expect(readThirdRoundReversal({})).toBeUndefined();
    expect(readThirdRoundReversal({ reversal_round: 'three' })).toBeUndefined();
  });
});

describe('deriveLineupSettings', () => {
  it('counts the roster positions the league actually rosters', () => {
    const lineup = deriveLineupSettings([
      'QB',
      'RB',
      'RB',
      'WR',
      'WR',
      'TE',
      'FLEX',
      'FLEX',
      'DEF',
      'BN',
      'BN',
      'BN',
      'BN',
      'BN',
      'BN',
      'IR',
      'IR',
    ]);

    expect(lineup).toEqual({ qb: 1, rb: 2, wr: 2, te: 1, flex: 2, def: 1, bench: 6, ir: 2 });
  });

  it('recognises the older spellings of the shared skill slot', () => {
    expect(deriveLineupSettings(['WRRB_FLEX', 'REC_FLEX']).flex).toBe(2);
  });

  it('reports zero for a slot the league does not roster', () => {
    expect(deriveLineupSettings(['QB', 'RB']).def).toBe(0);
  });
});
