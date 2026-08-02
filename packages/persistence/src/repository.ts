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
          },
          { onConflict: 'id' },
        )
      ).error,
    );
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

  async savePlayers(players: readonly PlayerRecord[]): Promise<number> {
    if (players.length === 0) {
      return 0;
    }
    unwrap(
      'players',
      (
        await this.client.from('players').upsert(
          players.map((player) => ({
            id: player.id,
            full_name: player.fullName,
            position: player.position,
            sleeper_player_id: player.sleeperPlayerId,
          })),
          { onConflict: 'id' },
        )
      ).error,
    );
    return players.length;
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

  async saveKeeperRights(rights: readonly KeeperRight[]): Promise<number> {
    if (rights.length === 0) {
      return 0;
    }
    unwrap(
      'keeper_rights',
      (
        await this.client.from('keeper_rights').upsert(
          rights.map((right) => ({
            id: right.id,
            season_id: right.seasonId,
            franchise_id: right.franchiseId,
            player_id: right.playerId,
            source_type: right.sourceType,
            nominal_round: right.nominalRound,
            confidence: right.confidence,
            manual_override_reason: right.manualOverrideReason,
          })),
          { onConflict: 'id' },
        )
      ).error,
    );
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
