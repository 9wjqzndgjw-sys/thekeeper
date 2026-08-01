import type { DraftSelectionInput } from './reconcile.js';

/**
 * The shape of a Sleeper draft pick this package needs. Declared structurally rather than
 * imported so the tracker keeps its domain-only dependency: the adapter's
 * `NormalizedSleeperDraftPick` satisfies this without an import edge between packages.
 */
export interface SleeperDraftPickLike {
  pickNo: number;
  round: number;
  draftSlot: number | null;
  rosterId: number | null;
  sleeperPlayerId: string | null;
  isKeeper: boolean;
}

export interface SleeperDraftPickSource {
  getDraftPicks(draftId: string): Promise<{ data: readonly SleeperDraftPickLike[] }>;
}

export function toDraftSelectionInput(pick: SleeperDraftPickLike): DraftSelectionInput {
  return {
    overallPick: pick.pickNo,
    round: pick.round,
    slot: pick.draftSlot,
    rosterId: pick.rosterId,
    playerId: pick.sleeperPlayerId,
    isKeeper: pick.isKeeper,
  };
}

/**
 * Builds the `fetchSelections` function the tracker polls with. The abort signal is
 * observed before and after the request so a stop during an in-flight fetch does not
 * reconcile a payload the caller has already abandoned.
 */
export function createSleeperSelectionFetcher(
  source: SleeperDraftPickSource,
  draftId: string,
): (signal: AbortSignal) => Promise<DraftSelectionInput[]> {
  return async (signal: AbortSignal) => {
    if (signal.aborted) {
      throw new Error(`Draft selection fetch aborted before starting: ${draftId}`);
    }

    const response = await source.getDraftPicks(draftId);
    if (signal.aborted) {
      throw new Error(`Draft selection fetch aborted: ${draftId}`);
    }

    return response.data.map(toDraftSelectionInput);
  };
}
