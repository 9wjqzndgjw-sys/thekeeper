import type { Position } from '@keeper/domain';

/** The bits of a catalog player this matcher needs. */
export interface CatalogPlayerLike {
  fullName: string;
  position: string;
  sleeperPlayerId: string | null;
}

/** A projected player, as loaded from an export. */
export interface ProjectedPlayerLike {
  fullName: string;
  position: Position;
  projectedPoints: number;
}

export interface MatchProjectionsToCatalogResult {
  /** Projected points keyed by Sleeper player id. */
  pointsBySleeperId: Map<string, number>;
  /** Position keyed by Sleeper player id, taken from the catalog rather than the export. */
  positionBySleeperId: Map<string, Position>;
  /** Catalog display name keyed by Sleeper player id. */
  nameBySleeperId: Map<string, string>;
  /** Projected players no catalog entry matched, by name. Worth reporting, never guessing. */
  unmatchedProjectionNames: string[];
}

/**
 * Collapses a name to a comparable key.
 *
 * Case and punctuation go first, so "Ja'Marr" and "JaMarr" agree. Then generational
 * suffixes, because projection exports carry them and Sleeper frequently does not --
 * "Kenneth Walker III" and "Kenneth Walker" are one player, and leaving that unhandled
 * silently dropped real keepers from the board.
 */
export function normalizeProjectionName(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\b(jr|sr|ii|iii|iv|v)\b/g, '')
    .replace(/[^a-z]/g, '');
}

/**
 * Joins projections to the player catalog on position plus normalized name, because the
 * exports carry no Sleeper ids.
 *
 * Position is part of the key rather than something taken from the export: two players can
 * share a name, and the catalog is the authority on who plays where. A projection that
 * finds no catalog entry is reported, not approximated -- a wrong identity here prices a
 * real player against the wrong replacement level.
 */
export function matchProjectionsToCatalog(input: {
  projections: readonly ProjectedPlayerLike[];
  catalog: readonly CatalogPlayerLike[];
}): MatchProjectionsToCatalogResult {
  const projectionsByKey = new Map<string, ProjectedPlayerLike>();
  for (const projection of input.projections) {
    projectionsByKey.set(
      `${projection.position}:${normalizeProjectionName(projection.fullName)}`,
      projection,
    );
  }

  const pointsBySleeperId = new Map<string, number>();
  const positionBySleeperId = new Map<string, Position>();
  const nameBySleeperId = new Map<string, string>();
  const matchedKeys = new Set<string>();

  for (const player of input.catalog) {
    if (!player.sleeperPlayerId) {
      continue;
    }
    positionBySleeperId.set(player.sleeperPlayerId, player.position as Position);
    nameBySleeperId.set(player.sleeperPlayerId, player.fullName);

    const key = `${player.position}:${normalizeProjectionName(player.fullName)}`;
    const projection = projectionsByKey.get(key);
    if (projection !== undefined) {
      pointsBySleeperId.set(player.sleeperPlayerId, projection.projectedPoints);
      matchedKeys.add(key);
    }
  }

  return {
    pointsBySleeperId,
    positionBySleeperId,
    nameBySleeperId,
    unmatchedProjectionNames: [...projectionsByKey.entries()]
      .filter(([key]) => !matchedKeys.has(key))
      .map(([, projection]) => projection.fullName)
      .sort(),
  };
}
