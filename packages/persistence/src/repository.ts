import type { DraftPickAsset, Franchise, KeeperRight, LeagueId, SeasonId } from '@keeper/domain';
import type { KeeperDatabaseClient } from './client.js';

export interface RawSnapshotRecord {
  mapperVersion: string;
  endpoint: string;
  url: string;
  fetchedAt: string;
  payload: unknown;
}

export interface LeagueSeasonRecord {
  leagueId: LeagueId;
  leagueName: string;
  rulesVersion: string;
  seasonId: SeasonId;
  seasonYear: number;
  sleeperLeagueId: string;
  previousSleeperLeagueId: string | null;
  status: 'pre_draft' | 'drafting' | 'in_season' | 'complete';
  sleeperDraftId: string | null;
  teamCount: number;
  draftRounds: number;
  scoringSettings: Record<string, unknown>;
  lineup: Record<string, unknown>;
  rules: Record<string, unknown>;
}

/** A season row as read back, with the jsonb columns still opaque. */
export interface StoredLeagueSeason {
  seasonId: SeasonId;
  leagueId: LeagueId;
  leagueName: string;
  rulesVersion: string;
  seasonYear: number;
  sleeperLeagueId: string;
  previousSleeperLeagueId: string | null;
  status: 'pre_draft' | 'drafting' | 'in_season' | 'complete';
  sleeperDraftId: string | null;
  teamCount: number;
  draftRounds: number;
  scoringSettings: Record<string, unknown>;
  lineup: Record<string, unknown>;
  rules: Record<string, unknown>;
}

export interface PlayerSeasonRecord {
  seasonId: SeasonId;
  playerId: string;
  projectedPoints: number;
  projectionSource: string;
}

export interface FranchiseSeasonRecord {
  franchise: Franchise;
  sleeperRosterId: number;
  sleeperOwnerId: string | null;
  identitySource: 'owner' | 'roster_fallback' | 'manual_override';
}

export interface KeeperDecisionRecord {
  seasonId: SeasonId;
  franchiseId: string;
  playerId: string;
  keeperRightId: string | null;
  resolvedPickAssetId: string | null;
  source: 'sleeper' | 'manual';
  declaredAt: string | null;
}

export interface PlayerRecord {
  id: string;
  fullName: string;
  position: string;
  sleeperPlayerId: string | null;
}

/** Rows written per table, so a caller can confirm what actually landed. */
export type PersistCounts = Record<string, number>;

function unwrap(label: string, error: { message: string } | null): void {
  if (error) {
    throw new Error(`${label}: ${error.message}`);
  }
}

/**
 * Writes are upserts keyed on the same identity the schema enforces, so re-running an
 * import is idempotent rather than duplicating or failing on a constraint.
 */
export class KeeperRepository {
  constructor(private readonly client: KeeperDatabaseClient) {}

  async saveRawSnapshots(snapshots: readonly RawSnapshotRecord[]): Promise<number> {
    if (snapshots.length === 0) {
      return 0;
    }
    // Append-only by design: a snapshot records what the API said at a moment, so a later
    // fetch is a new row rather than an edit to an old one.
    const { error } = await this.client.from('raw_api_snapshots').insert(
      snapshots.map((snapshot) => ({
        mapper_version: snapshot.mapperVersion,
        endpoint: snapshot.endpoint,
        url: snapshot.url,
        fetched_at: snapshot.fetchedAt,
        payload: snapshot.payload,
      })),
    );
    unwrap('raw_api_snapshots', error);
    return snapshots.length;
  }

  async saveLeagueSeason(record: LeagueSeasonRecord): Promise<void> {
    unwrap(
      'leagues',
      (
        await this.client
          .from('leagues')
          .upsert(
            { id: record.leagueId, name: record.leagueName, rules_version: record.rulesVersion },
            { onConflict: 'id' },
          )
      ).error,
    );

    unwrap(
      'league_seasons',
      (
        await this.client.from('league_seasons').upsert(
          {
            id: record.seasonId,
            league_id: record.leagueId,
            season_year: record.seasonYear,
            sleeper_league_id: record.sleeperLeagueId,
            previous_sleeper_league_id: record.previousSleeperLeagueId,
            status: record.status,
            sleeper_draft_id: record.sleeperDraftId,
            team_count: record.teamCount,
            draft_rounds: record.draftRounds,
            scoring_settings: record.scoringSettings,
            lineup: record.lineup,
            rules: record.rules,
          },
          { onConflict: 'id' },
        )
      ).error,
    );
  }

