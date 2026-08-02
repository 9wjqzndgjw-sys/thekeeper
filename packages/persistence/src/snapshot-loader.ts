import type {
  FranchiseId,
  LeagueRules,
  LeagueStateSnapshot,
  LineupSettings,
  Player,
  PlayerId,
  PlayerSeason,
  Position,
  ScoringSettings,
  SeasonId,
} from '@keeper/domain';
import type { KeeperDatabaseClient } from './client.js';
import { KeeperRepository } from './repository.js';

export interface LoadLeagueSnapshotInput {
  client: KeeperDatabaseClient;
  seasonId: SeasonId;
  /**
   * Whose dashboard this is. Recommendations are franchise-specific, so this decides which
   * team the optimizer answers for.
   */
  userFranchiseId?: FranchiseId;
}

export interface LoadedLeagueSnapshot {
  snapshot: LeagueStateSnapshot;
  /** Every player the catalog knows, for the boards. */
  players: Player[];
  /** Things a reader should know about this data, in plain words. */
  caveats: string[];
}

/**
 * Reads a whole league out of the database and assembles the snapshot the engine works on.
 *
 * This is the seam that lets the browser answer the same questions as the terminal. The
 * command line reads projection exports off disk, which a hosted page cannot do, so the
 * scored projections are persisted and both sides read them from here.
 *
 * Anything genuinely absent is reported as a caveat rather than filled in. An empty roster
 * list is honest; an invented one would quietly change what the engine recommends.
 */
export async function loadLeagueSnapshot(
  input: LoadLeagueSnapshotInput,
): Promise<LoadedLeagueSnapshot> {
  const repository = new KeeperRepository(input.client);

  const season = await repository.readLeagueSeason(input.seasonId);
  if (!season) {
    throw new Error(
      `No league season '${input.seasonId}' in the database. Run "npm run sync -w @keeper/cli" first.`,
    );
  }

  const [franchises, keeperRights, pickInventory, catalog, playerSeasonRows] = await Promise.all([
    repository.readFranchises(input.seasonId),
    repository.readKeeperRights(input.seasonId),
    repository.readPickInventory(input.seasonId),
    repository.readAllPlayers(),
    repository.readPlayerSeasons(input.seasonId),
  ]);

  const caveats: string[] = [];

  if (playerSeasonRows.length === 0) {
    caveats.push(
      'No projections are stored for this season, so every player is valued at zero. Run ' +
        '"npm run project -w @keeper/cli" to load them.',
    );
  }

  // Only players with a stored projection can be valued, so the board is built from those.
  const projectedByPlayerId = new Map(
    playerSeasonRows.map((row) => [row.playerId, row.projectedPoints]),
  );
  const players: Player[] = catalog
    .filter((player) => projectedByPlayerId.has(player.id))
    .map((player) => ({
      id: player.id as PlayerId,
      fullName: player.fullName,
      position: player.position as Position,
      sleeperPlayerId: player.sleeperPlayerId,
    }));

  const playerSeasons: PlayerSeason[] = players.map((player) => ({
    playerId: player.id,
    seasonId: input.seasonId,
    nflTeam: null,
    age: null,
    role: null,
    injuryStatus: null,
    projectedPoints: projectedByPlayerId.get(player.id) ?? null,
    actualPoints: null,
  }));

  const userFranchiseId = input.userFranchiseId ?? (franchises[0]?.id as FranchiseId | undefined);
  if (!userFranchiseId) {
    throw new Error(`League season '${input.seasonId}' has no franchises. Run the import again.`);
  }
  if (!input.userFranchiseId) {
    caveats.push(
      'No franchise was chosen, so recommendations are shown for the first team in the league. ' +
        'Set VITE_KEEPER_FRANCHISE_ID to pick one.',
    );
  }

  const rules = readRules(season.rules, season.teamCount, season.draftRounds);
  if (Object.keys(season.rules).length === 0) {
    caveats.push(
      'This season predates stored league rules, so keeper limits fall back to defaults. ' +
        'Re-run the import to record them.',
    );
  }

  // Rosters and completed selections are not imported yet. They are left empty rather than
  // approximated, and the boards that would use them say so.
  caveats.push('Rosters and completed draft selections are not imported yet.');

  return {
    players,
    caveats,
    snapshot: {
      league: {
        id: season.leagueId,
        name: season.leagueName,
        rules,
        scoring: season.scoringSettings as unknown as ScoringSettings,
        lineup: readLineup(season.lineup),
        rulesVersion: season.rulesVersion,
      },
      season: {
        id: season.seasonId,
        leagueId: season.leagueId,
        year: season.seasonYear,
        sleeperLeagueId: season.sleeperLeagueId,
        previousSleeperLeagueId: season.previousSleeperLeagueId,
        status: season.status,
        draftId: null,
        keeperDeadline: '',
        draftTime: '',
      },
      franchises: franchises.map((franchise) => ({
        id: franchise.id as FranchiseId,
        leagueId: season.leagueId,
        displayName: franchise.displayName,
      })),
      rosters: [],
      keeperRights,
      pickInventory,
      draft: null,
      draftSelections: [],
      playerSeasons,
      userFranchiseId,
      evaluatedAt: new Date().toISOString(),
      assumptions: { storedRules: season.rules },
    },
  };
}

/** Lineup slots default to zero individually, so a partial record cannot invent starters. */
function readLineup(stored: Record<string, unknown>): LineupSettings {
  const slot = (key: keyof LineupSettings): number => {
    const value = stored[key];
    return typeof value === 'number' && Number.isFinite(value) ? value : 0;
  };
  return {
    qb: slot('qb'),
    rb: slot('rb'),
    wr: slot('wr'),
    te: slot('te'),
    flex: slot('flex'),
    def: slot('def'),
    bench: slot('bench'),
    ir: slot('ir'),
  };
}

/**
 * Team count and round count come from their own columns rather than the rules blob, since
 * those are what the pick inventory was actually built from.
 */
function readRules(
  stored: Record<string, unknown>,
  teamCount: number,
  draftRounds: number,
): LeagueRules {
  const number = (key: string, fallback: number): number => {
    const value = stored[key];
    return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
  };
  const boolean = (key: string, fallback: boolean): boolean => {
    const value = stored[key];
    return typeof value === 'boolean' ? value : fallback;
  };

  return {
    teamCount,
    draftRounds,
    thirdRoundReversal: boolean('thirdRoundReversal', false),
    maxKeepers: number('maxKeepers', 3),
    keeperDurationIndefinite: boolean('keeperDurationIndefinite', true),
    keeperCostAdvancePerSeason: number('keeperCostAdvancePerSeason', 1),
    undraftedKeeperRound: number('undraftedKeeperRound', 10),
    keeperRightsTradeable: boolean('keeperRightsTradeable', true),
    tradesProcessImmediately: boolean('tradesProcessImmediately', true),
    keeperDeadlineDaysBeforeDraft: number('keeperDeadlineDaysBeforeDraft', 7),
    keeperDeclarationsPublicPreDraft: boolean('keeperDeclarationsPublicPreDraft', true),
    draftOrderMethod: (stored.draftOrderMethod as LeagueRules['draftOrderMethod']) ?? 'dynamic',
    toiletBowlAwardPick: (stored.toiletBowlAwardPick as LeagueRules['toiletBowlAwardPick']) ?? {
      round: 1,
      slot: 1,
    },
    futurePicksTradeable: boolean('futurePicksTradeable', true),
  };
}
