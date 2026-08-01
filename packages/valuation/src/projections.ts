import type { LeagueStateSnapshot, PlayerId, PlayerSeason, SeasonId } from '@keeper/domain';

export interface ProjectionSource {
  version: string;
  getProjectedPoints(playerId: PlayerId, seasonId: SeasonId): number | null;
}

export function createProjectionSourceFromPlayerSeasons(
  playerSeasons: PlayerSeason[],
  version = 'fixture-projection-0',
): ProjectionSource {
  const pointsByKey = new Map<string, number | null>(
    playerSeasons.map((playerSeason) => [
      projectionKey(playerSeason.playerId, playerSeason.seasonId),
      playerSeason.projectedPoints,
    ]),
  );

  return {
    version,
    getProjectedPoints(playerId, seasonId) {
      return pointsByKey.get(projectionKey(playerId, seasonId)) ?? null;
    },
  };
}

export function createSnapshotProjectionSource(
  snapshot: LeagueStateSnapshot,
  version?: string,
): ProjectionSource {
  return createProjectionSourceFromPlayerSeasons(snapshot.playerSeasons, version);
}

function projectionKey(playerId: PlayerId, seasonId: SeasonId): string {
  return `${seasonId}::${playerId}`;
}
