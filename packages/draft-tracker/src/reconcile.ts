/**
 * Selections are keyed by draft id plus overall pick, so replaying the same payload is a
 * no-op and a corrected pick updates in place instead of appending a second row.
 */
export interface DraftSelectionInput {
  overallPick: number;
  round: number;
  slot: number | null;
  rosterId: number | null;
  playerId: string | null;
  isKeeper: boolean;
}

export type TrackedSelectionSource = 'api' | 'manual';

export interface TrackedSelection extends DraftSelectionInput {
  draftId: string;
  source: TrackedSelectionSource;
  recordedAt: string;
}

export type TrackedSelectionField = 'round' | 'slot' | 'rosterId' | 'playerId' | 'isKeeper';

export type DraftTrackerEvent =
  | { type: 'pick_added'; selection: TrackedSelection }
  | {
      type: 'pick_corrected';
      previous: TrackedSelection;
      selection: TrackedSelection;
      changedFields: TrackedSelectionField[];
    }
  | { type: 'pick_removed'; selection: TrackedSelection }
  | { type: 'duplicate_ignored'; overallPick: number; ignored: DraftSelectionInput }
  | { type: 'manual_pick_confirmed'; selection: TrackedSelection }
  | {
      type: 'manual_pick_superseded';
      previous: TrackedSelection;
      selection: TrackedSelection;
      changedFields: TrackedSelectionField[];
    }
  | { type: 'empty_response_ignored'; retainedSelectionCount: number };

export interface ReconcileSelectionsInput {
  draftId: string;
  previous: readonly TrackedSelection[];
  incoming: readonly DraftSelectionInput[];
  recordedAt: string;
  /**
   * Sleeper returns the full pick list, so a pick that disappears is a real removal.
   * Disable when the payload is known to be partial, e.g. a manual injection.
   */
  treatMissingAsRemoved?: boolean;
}

export interface ReconcileSelectionsResult {
  selections: TrackedSelection[];
  events: DraftTrackerEvent[];
  changed: boolean;
}

const COMPARED_FIELDS: readonly TrackedSelectionField[] = [
  'round',
  'slot',
  'rosterId',
  'playerId',
  'isKeeper',
];

/**
 * Folds a fresh payload into canonical state. Pure and order-independent: the result
 * depends only on the inputs, so the same payload applied twice produces no second round
 * of events, and the caller can persist each returned array as an immutable snapshot.
 */
export function reconcileSelections(input: ReconcileSelectionsInput): ReconcileSelectionsResult {
  const events: DraftTrackerEvent[] = [];
  const previousByOverallPick = new Map(
    input.previous.map((selection) => [selection.overallPick, selection]),
  );

  // A draft that has already produced picks does not legitimately go back to zero. Losing
  // the whole board to one bad response would erase last known good state, so retain it.
  if (input.incoming.length === 0 && input.previous.length > 0) {
    return {
      selections: sortSelections([...input.previous]),
      events: [{ type: 'empty_response_ignored', retainedSelectionCount: input.previous.length }],
      changed: false,
    };
  }

  const incomingByOverallPick = new Map<number, DraftSelectionInput>();
  for (const selection of input.incoming) {
    const existing = incomingByOverallPick.get(selection.overallPick);
    if (existing) {
      events.push({
        type: 'duplicate_ignored',
        overallPick: selection.overallPick,
        ignored: existing,
      });
    }
    incomingByOverallPick.set(selection.overallPick, selection);
  }

  const selections: TrackedSelection[] = [];
  let changed = false;

  for (const [overallPick, incoming] of incomingByOverallPick) {
    const previous = previousByOverallPick.get(overallPick);
    const next: TrackedSelection = {
      ...incoming,
      draftId: input.draftId,
      source: 'api',
      recordedAt: previous ? previous.recordedAt : input.recordedAt,
    };

    if (!previous) {
      selections.push({ ...next, recordedAt: input.recordedAt });
      events.push({ type: 'pick_added', selection: { ...next, recordedAt: input.recordedAt } });
      changed = true;
      continue;
    }

    const changedFields = diffSelection(previous, incoming);
    if (changedFields.length === 0) {
      // Identical to what we already hold. Keep the original record so a manual entry that
      // the API later confirms is not silently re-dated, but do mark it API-backed.
      if (previous.source === 'manual') {
        const confirmed: TrackedSelection = { ...previous, source: 'api' };
        selections.push(confirmed);
        events.push({ type: 'manual_pick_confirmed', selection: confirmed });
        changed = true;
      } else {
        selections.push(previous);
      }
      continue;
    }

    const updated: TrackedSelection = { ...next, recordedAt: input.recordedAt };
    selections.push(updated);
    events.push(
      previous.source === 'manual'
        ? { type: 'manual_pick_superseded', previous, selection: updated, changedFields }
        : { type: 'pick_corrected', previous, selection: updated, changedFields },
    );
    changed = true;
  }

  for (const previous of input.previous) {
    if (incomingByOverallPick.has(previous.overallPick)) {
      continue;
    }
    // A manual entry the API has not caught up to yet is not a removal.
    if (previous.source === 'manual' || input.treatMissingAsRemoved === false) {
      selections.push(previous);
      continue;
    }
    events.push({ type: 'pick_removed', selection: previous });
    changed = true;
  }

  return { selections: sortSelections(selections), events, changed };
}

/**
 * Records a pick entered by hand while the API is unreachable. The entry is marked
 * `manual` so the UI can label it and so a later API payload can confirm or supersede it
 * in place rather than adding a second pick at the same slot.
 */
export function injectManualSelection(input: {
  draftId: string;
  previous: readonly TrackedSelection[];
  selection: DraftSelectionInput;
  recordedAt: string;
}): ReconcileSelectionsResult {
  const existing = input.previous.find(
    (selection) => selection.overallPick === input.selection.overallPick,
  );
  const manual: TrackedSelection = {
    ...input.selection,
    draftId: input.draftId,
    source: 'manual',
    recordedAt: input.recordedAt,
  };

  if (!existing) {
    return {
      selections: sortSelections([...input.previous, manual]),
      events: [{ type: 'pick_added', selection: manual }],
      changed: true,
    };
  }

  const changedFields = diffSelection(existing, input.selection);
  if (changedFields.length === 0) {
    return { selections: sortSelections([...input.previous]), events: [], changed: false };
  }

  return {
    selections: sortSelections([
      ...input.previous.filter(
        (selection) => selection.overallPick !== input.selection.overallPick,
      ),
      manual,
    ]),
    events: [{ type: 'pick_corrected', previous: existing, selection: manual, changedFields }],
    changed: true,
  };
}

function diffSelection(
  previous: DraftSelectionInput,
  incoming: DraftSelectionInput,
): TrackedSelectionField[] {
  return COMPARED_FIELDS.filter((field) => previous[field] !== incoming[field]);
}

function sortSelections(selections: TrackedSelection[]): TrackedSelection[] {
  return selections.sort((left, right) => left.overallPick - right.overallPick);
}
