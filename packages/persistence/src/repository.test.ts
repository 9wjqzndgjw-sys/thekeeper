import { describe, expect, it } from 'vitest';
import type { DraftPickAsset, KeeperRight, SeasonId } from '@keeper/domain';
import {
  KeeperRepository,
  type KeeperDecisionRecord,
  type PlayerSeasonRecord,
} from './repository.js';
import type { KeeperDatabaseClient } from './client.js';

const seasonId = 'season:1' as SeasonId;

/**
 * An in-memory stand-in for the PostgREST client, supporting exactly the calls the
 * repository makes.
 *
 * Worth the weight: every destructive bug in the replace path passed the whole suite,
 * because nothing exercised the repository at all. A fake that holds rows and honours
 * delete filters is the smallest thing that can tell "removed what the import omitted" from
 * "removed everything".
 */
function fakeClient(initial: Record<string, Record<string, unknown>[]>) {
  const tables: Record<string, Record<string, unknown>[]> = structuredClone(initial);

  const client = {
    from(table: string) {
      tables[table] ??= [];
      const rows = () => tables[table]!;

      const builder = {
        _filters: [] as ((row: Record<string, unknown>) => boolean)[],
        _mode: 'select' as 'select' | 'delete',
        _columns: '' as string,

        select(columns: string) {
          this._mode = 'select';
          this._columns = columns;
          return this;
        },
        delete() {
          this._mode = 'delete';
          return this;
        },
        eq(column: string, value: unknown) {
          this._filters.push((row) => row[column] === value);
          return this;
        },
        in(column: string, values: unknown[]) {
          this._filters.push((row) => values.includes(row[column]));
          return this;
        },
        upsert(payload: Record<string, unknown>[], options: { onConflict: string }) {
          const keys = options.onConflict.split(',').map((key) => key.trim());
          for (const incoming of payload) {
            const existing = rows().find((row) => keys.every((key) => row[key] === incoming[key]));
            if (existing) {
              Object.assign(existing, incoming);
            } else {
              rows().push({ ...incoming });
            }
          }
          return Promise.resolve({ error: null });
        },
        then(resolve: (value: { data: unknown; error: null }) => unknown) {
          const matched = rows().filter((row) => this._filters.every((filter) => filter(row)));
          if (this._mode === 'delete') {
            tables[table] = rows().filter((row) => !matched.includes(row));
            return resolve({ data: matched, error: null });
          }
          return resolve({ data: matched, error: null });
        },
      };
      return builder;
    },
  };

  return { client: client as unknown as KeeperDatabaseClient, tables };
}

function right(id: string, playerId: string, sourceType = 'drafted'): KeeperRight {
  return {
    id,
    seasonId,
    franchiseId: 'f1',
    playerId,
    sourceType,
    nominalRound: 5,
    priorSeasonRound: 6,
    effectiveOverallPick: null,
    confidence: 'inferred',
    manualOverrideReason: null,
  } as KeeperRight;
}

function decision(
  playerId: string,
  source: 'sleeper' | 'manual' = 'sleeper',
): KeeperDecisionRecord {
  return {
    seasonId,
    franchiseId: 'f1',
    playerId,
    keeperRightId: `k-${playerId}`,
    resolvedPickAssetId: null,
    source,
    declaredAt: null,
  };
}

function pick(id: string, round: number): DraftPickAsset {
  return {
    id,
    seasonId,
    round,
    originalFranchiseId: 'f1',
    currentFranchiseId: 'f1',
    slot: 1,
    overallPick: (round - 1) * 12 + 1,
    ownershipConfidence: 'confirmed',
  } as DraftPickAsset;
}

function playerSeason(playerId: string, projectedPoints: number): PlayerSeasonRecord {
  return {
    seasonId,
    playerId,
    projectedPoints,
    projectionSource: 'test',
  };
}

