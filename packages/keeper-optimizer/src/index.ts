import type { KeeperRight, KeeperRightId } from '@keeper/domain';

export interface KeeperCombination {
  selectedKeeperRightIds: KeeperRightId[];
}

// Placeholder until Phase 1 implements exhaustive combination enumeration and pick resolution.
export function enumerateKeeperCombinations(keeperRights: KeeperRight[]): KeeperCombination[] {
  return keeperRights.length === 0 ? [{ selectedKeeperRightIds: [] }] : [];
}
