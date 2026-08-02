import type { LeagueRules, LineupSettings } from '@keeper/domain';

/**
 * League policy Sleeper has no field for.
 *
 * Sleeper describes how a draft runs, not how a league governs keepers, so these come from
 * the league's own written rules. They are an explicit input rather than defaults buried in
 * the mapper: getting `keeperCostAdvancePerSeason` wrong silently misprices every keeper in
 * the league, and that is not something to guess at.
 */
export interface LeaguePolicy {
  keeperDurationIndefinite: boolean;
  keeperCostAdvancePerSeason: number;
  undraftedKeeperRound: number;
  keeperRightsTradeable: boolean;
  tradesProcessImmediately: boolean;
  keeperDeadlineDaysBeforeDraft: number;
  keeperDeclarationsPublicPreDraft: boolean;
  toiletBowlAwardPick: { round: number; slot: number };
  futurePicksTradeable: boolean;
}

export interface DeriveLeagueRulesInput {
  /** `settings` from the Sleeper league payload, as sent. */
  settings: Record<string, unknown>;
  policy: LeaguePolicy;
  teamCount: number;
  draftRounds: number;
  /**
   * Whether the third round reverses, taken from the draft.
   *
   * This belongs to the draft rather than the league: Sleeper carries `reversal_round` in
   * the draft's settings and the league payload has no such field at all. Reading it from
   * the league would return nothing and quietly resolve to "no reversal", which is a real
   * answer arrived at by not looking -- and it shifts every pick number from round three on.
   */
  thirdRoundReversal?: boolean;
}

export interface DeriveLeagueRulesResult {
  rules: LeagueRules;
  /**
   * Rules the league payload did not express, so the recorded policy was used. Surfaced so
   * a missing Sleeper field shows up as a stated assumption instead of a confident number.
   */
  assumedFromPolicy: string[];
}

/**
 * Builds the engine's rule set from a Sleeper league payload plus recorded league policy.
 *
 * Sleeper is the authority on what it actually knows -- how many teams, whether the third
 * round reverses, how many keepers are allowed -- and anything it does not model is taken
 * from policy and reported. Nothing is inferred from a value's absence.
 */
export function deriveLeagueRules(input: DeriveLeagueRulesInput): DeriveLeagueRulesResult {
  const assumedFromPolicy: string[] = [];

  const maxKeepers = readPositiveInteger(input.settings, 'max_keepers');
  if (maxKeepers === null) {
    assumedFromPolicy.push('max_keepers');
  }
  if (input.thirdRoundReversal === undefined) {
    assumedFromPolicy.push('reversal_round');
  }

  return {
    rules: {
      teamCount: input.teamCount,
      draftRounds: input.draftRounds,
      thirdRoundReversal: input.thirdRoundReversal ?? false,
      maxKeepers: maxKeepers ?? 3,
      draftOrderMethod: 'dynamic',
      ...input.policy,
    },
    assumedFromPolicy,
  };
}

/**
 * Reads the reversal setting out of a Sleeper draft's settings.
 *
 * Zero means the draft snakes normally. Three is the only value the engine's order maths
 * treats as third-round reversal; any other round would need the maths extended rather than
 * silently approximated, so it is reported as unknown.
 */
export function readThirdRoundReversal(
  draftSettings: Record<string, unknown>,
): boolean | undefined {
  const value = draftSettings.reversal_round;
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    return undefined;
  }
  if (value === 0) {
    return false;
  }
  return value === 3 ? true : undefined;
}

/**
 * The league's written keeper policy. Recorded here because it governs how every keeper is
 * priced and Sleeper cannot answer for it.
 *
 * A keeper's cost climbs one round per season and stops at the first: once a player reaches
 * round one he stays there, which is why two first-round keepers cost two first-round picks
 * and a third would be illegal.
 */
export const RECORDED_LEAGUE_POLICY: LeaguePolicy = {
  keeperDurationIndefinite: true,
  keeperCostAdvancePerSeason: 1,
  undraftedKeeperRound: 10,
  // 01_LEAGUE_RULES.md: keeper rights cannot be traded separately from players. A player
  // can be traded and his cost travels with him; the right itself is not an asset.
  keeperRightsTradeable: false,
  tradesProcessImmediately: true,
  keeperDeadlineDaysBeforeDraft: 7,
  keeperDeclarationsPublicPreDraft: true,
  toiletBowlAwardPick: { round: 1, slot: 1 },
  futurePicksTradeable: true,
};

/**
 * Reads the lineup a league actually starts from its roster_positions list, which is the
 * authority: a hand-maintained copy drifts the moment the league adds a flex.
 */
export function deriveLineupSettings(rosterPositions: readonly string[]): LineupSettings {
  const counts = new Map<string, number>();
  for (const slot of rosterPositions) {
    counts.set(slot, (counts.get(slot) ?? 0) + 1);
  }
  const count = (...slots: string[]): number =>
    slots.reduce((total, slot) => total + (counts.get(slot) ?? 0), 0);

  return {
    qb: count('QB'),
    rb: count('RB'),
    wr: count('WR'),
    te: count('TE'),
    // Sleeper spells the shared skill slot several ways depending on league age.
    flex: count('FLEX', 'REC_FLEX', 'WRRB_FLEX', 'WRRB_WRT'),
    def: count('DEF'),
    bench: count('BN'),
    ir: count('IR'),
  };
}

function readPositiveInteger(settings: Record<string, unknown>, key: string): number | null {
  const value = settings[key];
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : null;
}