describe('replaceKeeperDecisions', () => {
  it('removes a withdrawn declaration', () => {
    const { client, tables } = fakeClient({
      keeper_decisions: [
        { season_id: seasonId, player_id: 'a', source: 'sleeper' },
        { season_id: seasonId, player_id: 'b', source: 'sleeper' },
      ],
    });

    return new KeeperRepository(client)
      .replaceKeeperDecisions(seasonId, [decision('a')])
      .then((counts) => {
        expect(counts.removed).toBe(1);
        expect(tables.keeper_decisions!.map((row) => row.player_id)).toEqual(['a']);
      });
  });

  it('clears every declaration when the league withdraws them all', () => {
    // The case the early return used to skip entirely, and the one where every stored row
    // is stale by definition.
    const { client, tables } = fakeClient({
      keeper_decisions: [{ season_id: seasonId, player_id: 'a', source: 'sleeper' }],
    });

    return new KeeperRepository(client).replaceKeeperDecisions(seasonId, []).then((counts) => {
      expect(counts.removed).toBe(1);
      expect(tables.keeper_decisions).toEqual([]);
    });
  });

  it('never deletes a manual declaration', () => {
    // A manual row exists because Sleeper is wrong about something. Reading its absence from
    // the API as an instruction to delete it destroys the correction, and the reason someone
    // made it is the reason it will not come back on its own.
    const { client, tables } = fakeClient({
      keeper_decisions: [
        { season_id: seasonId, player_id: 'a', source: 'sleeper' },
        { season_id: seasonId, player_id: 'manual-only', source: 'manual' },
      ],
    });

    return new KeeperRepository(client).replaceKeeperDecisions(seasonId, []).then(() => {
      expect(tables.keeper_decisions!.map((row) => row.player_id)).toEqual(['manual-only']);
    });
  });

  it('does not overwrite a manual declaration when Sleeper reports the same player', async () => {
    const { client, tables } = fakeClient({
      keeper_decisions: [
        {
          season_id: seasonId,
          franchise_id: 'manual-franchise',
          player_id: 'a',
          keeper_right_id: 'manual-right',
          source: 'manual',
        },
      ],
    });

    const counts = await new KeeperRepository(client).replaceKeeperDecisions(seasonId, [
      decision('a'),
    ]);

    expect(counts).toEqual({ written: 0, removed: 0 });
    expect(tables.keeper_decisions).toEqual([
      expect.objectContaining({
        franchise_id: 'manual-franchise',
        keeper_right_id: 'manual-right',
        player_id: 'a',
        source: 'manual',
      }),
    ]);
  });

  it('leaves another season alone', () => {
    const { client, tables } = fakeClient({
      keeper_decisions: [
        { season_id: seasonId, player_id: 'a', source: 'sleeper' },
        { season_id: 'season:other', player_id: 'a', source: 'sleeper' },
      ],
    });

    return new KeeperRepository(client).replaceKeeperDecisions(seasonId, []).then(() => {
      expect(tables.keeper_decisions!.map((row) => row.season_id)).toEqual(['season:other']);
    });
  });
});

describe('replaceKeeperRights', () => {
  it('removes rights the import no longer mentions', () => {
    const { client, tables } = fakeClient({
      keeper_rights: [
        { season_id: seasonId, id: 'k1', source_type: 'drafted' },
        { season_id: seasonId, id: 'k2', source_type: 'drafted' },
      ],
    });

    return new KeeperRepository(client)
      .replaceKeeperRights(seasonId, [right('k1', 'a')])
      .then((counts) => {
        expect(counts.removed).toBe(1);
        expect(tables.keeper_rights!.map((row) => row.id)).toEqual(['k1']);
      });
  });

  it('never deletes a manual override', () => {
    const { client, tables } = fakeClient({
      keeper_rights: [
        { season_id: seasonId, id: 'k1', source_type: 'drafted' },
        { season_id: seasonId, id: 'k-fix', source_type: 'manual_override' },
      ],
    });

    return new KeeperRepository(client).replaceKeeperRights(seasonId, []).then(() => {
      expect(tables.keeper_rights!.map((row) => row.id)).toEqual(['k-fix']);
    });
  });

  it('does not overwrite a manual right with the same id', async () => {
    const { client, tables } = fakeClient({
      keeper_rights: [
        {
          season_id: seasonId,
          franchise_id: 'f1',
          player_id: 'a',
          id: 'k1',
          source_type: 'manual_override',
          nominal_round: 2,
        },
      ],
    });

    const counts = await new KeeperRepository(client).replaceKeeperRights(seasonId, [
      right('k1', 'a'),
    ]);

    expect(counts).toEqual({ written: 0, removed: 0 });
    expect(tables.keeper_rights).toEqual([
      expect.objectContaining({
        id: 'k1',
        nominal_round: 2,
        source_type: 'manual_override',
      }),
    ]);
  });

  it('does not insert a second right over a manual correction with a different id', async () => {
    const { client, tables } = fakeClient({
      keeper_rights: [
        {
          season_id: seasonId,
          franchise_id: 'f1',
          player_id: 'a',
          id: 'manual-k1',
          source_type: 'manual_override',
          nominal_round: 2,
        },
      ],
    });

    const counts = await new KeeperRepository(client).replaceKeeperRights(seasonId, [
      right('sleeper-k1', 'a'),
    ]);

    expect(counts).toEqual({ written: 0, removed: 0 });
    expect(tables.keeper_rights).toHaveLength(1);
    expect(tables.keeper_rights![0]).toMatchObject({
      id: 'manual-k1',
      nominal_round: 2,
      source_type: 'manual_override',
    });
  });
});