  async readLeagueSeason(seasonId: SeasonId): Promise<StoredLeagueSeason | null> {
    const { data, error } = await this.client
      .from('league_seasons')
      .select(
        'id, league_id, season_year, sleeper_league_id, previous_sleeper_league_id, status, ' +
          'sleeper_draft_id, team_count, draft_rounds, scoring_settings, lineup, rules, ' +
          'leagues(name, rules_version)',
      )
      .eq('id', seasonId)
      .maybeSingle();
    unwrap('read league season', error);

    if (!data) {
      return null;
    }
    // The untyped client cannot narrow a row that carries an embedded join, so the shape is
    // asserted here and every field is coerced below rather than trusted.
    const row = data as unknown as Record<string, unknown> & {
      leagues: { name: string; rules_version: string } | null;
    };
    const league = row.leagues;

    return {
      seasonId: String(row.id) as SeasonId,
      leagueId: String(row.league_id) as LeagueId,
      leagueName: league?.name ?? '',
      rulesVersion: league?.rules_version ?? '',
      seasonYear: Number(row.season_year),
      sleeperLeagueId: String(row.sleeper_league_id),
      previousSleeperLeagueId: (row.previous_sleeper_league_id as string | null) ?? null,
      status: row.status as StoredLeagueSeason['status'],
      sleeperDraftId: (row.sleeper_draft_id as string | null) ?? null,
      teamCount: Number(row.team_count),
      draftRounds: Number(row.draft_rounds),
      scoringSettings: (row.scoring_settings ?? {}) as Record<string, unknown>,
      lineup: (row.lineup ?? {}) as Record<string, unknown>,
      rules: (row.rules ?? {}) as Record<string, unknown>,
    };
  }

  /**
   * Projections scored under this league's settings. Batched like the catalog, since a
   * full season covers hundreds of players.
   */
  async savePlayerSeasons(
    records: readonly PlayerSeasonRecord[],
    batchSize = 500,
  ): Promise<number> {
    for (let start = 0; start < records.length; start += batchSize) {
      const batch = records.slice(start, start + batchSize);
      unwrap(
        `player_seasons [${start}-${start + batch.length}]`,
        (
          await this.client.from('player_seasons').upsert(
            batch.map((record) => ({
              season_id: record.seasonId,
              player_id: record.playerId,
              projected_points: record.projectedPoints,
              projection_source: record.projectionSource,
            })),
            { onConflict: 'season_id,player_id' },
          )
        ).error,
      );
    }
    return records.length;
  }

  /** Projected points for a season, keyed by player id, paged past PostgREST's row cap. */
  async readPlayerSeasons(seasonId: SeasonId, pageSize = 1000): Promise<PlayerSeasonRecord[]> {
    const records: PlayerSeasonRecord[] = [];

    for (let from = 0; ; from += pageSize) {
      const { data, error } = await this.client
        .from('player_seasons')
        .select('season_id, player_id, projected_points, projection_source')
        .eq('season_id', seasonId)
        .order('player_id')
        .range(from, from + pageSize - 1);
      unwrap('read player seasons', error);

      const page = data ?? [];
      records.push(
        ...page.map((row) => ({
          seasonId: String(row.season_id) as SeasonId,
          playerId: String(row.player_id),
          projectedPoints: Number(row.projected_points ?? 0),
          projectionSource: String(row.projection_source ?? ''),
        })),
      );
      if (page.length < pageSize) {
        return records;
      }
    }
  }

  async saveFranchises(
    seasonId: SeasonId,
    records: readonly FranchiseSeasonRecord[],
  ): Promise<number> {
    if (records.length === 0) {
      return 0;
    }

    unwrap(
      'franchises',
      (
        await this.client.from('franchises').upsert(
          records.map((record) => ({
            id: record.franchise.id,
            league_id: record.franchise.leagueId,
            display_name: record.franchise.displayName,
          })),
          { onConflict: 'id' },
        )
      ).error,
    );

    unwrap(
      'franchise_seasons',
      (
        await this.client.from('franchise_seasons').upsert(
          records.map((record) => ({
            season_id: seasonId,
            franchise_id: record.franchise.id,
            sleeper_roster_id: record.sleeperRosterId,
            sleeper_owner_id: record.sleeperOwnerId,
            identity_source: record.identitySource,
          })),
          { onConflict: 'season_id,franchise_id' },
        )
      ).error,
    );

    return records.length;
  }

