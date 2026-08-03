import { describe, expect, it } from 'vitest';
import type { KeeperRight, SeasonId } from '@keeper/domain';
import { KeeperRepository, type KeeperDecisionRecord } from './repository.js';
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
});