describe('replacePickInventory', () => {
  it('removes omitted picks without touching another season', async () => {
    const { client, tables } = fakeClient({
      draft_pick_assets: [
        { season_id: seasonId, id: 'p1', round: 1 },
        { season_id: seasonId, id: 'p2', round: 2 },
        { season_id: 'season:other', id: 'other-pick', round: 1 },
      ],
    });

    const counts = await new KeeperRepository(client).replacePickInventory(seasonId, [
      pick('p1', 3),
    ]);

    expect(counts).toEqual({ written: 1, removed: 1 });
    expect(tables.draft_pick_assets).toEqual([
      expect.objectContaining({ id: 'p1', round: 3, season_id: seasonId }),
      expect.objectContaining({ id: 'other-pick', season_id: 'season:other' }),
    ]);
  });
});

describe('replacePlayerSeasons', () => {
  it('removes omitted projections without touching another season', async () => {
    const { client, tables } = fakeClient({
      player_seasons: [
        { season_id: seasonId, player_id: 'a', projected_points: 100 },
        { season_id: seasonId, player_id: 'b', projected_points: 90 },
        { season_id: 'season:other', player_id: 'a', projected_points: 80 },
      ],
    });

    const counts = await new KeeperRepository(client).replacePlayerSeasons(seasonId, [
      playerSeason('a', 120),
    ]);

    expect(counts).toEqual({ written: 1, removed: 1 });
    expect(tables.player_seasons).toEqual([
      expect.objectContaining({
        player_id: 'a',
        projected_points: 120,
        season_id: seasonId,
      }),
      expect.objectContaining({
        player_id: 'a',
        projected_points: 80,
        season_id: 'season:other',
      }),
    ]);
  });
});

describe('decision links to keeper rights', () => {
  // A right is dropped from the write when a manual override already covers that franchise
  // and player. The decision built alongside it still named the imported right, and
  // keeper_decisions references keeper_rights, so the insert failed and took the whole sync
  // down: protecting a correction made the next import impossible.
  it('points a decision at the manual right that replaced its imported one', () => {
    const { client, tables } = fakeClient({
      keeper_rights: [
        {
          season_id: seasonId,
          id: 'manual-fix',
          franchise_id: 'f1',
          player_id: 'p1',
          source_type: 'manual_override',
        },
      ],
      keeper_decisions: [],
    });

    return new KeeperRepository(client)
      .saveKeeperDecisions([
        {
          seasonId,
          franchiseId: 'f1',
          playerId: 'p1',
          keeperRightId: 'imported-right-that-was-excluded',
          resolvedPickAssetId: null,
          source: 'sleeper',
          declaredAt: null,
        },
      ])
      .then(() => {
        expect(tables.keeper_decisions![0]!.keeper_right_id).toBe('manual-fix');
      });
  });

  it('drops the link rather than inventing one when no right matches', () => {
    // A decision with no right is still a true statement that the player was declared.
    const { client, tables } = fakeClient({ keeper_rights: [], keeper_decisions: [] });

    return new KeeperRepository(client)
      .saveKeeperDecisions([
        {
          seasonId,
          franchiseId: 'f1',
          playerId: 'p1',
          keeperRightId: 'missing',
          resolvedPickAssetId: null,
          source: 'sleeper',
          declaredAt: null,
        },
      ])
      .then(() => {
        expect(tables.keeper_decisions![0]!.keeper_right_id).toBeNull();
      });
  });

  it('leaves an existing link alone', () => {
    const { client, tables } = fakeClient({
      keeper_rights: [
        {
          season_id: seasonId,
          id: 'k-p1',
          franchise_id: 'f1',
          player_id: 'p1',
          source_type: 'drafted',
        },
      ],
      keeper_decisions: [],
    });

    return new KeeperRepository(client).saveKeeperDecisions([decision('p1')]).then(() => {
      expect(tables.keeper_decisions![0]!.keeper_right_id).toBe('k-p1');
    });
  });
});