  /**
   * Batched because the full Sleeper catalog runs to thousands of rows and PostgREST will
   * reject a single payload that large.
   */
  async savePlayers(players: readonly PlayerRecord[], batchSize = 500): Promise<number> {
    for (let start = 0; start < players.length; start += batchSize) {
      const batch = players.slice(start, start + batchSize);
      unwrap(
        `players [${start}-${start + batch.length}]`,
        (
          await this.client.from('players').upsert(
            batch.map((player) => ({
              id: player.id,
              full_name: player.fullName,
              position: player.position,
              sleeper_player_id: player.sleeperPlayerId,
            })),
            { onConflict: 'id' },
          )
        ).error,
      );
    }
    return players.length;
  }

  /** Players already known to the database, keyed by Sleeper id. */
  async readPlayersBySleeperId(
    sleeperPlayerIds: readonly string[],
  ): Promise<Map<string, PlayerRecord>> {
    const found = new Map<string, PlayerRecord>();
    const batchSize = 200;

    for (let start = 0; start < sleeperPlayerIds.length; start += batchSize) {
      const batch = sleeperPlayerIds.slice(start, start + batchSize);
      const { data, error } = await this.client
        .from('players')
        .select('id, full_name, position, sleeper_player_id')
        .in('sleeper_player_id', batch);
      unwrap('read players', error);

      for (const row of data ?? []) {
        const sleeperPlayerId = row.sleeper_player_id as string | null;
        if (sleeperPlayerId) {
          found.set(sleeperPlayerId, {
            id: String(row.id),
            fullName: String(row.full_name),
            position: String(row.position),
            sleeperPlayerId,
          });
        }
      }
    }
    return found;
  }

  async savePickInventory(picks: readonly DraftPickAsset[]): Promise<number> {
    if (picks.length === 0) {
      return 0;
    }
    unwrap(
      'draft_pick_assets',
      (
        await this.client.from('draft_pick_assets').upsert(
          picks.map((pick) => ({
            id: pick.id,
            season_id: pick.seasonId,
            round: pick.round,
            slot: pick.slot,
            overall_pick: pick.overallPick,
            original_franchise_id: pick.originalFranchiseId,
            current_franchise_id: pick.currentFranchiseId,
            ownership_confidence: pick.ownershipConfidence,
          })),
          { onConflict: 'id' },
        )
      ).error,
    );
    return picks.length;
  }

  /**
   * One row per rostered player, so this now runs to hundreds rather than dozens and is
   * batched like the catalog.
   */
  async saveKeeperRights(rights: readonly KeeperRight[], batchSize = 500): Promise<number> {
    for (let start = 0; start < rights.length; start += batchSize) {
      const batch = rights.slice(start, start + batchSize);
      unwrap(
        `keeper_rights [${start}-${start + batch.length}]`,
        (
          await this.client.from('keeper_rights').upsert(
            batch.map((right) => ({
              id: right.id,
              season_id: right.seasonId,
              franchise_id: right.franchiseId,
              player_id: right.playerId,
              source_type: right.sourceType,
              nominal_round: right.nominalRound,
              prior_season_round: right.priorSeasonRound,
              confidence: right.confidence,
              manual_override_reason: right.manualOverrideReason,
            })),
            { onConflict: 'id' },
          )
        ).error,
      );
    }
    return rights.length;
  }

  async saveKeeperDecisions(decisions: readonly KeeperDecisionRecord[]): Promise<number> {
    if (decisions.length === 0) {
      return 0;
    }
    unwrap(
      'keeper_decisions',
      (
        await this.client.from('keeper_decisions').upsert(
          decisions.map((decision) => ({
            season_id: decision.seasonId,
            franchise_id: decision.franchiseId,
            player_id: decision.playerId,
            keeper_right_id: decision.keeperRightId,
            resolved_pick_asset_id: decision.resolvedPickAssetId,
            source: decision.source,
            declared_at: decision.declaredAt,
          })),
          { onConflict: 'season_id,player_id' },
        )
      ).error,
    );
    return decisions.length;
  }

