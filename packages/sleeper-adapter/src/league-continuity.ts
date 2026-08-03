export interface SleeperLeagueLink {
  sleeperLeagueId: string;
  previousSleeperLeagueId: string | null;
}

export interface SleeperLeagueContinuity {
  /** Oldest Sleeper league id in the chain; stable as later seasons are appended. */
  rootSleeperLeagueId: string;
  /** Current season first, oldest season last. */
  sleeperLeagueIds: string[];
}

/**
 * Follows Sleeper's previous-league pointers to the oldest known season.
 *
 * Sleeper creates a new league id each year. Using the current id as the internal League
 * identity splits one continuing league into unrelated records and gives the same manager
 * a different franchise id every season.
 */
export async function resolveSleeperLeagueContinuity(input: {
  current: SleeperLeagueLink;
  loadLeague: (sleeperLeagueId: string) => Promise<SleeperLeagueLink>;
  maxSeasons?: number;
}): Promise<SleeperLeagueContinuity> {
  const maxSeasons = input.maxSeasons ?? 100;
  if (!Number.isInteger(maxSeasons) || maxSeasons < 1) {
    throw new Error('maxSeasons must be a positive integer.');
  }

  const sleeperLeagueIds = [input.current.sleeperLeagueId];
  const seen = new Set(sleeperLeagueIds);
  let cursor = input.current;

  while (cursor.previousSleeperLeagueId !== null) {
    const previousId = cursor.previousSleeperLeagueId;
    if (seen.has(previousId)) {
      throw new Error(`Sleeper previous-league chain contains a cycle at ${previousId}.`);
    }
    if (sleeperLeagueIds.length >= maxSeasons) {
      throw new Error(`Sleeper previous-league chain exceeds ${maxSeasons} seasons.`);
    }

    const previous = await input.loadLeague(previousId);
    if (previous.sleeperLeagueId !== previousId) {
      throw new Error(
        `Requested Sleeper league ${previousId}, but the response identified itself as ${previous.sleeperLeagueId}.`,
      );
    }

    sleeperLeagueIds.push(previousId);
    seen.add(previousId);
    cursor = previous;
  }

  return {
    rootSleeperLeagueId: sleeperLeagueIds.at(-1)!,
    sleeperLeagueIds,
  };
}
