export const MINIMUM_PROJECTION_MATCH_RATE = 0.9;

export function canReplaceProjections(input: {
  loadErrorCount: number;
  loadedPlayerCount: number;
  matchedPlayerCount: number;
}): boolean {
  return (
    input.loadErrorCount === 0 &&
    input.loadedPlayerCount > 0 &&
    input.matchedPlayerCount / input.loadedPlayerCount >= MINIMUM_PROJECTION_MATCH_RATE
  );
}

export function canReplacePickInventory(input: {
  importErrorCount: number;
  pickCount: number;
}): boolean {
  return input.importErrorCount === 0 && input.pickCount > 0;
}

export function canReplaceKeeperState(input: {
  reconstructionErrorCount: number;
  reconstructedRightCount: number;
  persistableRightCount: number;
  missingPlayerCount: number;
}): boolean {
  return (
    input.reconstructionErrorCount === 0 &&
    input.reconstructedRightCount > 0 &&
    input.missingPlayerCount === 0 &&
    input.persistableRightCount === input.reconstructedRightCount
  );
}