  /** Every player the catalog knows, paged past PostgREST's default row cap. */
  async readAllPlayers(pageSize = 1000): Promise<PlayerRecord[]> {
    const players: PlayerRecord[] = [];

    for (let from = 0; ; from += pageSize) {
      const { data, error } = await this.client
        .from('players')
        .select('id, full_name, position, sleeper_player_id')
        .order('id')
        .range(from, from + pageSize - 1);
      unwrap('read players', error);

      const page = data ?? [];
      players.push(
        ...page.map((row) => ({
          id: String(row.id),
          fullName: String(row.full_name),
          position: String(row.position),
          sleeperPlayerId: (row.sleeper_player_id as string | null) ?? null,
        })),
      );
      if (page.length < pageSize) {
        return players;
      }
    }
  }

  /**
   * Every keeper right for a season: one per rostered player, not one per declaration.
   * Paged, because a twelve team league carries close to two hundred of them.
   */
  async readKeeperRights(seasonId: SeasonId, pageSize = 1000): Promise<KeeperRight[]> {
    const rights: KeeperRight[] = [];

    for (let from = 0; ; from += pageSize) {
      const { data, error } = await this.client
        .from('keeper_rights')
        .select(
          'id, season_id, franchise_id, player_id, source_type, nominal_round, ' +
            'prior_season_round, confidence, manual_override_reason',
        )
        .eq('season_id', seasonId)
        .order('id')
        .range(from, from + pageSize - 1);
      unwrap('read keeper rights', error);

      const page = (data ?? []) as unknown as Record<string, unknown>[];
      rights.push(
        ...page.map(
          (row) =>
            ({
              id: row.id,
              seasonId: row.season_id,
              franchiseId: row.franchise_id,
              playerId: row.player_id,
              sourceType: row.source_type,
              nominalRound: row.nominal_round,
              priorSeasonRound: (row.prior_season_round as number | null) ?? null,
              effectiveOverallPick: null,
              confidence: row.confidence,
              manualOverrideReason: (row.manual_override_reason as string | null) ?? null,
            }) as KeeperRight,
        ),
      );
      if (page.length < pageSize) {
        return rights;
      }
    }
  }

  /** What managers actually declared, which is a different thing from what they could. */
  async readKeeperDecisions(seasonId: SeasonId): Promise<KeeperDecisionRecord[]> {
    const { data, error } = await this.client
      .from('keeper_decisions')
      .select(
        'season_id, franchise_id, player_id, keeper_right_id, resolved_pick_asset_id, source, declared_at',
      )
      .eq('season_id', seasonId);
    unwrap('read keeper decisions', error);

    return (data ?? []).map((row) => ({
      seasonId: String(row.season_id) as SeasonId,
      franchiseId: String(row.franchise_id),
      playerId: String(row.player_id),
      keeperRightId: (row.keeper_right_id as string | null) ?? null,
      resolvedPickAssetId: (row.resolved_pick_asset_id as string | null) ?? null,
      source: row.source as KeeperDecisionRecord['source'],
      declaredAt: (row.declared_at as string | null) ?? null,
    }));
  }

  async readPickInventory(seasonId: SeasonId): Promise<DraftPickAsset[]> {
    const { data, error } = await this.client
      .from('draft_pick_assets')
      .select(
        'id, season_id, round, slot, overall_pick, original_franchise_id, current_franchise_id, ownership_confidence',
      )
      .eq('season_id', seasonId)
      .order('overall_pick');
    unwrap('read pick inventory', error);

    return (data ?? []).map(
      (row) =>
        ({
          id: row.id,
          seasonId: row.season_id,
          round: row.round,
          slot: row.slot,
          overallPick: row.overall_pick,
          originalFranchiseId: row.original_franchise_id,
          currentFranchiseId: row.current_franchise_id,
          ownershipConfidence: row.ownership_confidence,
        }) as DraftPickAsset,
    );
  }

  async countRows(table: string): Promise<number> {
    const { count, error } = await this.client
      .from(table)
      .select('*', { count: 'exact', head: true });
    unwrap(`count ${table}`, error);
    return count ?? 0;
  }

  async readFranchises(seasonId: SeasonId): Promise<{ id: string; displayName: string }[]> {
    const { data, error } = await this.client
      .from('franchise_seasons')
      .select('franchise_id, franchises(display_name)')
      .eq('season_id', seasonId);
    unwrap('read franchises', error);

    return (data ?? []).map((row) => {
      const joined = row.franchises as unknown as { display_name: string } | null;
      return { id: String(row.franchise_id), displayName: joined?.display_name ?? '' };
    });
  }
}
